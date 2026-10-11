// Load balancers, listener counts, target groups and target health in every
// scanned region (elasticloadbalancing:Describe*).
import {
  DescribeListenersCommand,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import { awsFailure, evidence, pageAll, worst } from "../evidence.js";

export const awsElbv2 = {
  key: "aws-elbv2",
  target: "aws",
  reads: [
    "elasticloadbalancing:DescribeLoadBalancers",
    "elasticloadbalancing:DescribeListeners",
    "elasticloadbalancing:DescribeTargetGroups",
    "elasticloadbalancing:DescribeTargetHealth",
  ],
  async collect({ regions, clients }) {
    const loadBalancers = [];
    const statuses = [];
    let error = null;
    let read = "elasticloadbalancing:DescribeLoadBalancers";
    const note = (status, err, which) => {
      statuses.push(status);
      if (status !== "ok" && !error) {
        error = err || null;
        read = which;
      }
    };
    for (const region of regions) {
      const elb = clients.elb(region);
      const lbs = await pageAll(async (Marker) => {
        const out = await elb.send(new DescribeLoadBalancersCommand({ Marker }));
        return { items: out.LoadBalancers || [], next: out.NextMarker };
      });
      note(lbs.status, lbs.error, "elasticloadbalancing:DescribeLoadBalancers");
      if (!lbs.items.length) continue;
      const tgs = await pageAll(async (Marker) => {
        const out = await elb.send(new DescribeTargetGroupsCommand({ Marker }));
        return { items: out.TargetGroups || [], next: out.NextMarker };
      });
      note(tgs.status, tgs.error, "elasticloadbalancing:DescribeTargetGroups");
      for (const lb of lbs.items) {
        const listeners = await pageAll(async (Marker) => {
          const out = await elb.send(new DescribeListenersCommand({ LoadBalancerArn: lb.LoadBalancerArn, Marker }));
          return { items: out.Listeners || [], next: out.NextMarker };
        });
        note(listeners.status, listeners.error, "elasticloadbalancing:DescribeListeners");
        const targetGroups = [];
        for (const tg of tgs.items.filter((t) => (t.LoadBalancerArns || []).includes(lb.LoadBalancerArn))) {
          let targets = [];
          try {
            const out = await elb.send(new DescribeTargetHealthCommand({ TargetGroupArn: tg.TargetGroupArn }));
            targets = (out.TargetHealthDescriptions || []).map((t) => ({ id: t.Target?.Id || "", state: t.TargetHealth?.State || "unknown", reason: t.TargetHealth?.Reason || "" }));
          } catch (failure) {
            const f = awsFailure(failure);
            note(f.status, f.error, "elasticloadbalancing:DescribeTargetHealth");
          }
          targetGroups.push({ arn: tg.TargetGroupArn, name: tg.TargetGroupName || "", targets });
        }
        loadBalancers.push({
          arn: lb.LoadBalancerArn,
          name: lb.LoadBalancerName || "",
          type: lb.Type || "application",
          scheme: lb.Scheme || "",
          region,
          listeners: listeners.items.length,
          targetGroups,
        });
      }
    }
    return evidence({ key: "aws-elbv2", collector: "aws-elbv2", read, target: "aws", status: worst(statuses), fields: { loadBalancers }, error });
  },
};
