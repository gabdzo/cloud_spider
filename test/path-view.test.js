import assert from "node:assert/strict";
import test from "node:test";
import { pathResult } from "../src/path-view.js";
import { samplePathGraph } from "../src/path-sample.js";

test("a region with no load balancers says so", () => {
  const view = pathResult({ ...samplePathGraph(), loadBalancers: [] }, { region: "eu-north-1" });
  assert.equal(view.headline, "eu-north-1 has no load balancers");
  assert.equal(view.diagram, null);
});

test("a pasted URL follows its rule only", () => {
  const view = pathResult(samplePathGraph(), { region: "sample", host: "https://api.sample.test/orders" });
  assert.equal(view.selected, "sample-lb-api");
  assert.deepEqual(
    view.diagram.nodes.filter((node) => node.kind === "rule").map((node) => node.id),
    ["sample-rule-443-api"],
  );
  assert.equal(
    view.headline,
    "sample-sg-node-b does not allow tcp 8080 from sample-sg-alb. The load balancer cannot reach this target.",
  );
});

test("a host no load balancer answers for is said, and the first load balancer is drawn", () => {
  const view = pathResult(samplePathGraph(), { region: "sample", host: "nothing.example.com" });
  assert.equal(view.hostNote, "no load balancer in sample answers for nothing.example.com. Route 53 is not read.");
  assert.equal(view.selected, "sample-lb-api");
});

test("an unknown load balancer id falls back to the first one", () => {
  const view = pathResult(samplePathGraph(), { region: "sample", lb: "arn:aws:elasticloadbalancing:other" });
  assert.equal(view.selected, "sample-lb-api");
  assert.deepEqual(view.loadBalancers, [
    { arn: "sample-lb-api", name: "api-alb", dns: "api-alb-sample.eu-north-1.elb.amazonaws.com" },
  ]);
});
