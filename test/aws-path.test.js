import assert from "node:assert/strict";
import test from "node:test";
import {
  collect,
  chunks,
  interfacesFrom,
  healthFrom,
  lbDimension,
  loadBalancerFrom,
  metricQueries,
  metricsFrom,
  nodeFrom,
  nodegroupFrom,
  routeTableFrom,
  ruleFrom,
  securityGroupFrom,
  targetGroupFrom,
} from "../src/aws-path.js";

const LB_ARN = "arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/api/abc123";

test("collect keeps every page and turns a thrown error into a sentence", async () => {
  const pages = { first: { Items: [1], Next: "b" }, b: { Items: [2] } };
  const seen = [];
  const ok = await collect(
    async (marker) => {
      seen.push(marker);
      return pages[marker || "first"];
    },
    (marker) => marker,
    (out) => ({ items: out.Items, next: out.Next }),
  );
  assert.deepEqual(ok, { items: [1, 2] });
  assert.deepEqual(seen, [undefined, "b"]);
  const bad = await collect(
    async () => {
      const error = new Error("User is not authorized");
      error.name = "AccessDenied";
      throw error;
    },
    (marker) => marker,
    (out) => out,
  );
  assert.deepEqual(bad, { error: "User is not authorized" });
  assert.deepEqual(chunks([1, 2, 3], 2), [[1, 2], [3]]);
});

test("a load balancer keeps its subnets, zones, groups, and state", () => {
  const lb = loadBalancerFrom({
    LoadBalancerArn: LB_ARN,
    LoadBalancerName: "api",
    DNSName: "API-1.eu-north-1.elb.amazonaws.com",
    Scheme: "internet-facing",
    Type: "application",
    State: { Code: "active" },
    VpcId: "vpc-1",
    AvailabilityZones: [
      { ZoneName: "eu-north-1a", SubnetId: "subnet-a" },
      { ZoneName: "eu-north-1b", SubnetId: "subnet-b" },
    ],
    SecurityGroups: ["sg-alb"],
  });
  assert.deepEqual(lb, {
    arn: LB_ARN,
    name: "api",
    dns: "api-1.eu-north-1.elb.amazonaws.com",
    scheme: "internet-facing",
    type: "application",
    state: "active",
    stateReason: "",
    vpcId: "vpc-1",
    subnetIds: ["subnet-a", "subnet-b"],
    zones: ["eu-north-1a", "eu-north-1b"],
    securityGroupIds: ["sg-alb"],
  });
  assert.equal(lbDimension(LB_ARN), "app/api/abc123");
});

test("a rule reads hosts, paths, and every forwarded target group once", () => {
  const rule = ruleFrom(
    {
      RuleArn: "r1",
      Priority: "3",
      IsDefault: false,
      Conditions: [
        { Field: "host-header", HostHeaderConfig: { Values: ["api.example.com"] } },
        { Field: "path-pattern", Values: ["/v1/*"] },
      ],
      Actions: [
        {
          Type: "forward",
          TargetGroupArn: "tg-a",
          ForwardConfig: { TargetGroups: [{ TargetGroupArn: "tg-a" }, { TargetGroupArn: "tg-b" }] },
        },
      ],
    },
    "l1",
  );
  assert.equal(rule.listenerArn, "l1");
  assert.equal(rule.priority, "3");
  assert.deepEqual(rule.hosts, ["api.example.com"]);
  assert.deepEqual(rule.paths, ["/v1/*"]);
  assert.deepEqual(rule.actions[0].targetGroupArns, ["tg-a", "tg-b"]);
});

test("a weight 0 target group gets no traffic, and a prefix-delegated interface keeps its prefix", () => {
  const rule = ruleFrom(
    {
      RuleArn: "r2",
      Priority: "4",
      Conditions: [{ Field: "http-header", HttpHeaderConfig: { HttpHeaderName: "x-canary", Values: ["1"] } }],
      Actions: [
        {
          Type: "forward",
          ForwardConfig: {
            TargetGroups: [
              { TargetGroupArn: "tg-live", Weight: 1 },
              { TargetGroupArn: "tg-idle", Weight: 0 },
            ],
          },
        },
      ],
    },
    "l1",
  );
  assert.deepEqual(rule.actions[0].targetGroupArns, ["tg-live"]);
  assert.equal(rule.others, 1);
  const entries = interfacesFrom({
    NetworkInterfaceId: "eni-2",
    PrivateIpAddress: "10.0.12.10",
    PrivateIpAddresses: [{ PrivateIpAddress: "10.0.12.10" }],
    Ipv4Prefixes: [{ Ipv4Prefix: "10.0.12.16/28" }],
    Groups: [{ GroupId: "sg-node" }],
    Attachment: { InstanceId: "i-0node0002" },
  });
  assert.deepEqual(
    entries.map((entry) => [entry.ip, entry.prefix]),
    [
      ["10.0.12.10", ""],
      ["", "10.0.12.16/28"],
    ],
  );
});

