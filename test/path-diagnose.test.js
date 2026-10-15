import assert from "node:assert/strict";
import test from "node:test";
import { diagnose, headline, healthVerdict, matchHost } from "../src/path-diagnose.js";
import { samplePathGraph } from "../src/path-sample.js";
import { isInstanceId } from "../src/ids.js";

const LB = "sample-lb-api";
const SLOW = "sample-tg-api|10.43.12.31:8080";
const FAST = "sample-tg-api|10.43.11.20:8080";
const BLOCKED = "sample-sg-node-b does not allow tcp 8080 from sample-sg-alb. The load balancer cannot reach this target.";

test("the sample host path names the security group that blocks the slow pod first", () => {
  const graph = samplePathGraph();
  const [match] = matchHost(graph, "https://API.sample.test:443/orders?id=1");
  assert.deepEqual(match, { lbArn: LB, ruleArn: "sample-rule-443-api", via: [], skipped: [] });
  const result = diagnose(graph, LB, { ruleArn: match.ruleArn });
  assert.deepEqual(
    result.nodes.filter((node) => node.kind === "rule").map((node) => node.id),
    ["sample-rule-443-api"],
  );
  assert.equal(result.findings[0].sentence, BLOCKED);
  assert.equal(result.nodes.find((node) => node.id === SLOW).status, "hang");
  assert.equal(result.nodes.find((node) => node.id === FAST).status, "ok");
  assert.equal(result.edges.find((edge) => edge.to === FAST).status, "ok");
  assert.equal(result.nodes.some((node) => node.id === "cluster:cloudspider-up"), true);
});

test("the whole load balancer puts the empty target group before the deeper break", () => {
  const result = diagnose(samplePathGraph(), LB);
  assert.equal(
    headline(result),
    "k8s-shop-web has no registered targets. The load balancer answers 503. The AWS Load Balancer Controller registers the pods of shop/web. Check that its selector matches running pods and that they are Ready.",
  );
  const listener80 = result.nodes.find((node) => node.id === "sample-listener-80");
  assert.equal(listener80.status, "ok");
  assert.match(listener80.caption, /redirects to HTTPS :443 same path/);
  const lb = result.nodes.find((node) => node.id === LB);
  assert.equal(lb.status, "hang");
  assert.match(lb.sentence, /^12 requests timed out at k8s-demo-api in the last 15 minutes/);
  assert.equal(result.findings.at(-1).symptom, true);
});

test("a rule that forwards to a missing target group is broken", () => {
  const graph = samplePathGraph();
  graph.rules.find((rule) => rule.arn === "sample-rule-443-web").actions[0].targetGroupArns = ["sample-tg-gone"];
  const result = diagnose(graph, LB);
  const gone = result.nodes.find((node) => node.id === "sample-tg-gone");
  assert.equal(gone.status, "broken");
  assert.equal(gone.sentence, "rule 2 forwards to a target group that does not exist.");
  assert.equal(result.nodes.some((node) => node.id === "sample-tg-web"), false);
});

test("a failed load balancer is the first finding", () => {
  const graph = samplePathGraph();
  graph.loadBalancers[0].state = "failed";
  graph.loadBalancers[0].stateReason = "subnet out of IPs";
  assert.equal(headline(diagnose(graph, LB)), "k8s-demo-api is failed. subnet out of IPs");
});

test("an internet-facing load balancer in subnets with no internet gateway route is broken", () => {
  const graph = samplePathGraph();
  graph.routeTables[0].routes = [{ dest: "10.43.0.0/16", target: "local", state: "active" }];
  assert.equal(
    headline(diagnose(graph, LB)),
    "sample-public-a, sample-public-b have no route to an internet gateway. The internet cannot reach k8s-demo-api there.",
  );
});

test("a load balancer with no listener says nothing answers", () => {
  const graph = samplePathGraph();
  graph.listeners = [];
  assert.equal(headline(diagnose(graph, LB)), "k8s-demo-api has no listener. Nothing answers on this load balancer.");
});

