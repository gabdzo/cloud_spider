import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { DescribeLoadBalancersCommand, DescribeTagsCommand, DescribeTargetGroupsCommand, ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { inheritTags, stackTags } from "../tags.js";
import { readAddon } from "../eks-addons.js";
import { alarmSet, insightsGroups } from "./plan.js";

// Observability for the EKS cluster from upgrades/eks. Stack: observability.
//   - containerInsights=on: the CloudWatch Observability EKS add-on (the
//     CloudWatch agent + Fluent Bit: Container Insights metrics, container
//     logs, dashboards), its credentials through EKS Pod Identity
//     (amazon-cloudwatch/cloudwatch-agent, CloudWatchAgentServerPolicy), and
//     its four log groups created first with retentionDays (default 7).
//   - alarms=on: an SNS topic; per ALB of the cluster (tag
//     elbv2.k8s.aws/cluster) 5XX alarms and an unhealthy-target alarm per
//     target group; with Container Insights a node-not-ready alarm.
//     alertEmail: an email subscription (opt-in; AWS mails a confirm link).
// Cost: Container Insights ~$0.30-0.60/day on a 2-node demo (metrics +
// log ingestion $0.50/GB); alarms $0.10/month each; SNS email free (1000/mo).
inheritTags(pulumi, stackTags("observability"));
const config = new pulumi.Config();
const clusterName = config.get("clusterName") || "cloudspider-up";
const containerInsights = (config.get("containerInsights") || "off") === "on";
const alarms = (config.get("alarms") || "off") === "on";
const alertEmail = config.get("alertEmail") || "";
const retentionDays = Number(config.get("retentionDays") || 7);
const region = aws.config.region || process.env.AWS_REGION || "eu-north-1";
const tags = { cloudspider: "expendable", cluster: clusterName };

if (alertEmail && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(alertEmail)) throw new Error("alertEmail must be an email address");

if (containerInsights) {
  const groups = insightsGroups(clusterName).map((name) => new aws.cloudwatch.LogGroup(name.split("/").pop(), { name, retentionInDays: retentionDays, tags }));
  const role = new aws.iam.Role("cloudwatch-agent", {
    assumeRolePolicy: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "pods.eks.amazonaws.com" }, Action: ["sts:AssumeRole", "sts:TagSession"] }] }),
    tags,
  });
  new aws.iam.RolePolicyAttachment("cloudwatch-agent", { role: role.name, policyArn: "arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy" });
  const existing = await readAddon(aws.eks.getAddon, clusterName, "amazon-cloudwatch-observability");
  if (existing.exists && existing.project && existing.project !== "observability") throw new Error(`amazon-cloudwatch-observability belongs to ${existing.project}; this stack leaves it alone`);
  new aws.eks.Addon("cloudwatch-observability", {
    clusterName,
    addonName: "amazon-cloudwatch-observability",
    resolveConflictsOnCreate: "OVERWRITE",
    podIdentityAssociations: [{ roleArn: role.arn, serviceAccount: "cloudwatch-agent" }],
    tags: { ...tags, project: "observability" },
  }, { dependsOn: groups });
}

let topicArn = pulumi.output("");
let alarmNames = [];
if (alarms) {
  const topic = new aws.sns.Topic("alerts", { name: `${clusterName}-alerts`, tags });
  topicArn = topic.arn;
  if (alertEmail) new aws.sns.TopicSubscription("alerts-email", { topic: topic.arn, protocol: "email", endpoint: alertEmail });
  const elb = new ElasticLoadBalancingV2Client({ region });
  const all = (await elb.send(new DescribeLoadBalancersCommand({}))).LoadBalancers || [];
  const lbs = [];
  for (let i = 0; i < all.length; i += 20) {
    const chunk = all.slice(i, i + 20);
    const described = (await elb.send(new DescribeTagsCommand({ ResourceArns: chunk.map((l) => l.LoadBalancerArn) }))).TagDescriptions || [];
    for (const d of described) {
      if (!(d.Tags || []).some((t) => t.Key === "elbv2.k8s.aws/cluster" && t.Value === clusterName)) continue;
      const lb = chunk.find((l) => l.LoadBalancerArn === d.ResourceArn);
      if (lb.Type !== "application") continue;
      const tgs = (await elb.send(new DescribeTargetGroupsCommand({ LoadBalancerArn: lb.LoadBalancerArn }))).TargetGroups || [];
      lbs.push({ name: lb.LoadBalancerName, suffix: lb.LoadBalancerArn.split(":loadbalancer/")[1], targetGroups: tgs.map((t) => t.TargetGroupArn.split(":").pop()) });
    }
  }
  for (const a of alarmSet(clusterName, lbs, { insights: containerInsights })) {
    new aws.cloudwatch.MetricAlarm(a.key, {
      name: a.name, alarmDescription: a.description, namespace: a.namespace, metricName: a.metric, statistic: a.statistic,
      period: a.period, evaluationPeriods: a.evaluationPeriods, threshold: a.threshold, comparisonOperator: "GreaterThanThreshold",
      dimensions: a.dimensions, treatMissingData: "notBreaching", alarmActions: [topic.arn], okActions: [topic.arn], tags,
    });
    alarmNames.push(a.name);
  }
}

export const alertTopic = topicArn;
export const alarmCount = alarmNames.length;
export const insights = containerInsights;
