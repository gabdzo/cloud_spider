import test from "node:test";
import assert from "node:assert/strict";
import { pipModel, shortHost } from "../src/pipboy-model.js";

const body = {
  context: "demo-viewer",
  diagram: {
    nodes: [
      { id: "cluster:demo", kind: "control-plane", label: "demo", status: "ok" },
      { id: "ns:shop", kind: "namespace", label: "shop", status: "broken" },
      { id: "ns:ok", kind: "namespace", label: "ok", status: "ok" },
      { id: "ns:kube-system", kind: "namespace", label: "kube-system", status: "ok" },
      { id: "Deployment:shop/api", kind: "workload", ns: "shop", label: "api", workloadKind: "Deployment", want: 2, have: 1, status: "broken" },
      { id: "Deployment:ok/web", kind: "workload", ns: "ok", label: "web", want: 1, have: 1, status: "ok" },
      { id: "pod:shop/api-1", kind: "pod", ns: "shop", owner: "Deployment:shop/api", status: "ok" },
      { id: "pod:shop/api-2", kind: "pod", ns: "shop", owner: "Deployment:shop/api", status: "broken", caption: "CrashLoopBackOff" },
      { id: "pod:ok/web-1", kind: "pod", ns: "ok", owner: "Deployment:ok/web", status: "ok" },
      { id: "svc:ok/web", kind: "service", ns: "ok", label: "web", status: "ok", svc: { type: "LoadBalancer", hostname: "k8s-ok-web-0123456789abcdef-1234567890.eu-central-1.elb.amazonaws.com", ports: [{ port: 80 }] } },
      { id: "node:n1", kind: "node", label: "n1", status: "ok", host: { ready: true } },
    ],
    edges: [],
    netpol: { ns: { shop: { badge: "deny", policies: [{ name: "default-deny", selects: "all pods", ingress: ["deny all ingress"], egress: [] }] } } },
  },
};

test("issues first, system last, health 0-10", () => {
  const m = pipModel(body);
  assert.deepEqual(m.namespaces.map((n) => n.name), ["shop", "ok", "kube-system"]);
  assert.equal(m.namespaces[0].health, 5);
  assert.equal(m.namespaces[0].state, "hurting");
  assert.equal(m.namespaces[1].health, 10);
  assert.deepEqual(m.totals, { ready: 2, pods: 3, nodes: 1, nodesReady: 1, issues: 1 });
  assert.equal(m.namespaces[0].policy.badge, "deny");
  assert.equal(m.namespaces[0].policy.lines[0].deny, true);
});

test("ELB hosts come out short", () => {
  const e = pipModel(body).namespaces[1].entries[0];
  assert.equal(e.kind, "LB");
  assert.ok(e.host.startsWith("k8s-ok-web (ELB)"), e.host);
  assert.ok(e.host.length < 40);
  assert.equal(shortHost("shop.example.com"), "shop.example.com");
});

test("an empty payload is an empty screen", () => {
  assert.deepEqual(pipModel({}).namespaces, []);
});
