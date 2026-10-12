// The observe bundle (upgrades/observe/plan.js): what it renders on plain
// Kubernetes and OpenShift, its NetworkPolicies, the SCC gate, footprint.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { LABELS, NAMESPACE, PROFILES, SCC, plan, netpol, gatewayConfig } from "../upgrades/observe/plan.js";
import { UPGRADES } from "../src/upgrade.js";

const base = { nodeCidr: "192.168.126.0/24" };
const kinds = (b) => b.objects.map((o) => o.kind);
const named = (b, kind, name) => b.objects.find((o) => o.kind === kind && o.metadata.name === name);

test("plain Kubernetes, privileged on: Beyla, agent, gateway, Loki; no SCC", () => {
  const b = plan({ ...base, allowPrivileged: "on" });
  assert.equal(b.objects[0].kind, "Namespace");
  assert.equal(b.objects[0].metadata.labels["pod-security.kubernetes.io/enforce"], "privileged");
  for (const [k, n] of [["DaemonSet", "beyla"], ["DaemonSet", "otel-agent"], ["Deployment", "otel-gateway"], ["StatefulSet", "loki"], ["PersistentVolumeClaim", "loki-data"], ["Service", "cloudspider-observe-metrics"], ["Service", "loki"]]) assert.ok(named(b, k, n), `${k}/${n}`);
  assert.ok(!kinds(b).includes("SecurityContextConstraints"));
  assert.ok(!kinds(b).includes("RoleBinding"));
  const beyla = named(b, "DaemonSet", "beyla").spec.template.spec;
  assert.equal(beyla.hostPID, true);
  assert.equal(beyla.hostNetwork, undefined);
  assert.equal(beyla.containers[0].securityContext.privileged, true);
  // Every object labelled and namespaced (cluster-scoped ones labelled).
  for (const o of b.objects) {
    assert.equal(o.metadata.labels["app.kubernetes.io/managed-by"], LABELS["app.kubernetes.io/managed-by"], `${o.kind}/${o.metadata.name}`);
    if (!["Namespace", "ClusterRole", "ClusterRoleBinding", "SecurityContextConstraints"].includes(o.kind)) assert.equal(o.metadata.namespace, NAMESPACE);
    if (["ClusterRole", "ClusterRoleBinding"].includes(o.kind)) assert.match(o.metadata.name, /^cloudspider-observe-/);
  }
});

test("ClusterRoles are read-only (no Secrets, no write verbs)", () => {
  const b = plan({ ...base, allowPrivileged: "on", kubeStateMetrics: "on", platform: "openshift" });
  for (const r of b.objects.filter((o) => o.kind === "ClusterRole")) {
    for (const rule of r.rules) {
      assert.ok(!rule.resources.includes("secrets"), r.metadata.name);
      for (const v of rule.verbs) assert.ok(["get", "list", "watch", "use"].includes(v), `${r.metadata.name} ${v}`);
      if (rule.verbs.includes("use")) assert.deepEqual(rule.resourceNames.length, 1);
    }
  }
});

test("privileged off: no Beyla, no agent, restricted namespace, a warning", () => {
  for (const platform of ["kubernetes", "openshift"]) {
    const b = plan({ ...base, platform });
    assert.ok(!named(b, "DaemonSet", "beyla") && !named(b, "DaemonSet", "otel-agent"));
    assert.ok(!kinds(b).includes("SecurityContextConstraints"));
    assert.equal(b.objects[0].metadata.labels["pod-security.kubernetes.io/enforce"], "restricted");
    assert.match(b.warnings[0], /allowPrivileged=off/);
    for (const o of b.objects.filter((x) => ["Deployment", "StatefulSet", "DaemonSet"].includes(x.kind))) for (const c of o.spec.template.spec.containers) assert.notEqual(c.securityContext?.privileged, true);
  }
});

