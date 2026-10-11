// Drill 2026-10-11, finding 7: the app's vault owns the app's ALB. The lbc
// add-on's default tags carry no `project` (they win over the Ingress's
// annotation tags), so the ALB keeps project=<app>; a vault can also select
// the controller's own `ingress.k8s.aws/stack` tag.
import test from "node:test";
import assert from "node:assert/strict";
import { matchVaults } from "../src/vault-match.js";

const ALB = "arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/k8s-shop-shopapi/abc";
// What the controller puts on the ALB: its own tags, the Ingress's
// annotation tags, then defaultTags (highest priority).
function albTags(defaultTags) {
  return Object.entries({ "elbv2.k8s.aws/cluster": "cs-drill", "ingress.k8s.aws/stack": "shop/shopapi", "ingress.k8s.aws/resource": "LoadBalancer", project: "shopapi", ...defaultTags }).map(([Key, Value]) => ({ Key, Value }));
}
const place = (defaultTags) => ({ vpcs: [], subnets: [], instances: [], fixtures: [{ id: ALB, kind: "alb", name: "k8s-shop-shopapi", tags: albTags(defaultTags) }] });
const lbcVault = { key: "lbc", resources: { tags: { project: "lbc" } } };
const appVault = { key: "shopapi", resources: { tags: { project: "shopapi" } } };

test("with project in the controller's default tags the lbc vault took the app's ALB (the drill)", () => {
  const owned = matchVaults([lbcVault, appVault], place({ project: "lbc", cluster: "cs-drill" }));
  assert.deepEqual(owned.get("lbc"), [ALB]);
  assert.deepEqual(owned.get("shopapi"), []);
});

test("without it, the app's vault owns its ALB", () => {
  const owned = matchVaults([lbcVault, appVault], place({ cluster: "cs-drill", "managed-by": "aws-load-balancer-controller", cloudspider: "expendable" }));
  assert.deepEqual(owned.get("lbc"), []);
  assert.deepEqual(owned.get("shopapi"), [ALB]);
});

test("a vault can bind by the controller's own tags (no annotation needed)", () => {
  const byStack = { key: "shop", resources: { tags: { "elbv2.k8s.aws/cluster": "cs-drill", "ingress.k8s.aws/stack": "shop/shopapi" } } };
  const owned = matchVaults([lbcVault, byStack], place({ project: "lbc" }));
  assert.deepEqual(owned.get("shop"), [], "a vault earlier in file order still wins a tie");
  assert.deepEqual(matchVaults([byStack, lbcVault], place({ project: "lbc" })).get("shop"), [ALB]);
});
