import test from "node:test";
import assert from "node:assert/strict";

test("TOPOLOGY focus bar: in the prompt bar, served, both themes, kept per browser, applied before Group by", async () => {
  const { readFile } = await import("node:fs/promises");
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /<span id="kube-focus" role="group"[^>]*hidden><button id="kf-issues"/);
  assert.match(server, /"kube-focus\.js",/);
  assert.match(server, /<section id="kube-healthy"/);
  assert.match(server, /:root\[data-theme="pro"\] #kube-focus/);
  const browser = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(browser, /window\.localStorage\.setItem\(TOPOLOGY_FOCUS_KEY, JSON\.stringify\(topologyFocus\)\)/);
  assert.match(browser, /groupedDiagram\(focusedView\(\)\.diagram\)/);
  assert.match(browser, /SHOW FULL VIEW/);
  assert.match(browser, /INVESTIGATE/);
});

test("a search stays inside ISSUES and searches what is shown", async () => {
  const { readFile } = await import("node:fs/promises");
  const browser = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.doesNotMatch(browser, /currentSearch\(\)\.active \? \{ \.\.\.topologyFocus, view: "all" \}/);
  assert.match(browser, /searchKube\(diagram, text\)/);
  assert.match(browser, /focusedView\(\)\?\.diagram : clusterData\?\.diagram/);
});

test("the context switcher drops to its own row when it would cover the tabs", async () => {
  const { readFile } = await import("node:fs/promises");
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const browser = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(server, /#kube-ctx\.below \{ top: 44px;/);
  assert.match(browser, /const below = leftSide && free < kubeCtxEl\.scrollWidth;/);
  assert.match(browser, /kubeCtxEl\.classList\.contains\("below"\)\) \? 88 : 52/);
});

test("long NetworkPolicy lists fold to +N; ISSUES says how many healthy are hidden, with a way to ALL", async () => {
  const { readFile } = await import("node:fs/promises");
  const browser = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  const m = /function shortList\(names, keep = 2\) \{\n  return (.*);\n\}/.exec(browser);
  assert.ok(m, "shortList");
  const shortList = new Function("names", "keep = 2", `return ${m[1]};`);
  assert.equal(shortList(["a", "b", "c", "d", "e", "f", "g", "h", "i"]), "a, b +7");
  assert.equal(shortList(["a", "b", "c"]), "a, b, c");
  assert.match(browser, /healthy hidden · SHOW IN ALL/);
  assert.match(browser, /no match in ISSUES · \$\{elsewhere\} healthy in ALL \(click\)/);
});
