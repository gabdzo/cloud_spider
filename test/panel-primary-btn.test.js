import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("Service panel: DIAGNOSE is a solid high-contrast primary button, CLOSE has a clear border", async () => {
  const browser = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(browser, /vel\("button", "vp-close vp-primary", "▶ DIAGNOSE"\)/);
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /\.vp-close\.vp-primary \{[^}]*background: var\(--world-amber, #ffcc33\)[^}]*border: 2px solid #000/);
  assert.match(server, /\.kp-title \.vp-close:not\(\.vp-primary\) \{[^}]*border: 2px solid #000/);
});

test("Service panel: pod rows never clip the pod name and the panel sits above the CONTEXT bar", async () => {
  const browser = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(browser, /vel\("button", "cmd svc-pod-btn", middle\(p\.name, 40\)\)/);
  const server = await readFile(new URL("../src/server.js", import.meta.url), "utf8");
  assert.match(server, /li\.svc-pod, \.svc-pod \{ grid-template-columns: none; display: flex; flex-wrap: wrap;/);
  assert.match(server, /\.kp-body \.svc-pod > button\.svc-pod-btn \{[^}]*min-width: 0; max-width: 100%;/);
  assert.match(server, /#kube-panel \{ position: absolute; z-index: 6;/);
});
