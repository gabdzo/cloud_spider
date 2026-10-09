# Request Path Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Path view to Cloud Spider that follows a request through a load balancer (listener, rule, target group, target, node, EKS cluster) in the region on screen. It names the first broken or hanging edge, so a person can see where a request to an EKS backend stops.

**Architecture:** The local process gets a second, read-only reader (`src/aws-path.js`). It returns plain objects. `src/path-read.js` collects one region into a graph. `src/path-diagnose.js` is a pure function from that graph to nodes, edges, and findings. That is the core, and most tests target it. `src/path-view.js` picks the load balancer, or the rule for a pasted host, and builds the JSON the page draws. The browser gets a Path button and draws columns joined by threads on the existing canvas. A local sample graph (`src/path-sample.js`) lets the page and tests run without AWS.

**Tech Stack:** Node 24 ESM, `node:test`, AWS SDK v3 (`client-ec2` already installed; add `client-elastic-load-balancing-v2`, `client-eks`, `client-cloudwatch`), plain HTML canvas, no framework.

**Spec:** This plan carries its own spec in the next section. Product background: `/Users/gabdzo/.gstack/projects/cloud_spider/ceo-plans/2026-10-09-cloud-spider.md`.

## Spec

The owner runs a backend on EKS behind an Application Load Balancer. When it stops answering, they want Cloud Spider to show where the request stops, without opening five console pages.

1. A **Path** button sits after **Sample** in the header. Pressing it swaps the map for the path view of the region on screen. Pressing it again (it reads **Map** while Path is on) returns to the map.
2. Path view has a load balancer menu and a text box: "paste a URL or host". A pasted host follows only the rule that answers for it.
3. The view draws columns from left to right: load balancer, listener, rule, target group, target, node, EKS cluster. Threads join them. Each box and thread has a status: `ok`, `broken`, `hang`, or `unknown`.
4. The status line names the first finding: the shallowest broken or hanging thing on the path. Traffic symptoms (504/502/503 counts) come after structural causes.
5. Clicking a box shows its sentence beside it.
6. Checks, each with one plain sentence:
   - Load balancer state is not `active`.
   - Internet-facing load balancer in a subnet with no `0.0.0.0/0` route to an `igw-`.
   - Load balancer with no listener.
   - Listener that forwards nothing (a redirect is fine).
   - Rule that forwards to a target group that does not exist.
   - Target group with no registered targets (503). With AWS Load Balancer Controller tags, name the Kubernetes service and say to check its selector and pod readiness.
   - Every target unhealthy (fail open).
   - Each target health reason (`Target.Timeout` is `hang`, the rest per the table in Task 3).
   - Security groups: target groups must allow the target port and the health check port from the load balancer security group or from CIDRs covering the load balancer subnets. Load balancer egress must allow the same port to the target.
   - Node instance not `running`.
   - EKS cluster not `ACTIVE`, or a cluster or node group health issue.
   - Last 15 minutes of ALB metrics: 504, 502, 503 at the load balancer, and 5xx from targets.
7. **Sample** in Path view draws a local sample path that shows a hang caused by a security group. It does not call AWS.
8. Path view reads only. It never stops, starts, registers, or changes anything.
9. A read the path cannot do without (load balancers, listeners, rules, target groups, health, subnets, security groups, route tables, interfaces, instances) fails the whole path with the call name and the profile hint. EKS, metrics, and tags are extras: if they fail, the path still draws and a note says what was not read.

## Global Constraints

- Node 24 ESM. Test command: `npm test` (runs `node --test test/*.test.js`). Never run `node --test test/` (fails with MODULE_NOT_FOUND on Node 24.21.0).
- New dependencies, exactly: `@aws-sdk/client-elastic-load-balancing-v2@^3.901.0`, `@aws-sdk/client-eks@^3.901.0`, `@aws-sdk/client-cloudwatch@^3.901.0`. No other packages.
- Read-only AWS: path code may only send `Describe*`, `List*`, and `GetMetricData` commands. No `Create*`, `Modify*`, `Delete*`, `Register*`, `Deregister*`, `Put*`, `Update*`.
- The process listens on `127.0.0.1`, default port `9241`. Path routes are `GET`. No new `POST` routes.
- Never print credentials or request bodies. Errors reach stdout only through `report()` in `src/report.js`.
- Failed required reads use the existing hint: `Set AWS_PROFILE=default and AWS_REGION=eu-north-1.` followed by the AWS error.
- Do not change `src/verbs.js`, `src/waits.js`, the stop and start flow, the Sample map, or the radio.
- User-facing strings: no em dashes. Plain sentences that say what is true.
- Colors only from the existing palette: text `#f2e3b8`, muted `#c2a978`, gold `#ffcc33`, error `#ff8a6b`, green `#a9cf86`, panel `rgba(16, 13, 8, 0.82)`, border `#b08f52`. Font Menlo, as in `src/draw.js`.
- Tags are arrays of `{ key, value }`, never objects.
- Sample ids must not match `^i-[0-9a-f]{8,17}$`.
- Do not run `pulumi`. Do not create AWS resources. Do not change git config. Work on branch `request-path`. Do not commit to `main`. Push only `request-path` to `origin` (`https://github.com/gabdzo/cloud_spider.git`). Never push `main` and never force-push.
- Visual polish of the path view is out of scope. The owner handles design separately. Keep the drawing plain and readable.

## Review Focus

- A target group used by two rules is drawn once with two threads into it. Test: Task 3, "a target group used by two rules is drawn once".
- A health check port other than the traffic port must also be open. Test: Task 3, "the health check port must be open too".
- A load balancer with no security group (NLB) makes reachability `unknown`, not `broken`. Test: Task 3, "a load balancer with no security group leaves reach unknown".
- A path read that returns after a region switch is dropped. Test: Task 4, "a path read that returns after a region switch is dropped".
- EKS, metrics, or tags denied still draws the path with notes. Test: Task 2, "denied EKS, metrics, and tags still draw the path with notes".

## File Structure

| File | Responsibility |
|------|----------------|
| `src/cidr.js` (new) | `cidrContains(outer, inner)` for IPv4. |
| `src/aws-path.js` (new) | SDK calls for the path and the mappers from SDK shapes to plain objects. |
| `src/aws.js` (modify) | Export `publicError`. |
| `src/path-read.js` (new) | `readPath(aws, region)` builds one region's graph and says which call failed. |
| `src/path-sample.js` (new) | `samplePathGraph()`, the local sample graph used by Sample and by tests. |
| `src/path-diagnose.js` (new) | `diagnose`, `headline`, `matchHost`, `hostOf`, `healthVerdict`, `reachable`. Pure. |
| `src/path-view.js` (new) | `pathResult(graph, query)` returns the JSON the page draws. |
| `src/app.js` (modify) | `pathView(query)` with a region and generation guard. |
| `src/server.js` (modify) | `GET /api/path`, `GET /api/path-sample`, header controls, serve new browser files. |
| `src/main.js` (modify) | Pass `path: createPathAws()` into `createApp`. |
| `src/path-layout.js` (new) | `layoutPath(diagram)` and `nodeAt(placed, x, y)`. Pure. |
| `src/path-draw.js` (new) | `paintPath(ctx, scene)` and `STATUS_COLOR`. |
| `src/browser.js` (modify) | Path mode, load balancer menu, host box, 15 second refresh, clicks. |
| `scripts/verify-path.mjs` (new) | Headless Chrome check of the Path view against the running page. |
| `README.md` (modify) | Two lines about Path. |

## Task 0: Pre-flight

- [ ] **Step 1: Check the tree is clean and the suite passes**

Run:

```bash
cd /Users/gabdzo/dev/cloud_spider
git status --porcelain
npm test
```

Expected: `git status --porcelain` prints nothing, and `npm test` ends with `fail 0`. If `git status` prints anything, stop. Do not commit the owner's changes. Report "the working tree is not clean" and end the run.

- [ ] **Step 2: Branch and install the three clients**

```bash
git switch -c request-path
npm install @aws-sdk/client-elastic-load-balancing-v2@^3.901.0 @aws-sdk/client-eks@^3.901.0 @aws-sdk/client-cloudwatch@^3.901.0
npm test
```

Expected: install succeeds, `npm test` still `fail 0`.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "Add the load balancer, EKS, and CloudWatch clients for the request path."
```

## Task 1: CIDR check and the path reader

**Files:**
- Create: `src/cidr.js`, `src/aws-path.js`
- Modify: `src/aws.js` (the `function publicError` line near the end)
- Test: `test/cidr.test.js`, `test/aws-path.test.js`

**Interfaces:**
- Consumes: `publicError(error)` from `src/aws.js` returns `{ error: string }`.
- Produces:
  - `cidrContains(outer: string, inner: string): boolean`. `inner` may be a bare IPv4 address (treated as `/32`).
  - `createPathAws()` returns an object whose methods resolve to `{ items }`, `{ tags }`, `{ values }`, or `{ error }`:
    - `loadBalancers(region)` gives `LoadBalancer[]`
    - `listeners(region, lbArn)` gives `Listener[]`
    - `rules(region, listenerArn)` gives `Rule[]`
    - `targetGroups(region)` gives `TargetGroup[]`
    - `targetHealth(region, tgArn)` gives `Health[]`
    - `tags(region, arns)` gives `{ tags: { [arn]: Tag[] } }`
    - `subnets(region, vpcId)` gives `{ id, vpcId, cidr, zone }[]`
    - `securityGroups(region, vpcId)` gives `SecurityGroup[]`
    - `routeTables(region, vpcId)` gives `RouteTable[]`
    - `interfacesByIp(region, ips)` gives `Interface[]`
    - `instancesById(region, ids)` gives `Node[]`
    - `clusters(region)` gives `Cluster[]`
    - `metrics(region, lb)` gives `{ values: { elb502, elb503, elb504, target5xx, requests } }`
  - Shapes:
    - `LoadBalancer = { arn, name, dns, scheme, type, state, stateReason, vpcId, subnetIds: string[], zones: string[], securityGroupIds: string[] }`
    - `Listener = { arn, lbArn, port: number, protocol, defaultActions: Action[] }`
    - `Action = { type, targetGroupArns: string[], redirectPort, redirectProtocol, statusCode }`
    - `Rule = { arn, listenerArn, priority: string, isDefault: boolean, hosts: string[], paths: string[], actions: Action[] }`
    - `TargetGroup = { arn, name, protocol, port: number, targetType, vpcId, healthPath, healthPort, healthProtocol, matcher, lbArns: string[] }`
    - `Health = { id, port: number, zone, state, reason, description }`
    - `SecurityGroup = { id, name, vpcId, ingress: Permission[], egress: Permission[] }`, `Permission = { protocol: string, from: number, to: number, cidrs: string[], groupIds: string[] }`
    - `RouteTable = { id, vpcId, main: boolean, subnetIds: string[], routes: { dest, target, state }[] }`
    - `Interface = { id, ip, subnetId, groupIds: string[], instanceId, description }` (one entry per private IP)
    - `Node = { id, state, vpcId, subnetId, privateIp, groupIds: string[], name, tags: Tag[] }`
    - `Cluster = { name, status, version, vpcId, issues: Issue[], nodegroups: { name, status, issues: Issue[], desired: number }[] }`, `Issue = { code, message }`
  - Also exported for tests: `collect`, `chunks`, `lbDimension`, `metricQueries`, `metricsFrom`, and each `*From` mapper.

- [ ] **Step 1: Write the failing CIDR test**

Create `test/cidr.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { cidrContains } from "../src/cidr.js";

