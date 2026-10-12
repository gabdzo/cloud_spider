// The EKS demo app's two collectors (upgrades/demo): the image must ship
// every component the configs name. ADOT v0.50 has no kubeletstats or
// hostmetrics, so the collector crashed on start; they run the upstream
// contrib image, pinned, and this checks both configs against that release's
// component list (test/fixtures/otelcol-contrib-components.json, from
// `otelcol-contrib components`; canonical names only, so a deprecated alias
// fails too). With OTELCOL_CONTRIB=<path to that otelcol-contrib binary>
// the rendered configs also go through `otelcol-contrib validate`
// (scripts/otel-validate.sh downloads it and runs this).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import YAML from "yaml";

const run = promisify(execFile);
const root = new URL("../", import.meta.url).pathname;
const contrib = JSON.parse(readFileSync(join(root, "test/fixtures/otelcol-contrib-components.json"), "utf8"));
const IMAGE = `otel/opentelemetry-collector-contrib:${contrib.version}`;
const ready = existsSync(join(root, "upgrades/demo/node_modules/@pulumi/kubernetes")) ? false : "run npm ci in upgrades/demo";

let rendered;
async function demo() {
  rendered ??= run(process.execPath, ["scripts/pulumi-mock.mjs", "upgrades/demo", "cloudspider-demo", "demo", JSON.stringify({ "cloudspider-demo:clusterName": "cloudspider-up" })], { cwd: root, maxBuffer: 32 << 20 }).then(({ stdout }) => JSON.parse(stdout));
  return rendered;
}
const one = (resources, type, name) => resources.find((r) => r.type.endsWith(type) && r.name === name)?.inputs;
const configOf = (resources, name) => one(resources, "ConfigMap", name).data["config.yaml"];
const typeOf = (id) => String(id).split("/")[0];

test("every receiver, processor and exporter in both collector configs is in the pinned contrib release", { skip: ready }, async () => {
  const resources = await demo();
  for (const name of ["otel-collector", "otel-gateway"]) {
    const config = YAML.parse(configOf(resources, name));
    for (const kind of ["receivers", "processors", "exporters", "extensions", "connectors"]) {
      for (const id of Object.keys(config[kind] || {})) assert.ok(contrib[kind].includes(typeOf(id)), `${name}: ${kind} ${id} is not in otelcol-contrib ${contrib.version}`);
    }
    // Pipelines name only components the config defines.
    for (const [pipe, spec] of Object.entries(config.service.pipelines)) {
      for (const kind of ["receivers", "processors", "exporters"]) {
        for (const id of spec[kind] || []) assert.ok(id in (config[kind] || {}), `${name}: pipeline ${pipe} uses undefined ${kind} ${id}`);
      }
    }
  }
  const collector = YAML.parse(configOf(resources, "otel-collector"));
  for (const id of ["kubelet_stats", "host_metrics", "file_log"]) assert.ok(id in collector.receivers, id);
});

test("both collectors run the pinned multi-arch contrib image with its binary's --config", { skip: ready }, async () => {
  const resources = await demo();
  const daemon = one(resources, "DaemonSet", "otel-collector").spec.template.spec;
  const gateway = one(resources, "Deployment", "otel-gateway").spec.template.spec;
  for (const container of [daemon.containers[0], gateway.containers[0]]) {
    assert.match(container.image, new RegExp(`^${IMAGE.replace(/[.]/g, "\\.")}@sha256:[0-9a-f]{64}$`), "contrib, tag and index digest pinned");
    assert.equal(container.command, undefined, "the image's entrypoint is /otelcol-contrib");
    assert.deepEqual(container.args, ["--config=/conf/config.yaml"]);
    assert.ok(container.volumeMounts.some((m) => m.name === "conf" && m.mountPath === "/conf"));
  }
  assert.ok(!JSON.stringify(resources).includes("aws-otel-collector"), "no ADOT image left");
  // The contrib image runs as uid 10001; the node agent reads root-owned
  // /var/log/pods and the host's /proc, so it runs as root (no escalation).
  assert.equal(daemon.containers[0].securityContext.runAsUser, 0);
  assert.equal(daemon.containers[0].securityContext.allowPrivilegeEscalation, false);
  assert.equal(gateway.containers[0].securityContext?.runAsUser, undefined, "the gateway keeps the image's non-root user");
  // AWS exporters authenticate with EKS Pod Identity on the collector's account.
  assert.equal(daemon.serviceAccountName, "otel-collector");
  assert.equal(one(resources, "PodIdentityAssociation", "otel-collector").serviceAccount, "otel-collector");
});