test("a target group and its health keep the check settings and the reason", () => {
  const tg = targetGroupFrom({
    TargetGroupArn: "tg-a",
    TargetGroupName: "k8s-shop-api",
    Protocol: "HTTP",
    Port: 8080,
    TargetType: "ip",
    VpcId: "vpc-1",
    HealthCheckPath: "/healthz",
    HealthCheckPort: "traffic-port",
    HealthCheckProtocol: "HTTP",
    Matcher: { HttpCode: "200" },
    LoadBalancerArns: [LB_ARN],
  });
  assert.equal(tg.healthPath, "/healthz");
  assert.equal(tg.healthPort, "traffic-port");
  assert.equal(tg.matcher, "200");
  const health = healthFrom({
    Target: { Id: "10.0.12.31", Port: 8080, AvailabilityZone: "eu-north-1b" },
    TargetHealth: { State: "unhealthy", Reason: "Target.Timeout", Description: "Request timed out" },
  });
  assert.deepEqual(health, {
    id: "10.0.12.31",
    port: 8080,
    zone: "eu-north-1b",
    state: "unhealthy",
    reason: "Target.Timeout",
    description: "Request timed out",
  });
});

test("security groups, route tables, interfaces, and nodes become plain objects", () => {
  const group = securityGroupFrom({
    GroupId: "sg-node",
    GroupName: "nodes",
    VpcId: "vpc-1",
    IpPermissions: [
      { IpProtocol: "tcp", FromPort: 8080, ToPort: 8080, UserIdGroupPairs: [{ GroupId: "sg-alb" }] },
    ],
    IpPermissionsEgress: [{ IpProtocol: "-1", IpRanges: [{ CidrIp: "0.0.0.0/0" }] }],
  });
  assert.deepEqual(group.ingress[0], {
    protocol: "tcp",
    from: 8080,
    to: 8080,
    cidrs: [],
    groupIds: ["sg-alb"],
    prefixListIds: [],
    ipv6: [],
  });
  assert.deepEqual(group.egress[0], {
    protocol: "-1",
    from: -1,
    to: -1,
    cidrs: ["0.0.0.0/0"],
    groupIds: [],
    prefixListIds: [],
    ipv6: [],
  });

  const table = routeTableFrom({
    RouteTableId: "rtb-1",
    VpcId: "vpc-1",
    Associations: [{ Main: true }, { SubnetId: "subnet-a" }],
    Routes: [
      { DestinationCidrBlock: "10.0.0.0/16", GatewayId: "local", State: "active" },
      { DestinationCidrBlock: "0.0.0.0/0", GatewayId: "igw-1", State: "active" },
    ],
  });
  assert.equal(table.main, true);
  assert.deepEqual(table.subnetIds, ["subnet-a"]);
  assert.deepEqual(table.routes[1], { dest: "0.0.0.0/0", target: "igw-1", state: "active" });

  const entries = interfacesFrom({
    NetworkInterfaceId: "eni-1",
    PrivateIpAddress: "10.0.11.10",
    PrivateIpAddresses: [{ PrivateIpAddress: "10.0.11.10" }, { PrivateIpAddress: "10.0.11.20" }],
    SubnetId: "subnet-a",
    Groups: [{ GroupId: "sg-node" }],
    Attachment: { InstanceId: "i-0node0001" },
    Description: "aws-K8S-i-0node0001",
  });
  assert.deepEqual(entries.map((entry) => entry.ip), ["10.0.11.10", "10.0.11.20"]);
  assert.equal(entries[1].instanceId, "i-0node0001");

  const node = nodeFrom({
    InstanceId: "i-0node0001",
    State: { Name: "running" },
    VpcId: "vpc-1",
    SubnetId: "subnet-a",
    PrivateIpAddress: "10.0.11.10",
    SecurityGroups: [{ GroupId: "sg-node" }],
    Tags: [{ Key: "Name", Value: "shop-node" }, { Key: "eks:cluster-name", Value: "shop" }],
  });
  assert.equal(node.name, "shop-node");
  assert.deepEqual(node.groupIds, ["sg-node"]);
  assert.deepEqual(node.tags[1], { key: "eks:cluster-name", value: "shop" });
});

test("node group issues and metric sums are read", () => {
  const group = nodegroupFrom({
    nodegroupName: "general",
    status: "DEGRADED",
    health: { issues: [{ code: "Ec2SubnetInvalidConfiguration", message: "no free addresses" }] },
    scalingConfig: { desiredSize: 2 },
  });
  assert.deepEqual(group, {
    name: "general",
    status: "DEGRADED",
    issues: [{ code: "Ec2SubnetInvalidConfiguration", message: "no free addresses" }],
    desired: 2,
  });
  const queries = metricQueries("app/api/abc123");
  assert.deepEqual(queries.map((query) => query.Id), ["elb502", "elb503", "elb504", "target5xx", "requests"]);
  assert.equal(queries[2].MetricStat.Metric.Dimensions[0].Value, "app/api/abc123");
  const values = metricsFrom({
    MetricDataResults: [
      { Id: "elb504", Values: [3, 4] },
      { Id: "requests", Values: [100] },
    ],
  });
  assert.deepEqual(values, { elb502: 0, elb503: 0, elb504: 7, target5xx: 0, requests: 100 });
});
