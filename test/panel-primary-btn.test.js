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