test("a CIDR contains itself and smaller blocks inside it, and nothing outside it", () => {
  assert.equal(cidrContains("10.0.0.0/16", "10.0.0.0/16"), true);
  assert.equal(cidrContains("10.0.0.0/16", "10.0.12.0/24"), true);
  assert.equal(cidrContains("10.0.0.0/16", "10.1.0.0/24"), false);
  assert.equal(cidrContains("10.0.12.0/24", "10.0.0.0/16"), false);
  assert.equal(cidrContains("0.0.0.0/0", "192.168.1.7"), true);
  assert.equal(cidrContains("10.0.0.0/16", "not-a-cidr"), false);
  assert.equal(cidrContains("10.0.0.0/33", "10.0.0.1"), false);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/cidr.test.js`
Expected: FAIL with `Cannot find module` for `src/cidr.js`.

- [ ] **Step 3: Write `src/cidr.js`**

```js
function toInt(ip) {
  const parts = String(ip).split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function parse(cidr) {
  const [ip, bits = "32"] = String(cidr).split("/");
  const base = toInt(ip);
  const size = Number(bits);
  if (base === null || !Number.isInteger(size) || size < 0 || size > 32) return null;
  const mask = size === 0 ? 0 : (0xffffffff << (32 - size)) >>> 0;
  return { start: (base & mask) >>> 0, size, mask };
}

export function cidrContains(outer, inner) {
  const a = parse(outer);
  const b = parse(inner);
  if (!a || !b || b.size < a.size) return false;
  return ((b.start & a.mask) >>> 0) === a.start;
}
```

- [ ] **Step 4: Run it to make sure it passes**

Run: `node --test test/cidr.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing mapper tests**

Create `test/aws-path.test.js`:

```js
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
  assert.deepEqual(group.ingress[0], { protocol: "tcp", from: 8080, to: 8080, cidrs: [], groupIds: ["sg-alb"] });
  assert.deepEqual(group.egress[0], { protocol: "-1", from: -1, to: -1, cidrs: ["0.0.0.0/0"], groupIds: [] });

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
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `node --test test/aws-path.test.js`
Expected: FAIL with `Cannot find module` for `src/aws-path.js`.

- [ ] **Step 7: Export `publicError` from `src/aws.js`**

In `src/aws.js`, change the line `function publicError(error) {` to:

```js
export function publicError(error) {
```

- [ ] **Step 8: Write `src/aws-path.js`**

```js
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeNetworkInterfacesCommand,
  DescribeRouteTablesCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
} from "@aws-sdk/client-ec2";
import {
  ElasticLoadBalancingV2Client,
  DescribeListenersCommand,
  DescribeLoadBalancersCommand,
  DescribeRulesCommand,
  DescribeTagsCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  EKSClient,
  DescribeClusterCommand,
  DescribeNodegroupCommand,
  ListClustersCommand,
  ListNodegroupsCommand,
} from "@aws-sdk/client-eks";
import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { publicError } from "./aws.js";

const METRICS = {
  elb502: "HTTPCode_ELB_502_Count",
  elb503: "HTTPCode_ELB_503_Count",
  elb504: "HTTPCode_ELB_504_Count",
  target5xx: "HTTPCode_Target_5XX_Count",
  requests: "RequestCount",
};

export function createPathAws() {
  const elb = (region) => new ElasticLoadBalancingV2Client({ region });
  const ec2 = (region) => new EC2Client({ region });
  const inVpc = (vpcId) => [{ Name: "vpc-id", Values: [vpcId] }];

  return {
    loadBalancers(region) {
      const client = elb(region);
      return collect(
        (command) => client.send(command),
        (Marker) => new DescribeLoadBalancersCommand({ Marker }),
        (out) => ({ items: (out.LoadBalancers || []).map(loadBalancerFrom), next: out.NextMarker }),
      );
    },
    listeners(region, lbArn) {
      const client = elb(region);
      return collect(
        (command) => client.send(command),
        (Marker) => new DescribeListenersCommand({ LoadBalancerArn: lbArn, Marker }),
        (out) => ({ items: (out.Listeners || []).map(listenerFrom), next: out.NextMarker }),
      );
    },
    rules(region, listenerArn) {
      const client = elb(region);
      return collect(
        (command) => client.send(command),
        (Marker) => new DescribeRulesCommand({ ListenerArn: listenerArn, Marker }),
        (out) => ({ items: (out.Rules || []).map((raw) => ruleFrom(raw, listenerArn)), next: out.NextMarker }),
      );
    },
    targetGroups(region) {
      const client = elb(region);
      return collect(
        (command) => client.send(command),
        (Marker) => new DescribeTargetGroupsCommand({ Marker }),
        (out) => ({ items: (out.TargetGroups || []).map(targetGroupFrom), next: out.NextMarker }),
      );
    },
    async targetHealth(region, tgArn) {
      try {
        const out = await elb(region).send(new DescribeTargetHealthCommand({ TargetGroupArn: tgArn }));
        return { items: (out.TargetHealthDescriptions || []).map(healthFrom) };
      } catch (error) {
        return publicError(error);
      }
    },
    async tags(region, arns) {
      try {
        const client = elb(region);
        const tags = {};
        for (const part of chunks(arns, 20)) {
          const out = await client.send(new DescribeTagsCommand({ ResourceArns: part }));
          for (const item of out.TagDescriptions || []) tags[item.ResourceArn] = (item.Tags || []).map(tagFrom);
        }
        return { tags };
      } catch (error) {
        return publicError(error);
      }
    },
    subnets(region, vpcId) {
      const client = ec2(region);
      return collect(
        (command) => client.send(command),
        (NextToken) => new DescribeSubnetsCommand({ Filters: inVpc(vpcId), NextToken }),
        (out) => ({
          items: (out.Subnets || []).map((raw) => ({
            id: raw.SubnetId,
            vpcId: raw.VpcId || "",
            cidr: raw.CidrBlock || "",
            zone: raw.AvailabilityZone || "",
          })),
          next: out.NextToken,
        }),
      );
    },
    securityGroups(region, vpcId) {
      const client = ec2(region);
      return collect(
        (command) => client.send(command),
        (NextToken) => new DescribeSecurityGroupsCommand({ Filters: inVpc(vpcId), NextToken }),
        (out) => ({ items: (out.SecurityGroups || []).map(securityGroupFrom), next: out.NextToken }),
      );
    },
    routeTables(region, vpcId) {
      const client = ec2(region);
      return collect(
        (command) => client.send(command),
        (NextToken) => new DescribeRouteTablesCommand({ Filters: inVpc(vpcId), NextToken }),
        (out) => ({ items: (out.RouteTables || []).map(routeTableFrom), next: out.NextToken }),
      );
    },
    async interfacesByIp(region, ips) {
      const client = ec2(region);
      const wanted = new Set(ips);
      const items = [];
      for (const part of chunks(ips, 100)) {
        const out = await collect(
          (command) => client.send(command),
          (NextToken) =>
            new DescribeNetworkInterfacesCommand({
              Filters: [{ Name: "addresses.private-ip-address", Values: part }],
              NextToken,
            }),
          (page) => ({ items: (page.NetworkInterfaces || []).flatMap(interfacesFrom), next: page.NextToken }),
        );
        if (out.error) return out;
        items.push(...out.items.filter((item) => wanted.has(item.ip)));
      }
      return { items };
    },
    async instancesById(region, ids) {
      const client = ec2(region);
      const items = [];
      for (const part of chunks(ids, 100)) {
        const out = await collect(
          (command) => client.send(command),
          (NextToken) => new DescribeInstancesCommand({ InstanceIds: part, NextToken }),
          (page) => ({
            items: (page.Reservations || []).flatMap((reservation) => (reservation.Instances || []).map(nodeFrom)),
            next: page.NextToken,
          }),
        );
        if (out.error) return out;
        items.push(...out.items);
      }
      return { items };
    },
    async clusters(region) {
      try {
        const client = new EKSClient({ region });
        const send = (command) => client.send(command);
        const names = await collect(
          send,
          (nextToken) => new ListClustersCommand({ nextToken }),
          (out) => ({ items: out.clusters || [], next: out.nextToken }),
        );
        if (names.error) return names;
        const items = [];
        for (const name of names.items) {
          const { cluster } = await client.send(new DescribeClusterCommand({ name }));
          const groups = await collect(
            send,
            (nextToken) => new ListNodegroupsCommand({ clusterName: name, nextToken }),
            (out) => ({ items: out.nodegroups || [], next: out.nextToken }),
          );
          if (groups.error) return groups;
          const nodegroups = [];
          for (const group of groups.items) {
            const { nodegroup } = await client.send(
              new DescribeNodegroupCommand({ clusterName: name, nodegroupName: group }),
            );
            nodegroups.push(nodegroupFrom(nodegroup));
          }
          items.push(clusterFrom(cluster, nodegroups));
        }
        return { items };
      } catch (error) {
        return publicError(error);
      }
    },
    async metrics(region, lb) {
      if (lb.type !== "application") return { values: {} };
      try {
        const end = new Date();
        const start = new Date(end.getTime() - 15 * 60_000);
        const out = await new CloudWatchClient({ region }).send(
          new GetMetricDataCommand({
            StartTime: start,
            EndTime: end,
            MetricDataQueries: metricQueries(lbDimension(lb.arn)),
          }),
        );
        return { values: metricsFrom(out) };
      } catch (error) {
        return publicError(error);
      }
    },
  };
}

export async function collect(send, makeCommand, readPage) {
  const items = [];
  let next;
  try {
    do {
      const page = readPage(await send(makeCommand(next)));
      items.push(...(page.items || []));
      next = page.next;
    } while (next);
    return { items };
  } catch (error) {
    return publicError(error);
  }
}

export function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function lbDimension(arn) {
  const marker = ":loadbalancer/";
  const at = String(arn).indexOf(marker);
  return at >= 0 ? arn.slice(at + marker.length) : "";
}

export function metricQueries(dimension) {
  return Object.entries(METRICS).map(([Id, MetricName]) => ({
    Id,
    MetricStat: {
      Metric: {
        Namespace: "AWS/ApplicationELB",
        MetricName,
        Dimensions: [{ Name: "LoadBalancer", Value: dimension }],
      },
      Period: 60,
      Stat: "Sum",
    },
    ReturnData: true,
  }));
}

export function metricsFrom(out) {
  const values = {};
  for (const key of Object.keys(METRICS)) {
    const found = (out.MetricDataResults || []).find((item) => item.Id === key);
    values[key] = (found?.Values || []).reduce((sum, value) => sum + value, 0);
  }
  return values;
}

function tagFrom(tag) {
  return { key: tag.Key, value: tag.Value || "" };
}

export function loadBalancerFrom(raw) {
  const zones = raw.AvailabilityZones || [];
  return {
    arn: raw.LoadBalancerArn,
    name: raw.LoadBalancerName,
    dns: (raw.DNSName || "").toLowerCase(),
    scheme: raw.Scheme || "",
    type: raw.Type || "",
    state: raw.State?.Code || "",
    stateReason: raw.State?.Reason || "",
    vpcId: raw.VpcId || "",
    subnetIds: zones.map((zone) => zone.SubnetId).filter(Boolean),
    zones: zones.map((zone) => zone.ZoneName).filter(Boolean),
    securityGroupIds: raw.SecurityGroups || [],
  };
}

export function listenerFrom(raw) {
  return {
    arn: raw.ListenerArn,
    lbArn: raw.LoadBalancerArn,
    port: raw.Port,
    protocol: raw.Protocol || "",
    defaultActions: (raw.DefaultActions || []).map(actionFrom),
  };
}

export function actionFrom(raw) {
  const arns = [
    raw.TargetGroupArn,
    ...(raw.ForwardConfig?.TargetGroups || []).map((item) => item.TargetGroupArn),
  ].filter(Boolean);
  return {
    type: raw.Type || "",
    targetGroupArns: [...new Set(arns)],
    redirectPort: raw.RedirectConfig?.Port || "",
    redirectProtocol: raw.RedirectConfig?.Protocol || "",
    statusCode: raw.RedirectConfig?.StatusCode || raw.FixedResponseConfig?.StatusCode || "",
  };
}

export function ruleFrom(raw, listenerArn) {
  const values = (field, key) =>
    (raw.Conditions || [])
      .filter((condition) => condition.Field === field)
      .flatMap((condition) => condition[key]?.Values || condition.Values || []);
  return {
    arn: raw.RuleArn,
    listenerArn,
    priority: raw.Priority || "",
    isDefault: Boolean(raw.IsDefault),
    hosts: values("host-header", "HostHeaderConfig"),
    paths: values("path-pattern", "PathPatternConfig"),
    actions: (raw.Actions || []).map(actionFrom),
  };
}

export function targetGroupFrom(raw) {
  return {
    arn: raw.TargetGroupArn,
    name: raw.TargetGroupName,
    protocol: raw.Protocol || "",
    port: raw.Port,
    targetType: raw.TargetType || "",
    vpcId: raw.VpcId || "",
    healthPath: raw.HealthCheckPath || "",
    healthPort: raw.HealthCheckPort || "traffic-port",
    healthProtocol: raw.HealthCheckProtocol || "",
    matcher: raw.Matcher?.HttpCode || raw.Matcher?.GrpcCode || "",
    lbArns: raw.LoadBalancerArns || [],
  };
}

export function healthFrom(raw) {
  return {
    id: raw.Target?.Id || "",
    port: raw.Target?.Port,
    zone: raw.Target?.AvailabilityZone || "",
    state: raw.TargetHealth?.State || "",
    reason: raw.TargetHealth?.Reason || "",
    description: raw.TargetHealth?.Description || "",
  };
}

function permissionFrom(raw) {
  return {
    protocol: String(raw.IpProtocol ?? "-1"),
    from: raw.FromPort ?? -1,
    to: raw.ToPort ?? -1,
    cidrs: (raw.IpRanges || []).map((range) => range.CidrIp).filter(Boolean),
    groupIds: (raw.UserIdGroupPairs || []).map((pair) => pair.GroupId).filter(Boolean),
  };
}

export function securityGroupFrom(raw) {
  return {
    id: raw.GroupId,
    name: raw.GroupName || "",
    vpcId: raw.VpcId || "",
    ingress: (raw.IpPermissions || []).map(permissionFrom),
    egress: (raw.IpPermissionsEgress || []).map(permissionFrom),
  };
}

export function routeTableFrom(raw) {
  const associations = raw.Associations || [];
  return {
    id: raw.RouteTableId,
    vpcId: raw.VpcId || "",
    main: associations.some((association) => association.Main),
    subnetIds: associations.map((association) => association.SubnetId).filter(Boolean),
    routes: (raw.Routes || []).map((route) => ({
      dest: route.DestinationCidrBlock || route.DestinationPrefixListId || "",
      target:
        route.GatewayId ||
        route.NatGatewayId ||
        route.TransitGatewayId ||
        route.VpcPeeringConnectionId ||
        route.NetworkInterfaceId ||
        route.InstanceId ||
        "",
      state: route.State || "active",
    })),
  };
}

export function interfacesFrom(raw) {
  const listed = (raw.PrivateIpAddresses || []).map((entry) => entry.PrivateIpAddress).filter(Boolean);
  const ips = listed.length ? listed : [raw.PrivateIpAddress].filter(Boolean);
  return ips.map((ip) => ({
    id: raw.NetworkInterfaceId,
    ip,
    subnetId: raw.SubnetId || "",
    groupIds: (raw.Groups || []).map((group) => group.GroupId).filter(Boolean),
    instanceId: raw.Attachment?.InstanceId || "",
    description: raw.Description || "",
  }));
}

export function nodeFrom(raw) {
  const tags = (raw.Tags || []).map(tagFrom);
  return {
    id: raw.InstanceId,
    state: raw.State?.Name || "",
    vpcId: raw.VpcId || "",
    subnetId: raw.SubnetId || "",
    privateIp: raw.PrivateIpAddress || "",
    groupIds: (raw.SecurityGroups || []).map((group) => group.GroupId).filter(Boolean),
    name: tags.find((tag) => tag.key === "Name" && tag.value)?.value || "",
    tags,
  };
}

function issueFrom(raw) {
  return { code: raw.code || "", message: raw.message || "" };
}

export function nodegroupFrom(raw) {
  return {
    name: raw.nodegroupName,
    status: raw.status || "",
    issues: (raw.health?.issues || []).map(issueFrom),
    desired: raw.scalingConfig?.desiredSize ?? 0,
  };
}

export function clusterFrom(raw, nodegroups) {
  return {
    name: raw.name,
    status: raw.status || "",
    version: raw.version || "",
    vpcId: raw.resourcesVpcConfig?.vpcId || "",
    issues: (raw.health?.issues || []).map(issueFrom),
    nodegroups,
  };
}
```

- [ ] **Step 9: Run the new tests and the suite**

Run: `node --test test/cidr.test.js test/aws-path.test.js && npm test`
Expected: PASS, `fail 0`.

- [ ] **Step 10: Check the reader only reads**

Run: `rg -n "\b[A-Z][A-Za-z0-9]*Command\b" src/aws-path.js | rg -v "Describe|List|GetMetricData"`
Expected: no output.

- [ ] **Step 11: Commit**

```bash
git add src/cidr.js src/aws-path.js src/aws.js test/cidr.test.js test/aws-path.test.js
git commit -m "Read load balancers, target health, security groups, routes, and EKS for the request path."
```

## Task 2: Read one region into a graph

**Files:**
- Create: `src/path-read.js`
- Test: `test/path-read.test.js`

**Interfaces:**
- Consumes: the `createPathAws()` method names and shapes from Task 1.
- Produces: `readPath(aws, region): Promise<{ error: string | null, call: string, graph: Graph | null }>`, where

```js
Graph = {
  region,
  loadBalancers: LoadBalancer[],
  listeners: Listener[],
  rules: Rule[],
  targetGroups: TargetGroup[],
  health: { [tgArn]: Health[] },
  tags: { [arn]: Tag[] },
  subnets: { id, vpcId, cidr, zone }[],
  securityGroups: SecurityGroup[],
  routeTables: RouteTable[],
  interfaces: Interface[],
  nodes: Node[],
  clusters: Cluster[],
  metrics: { [lbArn]: { elb502, elb503, elb504, target5xx, requests } },
  notes: string[],
}
```

- [ ] **Step 1: Write the failing tests**

Create `test/path-read.test.js`:

```js
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
    async interfacesByIp() {
      return {
        items: [
          {
            id: "eni-1",
            ip: "10.0.1.5",
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

test("ip targets read their interfaces and every node is read once", async () => {
  const { aws, calls } = fakeAws();
  const result = await readPath(aws, "eu-north-1");
  assert.equal(result.error, null);
  assert.deepEqual(calls.find((call) => call[0] === "interfacesByIp"), ["interfacesByIp", ["10.0.1.5"]]);
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
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test test/path-read.test.js`
Expected: FAIL with `Cannot find module` for `src/path-read.js`.

- [ ] **Step 3: Write `src/path-read.js`**

```js
export async function readPath(aws, region) {
  const fail = (call, error) => ({ error, call, graph: null });
  const lbs = await aws.loadBalancers(region);
  if (lbs.error) return fail("DescribeLoadBalancers", lbs.error);
  const notes = [];
  const graph = {
    region,
    loadBalancers: lbs.items,
    listeners: [],
    rules: [],
    targetGroups: [],
    health: {},
    tags: {},
    subnets: [],
    securityGroups: [],
    routeTables: [],
    interfaces: [],
    nodes: [],
    clusters: [],
    metrics: {},
    notes,
  };
  if (!lbs.items.length) return { error: null, call: "", graph };

  for (const lb of graph.loadBalancers) {
    const out = await aws.listeners(region, lb.arn);
    if (out.error) return fail("DescribeListeners", out.error);
    graph.listeners.push(...out.items);
  }
  for (const listener of graph.listeners) {
    const out = await aws.rules(region, listener.arn);
    if (out.error) return fail("DescribeRules", out.error);
    graph.rules.push(...out.items);
  }
  const groups = await aws.targetGroups(region);
  if (groups.error) return fail("DescribeTargetGroups", groups.error);
  graph.targetGroups = groups.items;
  for (const tg of graph.targetGroups) {
    const out = await aws.targetHealth(region, tg.arn);
    if (out.error) return fail("DescribeTargetHealth", out.error);
    graph.health[tg.arn] = out.items;
  }

  const tags = await aws.tags(region, [...graph.loadBalancers, ...graph.targetGroups].map((item) => item.arn));
  if (tags.error) notes.push(`DescribeTags: ${tags.error}`);
  else graph.tags = tags.tags;

  for (const vpcId of unique(graph.loadBalancers.map((lb) => lb.vpcId))) {
    const subnets = await aws.subnets(region, vpcId);
    if (subnets.error) return fail("DescribeSubnets", subnets.error);
    const securityGroups = await aws.securityGroups(region, vpcId);
    if (securityGroups.error) return fail("DescribeSecurityGroups", securityGroups.error);
    const routeTables = await aws.routeTables(region, vpcId);
    if (routeTables.error) return fail("DescribeRouteTables", routeTables.error);
    graph.subnets.push(...subnets.items);
    graph.securityGroups.push(...securityGroups.items);
    graph.routeTables.push(...routeTables.items);
  }

  const targetsOf = (type) =>
    graph.targetGroups
      .filter((tg) => tg.targetType === type)
      .flatMap((tg) => (graph.health[tg.arn] || []).map((item) => item.id));
  const ips = unique(targetsOf("ip"));
  if (ips.length) {
    const out = await aws.interfacesByIp(region, ips);
    if (out.error) return fail("DescribeNetworkInterfaces", out.error);
    graph.interfaces = out.items;
  }
  const nodeIds = unique([...targetsOf("instance"), ...graph.interfaces.map((item) => item.instanceId)]);
  if (nodeIds.length) {
    const out = await aws.instancesById(region, nodeIds);
    if (out.error) return fail("DescribeInstances", out.error);
    graph.nodes = out.items;
  }

  const clusters = await aws.clusters(region);
  if (clusters.error) notes.push(`EKS: ${clusters.error}`);
  else graph.clusters = clusters.items;

  for (const lb of graph.loadBalancers) {
    const out = await aws.metrics(region, lb);
    if (out.error) {
      notes.push(`GetMetricData: ${out.error}`);
      break;
    }
    graph.metrics[lb.arn] = out.values;
  }
  return { error: null, call: "", graph };
}

function unique(list) {
  return [...new Set(list.filter(Boolean))].sort();
}
```

- [ ] **Step 4: Run the tests and the suite**

Run: `node --test test/path-read.test.js && npm test`
Expected: PASS, `fail 0`.

- [ ] **Step 5: Commit**

```bash
git add src/path-read.js test/path-read.test.js
git commit -m "Collect one region into a request path graph."
```

## Task 3: Sample graph and the diagnosis

**Files:**
- Create: `src/path-sample.js`, `src/path-diagnose.js`
- Test: `test/path-diagnose.test.js`

**Interfaces:**
- Consumes: `Graph` from Task 2, `cidrContains` from Task 1.
- Produces:
  - `samplePathGraph(): Graph`. Load balancer arn `sample-lb-api`.
  - `diagnose(graph, lbArn, { ruleArn } = {}): { nodes: PathNode[], edges: PathEdge[], findings: Finding[] }`
    - `PathNode = { id, kind: "lb"|"listener"|"rule"|"tg"|"target"|"node"|"cluster", label, caption, status: "ok"|"broken"|"hang"|"unknown", sentence, symptom?: boolean }`
    - Target node id: `${tgArn}|${targetId}:${port}`. Cluster node id: `cluster:${name}`.
    - `PathEdge = { from, to, status, sentence }`
    - `Finding = { status, nodeId, depth, edge: boolean, symptom: boolean, sentence }`
  - `headline(result): string`
  - `matchHost(graph, text): { lbArn, ruleArn: string | null }[]`
  - `hostOf(text): string` (lowercase hostname, or `""`)
  - `healthVerdict(health, tg): { status, sentence }`
  - `reachable(graph, lb, groupIds, port, targetIp): { status, sentence }`

Health reason table (`where` is `id:port`, `check` is `healthProtocol healthPath`):

| Reason | Status | Sentence |
|--------|--------|----------|
| state `healthy` | ok | `${where} is healthy` |
| `Target.Timeout` | hang | `${where} does not answer ${check} in time. Requests to it hang until the load balancer gives up.` |
| `Target.ResponseCodeMismatch` | broken | `${where} answers ${check} with a code outside ${matcher}. ${description}` |
| `Target.FailedHealthChecks` | broken | `${where} refuses or drops ${check}. ${description}` |
| `Target.NotInUse` | broken | `${where} gets no traffic. ${description or "Its zone is not enabled on the load balancer, or no listener uses this target group."}` |
| `Target.NotRegistered` | broken | `${where} is not registered in ${tg.name}.` |
| `Target.InvalidState` | broken | `${where} is not running. ${description}` |
| `Target.IpUnusable` | broken | `${where} has an address the load balancer cannot use. ${description}` |
| `Target.DeregistrationInProgress` | unknown | `${where} is draining and leaves ${tg.name} soon.` |
| `Elb.InitialHealthChecking` | unknown | `${where} is still on its first health checks.` |
| `Elb.RegistrationInProgress` | unknown | `${where} is still being registered.` |
| anything else | broken if `unhealthy`, else unknown | `${where} is ${state}. ${description or reason}` |

Findings order: structural before symptoms, then known before `unknown`, then shallow before deep (`lb` 0, `listener` 1, `rule` 2, `tg` 3, `target` 4, `node` 5, `cluster` 6), then a thread before the box it points to. `headline` is the first finding sentence, or `every edge on this path looks healthy`.

- [ ] **Step 1: Write `src/path-sample.js`**

This is data, used by the tests in Step 2.

```js
const LB = "sample-lb-api";
const VPC = "sample-vpc";
const ALL_OUT = [{ protocol: "-1", from: -1, to: -1, cidrs: ["0.0.0.0/0"], groupIds: [] }];
const NODE_TAGS = [
  { key: "eks:cluster-name", value: "shop" },
  { key: "eks:nodegroup-name", value: "general" },
];

export function samplePathGraph() {
  return {
    region: "sample",
    loadBalancers: [
      {
        arn: LB,
        name: "api-alb",
        dns: "api-alb-sample.eu-north-1.elb.amazonaws.com",
        scheme: "internet-facing",
        type: "application",
        state: "active",
        stateReason: "",
        vpcId: VPC,
        subnetIds: ["sample-public-a", "sample-public-b"],
        zones: ["eu-north-1a", "eu-north-1b"],
        securityGroupIds: ["sample-sg-alb"],
      },
    ],
    listeners: [
      { arn: "sample-listener-80", lbArn: LB, port: 80, protocol: "HTTP", defaultActions: [] },
      { arn: "sample-listener-443", lbArn: LB, port: 443, protocol: "HTTPS", defaultActions: [] },
    ],
    rules: [
      {
        arn: "sample-rule-80-default",
        listenerArn: "sample-listener-80",
        priority: "default",
        isDefault: true,
        hosts: [],
        paths: [],
        actions: [
          { type: "redirect", targetGroupArns: [], redirectPort: "443", redirectProtocol: "HTTPS", statusCode: "HTTP_301" },
        ],
      },
      {
        arn: "sample-rule-443-api",
        listenerArn: "sample-listener-443",
        priority: "1",
        isDefault: false,
        hosts: ["api.sample.test"],
        paths: [],
        actions: [{ type: "forward", targetGroupArns: ["sample-tg-api"], redirectPort: "", redirectProtocol: "", statusCode: "" }],
      },
      {
        arn: "sample-rule-443-web",
        listenerArn: "sample-listener-443",
        priority: "2",
        isDefault: false,
        hosts: ["web.sample.test"],
        paths: [],
        actions: [{ type: "forward", targetGroupArns: ["sample-tg-web"], redirectPort: "", redirectProtocol: "", statusCode: "" }],
      },
      {
        arn: "sample-rule-443-default",
        listenerArn: "sample-listener-443",
        priority: "default",
        isDefault: true,
        hosts: [],
        paths: [],
        actions: [{ type: "fixed-response", targetGroupArns: [], redirectPort: "", redirectProtocol: "", statusCode: "404" }],
      },
    ],
    targetGroups: [
      {
        arn: "sample-tg-api",
        name: "k8s-shop-api",
        protocol: "HTTP",
        port: 8080,
        targetType: "ip",
        vpcId: VPC,
        healthPath: "/healthz",
        healthPort: "traffic-port",
        healthProtocol: "HTTP",
        matcher: "200",
        lbArns: [LB],
      },
      {
        arn: "sample-tg-web",
        name: "k8s-shop-web",
        protocol: "HTTP",
        port: 3000,
        targetType: "ip",
        vpcId: VPC,
        healthPath: "/",
        healthPort: "traffic-port",
        healthProtocol: "HTTP",
        matcher: "200",
        lbArns: [LB],
      },
    ],
    health: {
      "sample-tg-api": [
        { id: "10.0.11.20", port: 8080, zone: "eu-north-1a", state: "healthy", reason: "", description: "" },
        {
          id: "10.0.12.31",
          port: 8080,
          zone: "eu-north-1b",
          state: "unhealthy",
          reason: "Target.Timeout",
          description: "Request timed out",
        },
      ],
      "sample-tg-web": [],
    },
    tags: {
      "sample-tg-api": [
        { key: "elbv2.k8s.aws/cluster", value: "shop" },
        { key: "service.k8s.aws/stack", value: "shop/api" },
      ],
      "sample-tg-web": [
        { key: "elbv2.k8s.aws/cluster", value: "shop" },
        { key: "service.k8s.aws/stack", value: "shop/web" },
      ],
    },
    subnets: [
      { id: "sample-public-a", vpcId: VPC, cidr: "10.0.1.0/24", zone: "eu-north-1a" },
      { id: "sample-public-b", vpcId: VPC, cidr: "10.0.2.0/24", zone: "eu-north-1b" },
      { id: "sample-private-a", vpcId: VPC, cidr: "10.0.11.0/24", zone: "eu-north-1a" },
      { id: "sample-private-b", vpcId: VPC, cidr: "10.0.12.0/24", zone: "eu-north-1b" },
    ],
    securityGroups: [
      {
        id: "sample-sg-alb",
        name: "alb",
        vpcId: VPC,
        ingress: [
          { protocol: "tcp", from: 80, to: 80, cidrs: ["0.0.0.0/0"], groupIds: [] },
          { protocol: "tcp", from: 443, to: 443, cidrs: ["0.0.0.0/0"], groupIds: [] },
        ],
        egress: ALL_OUT,
      },
      {
        id: "sample-sg-node-a",
        name: "nodes-a",
        vpcId: VPC,
        ingress: [{ protocol: "tcp", from: 8080, to: 8080, cidrs: [], groupIds: ["sample-sg-alb"] }],
        egress: ALL_OUT,
      },
      {
        id: "sample-sg-node-b",
        name: "nodes-b",
        vpcId: VPC,
        ingress: [{ protocol: "tcp", from: 22, to: 22, cidrs: ["10.0.0.0/16"], groupIds: [] }],
        egress: ALL_OUT,
      },
    ],
    routeTables: [
      {
        id: "sample-rtb-public",
        vpcId: VPC,
        main: false,
        subnetIds: ["sample-public-a", "sample-public-b"],
        routes: [
          { dest: "10.0.0.0/16", target: "local", state: "active" },
          { dest: "0.0.0.0/0", target: "igw-sample", state: "active" },
        ],
      },
      {
        id: "sample-rtb-private",
        vpcId: VPC,
        main: true,
        subnetIds: [],
        routes: [{ dest: "10.0.0.0/16", target: "local", state: "active" }],
      },
    ],
    interfaces: [
      {
        id: "sample-eni-a",
        ip: "10.0.11.20",
        subnetId: "sample-private-a",
        groupIds: ["sample-sg-node-a"],
        instanceId: "sample-node-a",
        description: "aws-K8S-sample-node-a",
      },
      {
        id: "sample-eni-b",
        ip: "10.0.12.31",
        subnetId: "sample-private-b",
        groupIds: ["sample-sg-node-b"],
        instanceId: "sample-node-b",
        description: "aws-K8S-sample-node-b",
      },
    ],
    nodes: [
      {
        id: "sample-node-a",
        state: "running",
        vpcId: VPC,
        subnetId: "sample-private-a",
        privateIp: "10.0.11.10",
        groupIds: ["sample-sg-node-a"],
        name: "shop-node-a",
        tags: NODE_TAGS,
      },
      {
        id: "sample-node-b",
        state: "running",
        vpcId: VPC,
        subnetId: "sample-private-b",
        privateIp: "10.0.12.10",
        groupIds: ["sample-sg-node-b"],
        name: "shop-node-b",
        tags: NODE_TAGS,
      },
    ],
    clusters: [
      {
        name: "shop",
        status: "ACTIVE",
        version: "1.33",
        vpcId: VPC,
        issues: [],
        nodegroups: [{ name: "general", status: "ACTIVE", issues: [], desired: 2 }],
      },
    ],
    metrics: { [LB]: { elb502: 0, elb503: 7, elb504: 12, target5xx: 0, requests: 940 } },
    notes: [],
  };
}
```

- [ ] **Step 2: Write the failing diagnosis tests**

Create `test/path-diagnose.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { diagnose, headline, healthVerdict, matchHost } from "../src/path-diagnose.js";
import { samplePathGraph } from "../src/path-sample.js";
import { isInstanceId } from "../src/ids.js";

const LB = "sample-lb-api";
const SLOW = "sample-tg-api|10.0.12.31:8080";
const FAST = "sample-tg-api|10.0.11.20:8080";
const BLOCKED = "sample-sg-node-b does not allow tcp 8080 from sample-sg-alb. The load balancer cannot reach this target.";

test("the sample host path names the security group that blocks the slow pod first", () => {
  const graph = samplePathGraph();
  const [match] = matchHost(graph, "https://API.sample.test:443/orders?id=1");
  assert.deepEqual(match, { lbArn: LB, ruleArn: "sample-rule-443-api" });
  const result = diagnose(graph, LB, { ruleArn: match.ruleArn });
  assert.deepEqual(
    result.nodes.filter((node) => node.kind === "rule").map((node) => node.id),
    ["sample-rule-443-api"],
  );
  assert.equal(result.findings[0].sentence, BLOCKED);
  assert.equal(result.nodes.find((node) => node.id === SLOW).status, "hang");
  assert.equal(result.nodes.find((node) => node.id === FAST).status, "ok");
  assert.equal(result.edges.find((edge) => edge.to === FAST).status, "ok");
  assert.equal(result.nodes.some((node) => node.id === "cluster:shop"), true);
});

test("the whole load balancer puts the empty target group before the deeper break", () => {
  const result = diagnose(samplePathGraph(), LB);
  assert.equal(
    headline(result),
    "k8s-shop-web has no registered targets. The load balancer answers 503. The AWS Load Balancer Controller registers the pods of shop/web. Check that its selector matches running pods and that they are Ready.",
  );
  const listener80 = result.nodes.find((node) => node.id === "sample-listener-80");
  assert.equal(listener80.status, "ok");
  assert.match(listener80.caption, /redirects to HTTPS:443/);
  const lb = result.nodes.find((node) => node.id === LB);
  assert.equal(lb.status, "hang");
  assert.match(lb.sentence, /^12 requests timed out at api-alb in the last 15 minutes/);
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
  assert.equal(headline(diagnose(graph, LB)), "api-alb is failed. subnet out of IPs");
});

test("an internet-facing load balancer in subnets with no internet gateway route is broken", () => {
  const graph = samplePathGraph();
  graph.routeTables[0].routes = [{ dest: "10.0.0.0/16", target: "local", state: "active" }];
  assert.equal(
    headline(diagnose(graph, LB)),
    "sample-public-a, sample-public-b have no route to an internet gateway. The internet cannot reach api-alb there.",
  );
});

test("a load balancer with no listener says nothing answers", () => {
  const graph = samplePathGraph();
  graph.listeners = [];
  assert.equal(headline(diagnose(graph, LB)), "api-alb has no listener. Nothing answers on this load balancer.");
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
  assert.equal(edge.sentence, "api-alb has no security group. The targets must allow the callers' addresses on 8080.");
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
  assert.equal(node.sentence, "shop-node-b is stopped");
  const cluster = result.nodes.find((item) => item.id === "cluster:shop");
  assert.equal(cluster.status, "broken");
  assert.equal(cluster.sentence, "general: Ec2SubnetInvalidConfiguration subnet has no free addresses");
});

test("health reasons read as plain sentences", () => {
  const tg = samplePathGraph().targetGroups[0];
  const base = { id: "10.0.1.5", port: 8080, zone: "eu-north-1a", state: "unhealthy" };
  assert.deepEqual(
    healthVerdict(
      { ...base, reason: "Target.ResponseCodeMismatch", description: "Health checks failed with these codes: [404]" },
      tg,
    ),
    {
      status: "broken",
      sentence: "10.0.1.5:8080 answers HTTP /healthz with a code outside 200. Health checks failed with these codes: [404]",
    },
  );
  assert.equal(healthVerdict({ ...base, state: "initial", reason: "Elb.InitialHealthChecking", description: "" }, tg).status, "unknown");
  assert.equal(healthVerdict({ ...base, state: "draining", reason: "Target.DeregistrationInProgress", description: "" }, tg).status, "unknown");
  assert.equal(healthVerdict({ ...base, reason: "Target.Timeout", description: "" }, tg).status, "hang");
});

test("a host matches by load balancer DNS, by exact rule host, and by wildcard", () => {
  const graph = samplePathGraph();
  assert.deepEqual(matchHost(graph, "dualstack.api-alb-sample.eu-north-1.elb.amazonaws.com"), [
    { lbArn: LB, ruleArn: null },
  ]);
  graph.rules.find((rule) => rule.arn === "sample-rule-443-web").hosts = ["*.shop.test"];
  assert.deepEqual(matchHost(graph, "a.b.shop.test"), [{ lbArn: LB, ruleArn: "sample-rule-443-web" }]);
  assert.deepEqual(matchHost(graph, ""), []);
  assert.deepEqual(matchHost(graph, "http://"), []);
});

test("sample ids are not instance ids", () => {
  const graph = samplePathGraph();
  for (const node of graph.nodes) assert.equal(isInstanceId(node.id), false);
});
```

- [ ] **Step 3: Run them to make sure they fail**

Run: `node --test test/path-diagnose.test.js`
Expected: FAIL with `Cannot find module` for `src/path-diagnose.js`.

- [ ] **Step 4: Write `src/path-diagnose.js`**

```js
import { cidrContains } from "./cidr.js";

const DEPTH = { lb: 0, listener: 1, rule: 2, tg: 3, target: 4, node: 5, cluster: 6 };
const CONTROLLER_STACK = ["service.k8s.aws/stack", "ingress.k8s.aws/resource", "ingress.k8s.aws/stack"];

export function diagnose(graph, lbArn, { ruleArn = null } = {}) {
  const lb = graph.loadBalancers.find((item) => item.arn === lbArn);
  if (!lb) return { nodes: [], edges: [], findings: [] };
  const nodes = [];
  const edges = [];
  const seen = new Set();
  const add = (node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    nodes.push(node);
    return true;
  };
  const link = (from, to, status = "ok", sentence = "") => edges.push({ from, to, status, sentence });

  add(lbNode(graph, lb));
  const focus = ruleArn ? graph.rules.find((rule) => rule.arn === ruleArn) : null;
  const listeners = graph.listeners
    .filter((listener) => listener.lbArn === lb.arn)
    .filter((listener) => !focus || listener.arn === focus.listenerArn)
    .sort((a, b) => a.port - b.port);
  if (!listeners.length && (nodes[0].status === "ok" || nodes[0].symptom)) {
    Object.assign(nodes[0], {
      status: "broken",
      symptom: false,
      sentence: `${lb.name} has no listener. Nothing answers on this load balancer.`,
    });
  }

  for (const listener of listeners) {
    const rules = rulesFor(graph, listener).filter((rule) => !focus || rule.arn === focus.arn);
    add(listenerNode(listener, rules));
    link(lb.arn, listener.arn);
    for (const rule of rules) {
      add(ruleNode(rule));
      link(listener.arn, rule.arn);
      for (const action of rule.actions) {
        if (action.type !== "forward") continue;
        for (const tgArn of action.targetGroupArns) {
          const tg = graph.targetGroups.find((item) => item.arn === tgArn);
          if (!tg) {
            add({
              id: tgArn,
              kind: "tg",
              label: tgArn.split("/").at(-2) || tgArn,
              caption: "missing",
              status: "broken",
              sentence: `${ruleName(rule)} forwards to a target group that does not exist.`,
            });
            link(rule.arn, tgArn, "broken");
            continue;
          }
          link(rule.arn, tg.arn);
          if (add(targetGroupNode(graph, tg))) addTargets(graph, lb, tg, add, link);
        }
      }
    }
  }
  return { nodes, edges, findings: findingsOf(nodes, edges) };
}

export function headline(result) {
  return result.findings[0]?.sentence || "every edge on this path looks healthy";
}

export function hostOf(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `http://${raw}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function matchHost(graph, text) {
  const host = hostOf(text);
  if (!host) return [];
  const bare = host.replace(/^dualstack\./, "");
  const out = [];
  for (const lb of graph.loadBalancers) {
    if (lb.dns === bare) out.push({ lbArn: lb.arn, ruleArn: null });
  }
  for (const rule of graph.rules) {
    if (!rule.hosts.some((pattern) => hostMatches(pattern, host))) continue;
    const listener = graph.listeners.find((item) => item.arn === rule.listenerArn);
    if (listener) out.push({ lbArn: listener.lbArn, ruleArn: rule.arn });
  }
  return out;
}

function hostMatches(pattern, host) {
  const source = String(pattern)
    .toLowerCase()
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${source}$`).test(host);
}

export function healthVerdict(health, tg) {
  const where = `${health.id}:${health.port}`;
  const check = `${tg.healthProtocol} ${tg.healthPath || ""}`.trim();
  const description = health.description || "";
  const say = (status, sentence) => ({ status, sentence: sentence.trim() });
  if (health.state === "healthy") return say("ok", `${where} is healthy`);
  switch (health.reason) {
    case "Target.Timeout":
      return say("hang", `${where} does not answer ${check} in time. Requests to it hang until the load balancer gives up.`);
    case "Target.ResponseCodeMismatch":
      return say("broken", `${where} answers ${check} with a code outside ${tg.matcher || "200"}. ${description}`);
    case "Target.FailedHealthChecks":
      return say("broken", `${where} refuses or drops ${check}. ${description}`);
    case "Target.NotInUse":
      return say(
        "broken",
        `${where} gets no traffic. ${description || "Its zone is not enabled on the load balancer, or no listener uses this target group."}`,
      );
    case "Target.NotRegistered":
      return say("broken", `${where} is not registered in ${tg.name}.`);
    case "Target.InvalidState":
      return say("broken", `${where} is not running. ${description}`);
    case "Target.IpUnusable":
      return say("broken", `${where} has an address the load balancer cannot use. ${description}`);
    case "Target.DeregistrationInProgress":
      return say("unknown", `${where} is draining and leaves ${tg.name} soon.`);
    case "Elb.InitialHealthChecking":
      return say("unknown", `${where} is still on its first health checks.`);
    case "Elb.RegistrationInProgress":
      return say("unknown", `${where} is still being registered.`);
    default:
      return say(
        health.state === "unhealthy" ? "broken" : "unknown",
        `${where} is ${health.state}. ${description || health.reason || ""}`,
      );
  }
}

export function reachable(graph, lb, groupIds, port, targetIp = "") {
  if (!lb.securityGroupIds.length) {
    return {
      status: "unknown",
      sentence: `${lb.name} has no security group. The targets must allow the callers' addresses on ${port}.`,
    };
  }
  const targetGroups = groupIds
    .map((id) => graph.securityGroups.find((group) => group.id === id))
    .filter(Boolean);
  if (!targetGroups.length) {
    return { status: "unknown", sentence: "the security groups of this target were not read." };
  }
  const lbCidrs = lb.subnetIds
    .map((id) => graph.subnets.find((subnet) => subnet.id === id)?.cidr)
    .filter(Boolean);
  const inbound = targetGroups.some((group) =>
    group.ingress.some(
      (rule) =>
        covers(rule, port) &&
        (rule.groupIds.some((id) => lb.securityGroupIds.includes(id)) ||
          (lbCidrs.length > 0 && lbCidrs.every((cidr) => rule.cidrs.some((outer) => cidrContains(outer, cidr))))),
    ),
  );
  if (!inbound) {
    return {
      status: "broken",
      sentence: `${groupIds.join(", ")} does not allow tcp ${port} from ${lb.securityGroupIds.join(", ")}. The load balancer cannot reach this target.`,
    };
  }
  const lbGroups = lb.securityGroupIds
    .map((id) => graph.securityGroups.find((group) => group.id === id))
    .filter(Boolean);
  const outbound = lbGroups.some((group) =>
    group.egress.some(
      (rule) =>
        covers(rule, port) &&
        (rule.groupIds.some((id) => groupIds.includes(id)) ||
          rule.cidrs.some((outer) => (targetIp ? cidrContains(outer, targetIp) : outer === "0.0.0.0/0"))),
    ),
  );
  if (!outbound) {
    return {
      status: "broken",
      sentence: `${lb.securityGroupIds.join(", ")} does not allow tcp ${port} out to this target. The load balancer cannot reach it.`,
    };
  }
  return { status: "ok", sentence: "" };
}

function covers(rule, port) {
  if (rule.protocol === "-1") return true;
  if (rule.protocol !== "tcp" && rule.protocol !== "6") return false;
  return port >= rule.from && port <= rule.to;
}

function lbNode(graph, lb) {
  const node = {
    id: lb.arn,
    kind: "lb",
    label: lb.name,
    caption: `${lb.type} ${lb.scheme}`,
    status: "ok",
    sentence: lb.dns,
    symptom: false,
  };
  if (lb.state !== "active") {
    return { ...node, status: "broken", sentence: `${lb.name} is ${lb.state}. ${lb.stateReason || ""}`.trim() };
  }
  if (lb.scheme === "internet-facing") {
    const closed = lb.subnetIds.filter((id) => !routesToInternet(graph, lb.vpcId, id));
    if (closed.length) {
      return {
        ...node,
        status: "broken",
        sentence: `${closed.join(", ")} ${closed.length === 1 ? "has" : "have"} no route to an internet gateway. The internet cannot reach ${lb.name} there.`,
      };
    }
  }
  const symptom = symptomOf(lb, graph.metrics?.[lb.arn]);
  return symptom ? { ...node, ...symptom, symptom: true } : node;
}

function routesToInternet(graph, vpcId, subnetId) {
  const table =
    graph.routeTables.find((item) => item.subnetIds.includes(subnetId)) ||
    graph.routeTables.find((item) => item.vpcId === vpcId && item.main);
  return Boolean(
    table?.routes.some(
      (route) => route.dest === "0.0.0.0/0" && route.target.startsWith("igw-") && route.state !== "blackhole",
    ),
  );
}

function symptomOf(lb, m) {
  if (!m) return null;
  const when = "in the last 15 minutes";
  if (m.elb504 > 0) {
    return { status: "hang", sentence: `${m.elb504} requests timed out at ${lb.name} ${when}. A target took the connection and did not answer in time.` };
  }
  if (m.elb502 > 0) {
    return { status: "broken", sentence: `${m.elb502} requests got 502 from ${lb.name} ${when}. A target closed the connection or sent a bad response.` };
  }
  if (m.elb503 > 0) {
    return { status: "broken", sentence: `${m.elb503} requests got 503 from ${lb.name} ${when}. No target could take them.` };
  }
  if (m.target5xx > 0) {
    return { status: "broken", sentence: `${m.target5xx} requests got a 5xx from the service itself ${when}.` };
  }
  return null;
}

function rulesFor(graph, listener) {
  const rules = graph.rules.filter((rule) => rule.listenerArn === listener.arn);
  if (!rules.length) {
    return [
      {
        arn: `${listener.arn}|default`,
        listenerArn: listener.arn,
        priority: "default",
        isDefault: true,
        hosts: [],
        paths: [],
        actions: listener.defaultActions,
      },
    ];
  }
  const rank = (rule) => (rule.isDefault ? Number.MAX_SAFE_INTEGER : Number(rule.priority));
  return [...rules].sort((a, b) => rank(a) - rank(b));
}

function ruleName(rule) {
  return rule.isDefault ? "the default rule" : `rule ${rule.priority}`;
}

function actionWords(action, fallbackProtocol, fallbackPort) {
  if (!action) return "does nothing";
  if (action.type === "forward") return "forwards";
  if (action.type === "redirect") {
    return `redirects to ${action.redirectProtocol || fallbackProtocol}:${action.redirectPort || fallbackPort}`;
  }
  if (action.type === "fixed-response") return `answers ${action.statusCode} itself`;
  return action.type;
}

function listenerNode(listener, rules) {
  const actions = rules.flatMap((rule) => rule.actions);
  const label = `${listener.protocol} ${listener.port}`;
  const base = { id: listener.arn, kind: "listener", label, status: "ok", sentence: "" };
  if (actions.some((action) => action.type === "forward" && action.targetGroupArns.length)) {
    return { ...base, caption: `${rules.length} ${rules.length === 1 ? "rule" : "rules"}`, sentence: `${label} forwards to target groups.` };
  }
  const redirect = actions.find((action) => action.type === "redirect");
  if (redirect) {
    const words = actionWords(redirect, listener.protocol, listener.port);
    return { ...base, caption: words, sentence: `${label} ${words}.` };
  }
  const fixed = actions.find((action) => action.type === "fixed-response");
  return {
    ...base,
    caption: fixed ? `answers ${fixed.statusCode} itself` : "forwards nothing",
    status: "unknown",
    sentence: `${label} forwards nothing. ${fixed ? `It answers ${fixed.statusCode} itself.` : ""}`.trim(),
  };
}

function ruleNode(rule) {
  const match = [...rule.hosts, ...rule.paths].join(" ") || "everything else";
  return {
    id: rule.arn,
    kind: "rule",
    label: rule.isDefault ? "default" : `rule ${rule.priority}`,
    caption: match,
    status: "ok",
    sentence: `${ruleName(rule)} matches ${match} and ${actionWords(rule.actions[0], "", "")}.`,
  };
}

function k8sService(tags) {
  for (const key of CONTROLLER_STACK) {
    const found = tags.find((tag) => tag.key === key && tag.value);
    if (found) return found.value;
  }
  return "";
}

function targetGroupNode(graph, tg) {
  const health = graph.health[tg.arn] || [];
  const service = k8sService(graph.tags[tg.arn] || []);
  const node = {
    id: tg.arn,
    kind: "tg",
    label: tg.name,
    caption: service ? `k8s ${service}` : `${tg.protocol} ${tg.port} ${tg.targetType}`,
    status: "ok",
    sentence: `${tg.name} sends ${tg.protocol} ${tg.port} to ${health.length} ${health.length === 1 ? "target" : "targets"}.`,
  };
  if (!health.length) {
    node.status = "broken";
    node.sentence =
      `${tg.name} has no registered targets. The load balancer answers 503.` +
      (service
        ? ` The AWS Load Balancer Controller registers the pods of ${service}. Check that its selector matches running pods and that they are Ready.`
        : "");
  } else if (health.every((item) => item.state !== "healthy")) {
    node.status = "broken";
    node.sentence = `every target in ${tg.name} is unhealthy. The load balancer sends requests to all of them anyway, so callers see errors or hangs.`;
  }
  return node;
}

function addTargets(graph, lb, tg, add, link) {
  const health = [...(graph.health[tg.arn] || [])].sort((a, b) =>
    `${a.id}:${a.port}`.localeCompare(`${b.id}:${b.port}`),
  );
  const tgTags = graph.tags[tg.arn] || [];
  for (const item of health) {
    const id = `${tg.arn}|${item.id}:${item.port}`;
    const iface = tg.targetType === "ip" ? graph.interfaces.find((entry) => entry.ip === item.id) : null;
    const instanceId = tg.targetType === "instance" ? item.id : iface?.instanceId || "";
    const instance = graph.nodes.find((entry) => entry.id === instanceId) || null;
    const groupIds = iface ? iface.groupIds : instance?.groupIds || [];
    const targetIp = tg.targetType === "ip" ? item.id : instance?.privateIp || "";
    const verdict = healthVerdict(item, tg);
    add({ id, kind: "target", label: `${item.id}:${item.port}`, caption: item.state, status: verdict.status, sentence: verdict.sentence });

    const reach = reachTarget(graph, lb, tg, groupIds, item.port, targetIp);
    if (reach.status === "broken" && verdict.status === "ok") {
      link(tg.arn, id, "unknown", `${item.id}:${item.port} passes health checks, but the security groups read here do not show the rule that allows it.`);
    } else {
      link(tg.arn, id, reach.status, reach.sentence);
    }

    if (!instance) continue;
    const who = instance.name || instance.id;
    const fresh = add({
      id: instance.id,
      kind: "node",
      label: who,
      caption: instance.state,
      status: instance.state === "running" ? "ok" : "broken",
      sentence: `${who} is ${instance.state}`,
    });
    link(id, instance.id);
    const clusterName = clusterNameFor(instance, tgTags);
    if (!clusterName) continue;
    add(clusterNode(graph, clusterName));
    if (fresh) link(instance.id, `cluster:${clusterName}`);
  }
}

function reachTarget(graph, lb, tg, groupIds, trafficPort, targetIp) {
  const first = reachable(graph, lb, groupIds, trafficPort, targetIp);
  const healthPort = tg.healthPort && tg.healthPort !== "traffic-port" ? Number(tg.healthPort) : trafficPort;
  if (first.status !== "ok" || healthPort === trafficPort) return first;
  return reachable(graph, lb, groupIds, healthPort, targetIp);
}

function clusterNameFor(instance, tgTags) {
  const fromGroup = tgTags.find((tag) => tag.key === "elbv2.k8s.aws/cluster")?.value;
  if (fromGroup) return fromGroup;
  const fromNode = instance.tags.find((tag) => tag.key === "eks:cluster-name")?.value;
  if (fromNode) return fromNode;
  const legacy = instance.tags.find((tag) => tag.key.startsWith("kubernetes.io/cluster/"));
  return legacy ? legacy.key.slice("kubernetes.io/cluster/".length) : "";
}

function clusterNode(graph, name) {
  const id = `cluster:${name}`;
  const cluster = graph.clusters.find((item) => item.name === name);
  if (!cluster) {
    const note = (graph.notes || []).find((item) => item.startsWith("EKS:")) || "";
    return { id, kind: "cluster", label: name, caption: "EKS", status: "unknown", sentence: `${name} was not read. ${note}`.trim() };
  }
  const base = {
    id,
    kind: "cluster",
    label: name,
    caption: `EKS ${cluster.version} ${cluster.status}`,
    status: "ok",
    sentence: `${name} is ${cluster.status}`,
  };
  if (cluster.status !== "ACTIVE") return { ...base, status: "broken" };
  const issue = [
    ...cluster.issues.map((item) => ({ owner: name, ...item })),
    ...cluster.nodegroups.flatMap((group) => group.issues.map((item) => ({ owner: group.name, ...item }))),
  ][0];
  if (issue) return { ...base, status: "broken", sentence: `${issue.owner}: ${issue.code} ${issue.message}`.trim() };
  return base;
}

function findingsOf(nodes, edges) {
  const kindOf = (id) => nodes.find((node) => node.id === id)?.kind;
  const list = [
    ...edges
      .filter((edge) => edge.status !== "ok" && edge.sentence)
      .map((edge) => ({
        status: edge.status,
        nodeId: edge.to,
        depth: DEPTH[kindOf(edge.to)] ?? 9,
        edge: true,
        symptom: false,
        sentence: edge.sentence,
      })),
    ...nodes
      .filter((node) => node.status !== "ok")
      .map((node) => ({
        status: node.status,
        nodeId: node.id,
        depth: DEPTH[node.kind],
        edge: false,
        symptom: Boolean(node.symptom),
        sentence: node.sentence,
      })),
  ];
  const rank = (item) => [item.symptom ? 1 : 0, item.status === "unknown" ? 1 : 0, item.depth, item.edge ? 0 : 1];
  return list.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  });
}
```

- [ ] **Step 5: Run the tests and the suite**

Run: `node --test test/path-diagnose.test.js && npm test`
Expected: PASS, `fail 0`. If one sentence assertion fails, fix the code to match the test sentence. Do not loosen the test.

- [ ] **Step 6: Commit**

```bash
git add src/path-sample.js src/path-diagnose.js test/path-diagnose.test.js
git commit -m "Name the first broken or hanging edge on a load balancer path."
```

## Task 4: Path view, app, routes, and wiring

**Files:**
- Create: `src/path-view.js`
- Modify: `src/app.js`, `src/server.js`, `src/main.js`
- Test: `test/path-view.test.js`, `test/path-app.test.js`, `test/server.test.js`

**Interfaces:**
- Consumes: `readPath` (Task 2), `diagnose`, `headline`, `matchHost`, `hostOf` (Task 3), `samplePathGraph` (Task 3), `createPathAws` (Task 1).
- Produces:
  - `pathResult(graph, { lb, host, region }): PathView`, where `PathView = { region, loadBalancers: { arn, name, dns }[], selected, host, hostNote, diagram: { nodes, edges } | null, findings, headline, notes: string[], error: "" }`
  - `app.pathView({ lb, host })` returns `PathView`, `{ region, stale: true }`, or an error view `{ region, error, loadBalancers: [], selected: "", diagram: null, findings: [], headline: "", notes: [] }`.
  - `GET /api/path?lb=&host=` and `GET /api/path-sample?lb=&host=` return those JSON bodies.

- [ ] **Step 1: Write the failing view tests**

Create `test/path-view.test.js`:

```js
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
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test test/path-view.test.js`
Expected: FAIL with `Cannot find module` for `src/path-view.js`.

- [ ] **Step 3: Write `src/path-view.js`**

```js
import { diagnose, headline, hostOf, matchHost } from "./path-diagnose.js";

export function pathResult(graph, { lb = "", host = "", region = "" } = {}) {
  const loadBalancers = graph.loadBalancers
    .map(({ arn, name, dns }) => ({ arn, name, dns }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const notes = [...(graph.notes || [])];
  const empty = { region, loadBalancers, selected: "", host: "", hostNote: "", diagram: null, findings: [], notes, error: "" };
  if (!loadBalancers.length) return { ...empty, headline: `${region} has no load balancers` };

  const text = String(host || "").slice(0, 253);
  const matches = text ? matchHost(graph, text) : [];
  const match = matches.find((item) => item.lbArn === lb) || matches[0];
  const selected = match?.lbArn || (loadBalancers.some((item) => item.arn === lb) ? lb : loadBalancers[0].arn);
  const result = diagnose(graph, selected, { ruleArn: match?.ruleArn || null });
  const hostNote =
    text && !matches.length
      ? `no load balancer in ${region} answers for ${hostOf(text) || text}. Route 53 is not read.`
      : "";
  return {
    ...empty,
    selected,
    host: text,
    hostNote,
    diagram: { nodes: result.nodes, edges: result.edges },
    findings: result.findings,
    headline: headline(result),
  };
}
```

- [ ] **Step 4: Run the view tests**

Run: `node --test test/path-view.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing app tests**

Create `test/path-app.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";

function ec2() {
  return {
    async describeRegions() {
      return { regions: ["eu-north-1", "us-east-1"] };
    },
    async defaultRegion() {
      return "eu-north-1";
    },
    async describeVpcs() {
      return { items: [] };
    },
    async describeSubnets() {
      return { items: [] };
    },
    async describeInstances() {
      return { items: [] };
    },
  };
}

function makeApp(path) {
  return createApp({
    ec2: ec2(),
    trail: { async lookupEvents() { return { events: [] }; } },
    logs: { async filter() { return { events: [] }; } },
    path,
    logGroup: "",
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => 0,
  });
}

test("a path read that returns after a region switch is dropped", async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const app = makeApp({
    async loadBalancers() {
      await gate;
      return { items: [] };
    },
  });
  await app.boot();
  const pending = app.pathView({});
  await app.switchRegion("us-east-1");
  release();
  const result = await pending;
  assert.equal(result.stale, true);
  assert.equal(result.region, "us-east-1");
});

test("a failed path read names the call and the profile hint", async () => {
  const app = makeApp({
    async loadBalancers() {
      return { error: "explicit deny" };
    },
  });
  await app.boot();
  const result = await app.pathView({});
  assert.equal(result.error, "Set AWS_PROFILE=default and AWS_REGION=eu-north-1. explicit deny");
  assert.equal(result.diagram, null);
  assert.ok(app.stdout.includes("DescribeLoadBalancers: Set AWS_PROFILE=default and AWS_REGION=eu-north-1. explicit deny"));
});

test("an empty region draws no path and says so", async () => {
  const app = makeApp({
    async loadBalancers() {
      return { items: [] };
    },
  });
  await app.boot();
  const result = await app.pathView({});
  assert.equal(result.headline, "eu-north-1 has no load balancers");
});
```

- [ ] **Step 6: Run them to make sure they fail**

Run: `node --test test/path-app.test.js`
Expected: FAIL with `app.pathView is not a function`.

- [ ] **Step 7: Add `pathView` to `src/app.js`**

Add the imports at the top:

```js
import { readPath } from "./path-read.js";
import { pathResult } from "./path-view.js";
```

Change the signature line to:

```js
export function createApp({ ec2, trail, logs, path, logGroup, pageOrigin, clock, write }) {
```

Add next to the other `let` lines:

```js
  let pathGeneration = 0;
```

Add this method in the returned object, after `logsFor`:

```js
    async pathView(query = {}) {
      const at = region;
      const failed = (sentence) => ({
        region: at,
        error: sentence,
        loadBalancers: [],
        selected: "",
        diagram: null,
        findings: [],
        headline: "",
        notes: [],
      });
      if (!path) return failed("path reads are not set up");
      if (!at) return failed(error || "the region is not read yet");
      const mine = ++pathGeneration;
      const result = await readPath(path, at);
      if (mine !== pathGeneration || at !== region) return { region, stale: true };
      if (result.error) {
        const sentence = accountRead(result.error);
        report(sink, { call: result.call, sentence });
        return failed(sentence);
      }
      return pathResult(result.graph, { lb: query.lb || "", host: query.host || "", region: at });
    },
```

- [ ] **Step 8: Run the app tests**

Run: `node --test test/path-app.test.js`
Expected: PASS.

- [ ] **Step 9: Write the failing server test**

Append to `test/server.test.js`:

```js
test("path sample is local and names the first break", async () => {
  let reads = 0;
  const box = app();
  const original = box.app.boot.bind(box.app);
  box.app.boot = async () => {
    reads += 1;
    return original();
  };
  const server = await listen(box.app, 0);
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/path-sample?host=api.sample.test`);
    const body = await response.json();
    assert.equal(
      body.findings[0].sentence,
      "sample-sg-node-b does not allow tcp 8080 from sample-sg-alb. The load balancer cannot reach this target.",
    );
    assert.equal(reads, 0);
    const page = await (await fetch(`http://127.0.0.1:${address.port}/`)).text();
    assert.match(page, /id="path"/);
    assert.match(page, /id="lb"/);
    assert.match(page, /id="host"/);
    const layout = await fetch(`http://127.0.0.1:${address.port}/path-layout.js`);
    assert.equal(layout.status, 200);
    const drawer = await fetch(`http://127.0.0.1:${address.port}/path-draw.js`);
    assert.equal(drawer.status, 200);
  } finally {
    server.close();
  }
});
```

- [ ] **Step 10: Run it to make sure it fails**

Run: `node --test test/server.test.js`
Expected: FAIL on the new test (404 or missing ids).

- [ ] **Step 11: Change `src/server.js`**

Add imports at the top:

```js
import { samplePathGraph } from "./path-sample.js";
import { pathResult } from "./path-view.js";
```

Add `"path-layout.js"` and `"path-draw.js"` to the `FILES` set.

In the page CSS, change `select, button {` to `select, button, input {`, and add after `select:disabled { opacity: 0.45; }`:

```css
  input { min-width: 240px; }
  input::placeholder { color: #c2a978; }
  [hidden] { display: none !important; }
```

In the header HTML, after `<button id="sample" type="button">Sample</button>`, add:

```html
  <button id="path" type="button">Path</button>
  <select id="lb" aria-label="load balancer" hidden></select>
  <input id="host" type="text" aria-label="URL or host" placeholder="paste a URL or host" hidden>
```

In `route()`, after the `/api/sample` block, add:

```js
  if (req.method === "GET" && url.pathname === "/api/path-sample") {
    send(
      res,
      200,
      pathResult(samplePathGraph(), {
        lb: url.searchParams.get("lb") || "",
        host: url.searchParams.get("host") || "",
        region: "sample",
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/path") {
    await app.boot();
    send(
      res,
      200,
      await app.pathView({
        lb: url.searchParams.get("lb") || "",
        host: url.searchParams.get("host") || "",
      }),
    );
    return;
  }
```

- [ ] **Step 12: Wire `src/main.js`**

Add the import:

```js
import { createPathAws } from "./aws-path.js";
```

Add `path: createPathAws(),` to the `createApp({ ... })` call, after `logs: aws.logs,`.

- [ ] **Step 13: Run the suite**

Run: `npm test`
Expected: `fail 0`. The new browser files do not exist yet. The server test fetches them, so create empty placeholders now so the route returns 200. Task 5 replaces them:

```bash
printf 'export {};\n' > src/path-layout.js
printf 'export {};\n' > src/path-draw.js
npm test
```

- [ ] **Step 14: Commit**

```bash
git add src/path-view.js src/app.js src/server.js src/main.js src/path-layout.js src/path-draw.js test/path-view.test.js test/path-app.test.js test/server.test.js
git commit -m "Serve the request path for the region on screen and a local sample path."
```

## Task 5: Layout and drawing

**Files:**
- Modify: `src/path-layout.js`, `src/path-draw.js` (replace the placeholders)
- Test: `test/path-layout.test.js`

**Interfaces:**
- Consumes: `PathView.diagram` from Task 4, `FONT_PX` from `src/layout.js`.
- Produces:
  - `layoutPath(diagram): { nodes: (PathNode & { x, y, w, h })[], edges: (PathEdge & { x1, y1, x2, y2 })[], contentWidth, contentHeight }`
  - `nodeAt(placed, x, y): placedNode | null`
  - `paintPath(ctx, { placed, selectedId, phase, width, height, empty })`
  - `STATUS_COLOR = { ok: "#a9cf86", broken: "#ff8a6b", hang: "#ffcc33", unknown: "#c2a978" }`

- [ ] **Step 1: Write the failing tests**

Create `test/path-layout.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { layoutPath, nodeAt } from "../src/path-layout.js";
import { paintPath, STATUS_COLOR } from "../src/path-draw.js";
import { pathResult } from "../src/path-view.js";
import { samplePathGraph } from "../src/path-sample.js";

function diagram() {
  return pathResult(samplePathGraph(), { region: "sample" }).diagram;
}

test("nodes sit inside the content and nodes in one column do not overlap", () => {
  const placed = layoutPath(diagram());
  for (const node of placed.nodes) {
    assert.ok(node.x >= 0 && node.x + node.w <= placed.contentWidth, `${node.id} is outside the width`);
    assert.ok(node.y >= 0 && node.y + node.h <= placed.contentHeight, `${node.id} is outside the height`);
  }
  for (const a of placed.nodes) {
    for (const b of placed.nodes) {
      if (a === b || a.x !== b.x) continue;
      assert.ok(a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.id} overlaps ${b.id}`);
    }
  }
});

test("a thread runs from the right side of its source to the left side of its target", () => {
  const placed = layoutPath(diagram());
  assert.ok(placed.edges.length > 0);
  for (const edge of placed.edges) {
    const from = placed.nodes.find((node) => node.id === edge.from);
    const to = placed.nodes.find((node) => node.id === edge.to);
    assert.equal(edge.x1, from.x + from.w);
    assert.equal(edge.x2, to.x);
    assert.ok(to.x > from.x);
  }
});

test("a point on a box finds it and a point in the gap finds nothing", () => {
  const placed = layoutPath(diagram());
  const first = placed.nodes[0];
  assert.equal(nodeAt(placed, first.x + 5, first.y + 5).id, first.id);
  assert.equal(nodeAt(placed, first.x + first.w + 10, first.y + 5), null);
});

test("a broken thread is drawn in the broken color and a healthy one in the ok color", () => {
  const strokes = [];
  const ctx = new Proxy(
    {},
    {
      get(target, key) {
        if (key in target) return target[key];
        if (key === "stroke") return () => strokes.push(target.strokeStyle);
        return () => {};
      },
      set(target, key, value) {
        target[key] = value;
        return true;
      },
    },
  );
  const placed = layoutPath(diagram());
  paintPath(ctx, { placed, selectedId: placed.nodes[0].id, phase: 0, width: placed.contentWidth, height: placed.contentHeight, empty: "" });
  assert.ok(strokes.includes(STATUS_COLOR.broken));
  assert.ok(strokes.includes(STATUS_COLOR.ok));
});
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `node --test test/path-layout.test.js`
Expected: FAIL with `layoutPath` not exported.

- [ ] **Step 3: Write `src/path-layout.js`**

```js
const COL_W = 220;
const COL_GAP = 56;
const ROW_H = 64;
const ROW_GAP = 14;
const PAD = 24;
const COLUMN = { lb: 0, listener: 1, rule: 2, tg: 3, target: 4, node: 5, cluster: 6 };

export function layoutPath(diagram) {
  const columns = new Map();
  for (const node of diagram?.nodes || []) {
    const col = COLUMN[node.kind] ?? 0;
    if (!columns.has(col)) columns.set(col, []);
    columns.get(col).push(node);
  }
  const nodes = [];
  for (const [col, list] of columns) {
    list.forEach((node, row) => {
      nodes.push({
        ...node,
        x: PAD + col * (COL_W + COL_GAP),
        y: PAD + row * (ROW_H + ROW_GAP),
        w: COL_W,
        h: ROW_H,
      });
    });
  }
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges = (diagram?.edges || [])
    .map((edge) => {
      const a = byId.get(edge.from);
      const b = byId.get(edge.to);
      if (!a || !b) return null;
      return { ...edge, x1: a.x + a.w, y1: a.y + a.h / 2, x2: b.x, y2: b.y + b.h / 2 };
    })
    .filter(Boolean);
  const maxCol = Math.max(0, ...nodes.map((node) => COLUMN[node.kind] ?? 0));
  const maxRows = Math.max(0, ...[...columns.values()].map((list) => list.length));
  return {
    nodes,
    edges,
    contentWidth: PAD * 2 + (maxCol + 1) * COL_W + maxCol * COL_GAP,
    contentHeight: PAD * 2 + maxRows * ROW_H + Math.max(0, maxRows - 1) * ROW_GAP,
  };
}

export function nodeAt(placed, x, y) {
  return (
    placed.nodes.find((node) => x >= node.x && x < node.x + node.w && y >= node.y && y < node.y + node.h) || null
  );
}
```

- [ ] **Step 4: Write `src/path-draw.js`**

```js
import { FONT_PX } from "./layout.js";

const FONT = `bold ${FONT_PX}px Menlo, Monaco, Consolas, monospace`;
const SMALL = `bold ${FONT_PX - 2}px Menlo, Monaco, Consolas, monospace`;
const TEXT = "#f2e3b8";
const MUTED = "#c2a978";
const PANEL = "rgba(16, 13, 8, 0.82)";

export const STATUS_COLOR = { ok: "#a9cf86", broken: "#ff8a6b", hang: "#ffcc33", unknown: "#c2a978" };

export function paintPath(ctx, { placed, selectedId, phase, width, height, empty }) {
  ctx.imageSmoothingEnabled = false;
  ctx.textBaseline = "alphabetic";
  ctx.clearRect(0, 0, width, height);
  ctx.font = FONT;
  if (!placed.nodes.length) {
    ctx.fillStyle = TEXT;
    ctx.fillText(empty || "", 24, 40);
    return;
  }
  for (const edge of placed.edges) {
    ctx.strokeStyle = STATUS_COLOR[edge.status] || MUTED;
    ctx.lineWidth = edge.status === "ok" ? 2 : 4;
    ctx.setLineDash(edge.status === "hang" || edge.status === "unknown" ? [6, 6] : []);
    ctx.lineDashOffset = edge.status === "hang" ? -phase * 6 : 0;
    ctx.beginPath();
    ctx.moveTo(edge.x1, edge.y1);
    ctx.bezierCurveTo(edge.x1 + 28, edge.y1, edge.x2 - 28, edge.y2, edge.x2, edge.y2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  for (const node of placed.nodes) drawNode(ctx, node, node.id === selectedId);
  const selected = placed.nodes.find((node) => node.id === selectedId);
  if (selected?.sentence) drawSentence(ctx, selected, width);
}

function drawNode(ctx, node, selected) {
  ctx.fillStyle = PANEL;
  ctx.fillRect(node.x, node.y, node.w, node.h);
  ctx.strokeStyle = STATUS_COLOR[node.status] || MUTED;
  ctx.lineWidth = selected ? 4 : 2;
  ctx.strokeRect(node.x + 1, node.y + 1, node.w - 2, node.h - 2);
  ctx.font = FONT;
  ctx.fillStyle = TEXT;
  ctx.fillText(clip(node.label, 24), node.x + 10, node.y + 24);
  ctx.font = SMALL;
  ctx.fillStyle = MUTED;
  ctx.fillText(clip(`${node.kind}  ${node.caption || ""}`, 28), node.x + 10, node.y + 44);
}

function drawSentence(ctx, node, width) {
  const lines = wrap(node.sentence, 46);
  const w = 420;
  const h = 16 + lines.length * 20;
  let x = node.x + node.w + 12;
  if (x + w > width - 8) x = Math.max(8, node.x - w - 12);
  const y = node.y + node.h + 8;
  ctx.fillStyle = PANEL;
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = TEXT;
  ctx.lineWidth = 2;
  ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.font = SMALL;
  ctx.fillStyle = TEXT;
  lines.forEach((line, index) => ctx.fillText(line, x + 12, y + 22 + index * 20));
}

function clip(text, max) {
  const value = String(text || "");
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function wrap(text, max) {
  const lines = [];
  let line = "";
  for (const word of String(text).split(" ")) {
    if (line && `${line} ${word}`.length > max) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines;
}
```

- [ ] **Step 5: Run the tests and the suite**

Run: `node --test test/path-layout.test.js && npm test`
Expected: PASS, `fail 0`.

- [ ] **Step 6: Commit**

```bash
git add src/path-layout.js src/path-draw.js test/path-layout.test.js
git commit -m "Lay out the request path in columns and draw its threads by status."
```

## Task 6: Browser Path mode, check in Chrome, README

**Files:**
- Modify: `src/browser.js`, `README.md`
- Create: `scripts/verify-path.mjs`

**Interfaces:**
- Consumes: `/api/path`, `/api/path-sample` (Task 4), `layoutPath`, `nodeAt`, `paintPath` (Task 5).
- Produces: header controls `#path`, `#lb`, `#host` that work as the Spec says.

- [ ] **Step 1: Imports, elements, state in `src/browser.js`**

After the existing imports add:

```js
import { layoutPath, nodeAt } from "./path-layout.js";
import { paintPath } from "./path-draw.js";
```

After `const map = document.querySelector("#map");` add:

```js
const pathButton = document.querySelector("#path");
const lbSelect = document.querySelector("#lb");
const hostInput = document.querySelector("#host");
```

After `let sample = false;` add:

```js
let mode = "map";
let pathData = null;
let pathSelected = null;
let pathPulling = false;
let pathAgain = false;
```

- [ ] **Step 2: `renderChrome` and `draw`**

Replace `renderChrome` with:

```js
function renderChrome() {
  statusEl.textContent = ui.status;
  radioEl.textContent = ui.radio || "";
  if (mode === "path") {
    confirmEl.textContent = (pathData?.notes || []).join("  ");
    no.hidden = true;
    yes.hidden = true;
    return;
  }
  confirmEl.textContent = ui.confirmation?.line || "";
  no.hidden = !ui.confirmation;
  yes.hidden = !ui.confirmation?.allowsY;
  yes.textContent = ui.confirmation?.verb === "start" ? "bring it back" : "put it down";
}
```

Replace `draw` with these four functions:

```js
function sizeCanvas(contentWidth, contentHeight) {
  const width = Math.max(contentWidth, map.clientWidth || 960);
  const height = Math.max(contentHeight, map.clientHeight || 640);
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

function placedPath() {
  return pathData?.diagram
    ? layoutPath(pathData.diagram)
    : { nodes: [], edges: [], contentWidth: 960, contentHeight: 640 };
}

function drawPath() {
  const placed = placedPath();
  const { width, height } = sizeCanvas(placed.contentWidth, placed.contentHeight);
  paintPath(ctx, {
    placed,
    selectedId: pathSelected,
    phase,
    width,
    height,
    empty: pathData?.headline || pathData?.error || "reading the path",
  });
}

function draw() {
  if (mode === "path") {
    drawPath();
    return;
  }
  const placed = place
    ? layout(place)
    : {
        settlements: [],
        orphans: { items: [], label: "no VPC" },
        contentWidth: 960,
        contentHeight: 640,
      };
  const { width, height } = sizeCanvas(placed.contentWidth, placed.contentHeight);
  paint(ctx, { placed, ui, region, phase, width, height });
}
```

- [ ] **Step 3: Keep `pull()` from writing over the path**

In `pull()`, right after `setRadio(ui, view.radio || "");`, insert:

```js
    if (mode === "path") {
      if (!sample) syncRegions(view.regions || [], view.region);
      renderChrome();
      return;
    }
```

- [ ] **Step 4: Path functions**

Add after `leaveSample()`:

```js
function pathStatus(body) {
  const words = [body.hostNote, body.headline].filter(Boolean).join(" ");
  return sample ? `sample, not the account. ${words}` : words;
}

function syncLoadBalancers(list, selected) {
  const shown = [...lbSelect.options].map((option) => option.value).join();
  if (shown !== list.map((item) => item.arn).join()) {
    lbSelect.replaceChildren(
      ...list.map((item) => {
        const option = document.createElement("option");
        option.value = item.arn;
        option.textContent = item.name;
        return option;
      }),
    );
  }
  if (selected && lbSelect.value !== selected) lbSelect.value = selected;
}

async function pullPath() {
  if (pathPulling) {
    pathAgain = true;
    return;
  }
  pathPulling = true;
  const wasSample = sample;
  try {
    const query = new URLSearchParams({ lb: lbSelect.value || "", host: hostInput.value.trim() });
    const response = await fetch(`${wasSample ? "/api/path-sample" : "/api/path"}?${query}`);
    const body = await response.json();
    if (body.stale || mode !== "path" || wasSample !== sample) return;
    pathData = body;
    syncLoadBalancers(body.loadBalancers || [], body.selected || "");
    if (pathSelected && !body.diagram?.nodes?.some((node) => node.id === pathSelected)) pathSelected = null;
    setStatus(ui, body.error ? "" : pathStatus(body));
    errorEl.hidden = !body.error;
    errorEl.textContent = body.error || "";
    renderChrome();
    draw();
  } catch {
    errorEl.hidden = false;
    errorEl.textContent = "the page failed";
  } finally {
    pathPulling = false;
    if (pathAgain) {
      pathAgain = false;
      pullPath();
    }
  }
}

function dropSample() {
  if (!sample) return;
  sample = false;
  ui.sample = false;
  regionSelect.disabled = false;
}

function enterPath() {
  dropSample();
  mode = "path";
  pathData = null;
  pathSelected = null;
  pathButton.textContent = "Map";
  lbSelect.hidden = false;
  hostInput.hidden = false;
  clickGround(ui);
  setStatus(ui, "reading the path");
  renderChrome();
  draw();
  pullPath();
}

function leavePath() {
  dropSample();
  mode = "map";
  pathData = null;
  pathSelected = null;
  pathButton.textContent = "Path";
  lbSelect.hidden = true;
  hostInput.hidden = true;
  setStatus(ui, "");
  renderChrome();
  pull();
}
```

- [ ] **Step 5: Sample in Path mode**

At the very top of `toggleSample()`, insert:

```js
  if (mode === "path") {
    sample = !sample;
    ui.sample = sample;
    regionSelect.disabled = sample;
    pathData = null;
    pathSelected = null;
    lbSelect.replaceChildren();
    setStatus(ui, sample ? "sample, not the account" : "reading the path");
    renderChrome();
    draw();
    pullPath();
    return;
  }
```

- [ ] **Step 6: Clicks, keys, region, controls, refresh**

At the top of the canvas `click` listener body, before `if (!place) {`, insert:

```js
  if (mode === "path") {
    const hit = nodeAt(placedPath(), event.offsetX, event.offsetY);
    pathSelected = hit?.id || null;
    draw();
    return;
  }
```

At the top of the `keydown` listener body, insert:

```js
  if (mode === "path") return;
```

In the region `change` listener, after `await pull();`, add:

```js
  if (mode === "path") {
    pathData = null;
    pathSelected = null;
    lbSelect.replaceChildren();
    hostInput.value = "";
    await pullPath();
  }
```

After the `sampleButton` click listener, add:

```js
pathButton.addEventListener("click", () => {
  if (mode === "path") leavePath();
  else enterPath();
});

lbSelect.addEventListener("change", () => {
  hostInput.value = "";
  pathSelected = null;
  pullPath();
});

hostInput.addEventListener("change", () => {
  pathSelected = null;
  pullPath();
});

setInterval(() => {
  if (mode === "path") pullPath();
}, 15_000);
```

- [ ] **Step 7: Run the suite**

Run: `npm test`
Expected: `fail 0`.

- [ ] **Step 8: Write `scripts/verify-path.mjs`**

```js
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const page = process.env.CLOUDSPIDER_URL || "http://127.0.0.1:9241/";
const port = 9333;
const dir = await mkdtemp(join(tmpdir(), "cloudspider-chrome-"));
const child = spawn(
  chrome,
  ["--headless=new", "--disable-gpu", "--no-first-run", "--window-size=1440,900", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, page],
  { stdio: "ignore" },
);
const failures = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

async function socketUrl() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const found = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (found) return found.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("chrome did not open a page");
}

const ws = new WebSocket(await socketUrl());
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});
let next = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (!msg.id || !pending.has(msg.id)) return;
  const { resolve, reject } = pending.get(msg.id);
  pending.delete(msg.id);
  if (msg.error) reject(new Error(JSON.stringify(msg.error)));
  else resolve(msg.result);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
async function js(expression) {
  const out = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.text || "page error");
  return out.result.value;
}
const waitFor = (test, ms = 20000) =>
  js(`new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const value = (${test})();
      if (value || Date.now() - start > ${ms}) resolve(Boolean(value));
      else setTimeout(tick, 100);
    };
    tick();
  })`);
const status = () => js(`document.querySelector("#status").textContent`);

try {
  await send("Page.enable");
  await waitFor(`() => document.querySelector("#region").options.length || !document.querySelector("#error").hidden`);
  await js(`(() => {
    window.__calls = [];
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      window.__calls.push(String(url) + " " + ((opts && opts.method) || "GET"));
      return real(url, opts);
    };
  })()`);

  await js(`document.querySelector("#path").click()`);
  const read = await waitFor(`() => {
    const text = document.querySelector("#status").textContent;
    return (text && text !== "reading the path") || !document.querySelector("#error").hidden;
  }`);
  check("Path reads the live region", read, `${await status()} ${await js(`document.querySelector("#error").textContent`)}`);
  check("Path shows the load balancer menu and host box", await js(`!document.querySelector("#lb").hidden && !document.querySelector("#host").hidden`));
  check("the Path button reads Map", (await js(`document.querySelector("#path").textContent`)) === "Map");

  await js(`document.querySelector("#sample").click()`);
  check("Sample in Path says it is a sample", await waitFor(`() => document.querySelector("#status").textContent.startsWith("sample, not the account.")`), await status());
  check("the region menu is disabled during Sample", await js(`document.querySelector("#region").disabled`));

  await js(`(() => {
    const box = document.querySelector("#host");
    box.value = "api.sample.test";
    box.dispatchEvent(new Event("change"));
  })()`);
  check(
    "the pasted host names the blocking security group",
    await waitFor(`() => document.querySelector("#status").textContent.includes("sample-sg-node-b does not allow tcp 8080")`),
    await status(),
  );

  const point = await js(`(async () => {
    const { layoutPath } = await import("/path-layout.js");
    const body = await fetch("/api/path-sample?host=api.sample.test").then((r) => r.json());
    const node = layoutPath(body.diagram).nodes.find((item) => item.kind === "target" && item.status === "hang");
    const rect = document.querySelector("#place").getBoundingClientRect();
    return { x: rect.left + node.x + 20, y: rect.top + node.y + 20 };
  })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(300);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile("/tmp/cloudspider-path.png", Buffer.from(shot.data, "base64"));
  console.log("screenshot /tmp/cloudspider-path.png");

  const writes = await js(`window.__calls.filter((line) => line.includes("/api/stop") || line.includes("/api/start") || line.endsWith("POST"))`);
  check("Path sent no POST", writes.length === 0, writes.join(", "));

  await js(`document.querySelector("#path").click()`);
  await sleep(500);
  check("leaving Path hides its controls", await js(`document.querySelector("#lb").hidden && document.querySelector("#host").hidden`));
  check("leaving Path enables the region menu", await js(`!document.querySelector("#region").disabled`));
  check("the button reads Path again", (await js(`document.querySelector("#path").textContent`)) === "Path");
} finally {
  ws.close();
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures.length) {
  console.log(`${failures.length} checks failed`);
  process.exit(1);
}
console.log("all checks passed");
```

- [ ] **Step 9: Restart the page and run the check**

```bash
lsof -ti tcp:9241 | xargs kill 2>/dev/null; sleep 1
AWS_PROFILE=default AWS_REGION=eu-north-1 CLOUDSPIDER_LOG_GROUP=/cloudspider/test npm start &
sleep 4
node scripts/verify-path.mjs
```

Expected: every line starts with `ok`, then `all checks passed`. The live region has no load balancers, so the first check's detail reads `eu-north-1 has no load balancers`. Open `/tmp/cloudspider-path.png` and confirm you can see seven columns, a red thread into the `10.0.12.31:8080` box, and its sentence beside it. If a check fails, fix the code, not the check.

Leave the server running for the owner.

- [ ] **Step 10: README**

Append these two lines to `README.md`. Keep it at 10 lines or fewer:

```
Path follows a request: load balancer, listener, rule, target group, target, node, EKS cluster.
It names the first broken or hanging edge. Paste a URL or host to follow one rule. Path only reads.
```

- [ ] **Step 11: Final suite and read-only check**

```bash
npm test
rg -n "\b[A-Z][A-Za-z0-9]*Command\b" src/aws-path.js | rg -v "Describe|List|GetMetricData"
rg -n "—" src/path-*.js src/aws-path.js README.md
```

Expected: `fail 0`, and both `rg` lines print nothing.

- [ ] **Step 12: Commit**

```bash
git add src/browser.js scripts/verify-path.mjs README.md
git commit -m "Add the Path view to the page with a sample path and a Chrome check."
```

## Live check (owner, not for the bot)

The test account has no load balancer or EKS cluster. To see Path on real data, the owner can add a small ALB to the Pulumi stack in `infra/`. It needs two public subnets in two zones, an instance target group on the running tagged instance with a tiny web server, and a second target group whose security group does not allow the port. An ALB costs about $0.60 a day plus traffic. A real EKS cluster costs about $2.40 a day for the control plane before nodes. Decide this after reviewing the overnight result. It is not part of this plan.
