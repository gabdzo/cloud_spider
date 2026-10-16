import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { stringify } from "yaml";
import { createKube } from "../src/kube.js";
import { inventory } from "../src/kube-inventory.js";
import { createHealthWatch, morningLine } from "../src/kube-health.js";

// A context restricted to 5 namespaces (namespaces: [...]): every read is a
// namespaced call, nothing cluster-wide, no nodes; 403s stay notes.
const NS = ["oba-dev", "ppf-play", "albaraka-dev", "team-x", "albaraka-helm"];
const CONFIG = {
  apiVersion: "v1",
  clusters: [{ name: "c", cluster: { server: "https://fake.example", "certificate-authority-data": Buffer.from("CA").toString("base64") } }],
  users: [{ name: "u", user: { exec: { command: "tok", args: [] } } }],
  contexts: [{ name: "five", context: { cluster: "c", user: "u" } }],
};
const run = () => {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  setImmediate(() => { child.stdout.emit("data", JSON.stringify({ status: { token: "t", expirationTimestamp: new Date(Date.now() + 9e5).toISOString() } })); child.emit("close", 0); });
  return child;
};

test("a 5-namespace context: snapshot, RES inventory and the morning use namespaced calls only", async () => {
  const urls = [];
  const kube = createKube({
    env: { KUBECONFIG: "/kc", PATH: "/bin" }, run, read: async () => stringify(CONFIG), context: "five", namespaces: NS,
    get: async (url) => {
      const path = url.replace("https://fake.example", "");
      urls.push(path);
      if (path === "/api/v1") return { status: 200, body: JSON.stringify({ resources: [{ name: "pods", namespaced: true, kind: "Pod", verbs: ["list"] }, { name: "configmaps", namespaced: true, kind: "ConfigMap", verbs: ["list"] }] }) };
      if (path === "/apis") return { status: 200, body: JSON.stringify({ groups: [] }) };
      if (path.includes("/namespaces/team-x/")) return { status: 403, body: "{}" };
      if (/\/namespaces\/oba-dev\/pods\b/.test(path) && !path.includes("includeObject")) return { status: 200, body: JSON.stringify({ items: [{ metadata: { namespace: "oba-dev", name: "api-1", ownerReferences: [] }, spec: { containers: [{ name: "a" }] }, status: { phase: "Running", containerStatuses: [{ name: "a", ready: false, restartCount: 9, state: { waiting: { reason: "CrashLoopBackOff" } } }] } }] }) };
      if (path.includes("includeObject")) return { status: 200, body: JSON.stringify({ columnDefinitions: [{ name: "Name" }], rows: [{ cells: ["x"], object: { metadata: { namespace: path.split("/")[4], name: "x" } } }], metadata: {} }) };
      return { status: 200, body: JSON.stringify({ items: [] }) };
    },
  });
  const snap = await kube.snapshot();
  assert.equal(snap.error, undefined);
  assert.deepEqual(snap.namespaces.map((n) => n.metadata.name), NS);
  assert.ok(snap.access["team-x"], "team-x 403 is a note, not a failure");
  const inv = await inventory({ get: (p, o) => kube.readPath(p, o), scope: kube.scope });
  assert.equal(inv.kinds.find((k) => k.resource === "pods").count, 4, "four readable namespaces");
  const wide = urls.filter((p) => !/^\/apis?$|^\/api\/v1$|^\/apis\/[^/]+\/[^/]+$/.test(p) && !/\/namespaces\/[a-z-]+\//.test(p));
  assert.deepEqual(wide, [], "no cluster-wide list");
  assert.ok(!urls.some((p) => /\/nodes\b/.test(p)));
  const watch = createHealthWatch();
  const ctx = { name: "five", label: "five", namespaces: NS };
  watch.take(ctx, snap);
  const line = morningLine(watch.summary(ctx));
  assert.match(line.text, /oba-dev, ppf-play, albaraka-dev, team-x, albaraka-helm/);
  assert.match(line.text, /By namespace: oba-dev 1; healthy: ppf-play, albaraka-dev, team-x, albaraka-helm/);
});
