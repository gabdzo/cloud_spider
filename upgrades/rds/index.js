import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { inheritTags, stackTags } from "../tags.js";

// RDS PostgreSQL at the cheapest dev settings, in eu-north-1. Stack: rds.
//   - its own VPC (10.44.0.0/16) with two PRIVATE subnets: no internet
//     gateway, no NAT gateway (a NAT alone is ~$35/month), no public IP
//   - db.t4g.micro, 20 GB gp3, single-AZ, no backups kept, no final snapshot,
//     no deletion protection: Take it down deletes it, data included
//   - the master password is made and kept by RDS in Secrets Manager
//     (manageMasterUserPassword): it is never in Pulumi config or state
//   - port 5432 is open to the VPC's own range only
// About $0.02/h, $14.50/month while up (docs/plan-expansion.md).
// Vault: vaults/templates/rds.yaml selects project=rds.
inheritTags(pulumi, stackTags("rds"));

const config = new pulumi.Config();
const name = config.get("name") || "cloudspider-rds";
if (!/^[a-z][a-z0-9-]{1,27}$/.test(name)) throw new Error("name must be a short lowercase name");

const tags = { Name: name, cloudspider: "expendable" };
const cidr = "10.44.0.0/16";

const vpc = new aws.ec2.Vpc("rds", { cidrBlock: cidr, enableDnsHostnames: true, enableDnsSupport: true, tags });
const subnets = [
  ["a", "10.44.1.0/24", "eu-north-1a"],
  ["b", "10.44.2.0/24", "eu-north-1b"],
].map(([key, block, zone]) =>
  new aws.ec2.Subnet(`private-${key}`, {
    vpcId: vpc.id,
    cidrBlock: block,
    availabilityZone: zone,
    mapPublicIpOnLaunch: false,
    tags: { ...tags, Name: `${name}-private-${key}`, tier: "private" },
  }),
);

const group = new aws.ec2.SecurityGroup("rds", {
  vpcId: vpc.id,
  description: "PostgreSQL from inside the VPC only",
  ingress: [{ protocol: "tcp", fromPort: 5432, toPort: 5432, cidrBlocks: [cidr], description: "postgres from the VPC" }],
  egress: [],
  tags,
});

const subnetGroup = new aws.rds.SubnetGroup("rds", {
  name: `${name}-subnets`,
  subnetIds: subnets.map((item) => item.id),
  tags,
});

const db = new aws.rds.Instance("db", {
  identifier: name,
  engine: "postgres",
  engineVersion: "16",
  instanceClass: "db.t4g.micro",
  allocatedStorage: 20,
  storageType: "gp3",
  storageEncrypted: true,
  dbName: "app",
  username: "app_admin",
  manageMasterUserPassword: true,
  dbSubnetGroupName: subnetGroup.name,
  vpcSecurityGroupIds: [group.id],
  publiclyAccessible: false,
  multiAz: false,
  backupRetentionPeriod: 0,
  skipFinalSnapshot: true,
  deletionProtection: false,
  performanceInsightsEnabled: false,
  autoMinorVersionUpgrade: true,
  applyImmediately: true,
  copyTagsToSnapshot: true,
  tags,
});

export const endpoint = db.address;
export const port = db.port;
export const database = db.dbName;
export const user = db.username;
// The ARN of the RDS-managed secret (the value stays in Secrets Manager):
//   aws secretsmanager get-secret-value --secret-id <masterSecretArn>
export const masterSecretArn = db.masterUserSecrets.apply((items) => items?.[0]?.secretArn || "");
export const vpcId = vpc.id;
