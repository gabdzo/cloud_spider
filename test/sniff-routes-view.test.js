import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
const browser = readFileSync(new URL("../src/browser.js", import.meta.url), "utf8");

test("SNIFF has a ROUTES | TRACE switch, ROUTES is a page (not the popup), choice remembered", () => {
  assert.match(server, /id="sniff-switch"[^>]*>.*id="sniff-routes-key".*id="sniff-trace-key"/);
  assert.match(server, /#sniff-routes-page \{ position: fixed;[^}]*overflow: auto;[^}]*var\(--pip-ink\)/);
  assert.match(browser, /localStorage\.getItem\("cs\.sniffView"\) === "trace" \? "trace" : "routes"/);
  assert.doesNotMatch(browser, /sniffEmptyEl\.replaceChildren\([^)]*sniffRoutesBlock/);
  assert.match(browser, /setSniffView\("trace"\);\n\s*hostInput\.dispatchEvent/);
  assert.match(browser, /const keep = sniffRoutesPage\.scrollTop;/);
});
