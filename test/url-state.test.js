import test from "node:test";
import assert from "node:assert/strict";
import { formatUrlState, parseUrlState } from "../src/url-state.js";
import { parseVaultHash } from "../src/vault-page.js";

test("url state round-trips every piece", () => {
  const cases = [
    { view: "", vault: null, sample: false, learn: "", stacks: "", lb: "", host: "", debug: "", why: false },
    { view: "path", vault: null, sample: true, learn: "", stacks: "", lb: "arn:aws:elasticloadbalancing:eu-central-1:1:loadbalancer/app/web/abc", host: "shop.example.com", debug: "", why: false },
    { view: "cluster", vault: null, sample: false, learn: "k8s/01-pods", stacks: "", lb: "", host: "", debug: "", why: false },
    { view: "vaults", vault: "shop/api", sample: true, learn: "", stacks: "eks", lb: "", host: "", debug: "", why: false },
    { view: "", vault: null, sample: false, learn: "", stacks: "1", lb: "", host: "", debug: "", why: false },
  ];
  for (const state of cases) assert.deepEqual(parseUrlState(formatUrlState(state)), state);
});

test("a WHY? link runs DEBUG once: debug and why parse on the path view only and are not written back", () => {
  const want = parseUrlState("#path?sample=1&debug=https%3A%2F%2Fweb.sample.test%2F&why=1");
  assert.equal(want.debug, "https://web.sample.test/");
  assert.equal(want.why, true);
  assert.equal(parseUrlState("#cluster?debug=x&why=1").debug, "");
  assert.equal(formatUrlState({ ...want }), "#path?sample=1");
});

test("the plain map has no hash; old hashes still parse", () => {
  assert.equal(formatUrlState({ view: "" }), "");
  assert.equal(parseUrlState("#path").view, "path");
  assert.equal(parseUrlState("#cluster").view, "cluster");
  assert.equal(parseUrlState("#vaults/a%2Fb").vault, "a/b");
  assert.equal(parseUrlState("#nonsense").view, "");
});

test("lb and host only belong to the path view", () => {
  assert.equal(formatUrlState({ view: "", lb: "x", host: "y" }), "");
  assert.equal(parseUrlState("#cluster?lb=x&host=y").lb, "");
});

test("vault routes keep working with a query behind them", () => {
  assert.deepEqual(parseVaultHash("#vaults?sample=1"), { key: null });
  assert.deepEqual(parseVaultHash("#vaults/shop%2Fapi?learn=1"), { key: "shop/api" });
});
