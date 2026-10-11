import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { parse } from "yaml";
import { lintEntries, lintFolder } from "../src/vault-lint.js";
import { createVaultStore, parseVaultText } from "../src/vaults.js";
import { matchVaults } from "../src/vault-match.js";

const run = promisify(execFile);
const root = new URL("../", import.meta.url).pathname;
const vaultsDir = `${root}vaults`;

test("every file in vaults/ is a valid vault and follows the conventions", async () => {
  const result = await lintFolder(vaultsDir);
  assert.deepEqual(result.problems, [], result.problems.map((item) => item.text).join("\n"));
  assert.ok(result.ok);
  assert.ok(result.files.includes("templates/example.yaml"));
  assert.ok(result.vaults >= 7);
});

test("vaults/templates/ holds templates: checked and listed, never drawn", async () => {
  const store = createVaultStore({ dir: vaultsDir });
  const loaded = await store.load();
  const files = loaded.vaults.map((vault) => vault.file);
  assert.ok(!files.some((file) => /example/.test(file)));
  const templates = await store.templates();
  assert.ok(templates.some((item) => item.file === "templates/example.yaml"));
  assert.ok(templates.every((item) => !item.damaged));
  assert.ok(files.includes("eks.yaml"));
  assert.ok(loaded.vaults.every((vault) => !vault.damaged));
  // The template uses every field the format has.
  const doc = parse(readFileSync(`${vaultsDir}/templates/example.yaml`, "utf8"));
  assert.deepEqual(Object.keys(doc.metadata).sort(), ["description", "name", "number", "owner", "tags", "title"]);
  assert.deepEqual(Object.keys(doc.spec).sort(), ["checks", "links", "resources", "slos", "stack", "type"]);
  assert.deepEqual(Object.keys(doc.spec.slos[0]).sort(), ["name", "sli", "source", "target", "window"]);
  assert.ok(doc.spec.slos.some((slo) => slo.threshold));
  assert.deepEqual(Object.keys(doc.spec.links).sort(), ["dashboard", "docs", "repo", "view"]);
  assert.deepEqual(Object.keys(doc.spec.checks.http[0]).sort(), ["contains", "expect", "name", "timeout", "url"]);
});

test("the lint catches a project tag that is not the vault name and a reused number", () => {
  const file = (name, number, project) =>
    `apiVersion: cloudspider/v1\nkind: Vault\nmetadata: {name: ${name}, number: ${number}, description: D, owner: me}\nspec:\n  type: api\n  resources: {tags: {project: ${project}}}\n`;
  const entries = [...parseVaultText(file("a", 1, "a"), "a.yaml"), ...parseVaultText(file("b", 1, "bee"), "b.yaml")];
  const texts = lintEntries(entries).map((item) => item.text);
  assert.deepEqual(texts, [
    "b.yaml: spec.resources.tags.project is bee; the convention is project: b",
    "b.yaml: metadata.number 1 is already VAULT 1 in a.yaml",
  ]);
});

test("npm run vaults:check passes on vaults/ and fails on the damaged sample", async () => {
  const ok = await run(process.execPath, ["scripts/vaults-check.mjs"], { cwd: root });
  assert.match(ok.stdout, /all valid/);
  await assert.rejects(run(process.execPath, ["scripts/vaults-check.mjs", "samples/vaults"], { cwd: root }), (error) => {
    assert.equal(error.code, 1);
    assert.match(error.stdout, /ERROR reactor\.yaml: metadata\.owner: is required/);
    return true;
  });
});