test("a healthy target the security groups do not explain is unknown, not broken", () => {
  const graph = samplePathGraph();
  graph.health["sample-tg-api"][1] = { ...graph.health["sample-tg-api"][1], state: "healthy", reason: "", description: "" };
  const result = diagnose(graph, LB, { ruleArn: "sample-rule-443-api" });
  const edge = result.edges.find((item) => item.to === SLOW);
  assert.equal(edge.status, "unknown");
  assert.match(edge.sentence, /passes health checks, but the security groups read here do not show the rule that allows it/);
  assert.equal(result.nodes.find((node) => node.id === SLOW).status, "ok");
});

test("the health check port must be open too", () => {
  const graph = samplePathGraph();
  graph.targetGroups[0].healthPort = "9090";
  graph.health["sample-tg-api"][0] = {
    ...graph.health["sample-tg-api"][0],
    state: "unhealthy",
    reason: "Target.Timeout",
    description: "Request timed out",
  };
  const result = diagnose(graph, LB, { ruleArn: "sample-rule-443-api" });
  const edge = result.edges.find((item) => item.to === FAST);
  assert.equal(edge.status, "broken");
  assert.equal(
    edge.sentence,
    "sample-sg-node-a does not allow tcp 9090 from sample-sg-alb. The load balancer cannot reach this target.",
  );
});

test("a load balancer with no security group leaves reach unknown", () => {
  const graph = samplePathGraph();
  graph.loadBalancers[0].securityGroupIds = [];
  graph.loadBalancers[0].type = "network";
  const result = diagnose(graph, LB, { ruleArn: "sample-rule-443-api" });
  const edge = result.edges.find((item) => item.to === SLOW);
  assert.equal(edge.status, "unknown");
  assert.equal(edge.sentence, "k8s-demo-api has no security group. The targets must allow the callers' addresses on 8080.");
});

test("a target group used by two rules is drawn once", () => {
  const graph = samplePathGraph();
  graph.rules.find((rule) => rule.arn === "sample-rule-443-web").actions[0].targetGroupArns = ["sample-tg-api"];
  const result = diagnose(graph, LB);
  assert.equal(result.nodes.filter((node) => node.id === "sample-tg-api").length, 1);
  assert.equal(result.edges.filter((edge) => edge.to === "sample-tg-api").length, 2);
  assert.equal(result.nodes.filter((node) => node.id === SLOW).length, 1);
});

test("a stopped node and a node group issue are broken", () => {
  const graph = samplePathGraph();
  graph.nodes[1].state = "stopped";
  graph.clusters[0].nodegroups[0].issues = [
    { code: "Ec2SubnetInvalidConfiguration", message: "subnet has no free addresses" },
  ];
  const result = diagnose(graph, LB, { ruleArn: "sample-rule-443-api" });
  const node = result.nodes.find((item) => item.id === "sample-node-b");
  assert.equal(node.status, "broken");
  assert.equal(node.sentence, "cloudspider-up-node-b is stopped");
  const cluster = result.nodes.find((item) => item.id === "cluster:cloudspider-up");
  assert.equal(cluster.status, "broken");
  assert.equal(cluster.sentence, "general: Ec2SubnetInvalidConfiguration subnet has no free addresses");
});

test("health reasons read as plain sentences", () => {
  const tg = samplePathGraph().targetGroups[0];
  const base = { id: "10.43.1.5", port: 8080, zone: "eu-north-1a", state: "unhealthy" };
  assert.deepEqual(
    healthVerdict(
      { ...base, reason: "Target.ResponseCodeMismatch", description: "Health checks failed with these codes: [404]" },
      tg,
    ),
    {
      status: "broken",
      sentence: "10.43.1.5:8080 answers HTTP /healthz with a code outside 200. Health checks failed with these codes: [404]",
    },
  );
  assert.equal(healthVerdict({ ...base, state: "initial", reason: "Elb.InitialHealthChecking", description: "" }, tg).status, "unknown");
  assert.equal(healthVerdict({ ...base, state: "draining", reason: "Target.DeregistrationInProgress", description: "" }, tg).status, "unknown");
  assert.equal(healthVerdict({ ...base, reason: "Target.Timeout", description: "" }, tg).status, "hang");
});

