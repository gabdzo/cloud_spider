// SERVICES prototype (SAMPLE only): scenarios, grouping, focus, budget,
// search, layers and the incident timeline.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { bareScenario, bundleScenario } from "../src/graph-sample.js";
import { EDGE_BUDGET_BIG, initialExpanded, sceneStats, timeline, visibleGraph } from "../src/graph-model.js";

test("scenarios: a bare cert-manager cluster and a 40-operator bundle at 200+ namespaces", () => {
  const bare = sceneStats(bareScenario());
  assert.equal(bare.operators, 1);
  const big = sceneStats(bundleScenario());
  assert.equal(big.operators, 40);
  assert.ok(big.namespaces >= 200, `namespaces ${big.namespaces}`);
  assert.ok(big.crds >= 120, `crds ${big.crds}`);
  for (const s of [bareScenario(), bundleScenario()]) {
    const ids = new Set(s.nodes.map((n) => n.id));
    for (const e of s.edges) assert.ok(ids.has(e.from) && ids.has(e.to), `${e.from} -> ${e.to}`);
    for (const ev of s.events) assert.ok(ids.has(ev.node) && s.groups.some((g) => g.id === ev.group), ev.text);
    assert.match(s.note, /^sample · /);
  }
});

test("closed groups merge their links; small clusters open everything", () => {
  const s = bundleScenario();
  const v = visibleGraph(s, { budget: 9999 });
  assert.ok(v.edges.every((e) => e.from.startsWith("g:") && e.to.startsWith("g:")));
  assert.equal(new Set(v.edges.map((e) => `${e.from}>${e.to}`)).size, v.edges.length);
  assert.equal(initialExpanded(bareScenario()).size, bareScenario().groups.length);
  assert.equal(initialExpanded(s).size, 0);
  const open = visibleGraph(s, { expanded: new Set(["billing"]), budget: 9999 });
  assert.ok(open.edges.some((e) => e.from === "billing/api"));
});

test("big overview keeps the error links first; focus shows one group and its neighbors", () => {
  const s = bundleScenario();
  const v = visibleGraph(s);
  assert.equal(v.edges.length, EDGE_BUDGET_BIG);
  assert.ok(v.hidden > 0);
  assert.ok(v.edges.slice(0, 3).every((e) => e.errors > 0));
  const f = visibleGraph(s, { focus: "billing" });
  const shown = f.bands.flatMap((b) => b.groups);
  assert.ok(shown.length < 12 && shown.some((g) => g.id === "billing" && g.open));
  assert.ok(f.edges.every((e) => e.groups.includes("billing")));
});

test("search marks matches and dims the rest; layers filter by data source", () => {
  const s = bundleScenario();
  const v = visibleGraph(s, { query: "ledger" });
  const groups = v.bands.flatMap((b) => b.groups);
  assert.ok(groups.find((g) => g.id === "ledgerdb").match);
  assert.ok(groups.find((g) => g.id === "portal").dim);
  const traces = visibleGraph(s, { layers: new Set(["trace"]), budget: 9999 });
  assert.ok(traces.edges.every((e) => e.sources.every((x) => x === "trace")));
  assert.equal(visibleGraph(s, { layers: new Set() }).edges.length, 0);
});

test("timeline: events sorted on the window, incident band inside it", () => {
  const t = timeline(bundleScenario());
  assert.ok(t.events.every((e, i, all) => i === 0 || e.x >= all[i - 1].x));
  assert.ok(t.incident[0] > 0 && t.incident[1] < 1 && t.incident[0] < t.incident[1]);
});

test("the SERVICES tab exists only in SAMPLE mode and is served", () => {
  const browser = readFileSync(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(browser, /\{ id: "graph", label: "SERVICES", sampleOnly: true/);
  assert.match(browser, /button\.hidden = Boolean\(CLUSTER_SCREENS\.find\(\(item\) => item\.id === button\.dataset\.screen\)\?\.sampleOnly\) && !sample;/);
  const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  for (const f of ["graph-sample.js", "graph-model.js", "graph-view.js"]) assert.ok(server.includes(`"${f}"`), f);
  assert.match(server, /<section id="kube-graph"/);
});
