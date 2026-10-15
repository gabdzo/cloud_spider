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
