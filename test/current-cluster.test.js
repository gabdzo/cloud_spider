// The current cluster comes from the selected kube context or the live EKS
// stacks, never from a hard-coded "cloudspider-up"; the cards, the scale
// row and the run history follow it. Fakes, cluster name "shop-east".
import assert from "node:assert/strict";
import test from "node:test";
import { pickCurrentCluster } from "../src/current-cluster.js";
import { createApp } from "../src/app.js";
import { driftHint } from "../src/stack-overview.js";
import { scaleRowHtml } from "../src/eks-scale-view.js";

test("pickCurrentCluster: the selected context's cluster first, then the live EKS stack", () => {
  const eksStacks = [{ name: "upgrade", resourceCount: 0 }, { name: "eks-shop-east", resourceCount: 33 }, { name: "eks-old", resourceCount: 0 }];
  assert.equal(pickCurrentCluster({ selectedContext: "shop-east-viewer", eksStacks }), "shop-east");
  assert.equal(pickCurrentCluster({ selectedContext: "arn:aws:eks:eu-north-1:1:cluster/shop-east", eksStacks }), "shop-east");
  assert.equal(pickCurrentCluster({ selectedContext: "", eksStacks }), "shop-east");
  assert.equal(pickCurrentCluster({ selectedContext: "minikube", eksStacks }), "shop-east");
  assert.equal(pickCurrentCluster({ selectedContext: "", eksStacks: [{ name: "upgrade", resourceCount: 30 }], legacyName: "cloudspider-up" }), "cloudspider-up");
  assert.equal(pickCurrentCluster({ selectedContext: "", eksStacks: [] }), "");
});

function fakeUpgrade() {
  return {
    list: () => [
      { id: "eks", stack: "upgrade", current: { clusterName: "cloudspider-up", vpcCidr: "10.43.0.0/16" }, parameters: [{ name: "clusterName", default: "cloudspider-up" }] },
      { id: "pgcluster", stack: "pgcluster", needs: ["eks"], current: {}, parameters: [{ name: "clusterName", default: "cloudspider-up" }] },
      { id: "kyverno", stack: "kyverno", addon: true, needs: ["eks"], current: {}, parameters: [{ name: "clusterName", default: "cloudspider-up" }] },
      { id: "site", stack: "site", current: {}, parameters: [] },
    ],
    eksStacks: async () => [{ name: "upgrade", resourceCount: 0 }, { name: "eks-shop-east", resourceCount: 33 }],
    discoverStacks: async (c) => ({ stacks: [{ id: "pgcluster", stack: `pgcluster-${c}`, count: 20 }, { id: "kyverno", stack: `kyverno-${c}`, addon: true, count: 12 }] }),
    stackConfigOf: (id, stack) => (stack === "eks-shop-east" ? { clusterName: "shop-east", vpcCidr: "10.44.0.0/16" } : {}),
    legacyCluster: async () => "cloudspider-up",
  };
}

test("the cards come back for the current cluster: its stacks and saved config, not cloudspider-up's", async () => {
  const app = createApp({ upgrade: fakeUpgrade(), pageOrigin: "http://127.0.0.1:9241", clock: () => 0, write() {}, autoConnect: false, settings: { kube: { context: "" } } });
  const cards = await app.upgrades();
  const by = Object.fromEntries(cards.map((c) => [c.id, c]));
  assert.equal(by.eks.current.clusterName, "shop-east");
  assert.equal(by.eks.current.vpcCidr, "10.44.0.0/16");
  assert.equal(by.eks.stack, "eks-shop-east");
  assert.equal(by.pgcluster.stack, "pgcluster-shop-east");
  assert.equal(by.pgcluster.current.clusterName, "shop-east");
  assert.equal(by.kyverno.stack, "kyverno-shop-east");
  assert.equal(by.site.stack, "site");
  assert.equal(await app.currentCluster(), "shop-east");
});

test("a deployed stack with no run in the app says so, instead of 'no run logged'", () => {
  assert.equal(driftHint({ state: "deployed", count: 3 }, null), "DEPLOYED OUTSIDE THE APP: NO RUN LOGGED HERE");
  assert.equal(driftHint({ state: "down" }, null), "");
});

test("the scale hint names the card's cluster and says what to add", () => {
  const html = scaleRowHtml({ cluster: "shop-east", status: { canScale: false, writeContexts: [] } });
  assert.match(html, /shop-east/);
  assert.doesNotMatch(html, /cloudspider-up/);
});