// The Pulumi programs, run under mocks: every taggable resource carries the
// project tag of exactly one vault file, and each vault selects it.
const PROGRAMS = [
  { dir: "infra", project: "cloudspider", stack: "test", stackDefault: "cloudspider", vaults: ["cloudspider"] },
  { dir: "upgrades/eks", project: "cloudspider-upgrade", stack: "upgrade", vaults: ["eks"] },
  { dir: "upgrades/signal", project: "cloudspider-signal", stack: "signal", vaults: ["signal"], template: true },
  { dir: "upgrades/barrel", project: "cloudspider-barrel", stack: "barrel", vaults: ["barrel"], template: true },
  { dir: "upgrades/camp", project: "cloudspider-camp", stack: "camp", vaults: ["camp"] },
  { dir: "upgrades/demo", project: "cloudspider-demo", stack: "demo", vaults: ["demo"] },
  { dir: "upgrades/rds", project: "cloudspider-rds", stack: "rds", vaults: ["rds"], template: true },
  // Its own AWS resources are only the EBS CSI driver it made before the EKS
  // stack owned it (kept until the migration): mock that cluster.
  { dir: "upgrades/pgcluster", project: "cloudspider-pgcluster", stack: "pgcluster", vaults: ["pgcluster"], template: true, eksAddons: { "eks-pod-identity-agent": { project: "eks" }, "aws-ebs-csi-driver": { project: "pgcluster" } } },
  { dir: "upgrades/site", project: "cloudspider-site", stack: "site", vaults: ["site"], template: true },
  { dir: "upgrades/worker", project: "cloudspider-worker", stack: "worker", vaults: ["worker"], template: true },
  { dir: "upgrades/openshift", project: "cloudspider-openshift", stack: "openshift", vaults: ["openshift"], template: true },
];

