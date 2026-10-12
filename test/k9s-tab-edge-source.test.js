import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { edgeBadge } from "../src/graph-view.js";

test("K9S is a top-level view tab after Cluster, gated by the kubernetes module", async () => {
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  const tabs = server.match(/<nav class="tabs" aria-label="views">([\s\S]*?)<\/nav>/)[1];
  assert.match(tabs, /<button id="k9s-btn" class="tab" type="button" data-icon="terminal" aria-pressed="false"[^>]*data-module="kubernetes">K9S<\/button>/);
  assert.doesNotMatch(server, /#k9s-btn \{ position: absolute/);
  const browser = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(browser, /kubernetes: "#cluster, #k9s-btn"/);
  assert.match(browser, /if \(mode !== "cluster"\) \{\n    markHistory\(\);\n    await enterCluster\(\);\n    k9s\.open\(\);/);
});

test("edgeBadge: live trace edges say Beyla/OTel with rps and errors; flows LIVE · FLOW; static/owner none", () => {
  assert.equal(edgeBadge({ sources: ["trace"], rps: 38, errors: 3.1 }), "LIVE · Beyla/OTel 38/s · 3.1% err");
  assert.equal(edgeBadge({ sources: ["flow", "trace"], rps: 5, errors: 0 }), "LIVE · Beyla/OTel 5/s");
  assert.equal(edgeBadge({ sources: ["flow"], rps: 120, errors: 0 }), "LIVE · FLOW 120/s");
  assert.equal(edgeBadge({ sources: ["static"], rps: 0, errors: 0 }), "");
  assert.equal(edgeBadge({ sources: ["owner"], rps: 0, errors: 0 }), "");
});

test("graph legend names every edge style, styled in both themes", async () => {
  const view = await readFile(new URL("../src/graph-view.js", import.meta.url), "utf8");
  for (const s of ["TALKING · live traffic", "TALKING WITH ERRORS", "CONFIG ONLY · not seen talking", "OWNER"]) assert.ok(view.includes(s), s);
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /#kube-graph \.gv-badge rect/);
  assert.match(server, /:root\[data-theme="pro"\] #kube-graph \.gv-badge rect/);
  assert.match(server, /:root\[data-theme="pro"\] #kube-graph \.gv-key\.st-live i/);
});
