import { test } from "node:test";
import assert from "node:assert/strict";
import { nsPanelModel } from "../src/map-ns-panel.js";

const model = {
  apps: [
    { id: "Deployment:pier/api", ns: "pier", label: "api", have: 1, want: 2, status: "hang", services: ["api"] },
    { id: "Deployment:pier/web", ns: "pier", label: "web", have: 1, want: 1, status: "ok", services: ["web"] },
    { id: "Deployment:mole/job", ns: "mole", label: "job", have: 1, want: 1, status: "ok", services: [] },
  ],
  netpol: {
    ns: { pier: { badge: "deny", denyIn: true, denyOut: false, uncovered: 0, policies: [{ name: "api-in", selects: "app=api", podCount: 1, types: ["Ingress"], ingress: ["from pier · app=web → TCP 8080"], egress: [] }] } },
    edges: [
      { from: { id: "pier/web", ns: "pier", label: "web" }, to: { id: "pier/api", ns: "pier", label: "api" }, ports: ["TCP 8080"] },
      { from: { id: "mole/job", ns: "mole", label: "job" }, to: { id: "pier/api", ns: "pier", label: "api" }, ports: [] },
      { from: { id: "cidr:10.0.0.0/8", ns: "", label: "10.0.0.0/8" }, to: { id: "pier/web", ns: "pier", label: "web" }, ports: ["TCP 80"] },
    ],
  },
  entries: [{ ns: "pier", kindText: "INGRESS", label: "front", caption: "front.test" }],
};

test("namespace panel: headline, policies, who may come in, issues and the service to open", () => {
  const p = nsPanelModel(model, "pier");
  assert.equal(p.badge, "deny");
  assert.match(p.headline, /Default deny for ingress/);
  assert.equal(p.policies[0].pods, "1 workload");
  assert.deepEqual(p.allowedIn, ["mole/job → pier/api", "10.0.0.0/8 → pier/web · TCP 80"]);
  assert.equal(p.insideCount, 1);
  assert.deepEqual(p.issues.map((i) => i.label), ["api"]);
  assert.equal(p.issueService, "api");
  assert.deepEqual(p.entries, ["INGRESS front front.test"]);
});

test("namespace panel: OPEN when no policy, 'not readable' when the list was not read", () => {
  assert.equal(nsPanelModel(model, "mole").badge, "open");
  assert.match(nsPanelModel(model, "mole").headline, /every pod accepts traffic/);
  assert.equal(nsPanelModel({ ...model, netpol: null }, "pier").badge, "unread");
});
