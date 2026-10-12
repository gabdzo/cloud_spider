import { test } from "node:test";
import assert from "node:assert/strict";
import { parseAllDocuments } from "yaml";
import { MANAGED_BY, detect, planView, renderBundle, uninstallPlan } from "../src/observe/bundle.js";

test("every object is labelled for a clean uninstall, and namespaced into the bundle", () => {
  const b = renderBundle({ namespace: "obs" });
  for (const { obj } of b.items) {
    assert.equal(obj.metadata.labels["app.kubernetes.io/managed-by"], MANAGED_BY, `${obj.kind}/${obj.metadata.name}`);
    const cluster = ["Namespace", "ClusterRole", "ClusterRoleBinding", "SecurityContextConstraints"].includes(obj.kind);
    assert.equal(obj.metadata.namespace, cluster ? undefined : "obs", obj.kind);
  }
  assert.throws(() => renderBundle({ namespace: "Bad_NS" }), /not a namespace/);
});

test("RBAC is read-only, never Secrets", () => {
  for (const { obj } of renderBundle({}).items.filter((i) => i.obj.kind === "ClusterRole")) {
    for (const r of obj.rules) {
      assert.ok(r.verbs.every((v) => ["get", "list", "watch"].includes(v)), obj.metadata.name);
      assert.ok(!r.resources.includes("secrets"), obj.metadata.name);
    }
  }
});

test("privileged is gated, and the OpenShift SCC binds only Beyla's ServiceAccount", () => {
  const plain = renderBundle({});
  assert.match(plain.blocked, /privileged/);
  assert.equal(plain.items.some((i) => i.obj.kind === "SecurityContextConstraints"), false);
  assert.equal(renderBundle({ allowPrivileged: true }).blocked, "");
  const os = renderBundle({ openshift: true, namespace: "obs" });
  const scc = os.items.find((i) => i.obj.kind === "SecurityContextConstraints").obj;
  assert.deepEqual(scc.users, ["system:serviceaccount:obs:beyla"]);
  assert.equal(scc.allowHostNetwork, false);
  assert.ok(os.notes.some((n) => /OpenShift ships its own metrics/.test(n)));
  const others = os.items.filter((i) => ["Deployment"].includes(i.obj.kind));
  for (const d of others) assert.equal(d.obj.spec.template.spec.containers[0].securityContext.privileged, undefined, d.obj.metadata.name);
});

test("NetworkPolicies: default deny plus named allows", () => {
  const nps = renderBundle({}).items.filter((i) => i.obj.kind === "NetworkPolicy").map((i) => i.obj);
  const deny = nps.find((n) => n.metadata.name === "default-deny");
  assert.deepEqual(deny.spec, { podSelector: {}, policyTypes: ["Ingress", "Egress"] });
  assert.ok(nps.find((n) => n.metadata.name === "collector-otlp-in").spec.ingress[0].ports.some((p) => p.port === 4317));
});

test("kube-state-metrics only when missing; detection from the graph reads", () => {
  assert.ok(renderBundle({}).items.some((i) => i.obj.metadata.name === "kube-state-metrics"));
  assert.equal(renderBundle({ hasKubeStateMetrics: true }).items.some((i) => i.obj.metadata.name === "kube-state-metrics"), false);
  assert.deepEqual(detect({ absent: ["routes"], services: [{ metadata: { name: "kube-state-metrics" } }] }), { openshift: false, hasKubeStateMetrics: true });
});

test("uninstall removes workloads first and the namespace last", () => {
  const order = uninstallPlan(renderBundle({ openshift: true })).map((o) => o.kind);
  assert.equal(order[0], "DaemonSet");
  assert.equal(order.at(-1), "Namespace");
});

test("the preview is valid YAML with the exact commands, and applies nothing", () => {
  const v = planView(renderBundle({ openshift: true, namespace: "obs" }), { context: "crc-admin" });
  const docs = parseAllDocuments(v.yaml);
  assert.equal(docs.length, v.objects.length);
  assert.ok(docs.every((d) => d.errors.length === 0));
  assert.equal(v.install, "oc --context crc-admin apply -f cloudspider-observe.yaml");
  assert.equal(v.uninstall.at(-1), "oc --context crc-admin delete namespace obs");
});