const routes = (graph, text) => matchHost(graph, text).map(({ lbArn, ruleArn }) => ({ lbArn, ruleArn }));

test("a host matches by load balancer DNS, by exact rule host, and by wildcard", () => {
  const graph = samplePathGraph();
  assert.deepEqual(routes(graph, "dualstack.k8s-demo-api-7b31d2.eu-north-1.elb.amazonaws.com"), [
    { lbArn: LB, ruleArn: "sample-rule-443-default" },
  ]);
  graph.rules.find((rule) => rule.arn === "sample-rule-443-web").hosts = ["*.shop.test"];
  assert.deepEqual(routes(graph, "a.b.shop.test")[0], { lbArn: LB, ruleArn: "sample-rule-443-web" });
  assert.deepEqual(matchHost(graph, ""), []);
  assert.deepEqual(matchHost(graph, "http://"), []);
});

test("a URL walks its listener by port and priority down to the default rule", () => {
  const graph = samplePathGraph();
  const api = graph.rules.find((rule) => rule.arn === "sample-rule-443-api");
  api.paths = ["/v1/*"];
  assert.deepEqual(routes(graph, "https://api.sample.test/v2/orders"), [{ lbArn: LB, ruleArn: "sample-rule-443-default" }]);
  assert.deepEqual(routes(graph, "https://api.sample.test/v1/orders"), [{ lbArn: LB, ruleArn: "sample-rule-443-api" }]);
});

test("an http URL follows the redirect to the HTTPS listener", () => {
  const graph = samplePathGraph();
  assert.deepEqual(matchHost(graph, "http://api.sample.test/orders"), [
    { lbArn: LB, ruleArn: "sample-rule-443-api", via: ["sample-rule-80-default"], skipped: [] },
  ]);
  graph.rules.find((rule) => rule.arn === "sample-rule-80-default").actions[0].redirectHost = "elsewhere.test";
  assert.deepEqual(routes(graph, "http://api.sample.test/orders"), [{ lbArn: LB, ruleArn: "sample-rule-80-default" }]);
});

test("a rule with conditions not read here is passed over and named", () => {
  const graph = samplePathGraph();
  graph.rules.find((rule) => rule.arn === "sample-rule-443-api").others = 1;
  assert.deepEqual(matchHost(graph, "https://api.sample.test/orders"), [
    { lbArn: LB, ruleArn: "sample-rule-443-default", via: [], skipped: ["sample-rule-443-api"] },
  ]);
});

test("a default rule the API did not list can still be the focus", () => {
  const graph = samplePathGraph();
  graph.rules = graph.rules.filter((rule) => rule.listenerArn !== "sample-listener-80");
  const result = diagnose(graph, LB, { ruleArn: "sample-listener-80|default" });
  assert.deepEqual(
    result.nodes.filter((node) => node.kind === "listener").map((node) => node.label),
    ["HTTP 80"],
  );
});

test("a mix of unhealthy and starting targets still fails open", () => {
  const graph = samplePathGraph();
  graph.health["sample-tg-api"] = [
    { ...graph.health["sample-tg-api"][0], state: "initial", reason: "Elb.InitialHealthChecking", description: "" },
    graph.health["sample-tg-api"][1],
  ];
  const group = diagnose(graph, LB).nodes.find((node) => node.id === "sample-tg-api");
  assert.equal(
    group.sentence,
    "no target in k8s-shop-api is healthy. The load balancer sends requests to the unhealthy ones anyway, so callers see errors or hangs.",
  );
  assert.equal(group.symptom, true);
});