async function mocked(program, config = {}) {
  const env = program.eksAddons ? { ...process.env, CLOUDSPIDER_MOCK_EKS_ADDONS: JSON.stringify(program.eksAddons) } : process.env;
  const { stdout } = await run(process.execPath, ["scripts/pulumi-mock.mjs", program.dir, program.project, program.stack, JSON.stringify(config)], { cwd: root, env, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout);
}

function vaultFile(name, template = false) {
  return parse(readFileSync(`${vaultsDir}/${template ? "templates/" : ""}${name}.yaml`, "utf8"));
}

for (const program of PROGRAMS) {
  const ready = existsSync(`${root}${program.dir}/node_modules/@pulumi/pulumi`);
  test(`${program.dir}: every taggable resource has a project tag a vault selects`, { skip: ready ? false : `run npm ci in ${program.dir}` }, async () => {
    const resources = await mocked(program);
    const taggable = resources.filter((item) => item.type.startsWith("aws:") && "tags" in item.inputs);
    assert.ok(taggable.length > 0);
    if (program.stackDefault) {
      const stackFile = parse(readFileSync(`${root}${program.dir}/Pulumi.${program.stack}.yaml`, "utf8"));
      assert.equal(stackFile.config["aws:defaultTags"].tags.project, program.stackDefault, "the stack's default tag");
    }
    const seen = new Set();
    for (const item of taggable) {
      const project = item.inputs.tags?.project ?? program.stackDefault;
      assert.ok(project, `${item.type} ${item.name} has no project tag`);
      assert.ok(program.vaults.includes(project), `${item.name}: project=${project} is not one of ${program.vaults}`);
      seen.add(project);
    }
    assert.deepEqual([...seen].sort(), [...program.vaults].sort(), "each vault of this stack tags something");
    for (const name of program.vaults) {
      const doc = vaultFile(name, program.template);
      assert.deepEqual(doc.spec.resources.tags, { project: name }, `vaults/${name}.yaml selects project=${name}`);
    }
    // Tagged the way the map will read them: each tagged resource lands in its vault.
    const place = {
      instances: taggable.filter((item) => item.type === "aws:ec2/instance:Instance").map((item) => ({ id: `${item.name}-id`, name: item.inputs.tags?.Name || "", tags: Object.entries({ project: program.stackDefault, ...item.inputs.tags }).filter(([, v]) => v).map(([key, value]) => ({ key, value })) })),
      fixtures: taggable.filter((item) => item.type !== "aws:ec2/instance:Instance").map((item) => ({ id: `${item.type}:${item.name}`, kind: "generic", name: item.name, tags: { project: program.stackDefault, ...item.inputs.tags } })),
    };
    const store = createVaultStore({ dir: program.template ? `${vaultsDir}/templates` : vaultsDir, templates: program.template });
    const loaded = await store.load();
    const owned = matchVaults(loaded.vaults, place);
    const claimed = new Map();
    for (const [key, ids] of owned) for (const id of ids) claimed.set(id, key);
    for (const item of [...place.instances, ...place.fixtures]) {
      const project = item.tags?.project ?? item.tags?.find?.((tag) => tag.key === "project")?.value;
      assert.equal(claimed.get(item.id), project, `${item.id} is claimed by vault ${project}`);
    }
  });
}

test("upgrades/eks: a second cluster names its roles and node group after itself; the first is unchanged", { skip: existsSync(`${root}upgrades/eks/node_modules/@pulumi/pulumi`) ? false : "run npm ci in upgrades/eks" }, async () => {
  const program = PROGRAMS.find((item) => item.dir === "upgrades/eks");
  const first = await mocked(program);
  // The viewer and EBS CSI driver roles are new (no rename risk), so they
  // are named on every stack.
  for (const item of first.filter((r) => /iam\/role:Role$|eks\/nodeGroup:NodeGroup$/.test(r.type) && !["viewer", "ebs-csi-driver"].includes(r.name))) {
    assert.equal(item.inputs.name, undefined, `${item.name} keeps its auto name on the old stack`);
    assert.equal(item.inputs.nodeGroupName, undefined);
  }
  const second = await mocked({ ...program, stack: "eks-cloudspider-two" }, { "cloudspider-upgrade:clusterName": "cloudspider-two" });
  const byName = (type, name) => second.find((r) => r.type.endsWith(type) && r.name === name).inputs;
  assert.equal(byName("Role", "cluster").name, "cloudspider-two-cluster");
  assert.equal(byName("Role", "node").name, "cloudspider-two-node");
  assert.equal(byName("NodeGroup", "nodes").nodeGroupName, "cloudspider-two-nodes");
  assert.equal(byName("Cluster", "up").name, "cloudspider-two");
  assert.equal(byName("Role", "viewer").name, "cloudspider-two-viewer");
  assert.equal(byName("Cluster", "up").accessConfig.authenticationMode, "API_AND_CONFIG_MAP");
  assert.equal(first.find((r) => r.type.endsWith("Cluster")).inputs.accessConfig.bootstrapClusterCreatorAdminPermissions, undefined, "not set: changing it would replace the cluster");
  const policy = byName("AccessPolicyAssociation", "viewer");
  assert.equal(policy.policyArn, "arn:aws:eks::aws:cluster-access-policy/AmazonEKSViewPolicy", "view only, no Secrets");
  assert.deepEqual(byName("AccessEntry", "viewer").kubernetesGroups, ["cloudspider-viewers"]);
  for (const item of second.filter((r) => r.inputs.tags)) assert.equal(item.inputs.tags.cluster, "cloudspider-two", item.name);
  await assert.rejects(mocked({ ...program, stack: "eks-other" }, { "cloudspider-upgrade:clusterName": "cloudspider-two" }), /belongs in stack eks-cloudspider-two/);
});

test("living vaults name their Pulumi stack, and the stack folder exists", async () => {
  const loaded = await createVaultStore({ dir: vaultsDir }).load();
  const byName = Object.fromEntries(loaded.vaults.map((vault) => [vault.name, vault]));
  assert.deepEqual(byName.camp.stack, { dir: "upgrades/camp", name: "camp" });
  assert.deepEqual(byName.cloudspider.stack, { dir: "infra", name: "test" });
  assert.deepEqual(byName.eks.stack, { dir: "upgrades/eks", name: "*" });
  for (const vault of loaded.vaults.filter((item) => item.stack)) {
    assert.ok(existsSync(`${root}${vault.stack.dir}/Pulumi.yaml`), `${vault.file}: ${vault.stack.dir}/Pulumi.yaml`);
  }
});

test("vaults:new copies a template with the name, a free number and the project tag, never overwriting", async () => {
  const { mkdtempSync, mkdirSync, cpSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const dir = mkdtempSync(`${tmpdir()}/vaults-new-`);
  mkdirSync(`${dir}/templates`);
  cpSync(`${vaultsDir}/templates/example.yaml`, `${dir}/templates/example.yaml`);
  cpSync(`${vaultsDir}/camp.yaml`, `${dir}/camp.yaml`);
  const env = { ...process.env, CLOUDSPIDER_VAULTS_DIR: dir };
  await run(process.execPath, ["scripts/vaults-new.mjs", "example", "shop-api"], { cwd: root, env });
  const text = readFileSync(`${dir}/shop-api.yaml`, "utf8");
  assert.match(text, /# Template:/, "comments stay");
  const [entry] = parseVaultText(text, "shop-api.yaml");
  assert.equal(entry.damaged, false, entry.errors.join("; "));
  assert.equal(entry.name, "shop-api");
  assert.equal(entry.resources.tags.project, "shop-api");
  assert.equal(entry.number, 100);
  await assert.rejects(run(process.execPath, ["scripts/vaults-new.mjs", "example", "shop-api"], { cwd: root, env }), (error) => /already exists/.test(error.stdout));
});

test("upgrades/demo: logs to a 1-day group, Pod Identity for the collector, read-only RBAC for the viewer group", { skip: existsSync(`${root}upgrades/demo/node_modules/@pulumi/kubernetes`) ? false : "run npm ci in upgrades/demo" }, async () => {
  const resources = await mocked(PROGRAMS.find((item) => item.dir === "upgrades/demo"));
  const one = (type, name) => resources.find((r) => r.type.endsWith(type) && r.name === name)?.inputs;
  assert.equal(one("LogGroup", "demo").retentionInDays, 1);
  assert.equal(one("LogGroup", "demo").name, "/cloudspider/eks/cloudspider-up/demo");
  assert.match(one("Role", "collector").assumeRolePolicy, /pods\.eks\.amazonaws\.com/);
  assert.equal(one("PodIdentityAssociation", "otel-collector").serviceAccount, "otel-collector");
  const rules = one("ClusterRole", "cloudspider-viewer").rules;
  assert.ok(rules.every((rule) => rule.verbs.every((verb) => ["get", "list", "watch"].includes(verb))), "read verbs only");
  assert.equal(one("ClusterRoleBinding", "cloudspider-viewer").subjects[0].name, "cloudspider-viewers");
  assert.ok(!resources.some((r) => /Service$/.test(r.type) && r.inputs.spec?.type === "LoadBalancer"), "no load balancer (cost)");
  const config = one("ConfigMap", "otel-collector").data["config.yaml"];
  for (const word of ["file_log", "awscloudwatchlogs", "awsxray", "/var/log/pods/demo_", "kubelet_stats", "host_metrics", "otlp_grpc/gateway"]) assert.ok(config.includes(word), word);
  assert.ok(!/awsemf|cloudwatch_metrics|prometheusremotewrite/.test(config), "no CloudWatch custom metrics (cost)");
  // Telemetry: the gateway serves Prometheus text on the one-port otel-metrics
  // Service, and the viewer may only GET that Service's proxy.
  const gateway = one("ConfigMap", "otel-gateway").data["config.yaml"];
  assert.match(gateway, /prometheus:\n\s+endpoint: 0\.0\.0\.0:8889/);
  assert.deepEqual(one("Service", "otel-metrics").spec.ports.map((p) => p.port), [8889]);
  assert.deepEqual(one("Role", "viewer-otel-metrics").rules, [{ apiGroups: [""], resources: ["services/proxy"], resourceNames: ["otel-metrics"], verbs: ["get"] }]);
  assert.equal(one("RoleBinding", "viewer-otel-metrics").subjects[0].name, "cloudspider-viewers");
  assert.ok(one("ClusterRole", "otel-kubeletstats").rules.every((rule) => rule.verbs.every((verb) => ["get", "list", "watch"].includes(verb))));
});
