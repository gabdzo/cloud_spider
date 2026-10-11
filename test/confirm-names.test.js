// Full teardown 2026-10-11: camp and site only accepted the configured
// name (cloudspider-camp), not the stack name (camp). Both work now, and the
// confirm field says which to type.
import test from "node:test";
import assert from "node:assert/strict";
import { UPGRADES, createUpgrade } from "../src/upgrade.js";
import { confirmMatches, confirmNames, confirmPrompt } from "../src/upgrade-rules.js";

const spec = (id) => UPGRADES.find((item) => item.id === id);

function fakeRun() {
  return { stdout: { on() {} }, stderr: { on() {} }, on(event, fn) { if (event === "close") setImmediate(() => fn(0)); } };
}

test("the card name or the stack name: camp, site, eks, add-ons, pgcluster", () => {
  assert.deepEqual(confirmNames(spec("camp"), { name: "cloudspider-camp" }), ["cloudspider-camp", "camp"]);
  assert.deepEqual(confirmNames(spec("site"), { name: "my-site" }), ["my-site", "site"]);
  assert.deepEqual(confirmNames(spec("eks"), { clusterName: "cs-lt" }), ["cs-lt", "eks-cs-lt"]);
  assert.deepEqual(confirmNames(spec("eks"), { clusterName: "cloudspider-up" }), ["cloudspider-up", "upgrade"]);
  assert.deepEqual(confirmNames(spec("lbc"), { clusterName: "cs-lt" }), ["lbc-cs-lt"]);
  assert.deepEqual(confirmNames(spec("pgcluster"), { clusterName: "cs-lt" }), ["pgcluster"]);
  assert.equal(confirmPrompt(spec("camp"), { name: "cloudspider-camp" }), "type cloudspider-camp (or camp)");
  assert.equal(confirmPrompt(spec("pgcluster"), {}), "type pgcluster");
  assert.ok(confirmMatches(["cloudspider-camp", "camp"], " camp "));
  assert.equal(confirmMatches(["cloudspider-camp", "camp"], ""), false);
  assert.equal(confirmMatches([""], ""), false);
  assert.equal(confirmMatches(["camp"], "cloudspider"), false);
});

test("TAKE IT DOWN on camp and site starts with the stack name, refuses anything else and says what to type", () => {
  for (const [id, name] of [["camp", "cloudspider-camp"], ["site", "cloudspider-site"]]) {
    const upgrade = createUpgrade({ run: fakeRun });
    const wrong = upgrade.run({ module: id, action: "destroy", params: { name, confirmName: "nope" } });
    assert.equal(wrong.error, `the name does not match: type ${name} or ${id} to take it down`);
    const started = upgrade.run({ module: id, action: "destroy", params: { name, confirmName: id } });
    assert.equal(started.running, true, id);
    assert.equal(started.stack, id);
    const again = createUpgrade({ run: fakeRun }).run({ module: id, action: "destroy", params: { name, confirmName: name } });
    assert.equal(again.running, true);
  }
});

test("the confirm field shows the names to type", async () => {
  const { readFileSync } = await import("node:fs");
  const browser = readFileSync(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(browser, /function promptConfirm\(spec, body\)/);
  assert.match(browser, /confirm\.placeholder = text/);
  assert.equal(createUpgrade({ run: fakeRun }).list().find((item) => item.id === "camp").stack, "camp");
});
