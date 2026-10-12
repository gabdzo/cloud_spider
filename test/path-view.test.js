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

test("a host no rule names draws only the rule it would land on", () => {
  const view = pathResult(samplePathGraph(), { region: "sample", host: "nothing.example.com" });
  assert.equal(view.hostNote, "no rule in sample names nothing.example.com. If nothing.example.com points at k8s-demo-api, this is the path it takes. Route 53 is not read.");
  assert.equal(view.selected, "sample-lb-api");
  assert.deepEqual(
    view.diagram.nodes.filter((node) => node.kind === "rule").map((node) => node.id),
    ["sample-rule-443-default"],
  );
});

test("a redirect and a passed-over rule are both said", () => {
  const graph = samplePathGraph();
  graph.rules.find((rule) => rule.arn === "sample-rule-443-api").others = 2;
  const view = pathResult(graph, { region: "sample", host: "http://api.sample.test/" });
  assert.equal(
    view.hostNote,
    "api.sample.test is redirected first. The path drawn is the one after the redirect. 1 rule ahead of it also checks headers, query strings, methods, or source addresses, which are not evaluated here. If the request meets them, that rule answers instead.",
  );
});

test("an unknown load balancer id falls back to the first one", () => {
  const view = pathResult(samplePathGraph(), { region: "sample", lb: "arn:aws:elasticloadbalancing:other" });
  assert.equal(view.selected, "sample-lb-api");
  assert.deepEqual(view.loadBalancers.map(({ arn, name, dns }) => ({ arn, name, dns })), [
    { arn: "sample-lb-api", name: "k8s-demo-api", dns: "k8s-demo-api-7b31d2.eu-north-1.elb.amazonaws.com" },
  ]);
  // SNIFF's DEBUG prefills this URL for a public balancer.
  assert.match(view.loadBalancers[0].url, /^http:\/\/k8s-demo-api-7b31d2\.eu-north-1\.elb\.amazonaws\.com\//);
});
