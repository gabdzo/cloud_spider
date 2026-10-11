import assert from "node:assert/strict";
import test from "node:test";
import { awsEvaluators as E } from "../src/score/evaluators/aws.js";

const rule = (from, to, cidrs = ["0.0.0.0/0"], protocol = "tcp") => ({ protocol, from, to, cidrs, ipv6: [], groupIds: [] });
const sg = (id, ingress) => ({ id, region: "eu-north-1", ingress });

test("admin ports: 22, 3389 and 10250 open to the internet fail; ranges and all-traffic count", () => {
  const groups = [sg("a", [rule(443, 443)]), sg("b", [rule(22, 22)]), sg("c", [rule(10000, 11000)]), sg("d", [rule(-1, -1, ["0.0.0.0/0"], "-1")]), sg("e", [rule(22, 22, ["10.0.0.0/8"])])];
  assert.deepEqual(E["sg-no-open-admin-ports"]({ data: { "aws-network": { groups } } }).items.map((i) => i.pass), [true, false, false, false, true]);
});

test("rds-not-public needs both the public flag and an open group on its port", () => {
  const groups = [sg("open", [rule(5432, 5432)]), sg("closed", [rule(5432, 5432, ["10.0.0.0/16"])])];
  const db = (id, pub, sgId) => ({ id, region: "eu-north-1", public: pub, port: 5432, securityGroups: [sgId] });
  const out = E["rds-not-public"]({ data: { "aws-rds": { instances: [db("x", true, "open"), db("y", false, "open"), db("z", true, "closed")] }, "aws-network": { groups } } });
  assert.deepEqual(out.items.map((i) => i.pass), [false, true, true]);
});

test("load balancers: zero healthy targets fail; no listeners is not judged", () => {
  const lb = (name, listeners, states) => ({ name, region: "r", listeners, targetGroups: [{ targets: states.map((state) => ({ state, reason: state === "healthy" ? "" : "Target.Timeout" })) }] });
  const out = E["lb-has-healthy-targets"]({ data: { "aws-elbv2": { loadBalancers: [lb("a", 1, ["unhealthy"]), lb("b", 1, ["healthy", "unhealthy"]), lb("c", 0, ["unhealthy"])] } } });
  assert.deepEqual(out.items.map((i) => [i.id, i.pass]), [["r/a", false], ["r/b", true]]);
  assert.match(out.items[0].detail, /0 of 1 targets healthy \(Target.Timeout\)/);
});

test("EKS status and endpoint; CloudTrail needs one good trail", () => {
  const clusters = [{ name: "a", region: "r", status: "ACTIVE", endpointPublic: true, publicCidrs: ["0.0.0.0/0"] }, { name: "b", region: "r", status: "UPDATING", endpointPublic: true, publicCidrs: ["203.0.113.0/24"] }];
  assert.deepEqual(E["eks-active"]({ data: { "aws-eks": { clusters } } }).items.map((i) => i.pass), [true, false]);
  assert.deepEqual(E["eks-endpoint-restricted"]({ data: { "aws-eks": { clusters } } }).items.map((i) => i.pass), [false, true]);
  assert.equal(E["cloudtrail-on"]({ data: { "aws-cloudtrail": { trails: [{ name: "t", multiRegion: true, logging: false, management: true }] } } }).items[0].pass, false);
});

test("RDS Multi-AZ, encryption and backups", () => {
  const instances = [{ id: "a", region: "r", multiAz: true, encrypted: false, backupDays: 7 }, { id: "b", region: "r", multiAz: false, encrypted: true, backupDays: 1 }];
  const d = { "aws-rds": { instances } };
  assert.deepEqual(E["rds-multi-az"]({ data: d }).items.map((i) => i.pass), [true, false]);
  assert.deepEqual(E["rds-encrypted"]({ data: d }).items.map((i) => i.pass), [false, true]);
  assert.deepEqual(E["rds-backups-7d"]({ data: d }).items.map((i) => i.pass), [true, false]);
});

test("5XX alarm per internet-facing ALB, matched on the LoadBalancer dimension; log retention", () => {
  const lb = { name: "shop", region: "r", type: "application", scheme: "internet-facing", arn: "arn:aws:elasticloadbalancing:r:1:loadbalancer/app/shop/abc" };
  const alarm = (actions) => ({ region: "r", namespace: "AWS/ApplicationELB", metric: "HTTPCode_ELB_5XX_Count", dimensions: { LoadBalancer: "app/shop/abc" }, actions });
  const run = (alarms) => E["lb-5xx-alarm"]({ data: { "aws-alarms": { alarms }, "aws-elbv2": { loadBalancers: [lb, { ...lb, scheme: "internal", name: "in" }] } } }).items;
  assert.deepEqual(run([alarm(1)]).map((i) => [i.id, i.pass]), [["r/shop", true]]);
  assert.equal(run([alarm(0)])[0].pass, false);
  assert.deepEqual(E["log-retention"]({ data: { "aws-loggroups": { logGroups: [{ name: "a", region: "r", retentionDays: 7 }, { name: "b", region: "r", retentionDays: null }] } } }).items.map((i) => i.pass), [true, false]);
});
