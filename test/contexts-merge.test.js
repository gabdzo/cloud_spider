// cloudspider.yaml kube.contexts and the contexts file that CONNECT writes:
// yaml first, no duplicates, and CONNECT never copies a yaml entry into the
// file (nor writes one that the yaml already lists). Files are fakes.
import test from "node:test";
import assert from "node:assert/strict";
import { loadContexts } from "../src/kube-contexts.js";
import { addContextEntry, createConnector } from "../src/kube-connect.js";

const FILE = "contexts:\n  - context: from-file\n  - context: both\n    label: FILE\n  - context: from-file\n";

test("yaml first, then the file; a name in both or twice is listed once, each with its origin", async () => {
  const got = await loadContexts({
    env: {},
    read: async () => FILE,
    configured: [{ context: "both", label: "CFG" }, { context: "cfg-only" }, { context: "cfg-only", label: "AGAIN" }],
  });
  assert.deepEqual(got.contexts.map((c) => [c.name, c.label, c.origin]), [
    ["both", "CFG", "config"],
    ["cfg-only", "cfg-only", "config"],
    ["from-file", "from-file", "file"],
  ]);
  assert.ok(got.errors.some((e) => /cfg-only is listed twice/.test(e)));
  assert.ok(got.errors.some((e) => /from-file is listed twice/.test(e)));
  assert.deepEqual((await loadContexts({ env: {}, read: async () => FILE })).contexts.map((c) => c.origin), ["file", "file"]);
  assert.equal((await loadContexts({ env: { CLOUDSPIDER_KUBE_CONTEXTS: "e:*" } })).contexts[0].origin, "env");
  assert.equal((await loadContexts({ env: {}, read: async () => null })).contexts[0].origin, "single");
});

test("a new contexts file never copies cloudspider.yaml's contexts", () => {
  const current = [
    { name: "work-ro", label: "WORK", namespaces: ["a"], origin: "config" },
    { name: "cloudspider-viewer", label: "DEMO", namespaces: "*", origin: "single" },
  ];
  const next = addContextEntry(null, { context: "cs-new-viewer", namespaces: "*" }, { current });
  assert.match(next.text, /cloudspider-viewer/);
  assert.match(next.text, /cs-new-viewer/);
  assert.doesNotMatch(next.text, /work-ro/);
});

test("CONNECT does not write a context the yaml lists; DISCONNECT says it stays listed there", async () => {
  const files = new Map([["/c.yaml", "contexts:\n  - context: keep\n  - context: both\n"]]);
  const connector = createConnector({
    env: { HOME: "/home/x" },
    contextsFile: "/c.yaml",
    exampleFile: "/ex.yaml",
    read: async (path) => (files.has(path) ? files.get(path) : Promise.reject(Object.assign(new Error("no"), { code: "ENOENT" }))),
    write: async (path, text) => files.set(path, text),
  });
  const current = [{ name: "both", origin: "config" }];
  const added = await connector.addToList({ context: "both", namespaces: "*" }, current);
  assert.match(added.lines[0], /listed in cloudspider.yaml/);
  assert.equal(files.get("/c.yaml"), "contexts:\n  - context: keep\n  - context: both\n");
  const removed = await connector.removeFromList("both", current);
  assert.deepEqual(removed.lines, ["removed both from /c.yaml", "both is also in cloudspider.yaml (kube.contexts) and stays listed until you remove it there"]);
  assert.doesNotMatch(files.get("/c.yaml"), /both/);
  // Without a yaml twin it is a plain add.
  assert.match((await connector.addToList({ context: "fresh", namespaces: "*" }, current)).lines[0], /added to \/c.yaml/);
});
