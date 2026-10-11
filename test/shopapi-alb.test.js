// Shop API expose=alb: an internet-facing ALB through the AWS Load Balancer
// Controller, the drill's Ingress shape; NEEDS lbc only then; the ALB on
// the bill only then; the ALB owned by the shopapi vault; and the PATH view
// reads IGW → ALB → pod targets as healthy. Mocks and fakes only.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { UPGRADES, createUpgrade } from "../src/upgrade.js";
import { costFor, estimate } from "../src/stack-costs.js";
import { needsOf, needStates, needRefusal } from "../src/stack-needs.js";
import { matchVaults } from "../src/vault-match.js";
import { diagnose, headline } from "../src/path-diagnose.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ready = existsSync(join(root, "upgrades/shopapi/node_modules/@pulumi/kubernetes")) ? false : "run npm ci in upgrades/shopapi";
const spec = UPGRADES.find((item) => item.id === "shopapi");
async function mock(config) {
  const { stdout } = await promisify(execFile)(process.execPath, ["scripts/pulumi-mock.mjs", "upgrades/shopapi", "cloudspider-shopapi", "shopapi", JSON.stringify({ "cloudspider-shopapi:clusterName": "cloudspider-up", ...config })], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(stdout.slice(stdout.indexOf("[{")));
}

test("the card: expose none|alb; NEEDS lbc only with alb; ALB + its 2 IPv4 on the bill only with alb", () => {
  assert.deepEqual(spec.parameters.find((p) => p.name === "expose"), { name: "expose", type: "string", default: "none", choices: ["none", "alb"] });
  const listed = createUpgrade({ env: {}, cwd: "/nonexistent" }).list().find((item) => item.id === "shopapi");
  assert.deepEqual(listed.needsWhen, [{ param: "expose", value: "alb", needs: ["lbc"] }]);
  assert.equal(listed.cost.hour, 0, "default none: nothing of its own");
  const alb = estimate(costFor(spec.cost, { expose: "alb" }));
  // ALB $0.024/h + 2 × $0.005/h public IPv4 = $0.034/h ≈ $0.82/day.
  assert.ok(Math.abs(alb.day - 0.816) < 0.01, `ALB day ${alb.day}`);
  assert.ok(alb.usage.some((line) => /LCU/.test(line)));
  assert.equal(estimate(costFor(spec.cost, { expose: "none" })).hour, 0);
  const needs = needsOf(spec, { clusterName: "c1", expose: "alb" });
  assert.deepEqual(needs.map((n) => n.id), ["eks", "pgcluster", "lbc"]);
  assert.equal(needRefusal(spec, needStates(needs, { cluster: true, cards: { pgcluster: true }, addons: { lbc: false } }), "c1"), "expose=alb needs the AWS Load Balancer Controller add-on (lbc) on c1 first: RUN its card under ADD-ONS");
});

test("expose=alb: the drill's Ingress (alb, internet-facing, ip targets, health /items, project=shopapi); none: no Ingress", { skip: ready }, async () => {
  assert.ok(!(await mock({})).some((r) => r.type === "kubernetes:networking.k8s.io/v1:Ingress"));
  const resources = await mock({ "cloudspider-shopapi:expose": "alb" });
  const ingress = resources.find((r) => r.type === "kubernetes:networking.k8s.io/v1:Ingress").inputs;
  assert.equal(ingress.spec.ingressClassName, "alb");
  const a = ingress.metadata.annotations;
  assert.equal(a["alb.ingress.kubernetes.io/scheme"], "internet-facing");
  assert.equal(a["alb.ingress.kubernetes.io/target-type"], "ip");
  assert.equal(a["alb.ingress.kubernetes.io/healthcheck-path"], "/items");
  assert.match(a["alb.ingress.kubernetes.io/tags"], /^project=shopapi,cluster=cloudspider-up,/);
  assert.deepEqual(ingress.spec.rules[0].http.paths[0].backend, { service: { name: "shopapi", port: { number: 80 } } });
  assert.ok(!resources.some((r) => r.type === "kubernetes:core/v1:Namespace" && !r.id), "still never makes namespace shop");
  await assert.rejects(mock({ "cloudspider-shopapi:expose": "nlb" }), (error) => /expose must be none or alb/.test(`${error.stdout}${error.stderr}`));
});

// What cloudspider-up looks like with Shop API up behind its ALB: the EKS
// VPC (10.43.0.0/16, two public subnets routed to the IGW), the controller's
// frontend SG (80 from anywhere) and shared backend SG, the cluster SG letting
// that backend SG reach the pod port, one PostgREST pod on a prefix-delegated
// ENI prefix (vpc-cni prefix delegation, #172).
const ALB = "arn:aws:elasticloadbalancing:eu-north-1:550536272523:loadbalancer/app/k8s-shop-shopapi-1a2b3c/0f";
const TG = "arn:aws:elasticloadbalancing:eu-north-1:550536272523:targetgroup/k8s-shop-shopapi-9d8e7f/1a";
const OUT = [{ protocol: "-1", from: -1, to: -1, cidrs: ["0.0.0.0/0"], groupIds: [] }];
function shopGraph() {
  return {
    region: "eu-north-1",
    loadBalancers: [{ arn: ALB, name: "k8s-shop-shopapi-1a2b3c", dns: "k8s-shop-shopapi-1a2b3c.eu-north-1.elb.amazonaws.com", scheme: "internet-facing", type: "application", state: "active", stateReason: "", vpcId: "vpc-up", subnetIds: ["subnet-a", "subnet-b"], zones: ["eu-north-1a", "eu-north-1b"], securityGroupIds: ["sg-k8s-shop-frontend", "sg-k8s-traffic-cloudspider-up"] }],
    listeners: [{ arn: `${ALB}/l80`, lbArn: ALB, port: 80, protocol: "HTTP", defaultActions: [] }],
    rules: [
      { arn: `${ALB}/r1`, listenerArn: `${ALB}/l80`, priority: "1", isDefault: false, hosts: [], paths: ["/*"], actions: [{ type: "forward", targetGroupArns: [TG], redirectPort: "", redirectProtocol: "", statusCode: "" }] },
      { arn: `${ALB}/rdef`, listenerArn: `${ALB}/l80`, priority: "default", isDefault: true, hosts: [], paths: [], actions: [{ type: "fixed-response", targetGroupArns: [], redirectPort: "", redirectProtocol: "", statusCode: "404" }] },
    ],
    targetGroups: [{ arn: TG, name: "k8s-shop-shopapi-9d8e7f", protocol: "HTTP", port: 3000, targetType: "ip", vpcId: "vpc-up", healthPath: "/items", healthPort: "traffic-port", healthProtocol: "HTTP", matcher: "200", lbArns: [ALB] }],
    health: { [TG]: [{ id: "10.43.1.37", port: 3000, zone: "eu-north-1a", state: "healthy", reason: "", description: "" }] },
    tags: { [TG]: [{ key: "elbv2.k8s.aws/cluster", value: "cloudspider-up" }, { key: "ingress.k8s.aws/stack", value: "shop/shopapi" }] },
    subnets: [{ id: "subnet-a", vpcId: "vpc-up", cidr: "10.43.1.0/24", zone: "eu-north-1a" }, { id: "subnet-b", vpcId: "vpc-up", cidr: "10.43.2.0/24", zone: "eu-north-1b" }],
    securityGroups: [
      { id: "sg-k8s-shop-frontend", name: "k8s-shop-shopapi", vpcId: "vpc-up", ingress: [{ protocol: "tcp", from: 80, to: 80, cidrs: ["0.0.0.0/0"], groupIds: [] }], egress: OUT },
      { id: "sg-k8s-traffic-cloudspider-up", name: "k8s-traffic-cloudspider-up", vpcId: "vpc-up", ingress: [], egress: OUT },
      { id: "sg-eks-cluster", name: "eks-cluster-sg-cloudspider-up", vpcId: "vpc-up", ingress: [{ protocol: "tcp", from: 3000, to: 3000, cidrs: [], groupIds: ["sg-k8s-traffic-cloudspider-up"] }, { protocol: "-1", from: -1, to: -1, cidrs: [], groupIds: ["sg-eks-cluster"] }], egress: OUT },
    ],
    routeTables: [{ id: "rtb-up", vpcId: "vpc-up", main: false, subnetIds: ["subnet-a", "subnet-b"], routes: [{ dest: "10.43.0.0/16", target: "local", state: "active" }, { dest: "0.0.0.0/0", target: "igw-up", state: "active" }] }],
    interfaces: [
      { id: "eni-node-a", ip: "10.43.1.10", prefix: "", subnetId: "subnet-a", groupIds: ["sg-eks-cluster"], instanceId: "i-node-a", description: "" },
      { id: "eni-node-a", ip: "", prefix: "10.43.1.32/28", subnetId: "subnet-a", groupIds: ["sg-eks-cluster"], instanceId: "i-node-a", description: "" },
    ],
    nodes: [{ id: "i-node-a", state: "running", vpcId: "vpc-up", subnetId: "subnet-a", privateIp: "10.43.1.10", groupIds: ["sg-eks-cluster"], name: "cloudspider-up-node", tags: [{ key: "eks:cluster-name", value: "cloudspider-up" }, { key: "eks:nodegroup-name", value: "nodes" }] }],
    clusters: [{ name: "cloudspider-up", status: "ACTIVE", version: "1.32", vpcId: "vpc-up", issues: [], nodegroups: [{ name: "nodes", status: "ACTIVE", issues: [], desired: 1 }] }],
    metrics: { [ALB]: { elb502: 0, elb503: 0, elb504: 0, target5xx: 0, requests: 120 } },
    notes: [],
  };
}

test("PATH: IGW → ALB → the PostgREST pod (a prefix-delegated IP) reads healthy end to end", () => {
  const result = diagnose(shopGraph(), ALB);
  assert.equal(headline(result), "every edge on this path looks healthy");
  const target = result.nodes.find((n) => n.kind === "target");
  assert.equal(target.status, "ok");
  assert.ok(result.nodes.some((n) => n.kind === "node"), "the pod's node is found through its ENI prefix");
  assert.ok(result.edges.every((e) => e.status === "ok"), JSON.stringify(result.edges.filter((e) => e.status !== "ok")));
  // Without the IGW route the same ALB is broken at the front.
  const broken = shopGraph();
  broken.routeTables[0].routes.pop();
  assert.match(headline(diagnose(broken, ALB)), /no route to an internet gateway/);
});

test("the shopapi vault owns the ALB by its project tag", () => {
  const tags = [["elbv2.k8s.aws/cluster", "cloudspider-up"], ["ingress.k8s.aws/stack", "shop/shopapi"], ["project", "shopapi"], ["cluster", "cloudspider-up"], ["cloudspider", "expendable"], ["managed-by", "aws-load-balancer-controller"]].map(([Key, Value]) => ({ Key, Value }));
  const place = { vpcs: [], subnets: [], instances: [], fixtures: [{ id: ALB, kind: "alb", name: "k8s-shop-shopapi-1a2b3c", tags }] };
  const owned = matchVaults([{ key: "lbc", resources: { tags: { project: "lbc" } } }, { key: "shopapi", resources: { tags: { project: "shopapi" } } }], place);
  assert.deepEqual(owned.get("shopapi"), [ALB]);
});
