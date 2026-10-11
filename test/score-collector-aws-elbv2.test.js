import assert from "node:assert/strict";
import test from "node:test";
import { awsElbv2 } from "../src/score/collectors/aws-elbv2.js";
import { denied, fakeAws } from "./fixtures/fake-aws.js";

const LB = "arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/shop/1";
const TG = "arn:aws:elasticloadbalancing:eu-north-1:1:targetgroup/shop/2";

test("joins listeners, target groups and target health to each load balancer", async () => {
  const { clients } = fakeAws({
    DescribeLoadBalancersCommand: () => ({ LoadBalancers: [{ LoadBalancerArn: LB, LoadBalancerName: "shop", Type: "application", Scheme: "internet-facing" }] }),
    DescribeTargetGroupsCommand: () => ({ TargetGroups: [{ TargetGroupArn: TG, TargetGroupName: "shop", LoadBalancerArns: [LB] }, { TargetGroupArn: "other", LoadBalancerArns: [] }] }),
    DescribeListenersCommand: () => ({ Listeners: [{}, {}] }),
    DescribeTargetHealthCommand: () => ({ TargetHealthDescriptions: [{ Target: { Id: "10.0.1.5" }, TargetHealth: { State: "unhealthy", Reason: "Target.ResponseCodeMismatch" } }] }),
  });
  const rec = await awsElbv2.collect({ regions: ["eu-north-1"], clients });
  assert.equal(rec.status, "ok");
  assert.deepEqual(rec.fields.loadBalancers, [
    { arn: LB, name: "shop", type: "application", scheme: "internet-facing", region: "eu-north-1", listeners: 2, targetGroups: [{ arn: TG, name: "shop", targets: [{ id: "10.0.1.5", state: "unhealthy", reason: "Target.ResponseCodeMismatch" }] }] },
  ]);
});

test("denied target health makes the record denied and names that read", async () => {
  const { clients } = fakeAws({
    DescribeLoadBalancersCommand: () => ({ LoadBalancers: [{ LoadBalancerArn: LB }] }),
    DescribeTargetGroupsCommand: () => ({ TargetGroups: [{ TargetGroupArn: TG, LoadBalancerArns: [LB] }] }),
    DescribeListenersCommand: () => ({ Listeners: [] }),
    DescribeTargetHealthCommand: denied,
  });
  const rec = await awsElbv2.collect({ regions: ["eu-north-1"], clients });
  assert.equal(rec.status, "denied");
  assert.equal(rec.read, "elasticloadbalancing:DescribeTargetHealth");
});

test("a region with no load balancers makes no further calls", async () => {
  const { clients, calls } = fakeAws({ DescribeLoadBalancersCommand: () => ({ LoadBalancers: [] }) });
  const rec = await awsElbv2.collect({ regions: ["eu-north-1"], clients });
  assert.deepEqual(rec.fields.loadBalancers, []);
  assert.equal(calls.length, 1);
});
