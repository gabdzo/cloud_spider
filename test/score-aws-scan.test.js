import assert from "node:assert/strict";
import test from "node:test";
import { createScoreApi } from "../src/score/api.js";
import { loadCatalog } from "../src/score/catalog.js";
import { loadProfiles } from "../src/score/profiles.js";
import { createScanHistory } from "../src/score/history.js";
import { createMemoryStorage } from "../src/score/memory-storage.js";
import { fakeAws } from "./fixtures/fake-aws.js";

const ORIGIN = "http://127.0.0.1:9241";
// A small account: one public, open, single-AZ database (gate), one open SSH group,
// a healthy ALB, an ACTIVE cluster with a restricted endpoint, CloudTrail on.
const ACCOUNT = {
  DescribeSecurityGroupsCommand: () => ({ SecurityGroups: [
    { GroupId: "sg-db", IpPermissions: [{ IpProtocol: "tcp", FromPort: 5432, ToPort: 5432, IpRanges: [{ CidrIp: "0.0.0.0/0" }] }] },
    { GroupId: "sg-web", IpPermissions: [{ IpProtocol: "tcp", FromPort: 443, ToPort: 443, IpRanges: [{ CidrIp: "0.0.0.0/0" }] }] },
  ] }),
  DescribeLoadBalancersCommand: () => ({ LoadBalancers: [{ LoadBalancerArn: "lb", LoadBalancerName: "shop" }] }),
  DescribeTargetGroupsCommand: () => ({ TargetGroups: [{ TargetGroupArn: "tg", LoadBalancerArns: ["lb"] }] }),
  DescribeListenersCommand: () => ({ Listeners: [{}] }),
  DescribeTargetHealthCommand: () => ({ TargetHealthDescriptions: [{ Target: { Id: "i-1" }, TargetHealth: { State: "healthy" } }] }),
  ListClustersCommand: () => ({ clusters: ["prod"] }),
  DescribeClusterCommand: () => ({ cluster: { status: "ACTIVE", resourcesVpcConfig: { endpointPublicAccess: true, publicAccessCidrs: ["203.0.113.0/24"] } } }),
  ListNodegroupsCommand: () => ({ nodegroups: [] }),
  DescribeDBInstancesCommand: () => ({ DBInstances: [{ DBInstanceIdentifier: "shopdb", PubliclyAccessible: true, MultiAZ: false, StorageEncrypted: true, BackupRetentionPeriod: 7, Endpoint: { Port: 5432 }, VpcSecurityGroups: [{ VpcSecurityGroupId: "sg-db" }] }] }),
  DescribeTrailsCommand: () => ({ trailList: [{ Name: "org", TrailARN: "t", IsMultiRegionTrail: true }] }),
  GetTrailStatusCommand: () => ({ IsLogging: true }),
  GetEventSelectorsCommand: () => ({ EventSelectors: [{ IncludeManagementEvents: true, ReadWriteType: "All" }] }),
  DescribeAlarmsCommand: () => ({ MetricAlarms: [] }),
  DescribeLogGroupsCommand: () => ({ logGroups: [{ logGroupName: "/aws/eks/prod", retentionInDays: 7 }] }),
};

test("an AWS scan: a public open database is a failed gate → BLOCKED, the number still shown with it", async () => {
  const { clients, calls } = fakeAws(ACCOUNT);
  const api = createScoreApi({ app: {}, kubeFor: () => null, aws: { clients, regions: ["eu-north-1"] }, history: createScanHistory({ storage: createMemoryStorage() }), pageOrigin: ORIGIN, catalog: () => loadCatalog(), profiles: () => loadProfiles() });
  const out = await api.scan(ORIGIN, { target: "aws" });
  assert.equal(out.scan.card.verdict, "BLOCKED");
  assert.deepEqual(out.scan.card.gates.failed.sort(), ["AWS-REL-001", "AWS-SEC-001"]);
  assert.equal(out.scan.results.find((r) => r.id === "AWS-SEC-012").status, "PASS");
  assert.equal(out.scan.results.find((r) => r.id === "AWS-SEC-030").status, "NOT_ASSESSED");
  assert.ok(calls.every((c) => /^(Describe|List|Get)/.test(c.name)), "reads only");
  assert.equal((await api.view({ target: "aws" })).scan.id, out.scan.id);
});

test("no regions configured: the AWS scan says where to set them", async () => {
  const api = createScoreApi({ app: {}, kubeFor: () => null, history: createScanHistory({ storage: createMemoryStorage() }), pageOrigin: ORIGIN, catalog: () => loadCatalog(), profiles: () => loadProfiles() });
  assert.match((await api.scan(ORIGIN, { target: "aws" })).error, /scorecard.regions in cloudspider.yaml/);
});

test("scorecard.packs: a pack that is off does not scan; an unknown target is refused", async () => {
  const { clients, calls } = fakeAws(ACCOUNT);
  const history = createScanHistory({ storage: createMemoryStorage() });
  const api = createScoreApi({ app: {}, history, pageOrigin: ORIGIN, settings: { packs: ["kubernetes"] }, aws: { clients, regions: ["eu-north-1"] }, catalog: () => loadCatalog(), profiles: () => loadProfiles(), kubeFor: () => null });
  assert.match((await api.scan(ORIGIN, { target: "aws" })).error, /aws pack is off/);
  assert.equal(calls.length, 0);
  assert.match((await api.scan(ORIGIN, { target: "gcp" })).error, /kubernetes or aws/);
});
