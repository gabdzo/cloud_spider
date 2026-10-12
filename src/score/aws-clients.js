// AWS SDK clients for the scanner: read calls only, adaptive retry, one
// client per service and region, reused across collectors in a scan.
import { EC2Client } from "@aws-sdk/client-ec2";
import { ElasticLoadBalancingV2Client } from "@aws-sdk/client-elastic-load-balancing-v2";
import { EKSClient } from "@aws-sdk/client-eks";
import { RDSClient } from "@aws-sdk/client-rds";
import { CloudTrailClient } from "@aws-sdk/client-cloudtrail";
import { CloudWatchClient } from "@aws-sdk/client-cloudwatch";
import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { Route53Client } from "@aws-sdk/client-route-53";
import { CloudFrontClient } from "@aws-sdk/client-cloudfront";
import { ACMClient } from "@aws-sdk/client-acm";
import { ECRClient } from "@aws-sdk/client-ecr";
import { BackupClient } from "@aws-sdk/client-backup";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";

const RETRY = { maxAttempts: 5, retryMode: "adaptive" };

export function createScanClients({ extra = {} } = {}) {
  const cache = new Map();
  const make = (name, Client, region) => {
    const id = `${name}:${region}`;
    if (!cache.has(id)) cache.set(id, new Client({ region, ...RETRY }));
    return cache.get(id);
  };
  return {
    ec2: (region) => make("ec2", EC2Client, region),
    elb: (region) => make("elb", ElasticLoadBalancingV2Client, region),
    eks: (region) => make("eks", EKSClient, region),
    rds: (region) => make("rds", RDSClient, region),
    trail: (region) => make("trail", CloudTrailClient, region),
    cw: (region) => make("cw", CloudWatchClient, region),
    logs: (region) => make("logs", CloudWatchLogsClient, region),
    // Global services: one client, us-east-1.
    r53: () => make("r53", Route53Client, "us-east-1"),
    cf: () => make("cf", CloudFrontClient, "us-east-1"),
    acm: (region) => make("acm", ACMClient, region),
    ecr: (region) => make("ecr", ECRClient, region),
    backup: (region) => make("backup", BackupClient, region),
    sts: (region) => make("sts", STSClient, region),
    ...extra,
  };
}

// The scanning account's id (STS GetCallerIdentity), once per client set.
export function accountOf(clients, region) {
  let memo = null;
  return () => (memo ??= clients.sts(region).send(new GetCallerIdentityCommand({})).then((out) => out.Account || "").catch(() => ""));
}
