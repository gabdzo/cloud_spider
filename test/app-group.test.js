import { test } from "node:test";
import assert from "node:assert/strict";
import { selects, groupApps } from "../src/score/app/group.js";
import { collectApps, containerShape, APP_LISTS } from "../src/score/app/collect.js";
import { scopedKube } from "../src/score/scoped-kube.js";

test("selectors: matchLabels, expressions, plain maps", () => {
  assert.ok(selects({ app: "a" }, { app: "a", x: "1" }));
  assert.ok(selects({ matchLabels: { app: "a" }, matchExpressions: [{ key: "tier", operator: "In", values: ["web"] }] }, { app: "a", tier: "web" }));
  assert.ok(!selects({ matchExpressions: [{ key: "tier", operator: "DoesNotExist" }] }, { tier: "web" }));
});

test("env and ConfigMap values never survive the collector", async () => {
  const c = containerShape({ name: "c", env: [{ name: "DB_PASSWORD", value: "hunter2" }, { name: "TOKEN", valueFrom: { secretKeyRef: { name: "s", key: "t" } } }] });
  assert.ok(!JSON.stringify(c).includes("hunter2"));
  assert.deepEqual(c.env[0], { name: "DB_PASSWORD", literal: true, fromSecret: "", fromConfigMap: "" });
  const kube = { scope: "*", read: async (name) => (name === "configMaps" ? { json: { items: [{ metadata: { namespace: "a", name: "cfg" }, data: { password: "x9y8" } }] } } : { json: { items: [] } }) };
  const out = await collectApps(kube);
  assert.deepEqual(out.lists.configMaps.items, [{ namespace: "a", name: "cfg", keys: ["password"] }]);
  assert.ok(!JSON.stringify(out).includes("x9y8"));
});

test("collector is GET-only, scoped, never reads Secrets, at most 6 in flight", async () => {
  let inFlight = 0, peak = 0;
  const paths = [];
  const raw = {
    scope: ["a", "b", "c", "d", "e", "f", "g", "h"],
    read: async () => ({ forbidden: true }),
    readText: async () => ({}), readLines: async () => ({}), readTimed: async () => ({}),
    readPath: async (p) => { paths.push(p); inFlight++; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 2)); inFlight--; return { json: { items: [] } }; },
  };
  await collectApps(scopedKube(raw));
  assert.ok(peak <= 6, `peak ${peak}`);
  assert.ok(paths.every((p) => /\/namespaces\/[a-h]\//.test(p)));
  assert.ok(!paths.some((p) => /secrets/.test(p)));
  assert.ok(!APP_LISTS.includes("secrets"));
});

test("grouping: services, ingress, hpa, pdb, netpol, SA, configmaps, monitors", () => {
  const pod = { serviceAccountName: "web-sa", containers: [containerShape({ name: "c", envFrom: [{ configMapRef: { name: "web-cfg" } }, { secretRef: { name: "web-sec" } }] })], initContainers: [], volumes: [] };
  const L = (items) => ({ status: "ok", items });
  const lists = {
    deployments: L([{ namespace: "shop", name: "web", kind: "Deployment", selector: { matchLabels: { app: "web" } }, templateLabels: { app: "web" }, pod }]),
    statefulsets: L([]),
    pods: L([{ namespace: "shop", name: "web-1", labels: { app: "web" } }, { namespace: "shop", name: "db-1", labels: { app: "db" } }]),
    services: L([{ namespace: "shop", name: "web", selector: { app: "web" }, labels: { app: "web" }, ports: [] }]),
    endpointSlicesAll: L([{ namespace: "shop", service: "web", ready: 1, total: 1 }]),
    ingresses: L([{ namespace: "shop", name: "web", backends: [{ service: "web" }] }]),
    hpas: L([{ namespace: "shop", target: "web", targetKind: "Deployment", min: 2, max: 5 }]),
    pdbs: L([{ namespace: "shop", name: "web", selector: { matchLabels: { app: "web" } } }]),
    networkPolicies: L([{ namespace: "shop", name: "deny", podSelector: {} }]),
    serviceAccounts: L([{ namespace: "shop", name: "web-sa", automount: false }]),
    configMaps: L([{ namespace: "shop", name: "web-cfg", keys: ["A"] }]),
    roleBindings: L([{ namespace: "shop", name: "rb", role: { kind: "Role", name: "r" }, subjects: [{ kind: "ServiceAccount", name: "web-sa" }] }]),
    roles: L([{ namespace: "shop", name: "r", rules: [] }]),
    serviceMonitors: L([{ namespace: "mon", name: "web", selector: { matchLabels: { app: "web" } }, namespaces: ["shop"], any: false }]),
    podMonitors: L([]),
    prometheusRules: L([{ namespace: "mon", name: "r", exprs: ['rate(http_errors{service="web"}[5m]) > 1'] }]),
  };
  const [app] = groupApps(lists);
  assert.equal(app.id, "shop/web");
  assert.equal(app.pods.length, 1);
  assert.deepEqual([app.services.length, app.ingresses.length, app.pdbs.length, app.netpols.length, app.slices.length], [1, 1, 1, 1, 1]);
  assert.equal(app.hpa.min, 2);
  assert.equal(app.serviceAccount.roles.length, 1);
  assert.deepEqual(app.configMaps.map((c) => Boolean(c.found)), [true]);
  assert.deepEqual(app.secrets, ["web-sec"]);
  assert.deepEqual(app.monitors.map((m) => m.kind), ["ServiceMonitor"]);
  assert.deepEqual(app.rules, ["mon/r"]);
});
