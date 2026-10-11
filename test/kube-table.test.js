import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { createApp } from "../src/app.js";
import { K9S_KEYS, filterRows } from "../src/k9s.js";
import { createKube } from "../src/kube.js";
import { buildTable, describe, findObject, podStatus, redactObject, viewFor, yamlOf } from "../src/kube-table.js";
import { fanoutSnapshot } from "./fixtures/fanout-diagram.js";
import { fakeKubeApi, kubeconfigFor, workWorld } from "./fixtures/fake-kube-api.js";

const NOW = Date.parse("2026-10-11T04:00:00Z");
const big = () => fanoutSnapshot({ ns: "big", nodes: 12, apps: 30, replicas: 5, broken: [4, 17] });

test("k9s tables: pods like k9s (READY, STATUS reason, RESTARTS), filter, NAMESPACE column", () => {
  const t = buildTable("pods", big(), { ns: "big", now: NOW });
  assert.deepEqual(t.columns, ["NAME", "READY", "STATUS", "RESTARTS", "AGE", "NODE"], "no CPU/MEM without metrics");
  assert.equal(t.rows.length, 150);
  const crash = t.rows.filter((r) => r.cells.STATUS === "CrashLoopBackOff");
  assert.deepEqual(crash.map((r) => [r.cells.READY, r.cells.RESTARTS, r.status]), [["0/1", "37", "broken"], ["0/1", "37", "broken"]]);
  assert.equal(buildTable("pods", big(), { ns: "big", filter: "crash" }).rows.length, 2);
  const all = buildTable("pods", big(), { ns: "*" });
  assert.equal(all.columns[0], "NAMESPACE");
  assert.equal(filterRows(all.rows.map((r) => ({ ...r, cells: all.columns.map((c) => r.cells[c]) })), "svc04 crash").length, 1);
  const deploy = buildTable("deploy", big(), { ns: "big" });
  assert.equal(deploy.rows.find((r) => r.name === "svc04").cells.READY, "4/5");
  assert.equal(buildTable("svc", big(), { ns: "big" }).rows.length, 58);
  assert.equal(buildTable("ing", big(), { ns: "big" }).rows[0].cells.HOSTS, "team.example");
  assert.equal(podStatus({ metadata: { deletionTimestamp: "x" } }), "Terminating");
  assert.equal(podStatus({ status: { phase: "Running", containerStatuses: [{ state: { terminated: { reason: "OOMKilled" } } }] } }), "OOMKilled");
});

test("k9s views: aliases, and nodes only where the context may list them", () => {
  assert.equal(viewFor(":po").view.id, "pods");
  assert.equal(viewFor("deployments").view.id, "deploy");
  assert.match(viewFor(":nodes", { clusterWide: false }).error, /cluster-scoped/);
  assert.equal(viewFor(":nodes").view.id, "nodes");
  assert.match(viewFor(":secrets").error, /no view/);
  const events = buildTable("events", {}, { events: [
    { metadata: { namespace: "a", name: "1" }, type: "Normal", reason: "Pulled", lastTimestamp: "2026-10-11T03:00:00Z", involvedObject: { kind: "Pod", name: "p" } },
    { metadata: { namespace: "a", name: "2" }, type: "Warning", reason: "BackOff", lastTimestamp: "2026-10-11T03:58:00Z", involvedObject: { kind: "Pod", name: "p" }, count: 9 },
  ], now: NOW });
  assert.deepEqual(events.rows.map((r) => [r.cells.REASON, r.cells["LAST SEEN"], r.status]), [["BackOff", "2m", "hang"], ["Pulled", "60m", "ok"]], "newest first");
});

