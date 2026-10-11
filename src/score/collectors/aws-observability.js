// CloudWatch alarms (metric, dimensions, actions) and log group retention
// in every scanned region (cloudwatch:DescribeAlarms, logs:DescribeLogGroups).
import { DescribeAlarmsCommand } from "@aws-sdk/client-cloudwatch";
import { DescribeLogGroupsCommand } from "@aws-sdk/client-cloudwatch-logs";
import { evidence, pageAll, worst } from "../evidence.js";

export const awsObservability = {
  key: "aws-observability",
  target: "aws",
  reads: ["cloudwatch:DescribeAlarms", "logs:DescribeLogGroups"],
  async collect({ regions, clients }) {
    const alarms = [];
    const logGroups = [];
    const a = [];
    const l = [];
    let aErr = null;
    let lErr = null;
    for (const region of regions) {
      const got = await pageAll(async (NextToken) => {
        const out = await clients.cw(region).send(new DescribeAlarmsCommand({ NextToken, AlarmTypes: ["MetricAlarm"] }));
        return { items: out.MetricAlarms || [], next: out.NextToken };
      });
      a.push(got.status);
      aErr ||= got.error || null;
      for (const x of got.items) alarms.push({ name: x.AlarmName || "", region, metric: x.MetricName || "", namespace: x.Namespace || "", dimensions: Object.fromEntries((x.Dimensions || []).map((d) => [d.Name, d.Value])), actions: (x.AlarmActions || []).length });
      const groups = await pageAll(async (nextToken) => {
        const out = await clients.logs(region).send(new DescribeLogGroupsCommand({ nextToken }));
        return { items: out.logGroups || [], next: out.nextToken };
      });
      l.push(groups.status);
      lErr ||= groups.error || null;
      for (const g of groups.items) logGroups.push({ name: g.logGroupName || "", region, retentionDays: g.retentionInDays ?? null });
    }
    return [
      evidence({ key: "aws-alarms", collector: "aws-observability", read: "cloudwatch:DescribeAlarms", target: "aws", status: worst(a), fields: { alarms }, error: aErr }),
      evidence({ key: "aws-loggroups", collector: "aws-observability", read: "logs:DescribeLogGroups", target: "aws", status: worst(l), fields: { logGroups }, error: lErr }),
    ];
  },
};
