// Cloud Spider's IaC guardrails as plain rules (Pulumi CrossGuard wraps them
// in index.js; tests call them directly). docs/iac-robustness-plan.md item 9.
// A rule: { name, description, enforcementLevel, check(type, props) -> [messages] }.

const OPEN = ["0.0.0.0/0", "::/0"];
const WEB_PORTS = [80, 443];
export const ALLOWED_INSTANCE_TYPES = [
  "t4g.small", "t4g.medium", "c6g.medium", "c7g.medium", "m6g.medium", "m7g.medium",
  "m7i-flex.2xlarge", "m7i.2xlarge", "c5.metal", "t3.micro", "t4g.micro", "t4g.nano",
];
export const ALLOWED_DB_CLASSES = ["db.t4g.micro", "db.t4g.small"];
export const MAX_NODES = 10;
const TAGGED = ["aws:ec2/vpc:Vpc", "aws:ec2/subnet:Subnet", "aws:eks/cluster:Cluster", "aws:eks/nodeGroup:NodeGroup", "aws:rds/instance:Instance", "aws:s3/bucket:Bucket", "aws:s3/bucketV2:BucketV2", "aws:iam/role:Role", "aws:cloudwatch/logGroup:LogGroup", "aws:ec2/securityGroup:SecurityGroup", "aws:ec2/instance:Instance"];

const openRule = (r) => [...(r.cidrBlocks || []), ...(r.ipv6CidrBlocks || []), r.cidrIpv4, r.cidrIpv6].some((c) => OPEN.includes(c));
const webOnly = (r) => WEB_PORTS.includes(Number(r.fromPort)) && Number(r.fromPort) === Number(r.toPort);

export const RULES = [
  {
    name: "required-project-tag",
    description: "Taggable AWS resources carry a project tag (a vault selects on it; cost reports group by it).",
    enforcementLevel: "advisory",
    check: (type, p) => (TAGGED.includes(type) && !(p.tags && p.tags.project) ? ["no tags.project (upgrades/tags.js inheritTags)"] : []),
  },
  {
    name: "no-public-rds",
    description: "RDS instances are never publicly accessible.",
    enforcementLevel: "mandatory",
    check: (type, p) => (type === "aws:rds/instance:Instance" && p.publiclyAccessible === true ? ["publiclyAccessible is true"] : []),
  },
  {
    name: "rds-encrypted",
    description: "RDS storage is encrypted.",
    enforcementLevel: "mandatory",
    check: (type, p) => (type === "aws:rds/instance:Instance" && p.storageEncrypted !== true ? ["storageEncrypted is not true"] : []),
  },
  {
    name: "no-open-ingress",
    description: "Security groups open to the internet only on 80/443.",
    enforcementLevel: "mandatory",
    check: (type, p) => {
      if (type === "aws:ec2/securityGroup:SecurityGroup") return (p.ingress || []).filter((r) => openRule(r) && !webOnly(r)).map((r) => `ingress ${r.fromPort}-${r.toPort} open to the internet`);
      if (type === "aws:ec2/securityGroupRule:SecurityGroupRule" && p.type === "ingress" && openRule(p) && !webOnly(p)) return [`ingress ${p.fromPort}-${p.toPort} open to the internet`];
      if (type === "aws:vpc/securityGroupIngressRule:SecurityGroupIngressRule" && openRule(p) && !webOnly(p)) return [`ingress ${p.fromPort}-${p.toPort} open to the internet`];
      return [];
    },
  },
  {
    name: "allowed-instance-types",
    description: "Only the small Graviton types (and the OpenShift hosts) the cost estimates know.",
    enforcementLevel: "mandatory",
    check: (type, p) => {
      const types = type === "aws:eks/nodeGroup:NodeGroup" ? p.instanceTypes || [] : ["aws:ec2/instance:Instance", "aws:ec2/launchTemplate:LaunchTemplate"].includes(type) && p.instanceType ? [p.instanceType] : [];
      return types.filter((t) => !ALLOWED_INSTANCE_TYPES.includes(t)).map((t) => `instance type ${t} is not allowed`);
    },
  },
  {
    name: "cost-caps",
    description: `Node groups at most ${MAX_NODES} nodes; RDS only ${ALLOWED_DB_CLASSES.join(", ")}.`,
    enforcementLevel: "mandatory",
    check: (type, p) => {
      if (type === "aws:eks/nodeGroup:NodeGroup" && Number(p.scalingConfig?.maxSize) > MAX_NODES) return [`maxSize ${p.scalingConfig.maxSize} > ${MAX_NODES}`];
      if (type === "aws:rds/instance:Instance" && p.instanceClass && !ALLOWED_DB_CLASSES.includes(p.instanceClass)) return [`instanceClass ${p.instanceClass} is not allowed`];
      return [];
    },
  },
];

export function violations(resources) {
  const out = [];
  for (const r of resources) for (const rule of RULES) for (const message of rule.check(r.type, r.inputs || r.props || {})) out.push({ rule: rule.name, level: rule.enforcementLevel, resource: `${r.type}::${r.name}`, message });
  return out;
}
