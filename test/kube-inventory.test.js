import test from "node:test";
import assert from "node:assert/strict";
import { inventory, resHints, categoryOf } from "../src/kube-inventory.js";
import { resHtml, detailHtml, PIP_TABS } from "../src/pipboy-view.js";

const NS = ["oba-dev", "ppf-play", "albaraka-dev", "team-x", "albaraka-helm"];
const table = (rows, cols = ["Name", "Status", "Age"]) => ({ json: { columnDefinitions: cols.map((name) => ({ name })), rows, metadata: {} } });
const row = (ns, name, status = "", extra = {}) => ({ cells: [name, status, "1d"], object: { metadata: { namespace: ns, name, creationTimestamp: "2026-10-15T00:00:00Z", ...extra } } });

function fakeCluster({ scoped }) {
  const calls = [];
  const get = async (path, opts = {}) => {
    calls.push(path);
    if (path === "/api/v1") return { json: { resources: [
      { name: "pods", namespaced: true, kind: "Pod", verbs: ["list"] },
      { name: "pods/log", namespaced: true, kind: "Pod", verbs: ["get"] },
      { name: "services", namespaced: true, kind: "Service", verbs: ["list"] },
      { name: "secrets", namespaced: true, kind: "Secret", verbs: ["list"] },
      { name: "events", namespaced: true, kind: "Event", verbs: ["list"] },
      { name: "persistentvolumeclaims", namespaced: true, kind: "PersistentVolumeClaim", verbs: ["list"] },
      { name: "nodes", namespaced: false, kind: "Node", verbs: ["list"] },
    ] } };
    if (path === "/apis") return { json: { groups: [
      { name: "apps", preferredVersion: { groupVersion: "apps/v1" } },
      { name: "monitoring.coreos.com", preferredVersion: { groupVersion: "monitoring.coreos.com/v1" } },
    ] } };
    if (path === "/apis/apps/v1") return { json: { resources: [{ name: "replicasets", namespaced: true, kind: "ReplicaSet", verbs: ["list"] }, { name: "controllerrevisions", namespaced: true, kind: "ControllerRevision", verbs: ["list"] }] } };
    if (path === "/apis/monitoring.coreos.com/v1") return { json: { resources: [{ name: "servicemonitors", namespaced: true, kind: "ServiceMonitor", verbs: ["list"] }] } };
    assert.match(opts.accept || "", /as=Table/, "lists ask for Table (no secret data)");
    if (scoped) assert.match(path, /\/namespaces\/[a-z-]+\//, `namespaced call only: ${path}`);
    const ns = path.match(/namespaces\/([a-z-]+)\//)?.[1] || "oba-dev";
    if (ns === "team-x" && /secrets/.test(path)) return { forbidden: true, error: "forbidden" };
    if (/\/services\?/.test(path)) return table([row(ns, "web", "", { labels: { app: "web" } })], ["Name", "Type"]);
    if (/secrets/.test(path)) return table([row(ns, "tls", "")], ["Name", "Type", "Data"]);
    if (/persistentvolumeclaims/.test(path)) return table(ns === "oba-dev" ? [row(ns, "data", "Pending")] : []);
    if (/replicasets/.test(path)) return table([row(ns, "web-1", "", { ownerReferences: [{ kind: "Deployment" }] }), row(ns, "solo", "")]);
    if (/pods/.test(path)) return table([row(ns, "web-abc", "Running")]);
    return table([]);
  };
  return { get, calls };
}

test("RES inventory: discovery, skips noise, Table lists, a 5-namespace context reads namespace by namespace", async () => {
  const { get, calls } = fakeCluster({ scoped: true });
  const inv = await inventory({ get, scope: NS });
  const names = inv.kinds.map((k) => k.resource).sort();
  assert.deepEqual(names, ["persistentvolumeclaims", "pods", "replicasets", "secrets", "services"]);
  assert.ok(!calls.some((p) => /events|controllerrevisions|nodes/.test(p)));
  assert.equal(inv.kinds.find((k) => k.resource === "pods").count, 5);
  assert.equal(inv.kinds.find((k) => k.resource === "replicasets").count, 5, "Deployment-owned ReplicaSets dropped");
  assert.equal(inv.kinds.find((k) => k.resource === "secrets").denied.join(), "team-x");
  assert.equal(inv.monitoringCrd, true);
  const hints = resHints(inv, [{ metadata: { namespace: "ppf-play" }, spec: { selector: { matchLabels: { app: "web" } } } }]);
  assert.match(hints["oba-dev"].join(), /PVC data pending/);
  assert.match(hints["oba-dev"].join(), /1 Service without ServiceMonitor/);
  assert.equal(hints["ppf-play"], undefined, "a ServiceMonitor covers ppf-play/web");
});

test("RES inventory: '*' lists each kind cluster-wide; no monitoring CRD, no ServiceMonitor hint", async () => {
  const { get, calls } = fakeCluster({ scoped: false });
  const inv = await inventory({ get, scope: "*" });
  assert.ok(calls.includes("/api/v1/pods?limit=300&includeObject=Metadata"));
  assert.ok(!calls.some((p) => /\/namespaces\//.test(p)));
  const hints = resHints({ ...inv, monitoringCrd: false });
  assert.ok(!JSON.stringify(hints).includes("ServiceMonitor"));
});

test("RES categories and view", () => {
  assert.equal(categoryOf("monitoring.coreos.com", "servicemonitors"), "Monitoring");
  assert.equal(categoryOf("cert-manager.io", "certificates"), "Config");
  assert.equal(categoryOf("keda.sh", "scaledobjects"), "Workloads");
  assert.equal(categoryOf("networking.k8s.io", "networkpolicies"), "Policy");
  assert.equal(categoryOf("example.io", "widgets"), "Other CRDs");
  assert.ok(PIP_TABS.includes("res"));
  const res = { kinds: [{ group: "", version: "v1", resource: "pods", kind: "Pod", category: "Workloads", count: 1, items: [{ ns: "a", name: "p1", status: "Running", created: "2026-10-15T00:00:00Z" }] }], hints: { a: ["PVC x pending (not bound)"] } };
  assert.match(resHtml("a", res), /WORKLOADS[\s\S]*data-res-kind="\/pods"/);
  assert.match(resHtml("a", res, { resKind: "/pods", resObj: "p1" }), /Pod <b>p1<\/b>/);
  const ns = { name: "a", health: 10, state: "healthy", system: false, pods: 1, ready: 1, workloads: [], services: [], entries: [], policy: { badge: "open", lines: [] }, issues: [], text: "" };
  assert.match(detailHtml(ns, "stat", res), /HINTS[\s\S]*PVC x pending/);
});
