// SNIFF clarity 2/2: the status line is the verdict, DEBUG starts as a slim bar.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");

test("DEBUG starts folded and opens when a probe starts", () => {
  const view = src("netdebug/view.js");
  assert.match(view, /let open = false;/);
  for (const fn of ["const start = async", "const planInside = async", "const startInside = async"]) {
    assert.match(view.slice(view.indexOf(fn), view.indexOf(fn) + 120), /open = true;/, fn);
  }
});

test("SNIFF's status line carries the verdict, coloured by tone, notes on hover", () => {
  const browser = src("browser.js");
  assert.match(browser, /import \{ pathVerdict \} from "\.\/path-card\.js";/);
  assert.match(browser, /const verdict = pathVerdict\(body\.diagram, sample \? null : pathProbe\);/);
  assert.match(src("server.js"), /#status\[data-tone="broken"\]/);
});
