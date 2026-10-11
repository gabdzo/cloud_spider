// N10 (docs/design/network-debugging.md §8): what the account-side NET-*
// controls read. Route 53 and CloudFront are global (read once); load
// balancer edges and the VPC network are read per scanned region. Every
// call is a Describe/List; records are shaped by the netdebug readers'
// helpers so SNIFF's DEBUG and a scan see the same resource the same way.
import { ListHostedZonesCommand, ListResourceRecordSetsCommand } from "@aws-sdk/client-route-53";
import { ListDistributionsCommand } from "@aws-sdk/client-cloudfront";
import { DescribeListenersCommand, DescribeLoadBalancersCommand, DescribeTargetGroupsCommand, DescribeTargetHealthCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { DescribeFlowLogsCommand, DescribeNetworkAclsCommand, DescribeSubnetsCommand } from "@aws-sdk/client-ec2";
import { DescribeCertificateCommand, ListCertificatesCommand } from "@aws-sdk/client-acm";
import { distributionFrom, flowLogFrom, naclFrom, recordFrom } from "../../netdebug/aws-readers.js";
import { awsFailure, evidence, pageAll, worst } from "../evidence.js";

const MAX_ZONES_PAGES = 5; // 500 zones
const MAX_RECORD_PAGES = 4; // 1200 records per zone

// Collects the status of several reads into one evidence record.
function tracker(first) {
  const statuses = [];
  let error = null;
  let read = first;
  return {
    note(got, which) {
      statuses.push(got.status);
      if (got.status !== "ok" && !error) {
        error = got.error || null;
        read = which;
      }
    },
    done: (key, collector, fields) => evidence({ key, collector, read, target: "aws", status: worst(statuses), fields, error }),
  };
}

export const awsRoute53 = {
  key: "aws-route53",
  target: "aws",
  reads: ["route53:ListHostedZones", "route53:ListResourceRecordSets"],
  async collect({ clients }) {
    const t = tracker("route53:ListHostedZones");
    const r53 = clients.r53();
    const zones = await pageAll(async (Marker) => {
      const out = await r53.send(new ListHostedZonesCommand({ Marker, MaxItems: 100 }));
      return { items: out.HostedZones || [], next: out.IsTruncated ? out.NextMarker : undefined };
    }, { maxPages: MAX_ZONES_PAGES });
    t.note(zones, "route53:ListHostedZones");
    const records = [];
    for (const z of zones.items) {
      const zone = z.Name || "";
      const got = await pageAll(async (start) => {
        const out = await r53.send(new ListResourceRecordSetsCommand({ HostedZoneId: z.Id, MaxItems: 300, ...(start || {}) }));
        return { items: out.ResourceRecordSets || [], next: out.IsTruncated ? { StartRecordName: out.NextRecordName, StartRecordType: out.NextRecordType, StartRecordIdentifier: out.NextRecordIdentifier } : undefined };
      }, { maxPages: MAX_RECORD_PAGES });
      t.note(got, "route53:ListResourceRecordSets");
      for (const r of got.items) records.push({ zone, private: z.Config?.PrivateZone === true, ...recordFrom(r) });
    }
    return t.done("aws-route53", "aws-route53", { zones: zones.items.map((z) => ({ id: String(z.Id || "").replace(/^\/hostedzone\//, ""), name: z.Name || "", private: z.Config?.PrivateZone === true })), records });
  },
};

export const awsCloudfront = {
  key: "aws-cloudfront",
  target: "aws",
  reads: ["cloudfront:ListDistributions"],
  async collect({ clients }) {
    const t = tracker("cloudfront:ListDistributions");
    const cf = clients.cf();
    const got = await pageAll(async (Marker) => {
      const out = await cf.send(new ListDistributionsCommand({ Marker, MaxItems: 100 }));
      const list = out.DistributionList || {};
      return { items: list.Items || [], next: list.IsTruncated ? list.NextMarker : undefined };
    }, { maxPages: 10 });
    t.note(got, "cloudfront:ListDistributions");
    return t.done("aws-cloudfront", "aws-cloudfront", { distributions: got.items.map(distributionFrom) });
  },
};

const redirectsToHttps = (actions = []) => actions.some((a) => a.Type === "redirect" && String(a.RedirectConfig?.Protocol || "").toUpperCase() === "HTTPS");

export const awsLbEdge = {
  key: "aws-lb-edge",
  target: "aws",
  reads: ["elasticloadbalancing:DescribeLoadBalancers", "elasticloadbalancing:DescribeListeners", "elasticloadbalancing:DescribeTargetGroups", "elasticloadbalancing:DescribeTargetHealth"],
  async collect({ regions, clients }) {
    const t = tracker("elasticloadbalancing:DescribeLoadBalancers");
    const loadBalancers = [];
    for (const region of regions) {
      const elb = clients.elb(region);
      const lbs = await pageAll(async (Marker) => {
        const out = await elb.send(new DescribeLoadBalancersCommand({ Marker }));
        return { items: out.LoadBalancers || [], next: out.NextMarker };
      });
      t.note(lbs, "elasticloadbalancing:DescribeLoadBalancers");
      if (!lbs.items.length) continue;
      const tgs = await pageAll(async (Marker) => {
        const out = await elb.send(new DescribeTargetGroupsCommand({ Marker }));
        return { items: out.TargetGroups || [], next: out.NextMarker };
      });
      t.note(tgs, "elasticloadbalancing:DescribeTargetGroups");
      for (const lb of lbs.items) {
        const listeners = await pageAll(async (Marker) => {
          const out = await elb.send(new DescribeListenersCommand({ LoadBalancerArn: lb.LoadBalancerArn, Marker }));
          return { items: out.Listeners || [], next: out.NextMarker };
        });
        t.note(listeners, "elasticloadbalancing:DescribeListeners");
        const targetGroups = [];
        for (const tg of tgs.items.filter((x) => (x.LoadBalancerArns || []).includes(lb.LoadBalancerArn))) {
          let targets = [];
          try {
            const out = await elb.send(new DescribeTargetHealthCommand({ TargetGroupArn: tg.TargetGroupArn }));
            targets = (out.TargetHealthDescriptions || []).map((d) => d.Target?.Id || "").filter(Boolean);
          } catch (failure) {
            t.note(awsFailure(failure), "elasticloadbalancing:DescribeTargetHealth");
          }
          targetGroups.push({ name: tg.TargetGroupName || "", port: tg.Port ?? null, type: tg.TargetType || "instance", targets });
        }
        loadBalancers.push({
          region,
          name: lb.LoadBalancerName || "",
          dns: lb.DNSName || "",
          type: lb.Type || "application",
          scheme: lb.Scheme || "",
          vpcId: lb.VpcId || "",
          subnets: (lb.AvailabilityZones || []).map((z) => z.SubnetId).filter(Boolean),
          listeners: listeners.items.map((l) => ({ port: l.Port ?? null, protocol: l.Protocol || "", sslPolicy: l.SslPolicy || "", redirectHttps: redirectsToHttps(l.DefaultActions) })),
          targetGroups,
        });
      }
    }
    return t.done("aws-lb-edge", "aws-lb-edge", { loadBalancers });
  },
};

export const awsVpcNet = {
  key: "aws-vpc-net",
  target: "aws",
  reads: ["ec2:DescribeSubnets", "ec2:DescribeNetworkAcls", "ec2:DescribeFlowLogs"],
  async collect({ regions, clients }) {
    const t = tracker("ec2:DescribeSubnets");
    const subnets = [];
    const nacls = [];
    const flowLogs = [];
    for (const region of regions) {
      const ec2 = clients.ec2(region);
      const s = await pageAll(async (NextToken) => {
        const out = await ec2.send(new DescribeSubnetsCommand({ NextToken }));
        return { items: out.Subnets || [], next: out.NextToken };
      });
      t.note(s, "ec2:DescribeSubnets");
      for (const x of s.items) {
        const keys = (x.Tags || []).map((tag) => tag.Key || "");
        subnets.push({ region, id: x.SubnetId, vpcId: x.VpcId || "", cidr: x.CidrBlock || "", free: x.AvailableIpAddressCount ?? null, k8s: keys.some((k) => k.startsWith("kubernetes.io/cluster/") || k.startsWith("kubernetes.io/role/")) });
      }
      const n = await pageAll(async (NextToken) => {
        const out = await ec2.send(new DescribeNetworkAclsCommand({ NextToken }));
        return { items: out.NetworkAcls || [], next: out.NextToken };
      });
      t.note(n, "ec2:DescribeNetworkAcls");
      for (const x of n.items) nacls.push({ region, ...naclFrom(x) });
      const f = await pageAll(async (NextToken) => {
        const out = await ec2.send(new DescribeFlowLogsCommand({ NextToken }));
        return { items: out.FlowLogs || [], next: out.NextToken };
      });
      t.note(f, "ec2:DescribeFlowLogs");
      for (const x of f.items) flowLogs.push({ region, ...flowLogFrom(x) });
    }
    return t.done("aws-vpc-net", "aws-vpc-net", { subnets, nacls, flowLogs });
  },
};

// NET-TLS-001: ACM certificates in the scanned regions plus us-east-1 (where
// CloudFront's live). ListCertificates without Includes only returns RSA
// 1024/2048, so every key type is asked for. Only certificates in use are
// described (InUseBy, NotAfter), at most MAX_DESCRIBE.
const KEY_TYPES = ["RSA_1024", "RSA_2048", "RSA_3072", "RSA_4096", "EC_prime256v1", "EC_secp384r1", "EC_secp521r1"];
const MAX_DESCRIBE = 300;
export const awsAcm = {
  key: "aws-acm",
  target: "aws",
  reads: ["acm:ListCertificates", "acm:DescribeCertificate"],
  async collect({ regions, clients }) {
    const t = tracker("acm:ListCertificates");
    const certificates = [];
    let described = 0;
    for (const region of [...new Set([...regions, "us-east-1"])]) {
      const acm = clients.acm(region);
      const list = await pageAll(async (NextToken) => {
        const out = await acm.send(new ListCertificatesCommand({ NextToken, MaxItems: 100, Includes: { keyTypes: KEY_TYPES } }));
        return { items: out.CertificateSummaryList || [], next: out.NextToken };
      }, { maxPages: 10 });
      t.note(list, "acm:ListCertificates");
      for (const summary of list.items.filter((c) => c.InUse !== false)) {
        if (described >= MAX_DESCRIBE) {
          t.note({ status: "truncated" }, "acm:DescribeCertificate");
          break;
        }
        described += 1;
        try {
          const c = (await acm.send(new DescribeCertificateCommand({ CertificateArn: summary.CertificateArn }))).Certificate || {};
          certificates.push({ region, arn: c.CertificateArn || summary.CertificateArn, domain: c.DomainName || summary.DomainName || "", type: c.Type || "", notAfter: c.NotAfter ? new Date(c.NotAfter).toISOString() : null, inUseBy: c.InUseBy || [] });
        } catch (failure) {
          t.note(awsFailure(failure), "acm:DescribeCertificate");
        }
      }
    }
    return t.done("aws-acm", "aws-acm", { certificates });
  },
};
