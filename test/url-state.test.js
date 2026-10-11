import test from "node:test";
import assert from "node:assert/strict";
import { formatUrlState, parseUrlState } from "../src/url-state.js";
import { parseVaultHash } from "../src/vault-page.js";

test("url state round-trips every piece", () => {
  const cases = [
    { view: "", vault: null, sample: false, learn: "", stacks: "", lb: "", host: "" },
    { view: "path", vault: null, sample: true, learn: "", stacks: "", lb: "arn:aws:elasticloadbalancing:eu-central-1:1:loadbalancer/app/web/abc", host: "shop.example.com" },
    { view: "cluster", vault: null, sample: false, learn: "k8s/01-pods", stacks: "", lb: "", host: "" },
    { view: "vaults", vault: "shop/api", sample: true, learn: "", stacks: "eks", lb: "", host: "" },
    { view: "", vault: null, sample: false, learn: "", stacks: "1", lb: "", host: "" },
  ];
  for (const state of cases) assert.deepEqual(parseUrlState(formatUrlState(state)), state);
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