test("SCCs only on OpenShift with allowPrivileged=on, bound only to our ServiceAccounts", () => {
  const b = plan({ ...base, platform: "openshift", allowPrivileged: "on" });
  const sccs = b.objects.filter((o) => o.kind === "SecurityContextConstraints");
  assert.deepEqual(sccs.map((s) => s.metadata.name).sort(), [SCC.agent, SCC.beyla].sort());
  const beyla = sccs.find((s) => s.metadata.name === SCC.beyla);
  assert.equal(beyla.allowPrivilegedContainer, true);
  assert.equal(beyla.allowHostPID, true);
  assert.equal(beyla.allowHostNetwork, false);
  const agent = sccs.find((s) => s.metadata.name === SCC.agent);
  assert.equal(agent.allowPrivilegedContainer, false);
  assert.equal(agent.allowHostPID, false);
  for (const s of sccs) assert.deepEqual([s.users, s.groups], [[], []], "granted through RBAC, not users/groups");
  const bindings = b.objects.filter((o) => o.kind === "RoleBinding");
  assert.deepEqual(bindings.map((x) => x.subjects.map((s) => `${s.namespace}/${s.name}`)).flat().sort(), [`${NAMESPACE}/agent`, `${NAMESPACE}/beyla`]);
  assert.match(b.warnings[0], /SCC cloudspider-observe-beyla/);
  // OpenShift picks UIDs: no fixed runAsUser on the restricted workloads.
  assert.equal(named(b, "Deployment", "otel-gateway").spec.template.spec.containers[0].securityContext.runAsUser, undefined);
  assert.equal(named(plan(base), "Deployment", "otel-gateway").spec.template.spec.containers[0].securityContext.runAsUser, 10001);
});

test("NetworkPolicies: one direction each, DNS per platform, nodeCidr, apiserver proxy to gateway + Loki only", () => {
  const k = netpol({ nodeCidr: "10.0.0.0/16" });
  const o = netpol({ platform: "openshift", nodeCidr: "192.168.126.0/24" });
  for (const p of [...k, ...o]) {
    assert.equal(p.spec.policyTypes.length, 1, p.metadata.name);
    assert.ok(!JSON.stringify(p).includes('"vpc"'), "placeholder replaced");
    for (const e of p.spec.egress || []) assert.ok(e.ports || e.to.every((t) => t.podSelector && !t.namespaceSelector && !t.ipBlock), `${p.metadata.name} names its ports`);
  }
  const dns = (ps) => ps.find((p) => p.metadata.name === "allow-dns-egress").spec.egress[0];
  assert.equal(dns(k).to[0].namespaceSelector.matchLabels["kubernetes.io/metadata.name"], "kube-system");
  assert.equal(dns(o).to[0].namespaceSelector.matchLabels["kubernetes.io/metadata.name"], "openshift-dns");
  assert.deepEqual(dns(o).ports.map((p) => p.port), [5353, 5353]);
  assert.equal(k.find((p) => p.metadata.name === "allow-kubelet-egress").spec.egress[0].to[0].ipBlock.cidr, "10.0.0.0/16");
  assert.deepEqual(k.find((p) => p.metadata.name === "allow-apiserver-egress").spec.egress[0].ports, [{ protocol: "TCP", port: 6443 }]);
  const proxy = (ps) => ps.find((p) => p.metadata.name === "allow-apiserver-proxy").spec;
  assert.deepEqual(proxy(k).ingress[0].ports.map((p) => p.port), [8889, 3100]);
  assert.deepEqual(proxy(k).podSelector.matchExpressions[0].values, ["otel-gateway", "loki"]);
  assert.equal(proxy(k).ingress[0].from.length, 1);
  assert.ok(proxy(o).ingress[0].from.some((f) => f.namespaceSelector?.matchLabels?.["policy-group.network.openshift.io/host-network"] === ""));
  assert.throws(() => netpol({}), /nodeCidr/);
});

