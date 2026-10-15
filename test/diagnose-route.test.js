import { test } from "node:test";
import assert from "node:assert/strict";
import { diagnoseRoute } from "../src/diagnose/route.js";
import { validate } from "../src/diagnose/contract.js";

async function call(method, path, body, dx = null) {
  let out;
  const url = new URL(`http://x${path}`);
  const handled = await diagnoseRoute({ method, headers: {} }, {}, url, dx, { send: (_r, status, b) => (out = { status, body: b }), readJson: async () => body });
  return { handled, ...out };
}

test("route: SAMPLE investigate → verify resolved / still / gone, all offline", async () => {
  const inv = await call("POST", "/api/diagnose/investigate", { sample: true });
  assert.equal(inv.status, 200);
  assert.deepEqual(validate(inv.body), []);
  assert.equal(inv.body.mode, "sample");
  for (const [outcome, want] of [["", "resolved"], ["still", "still_failing"], ["gone", "inconclusive"]]) {
    const v = await call("POST", "/api/diagnose/verify", { sample: true, investigation_id: inv.body.investigation_id, outcome });
    assert.equal(v.body.status, want, outcome);
  }
  const saved = await call("GET", `/api/diagnose/investigation?sample=1&id=${inv.body.investigation_id}`);
  assert.equal(saved.body.verification.status, "inconclusive");
});

test("route: live needs DNS names and a context; unknown paths fall through", async () => {
  assert.equal((await call("POST", "/api/diagnose/investigate", { namespace: "../x", service: "a" })).status, 400);
  assert.equal((await call("POST", "/api/diagnose/investigate", { namespace: "a", service: "b" }, { kubeOf: () => null })).body.unset, true);
  assert.equal((await call("POST", "/api/diagnose/verify", { investigation_id: "nope" })).status, 404);
  assert.equal((await call("GET", "/api/other")).handled, false);
});

test("route: no context asked → the configured default context, not the first one; an asked one wins", async () => {
  const asked = [];
  const fake = (name) => ({ context: name, target: async () => ({ error: `${name} unreachable` }), read: async () => ({}) });
  const dx = { kubeOf: (name) => { asked.push(name); return ["alpha-lab", "zeta-shop"].includes(name) ? fake(name) : null; }, defaultContext: () => "zeta-shop", store: { save: async () => {}, load: async () => null } };
  const one = await call("POST", "/api/diagnose/investigate", { namespace: "shop", service: "cart" }, dx);
  assert.equal(one.body.scope.context, "zeta-shop");
  const two = await call("POST", "/api/diagnose/investigate", { context: "alpha-lab", namespace: "shop", service: "cart" }, dx);
  assert.equal(two.body.scope.context, "alpha-lab");
  assert.deepEqual(asked, ["zeta-shop", "alpha-lab"]);
  const gone = await call("POST", "/api/diagnose/investigate", { context: "old-one", namespace: "shop", service: "cart" }, dx);
  assert.match(gone.body.error, /no kube context named old-one/);
});