test("k9s describe and YAML: readable, and nothing secret leaves", () => {
  const pod = {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { namespace: "a", name: "api-1", creationTimestamp: "2026-10-11T03:00:00Z", labels: { app: "api" }, annotations: { "kubectl.kubernetes.io/last-applied-configuration": "{\"env\":\"DB_PASSWORD=hunter2\"}" }, managedFields: [{ manager: "kubectl" }], ownerReferences: [{ kind: "ReplicaSet", name: "api-6f" }] },
    spec: { nodeName: "n1", containers: [{ name: "app", image: "api:1.2", env: [{ name: "DB_PASSWORD", value: "hunter2" }, { name: "TOKEN", valueFrom: { secretKeyRef: { name: "db", key: "token" } } }], args: ["--api-key=abc123"], readinessProbe: { httpGet: { path: "/ready", port: 8080 }, periodSeconds: 5 } }] },
    status: { phase: "Running", podIP: "10.0.0.5", containerStatuses: [{ name: "app", ready: false, restartCount: 3, state: { waiting: { reason: "CrashLoopBackOff" } }, lastState: { terminated: { reason: "Error", exitCode: 1 } } }], conditions: [{ type: "Ready", status: "False" }] },
  };
  const text = describe("pods", pod, { events: [{ metadata: { name: "e" }, type: "Warning", reason: "BackOff", involvedObject: { name: "api-1" }, message: "Back-off restarting" }], now: NOW });
  for (const want of [/Name:\s+api-1/, /Controlled By:\s+ReplicaSet\/api-6f/, /State:\s+Waiting: CrashLoopBackOff/, /Last State:\s+Terminated: Error \(exit 1\)/, /Restart Count:\s+3/, /Readiness:\s+HTTP GET \/ready :8080/, /2 vars \(values not shown\)/, /Warning BackOff/]) assert.match(text, want);
  const yaml = yamlOf("pods", pod);
  assert.match(yaml, /^apiVersion: v1\nkind: Pod/);
  for (const leak of ["hunter2", "abc123", "managedFields", "\"token\""]) assert.ok(!yaml.includes(leak), `YAML leaks ${leak}`);
  assert.ok(!text.includes("hunter2"));
  // Inside a Deployment's pod template too; and a Secret's data, should one ever come by.
  const deploy = redactObject({ metadata: { name: "d" }, spec: { template: { spec: { containers: [{ name: "c", env: [{ name: "X", value: "s3cret" }] }] } } } });
  assert.equal(deploy.spec.template.spec.containers[0].env[0].value, "‹redacted›");
  assert.deepEqual(redactObject({ kind: "Secret", data: { a: "eHl6" } }).data, { a: "‹redacted›" });
  assert.equal(findObject("deploy", big(), "big", "svc04").metadata.name, "svc04");
  assert.equal(findObject("pods", big(), "other", "svc04-5f6d7c8b9-x4k0p"), null, "namespace must match");
});

test("k9s in the app: a namespaced context, the shared snapshot, GETs only", async () => {
  const calls = [];
  const api = fakeKubeApi({ world: workWorld({ now: NOW }), allow: ["payments", "ledger"], calls });
  const read = async () => kubeconfigFor([{ name: "work-ro", cluster: "arn:aws:eks:eu-west-1:1:cluster/work", server: "https://work.example" }]);
  const kube = createKube({ env: {}, read, get: api.get, context: "work-ro", namespaces: ["payments", "ledger"] });
  const app = createApp({
    ec2: { async describeRegions() { return { regions: [] }; }, async defaultRegion() { return ""; } },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    logGroup: "",
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => NOW,
    kubeContexts: [{ name: "work-ro", label: "WORK", namespaces: ["payments", "ledger"], pollMs: 60_000, kube }],
  });
  const pods = await app.kubeTable({ context: "work-ro", view: "pods" });
  assert.equal(pods.clusterWide, false);
  assert.deepEqual(pods.namespaces, ["payments", "ledger"]);
  assert.equal(pods.ns, "*");
  assert.ok(pods.rows.some((r) => r.cells.includes("CrashLoopBackOff")));
  const reads = calls.length;
  await app.kubeTable({ context: "work-ro", view: "deploy", ns: "ledger" });
  await app.kubeTable({ context: "work-ro", view: "svc" });
  assert.equal(calls.length, reads, "tables answer from the shared snapshot: no new reads");
  assert.match((await app.kubeTable({ context: "work-ro", view: "nodes" })).error, /cluster-scoped/);
  await app.kubeTable({ context: "work-ro", view: "events" });
  const eventCalls = calls.slice(reads).map((c) => c.path);
  assert.deepEqual(eventCalls.sort(), ["/api/v1/namespaces/ledger/events?limit=200", "/api/v1/namespaces/payments/events?limit=200"], "events: namespaced, only when asked");
  await app.kubeTable({ context: "work-ro", view: "events" });
  assert.equal(calls.length, reads + 2, "events cached 15 s");
  assert.ok(calls.every((c) => !/\/nodes|\/namespaces$|^\/api\/v1\/pods/.test(c.path)), "never cluster-scoped");
  const d = await app.kubeDescribe({ context: "work-ro", view: "pods", ns: "payments", name: pods.rows.find((r) => r.ns === "payments").name });
  assert.match(d.text, /Namespace:\s+payments/);
  assert.match(d.yaml, /kind: Pod/);
});

test("the K9S window has no key that writes", () => {
  const words = K9S_KEYS.map(([, what]) => what).join(" ");
  for (const verb of ["exec", "shell", "port", "forward", "delete", "kill", "scale", "edit", "restart", "attach"]) assert.ok(!words.includes(verb), `no ${verb} key`);
  const src = readFileSync(new URL("../src/k9s.js", import.meta.url), "utf8");
  assert.ok(!/method\s*:/.test(src), "fetches are plain GETs");
  for (const verb of ["/exec", "portforward", "DELETE", "PATCH", "PUT", "POST"]) assert.ok(!src.includes(verb), `no ${verb}`);
});
