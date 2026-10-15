import { test } from "node:test";
import assert from "node:assert/strict";
import { diagramFromKube } from "../src/kube-diagram.js";
import { diagnoseChoices, diagnoseTarget } from "../src/kube-focus.js";
import { formHtml } from "../src/diagnose-view.js";

const meta = (name, namespace, labels = {}, ownerReferences) => ({ name, namespace, labels, ...(ownerReferences ? { ownerReferences } : {}) });
const snap = {
  clusterName: "harbor-lab",
  namespaces: [{ metadata: { name: "shop" } }, { metadata: { name: "pay" } }],
  deployments: [{ metadata: meta("cart", "shop", { app: "cart" }), spec: { replicas: 1, selector: { matchLabels: { app: "cart" } }, template: { metadata: { labels: { app: "cart" } } } }, status: { readyReplicas: 0, replicas: 1 } }],
  replicasets: [{ metadata: meta("cart-6d9f", "shop", { app: "cart" }, [{ kind: "Deployment", name: "cart" }]) }],
  pods: [{ metadata: meta("cart-6d9f-x1", "shop", { app: "cart", "pod-template-hash": "6d9f" }, [{ kind: "ReplicaSet", name: "cart-6d9f" }]), spec: { nodeName: "n1", containers: [{ name: "c" }] }, status: { phase: "Running", conditions: [{ type: "Ready", status: "False" }], containerStatuses: [{ name: "c", ready: false, restartCount: 0, state: { running: {} } }] } }],
  services: [
    { metadata: meta("cart-front", "shop"), spec: { selector: { app: "cart" }, ports: [{ port: 80, targetPort: 8080 }] } },
    { metadata: meta("ledger", "pay"), spec: { selector: { app: "ledger" }, ports: [{ port: 80 }] } },
  ],
  nodes: [],
};

test("DIAGNOSE from TOPOLOGY: a Service is itself, a pod or workload the Service in front of it", () => {
  const d = diagramFromKube(snap);
  const pod = d.nodes.find((n) => n.kind === "pod");
  const svc = d.nodes.find((n) => n.kind === "service" && n.label === "cart-front");
  assert.deepEqual(diagnoseTarget(d, svc.id), { namespace: "shop", service: "cart-front" });
  assert.deepEqual(diagnoseTarget(d, pod.id), { namespace: "shop", service: "cart-front" });
  const wl = d.nodes.find((n) => n.kind === "workload");
  assert.deepEqual(diagnoseTarget(d, wl.id), { namespace: "shop", service: "cart-front" });
  assert.equal(diagnoseTarget(d, "nope"), null);
  const ch = diagnoseChoices(d);
  assert.ok(ch.namespaces.includes("shop") && ch.namespaces.includes("pay"));
  assert.deepEqual(ch.services.shop, ["cart-front"]);
});

test("DIAGNOSE fields: live namespaces and the namespace's Services as datalists, escaped", () => {
  const html = formHtml({ ns: "shop", svc: "cart-front" }, { namespaces: ["pay", "shop"], services: { shop: ["cart-front", "a\"b"] } });
  assert.match(html, /list="dx-nss"/);
  assert.match(html, /<datalist id="dx-nss"><option value="pay"><\/option><option value="shop">/);
  assert.match(html, /<datalist id="dx-svcs"><option value="cart-front"><\/option><option value="a&quot;b">/);
  assert.doesNotMatch(formHtml({ ns: "", svc: "" }), /datalist/);
});