test("otelcol-contrib validate passes on both rendered configs (OTELCOL_CONTRIB)", { skip: ready || (process.env.OTELCOL_CONTRIB ? false : "set OTELCOL_CONTRIB (scripts/otel-validate.sh)") }, async () => {
  const resources = await demo();
  const { stdout } = await run(process.env.OTELCOL_CONTRIB, ["--version"]);
  assert.match(stdout, new RegExp(`version ${contrib.version.replace(/[.]/g, "\\.")}\\b`));
  const dir = mkdtempSync(join(tmpdir(), "otel-validate-"));
  for (const name of ["otel-collector", "otel-gateway"]) {
    // Off the node: no /hostfs and no service account files, so those two
    // settings point at what this box has; everything else is as deployed.
    const local = configOf(resources, name).replace("root_path: /hostfs", "root_path: /").replace("auth_type: serviceAccount", "auth_type: none");
    const file = join(dir, `${name}.yaml`);
    writeFileSync(file, local);
    await run(process.env.OTELCOL_CONTRIB, ["validate", `--config=${file}`], { env: { ...process.env, K8S_NODE_IP: "127.0.0.1", K8S_NODE_NAME: "node-1" } });
  }
});

// 2026-10-12 preview on cloudspider-up: a config change (health_check) to the
// fixed-name ConfigMaps was a delete-before-replace, and Pulumi replaced the
// DaemonSet and Deployment that mount them too. Auto-named ConfigMaps are
// created first under a new name; the workloads only see their volume's
// configMap.name change, an in-place (rolling) update.
test("collector ConfigMaps are auto-named and the workloads mount them by output name (config change = new ConfigMap + rolling update)", { skip: ready }, async () => {
  const resources = await demo();
  for (const [name, kind] of [["otel-collector", "DaemonSet"], ["otel-gateway", "Deployment"]]) {
    const map = resources.find((r) => r.type === "kubernetes:core/v1:ConfigMap" && r.name === name);
    assert.equal(map.inputs.metadata.name, undefined, `${name}: no fixed ConfigMap name`);
    const workload = one(resources, kind, name);
    assert.equal(workload.metadata.name, name, `${kind} ${name} keeps its fixed name (updated in place)`);
    const volume = workload.spec.template.spec.volumes.find((v) => v.name === "conf");
    assert.equal(volume.configMap.name, `${name}-mock0000`, `${kind} ${name} mounts the auto-named ConfigMap`);
  }
  const source = readFileSync(join(root, "upgrades/demo/index.js"), "utf8");
  assert.doesNotMatch(source, /deleteBeforeReplace|replaceOnChanges/, "nothing forces a workload replace");
});

// 2026-10-12: podinfo logged "traces export: failed to exit idle mode: dns
// resolver: missing address" every few seconds; X-Ray had no trace at all.
test("podinfo's OTLP traces endpoint is a URL with a scheme and the collector's host and gRPC port", { skip: ready }, async () => {
  const resources = await demo();
  for (const name of ["api", "web"]) {
    const env = one(resources, "Deployment", name).spec.template.spec.containers[0].env;
    const endpoint = env.find((e) => e.name === "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT").value;
    const url = new URL(endpoint);
    assert.equal(url.protocol, "http:", `${name}: plaintext gRPC needs http://, a bare host:port has no host`);
    assert.equal(url.hostname, "otel-collector");
    assert.equal(url.port, "4317");
  }
});