test("a forward whose target groups all weigh 0 is broken", () => {
  const graph = samplePathGraph();
  const rule = graph.rules.find((item) => item.arn === "sample-rule-443-api");
  rule.actions = [{ ...rule.actions[0], targetGroupArns: [], weightless: true }];
  const node = diagnose(graph, LB, { ruleArn: rule.arn }).nodes.find((item) => item.id === rule.arn);
  assert.equal(node.status, "broken");
  assert.equal(node.sentence, "rule 1 gives every target group weight 0, so the requests it matches reach no target.");
});

test("a pod IP inside a delegated prefix still finds its node and cluster", () => {
  const graph = samplePathGraph();
  graph.interfaces[1] = { ...graph.interfaces[1], ip: "", prefix: "10.43.12.16/28" };
  const result = diagnose(graph, LB, { ruleArn: "sample-rule-443-api" });
  assert.equal(result.findings[0].sentence, BLOCKED);
  assert.equal(result.edges.some((edge) => edge.from === SLOW && edge.to === "sample-node-b"), true);
});

test("a lone timing-out target is the headline, not the fail-open target group", () => {
  const graph = samplePathGraph();
  graph.health["sample-tg-api"] = [graph.health["sample-tg-api"][1]];
  graph.interfaces[1] = { ...graph.interfaces[1], groupIds: ["sample-sg-node-a"] };
  const result = diagnose(graph, LB, { ruleArn: "sample-rule-443-api" });
  assert.match(headline(result), /^10\.43\.12\.31:8080 does not answer HTTP \/healthz in time/);
  const group = result.nodes.find((node) => node.id === "sample-tg-api");
  assert.equal(group.status, "broken");
  assert.equal(group.symptom, true);
});

test("targets that are only starting are not called fail-open", () => {
  const graph = samplePathGraph();
  graph.health["sample-tg-api"] = graph.health["sample-tg-api"].map((item) => ({
    ...item,
    state: "initial",
    reason: "Elb.InitialHealthChecking",
    description: "",
  }));
  const group = diagnose(graph, LB).nodes.find((node) => node.id === "sample-tg-api");
  assert.equal(group.sentence, "no target in k8s-shop-api is healthy right now. The load balancer answers 503 until one is.");
});

test("security group CIDRs are combined across rules, and prefix lists are unknown", () => {
  const graph = samplePathGraph();
  const nodesB = graph.securityGroups.find((group) => group.id === "sample-sg-node-b");
  nodesB.ingress = [
    { protocol: "tcp", from: 8080, to: 8080, cidrs: ["10.43.1.0/24"], groupIds: [], prefixListIds: [], ipv6: [] },
    { protocol: "tcp", from: 8080, to: 8080, cidrs: ["10.43.2.0/24"], groupIds: [], prefixListIds: [], ipv6: [] },
  ];
  let edge = diagnose(graph, LB, { ruleArn: "sample-rule-443-api" }).edges.find((item) => item.to === SLOW);
  assert.equal(edge.status, "ok");
  nodesB.ingress = [
    { protocol: "tcp", from: 8080, to: 8080, cidrs: [], groupIds: [], prefixListIds: ["pl-1"], ipv6: [] },
  ];
  edge = diagnose(graph, LB, { ruleArn: "sample-rule-443-api" }).edges.find((item) => item.to === SLOW);
  assert.equal(edge.status, "unknown");
  assert.match(edge.sentence, /prefix lists or IPv6 ranges, which are not read here/);
});

test("a pod with no EC2 node still joins its cluster", () => {
  const graph = samplePathGraph();
  graph.interfaces[1] = { ...graph.interfaces[1], instanceId: "" };
  const result = diagnose(graph, LB, { ruleArn: "sample-rule-443-api" });
  assert.equal(result.edges.some((edge) => edge.from === SLOW && edge.to === "cluster:cloudspider-up"), true);
});

test("sample ids are not instance ids", () => {
  const graph = samplePathGraph();
  for (const node of graph.nodes) assert.equal(isInstanceId(node.id), false);
});
