import assert from "node:assert/strict";
import test from "node:test";
import { readPath } from "../src/path-read.js";

const lb = {
  arn: "lb1",
  name: "api",
  dns: "api-1.eu-north-1.elb.amazonaws.com",
  scheme: "internet-facing",
  type: "application",
  state: "active",
  stateReason: "",
  vpcId: "vpc-1",
  subnetIds: ["subnet-a"],
  zones: ["eu-north-1a"],
  securityGroupIds: ["sg-alb"],
};

function health(id, port) {
  return { id, port, zone: "eu-north-1a", state: "healthy", reason: "", description: "" };
}

function fakeAws(over = {}) {
  const calls = [];
  const base = {
    async loadBalancers() {
      return { items: [lb] };
    },
    async listeners(_region, arn) {
      return { items: [{ arn: "l1", lbArn: arn, port: 443, protocol: "HTTPS", defaultActions: [] }] };
    },
    async rules(_region, arn) {
      return {
        items: [
          {
            arn: "r1",
            listenerArn: arn,
            priority: "default",
            isDefault: true,
            hosts: [],
            paths: [],
            actions: [{ type: "forward", targetGroupArns: ["tg1", "tg2"] }],
          },
        ],
      };
    },
    async targetGroups() {
      const group = (arn, targetType, port) => ({
        arn,
        name: arn,
        protocol: "HTTP",
        port,
        targetType,
        vpcId: "vpc-1",
        healthPath: "/healthz",
        healthPort: "traffic-port",
        healthProtocol: "HTTP",
        matcher: "200",
        lbArns: ["lb1"],
      });
      return { items: [group("tg1", "ip", 8080), group("tg2", "instance", 80)] };
    },
    async targetHealth(_region, arn) {
      return { items: arn === "tg1" ? [health("10.0.1.5", 8080)] : [health("i-0abc1234", 80)] };
    },
    async tags() {
      return { tags: {} };
    },
    async subnets() {
      return { items: [] };
    },
    async securityGroups() {
      return { items: [] };
    },
    async routeTables() {
      return { items: [] };
    },
    async interfaces() {
      return {
        items: [
          {
            id: "eni-1",
            ip: "10.0.1.5",
            prefix: "",
            subnetId: "subnet-a",
            groupIds: ["sg-node"],
            instanceId: "i-0node0001",
            description: "",
          },
        ],
      };
    },
    async instancesById(_region, ids) {
      return {
        items: ids.map((id) => ({
          id,
          state: "running",
          vpcId: "vpc-1",
          subnetId: "subnet-a",
          privateIp: "10.0.1.9",
          groupIds: ["sg-node"],
          name: "",
          tags: [],
        })),
      };
    },
    async clusters() {
      return { items: [] };
    },
    async metrics() {
      return { values: { elb502: 0, elb503: 0, elb504: 0, target5xx: 0, requests: 0 } };
    },
  };
  const aws = {};
  for (const [name, fn] of Object.entries({ ...base, ...over })) {
    aws[name] = async (...args) => {
      calls.push([name, ...args.slice(1)]);
      return fn(...args);
    };
  }
  return { aws, calls };
}

test("a region with no load balancers reads nothing else", async () => {
  const { aws, calls } = fakeAws({
    async loadBalancers() {
      return { items: [] };
    },
  });
  const result = await readPath(aws, "eu-north-1");
  assert.equal(result.error, null);
  assert.deepEqual(result.graph.loadBalancers, []);
  assert.deepEqual(calls.map((call) => call[0]), ["loadBalancers"]);
});

test("ip targets match the VPC interfaces and every node is read once", async () => {
  const { aws, calls } = fakeAws();
  const result = await readPath(aws, "eu-north-1");
  assert.equal(result.error, null);
  assert.deepEqual(calls.find((call) => call[0] === "interfaces"), ["interfaces", "vpc-1"]);
  assert.deepEqual(calls.find((call) => call[0] === "instancesById"), [
    "instancesById",
    ["i-0abc1234", "i-0node0001"],
  ]);
  assert.deepEqual(result.graph.health.tg1.map((item) => item.id), ["10.0.1.5"]);
  assert.deepEqual(calls.filter((call) => call[0] === "subnets"), [["subnets", "vpc-1"]]);
});

test("a failed listener read draws no path and names the call", async () => {
  const { aws, calls } = fakeAws({
    async listeners() {
      return { error: "Rate exceeded" };
    },
  });
  const result = await readPath(aws, "eu-north-1");
  assert.deepEqual(result, { error: "Rate exceeded", call: "DescribeListeners", graph: null });
  assert.equal(calls.some((call) => call[0] === "rules"), false);
});

test("denied EKS, metrics, and tags still draw the path with notes", async () => {
  const { aws } = fakeAws({
    async clusters() {
      return { error: "not authorized to perform: eks:ListClusters" };
    },
    async metrics() {
      return { error: "not authorized to perform: cloudwatch:GetMetricData" };
    },
    async tags() {
      return { error: "not authorized to perform: elasticloadbalancing:DescribeTags" };
    },
  });
  const result = await readPath(aws, "eu-north-1");
  assert.equal(result.error, null);
  assert.deepEqual(result.graph.notes, [
    "DescribeTags: not authorized to perform: elasticloadbalancing:DescribeTags",
    "EKS: not authorized to perform: eks:ListClusters",
    "GetMetricData: not authorized to perform: cloudwatch:GetMetricData",
  ]);
  assert.equal(result.graph.listeners.length, 1);
});