test("profiles: crc is tight and fits CRC; options are validated", () => {
  const crc = plan({ ...base, allowPrivileged: "on" });
  const std = plan({ ...base, allowPrivileged: "on", profile: "standard" });
  const one = (b) => ({ cpu: b.footprint.perNode.cpuM + b.footprint.once.cpuM, mem: b.footprint.perNode.memMi + b.footprint.once.memMi, lim: b.footprint.perNode.limitMi + b.footprint.once.limitMi });
  assert.deepEqual(one(crc), { cpu: 175, mem: 416, lim: 1056 });
  assert.ok(one(std).cpu > one(crc).cpu);
  assert.equal(crc.footprint.diskGi, PROFILES.crc.lokiSizeGi);
  for (const o of crc.objects.filter((x) => ["Deployment", "StatefulSet", "DaemonSet"].includes(x.kind))) for (const c of o.spec.template.spec.containers) assert.ok(c.resources.requests && c.resources.limits.memory, `${o.metadata.name} has requests + a memory limit`);
  assert.match(named(crc, "ConfigMap", "loki").data["loki.yaml"], /"retention_period": "24h"/);
  assert.equal(plan({ ...base, logs: "off" }).footprint.diskGi, 0);
  assert.ok(!named(plan({ ...base, logs: "off" }), "StatefulSet", "loki"));
  assert.throws(() => plan({ ...base, lokiSizeGi: "500" }), /lokiSizeGi/);
  // The card's footprint note says what plan() computes.
  const card = UPGRADES.find((s) => s.id === "observe");
  assert.match(card.note, /~175m CPU and ~420Mi requested/);
});

test("gateway config: metrics → Prometheus :8889, logs + Events → Loki, KSM scraped only when on", () => {
  const g = gatewayConfig({ profile: "crc", ksm: false, logs: true });
  assert.deepEqual(g.service.pipelines.metrics.receivers, ["otlp", "k8s_cluster"]);
  assert.deepEqual(g.service.pipelines.logs.receivers, ["otlp", "k8sobjects"]);
  assert.equal(g.exporters.prometheus.endpoint, "0.0.0.0:8889");
  assert.match(g.exporters["otlphttp/loki"].endpoint, /:3100\/otlp$/);
  assert.ok(gatewayConfig({ profile: "crc", ksm: true, logs: false }).service.pipelines.metrics.receivers.includes("prometheus"));
  assert.equal(gatewayConfig({ profile: "crc", ksm: true, logs: false }).service.pipelines.logs, undefined);
});

test("the stack: required kubeContext, local backend, card has the privileged warning", () => {
  const index = readFileSync(new URL("../upgrades/observe/index.js", import.meta.url), "utf8");
  assert.match(index, /config\.require\("kubeContext"\)/);
  assert.match(index, /new k8s\.Provider\("target", \{ context: kubeContext/);
  assert.match(readFileSync(new URL("../upgrades/observe/Pulumi.yaml", import.meta.url), "utf8"), /url: "file:\/\//);
  const card = UPGRADES.find((s) => s.id === "observe");
  const priv = card.parameters.find((p) => p.name === "allowPrivileged");
  assert.equal(priv.default, "off");
  assert.equal(priv.warn, "on");
  assert.match(priv.labels.on, /PRIVILEGED/);
});

test("the card refuses an install without kubeContext or nodeCidr, before pulumi runs", async () => {
  const { createUpgrade } = await import("../src/upgrade.js");
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const home = mkdtempSync(join(tmpdir(), "obs-home-"));
  const u = createUpgrade({ env: { HOME: home }, run() { throw new Error("must not run"); } });
  assert.match(u.run({ module: "observe", action: "up", params: { nodeCidr: "192.168.126.0/24" } }).error, /kubeContext is required/);
  assert.match(u.run({ module: "observe", action: "preview", params: { kubeContext: "crc-admin" } }).error, /nodeCidr is required/);
});

test("kubeContext accepts oc-login names, rejects shell-ish input", async () => {
  const { checkParams, UPGRADES: U } = await import("../src/upgrade.js");
  const card = U.find((s) => s.id === "observe");
  assert.ok(checkParams(card, { kubeContext: "default/api-crc-testing:6443/kubeadmin", nodeCidr: "192.168.126.0/24" }).values);
  assert.ok(checkParams(card, { kubeContext: "a; rm -rf /" }).error);
  assert.ok(checkParams(card, { kubeContext: "crc", nodeCidr: "10.0.0.0/8 x" }).error);
});
