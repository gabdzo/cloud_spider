// Read-only AWS readers for netdebug (design §6.2: only Describe/List/Get
// and TestDNSAnswer). Route 53 and CloudFront are global. Answers are
// normalised to plain objects; errors come back as { error }.
import { GetHealthCheckStatusCommand, GetHostedZoneCommand, ListHostedZonesCommand, ListResourceRecordSetsCommand, Route53Client, TestDNSAnswerCommand } from "@aws-sdk/client-route-53";
import { CloudFrontClient, ListDistributionsCommand } from "@aws-sdk/client-cloudfront";

const RETRY = { maxAttempts: 4, retryMode: "adaptive" };
const fail = (err) => ({ error: `${err?.name || "Error"}: ${err?.message || String(err)}`.slice(0, 300) });
const id = (text) => String(text || "").replace(/^\/hostedzone\//, "");

export function recordFrom(r) {
  const policy = r.Failover ? "failover" : r.Weight != null ? "weighted" : r.Region ? "latency" : r.GeoLocation ? "geolocation" : r.MultiValueAnswer ? "multivalue" : "simple";
  return {
    name: String(r.Name || "").replace(/\\052/g, "*"),
    type: r.Type,
    ttl: r.TTL ?? null,
    values: (r.ResourceRecords || []).map((v) => v.Value),
    alias: r.AliasTarget ? { dnsName: r.AliasTarget.DNSName, zoneId: r.AliasTarget.HostedZoneId, evaluate: r.AliasTarget.EvaluateTargetHealth === true } : null,
    policy,
    setId: r.SetIdentifier || "",
    healthCheckId: r.HealthCheckId || "",
  };
}

export function createRoute53Reader({ client = new Route53Client({ region: "us-east-1", ...RETRY }) } = {}) {
  return {
    async zones() {
      try {
        const out = [];
        let marker;
        for (let i = 0; i < 10; i += 1) {
          const page = await client.send(new ListHostedZonesCommand({ Marker: marker, MaxItems: 100 }));
          for (const z of page.HostedZones || []) out.push({ id: id(z.Id), name: z.Name, private: z.Config?.PrivateZone === true, count: z.ResourceRecordSetCount ?? null });
          if (!page.IsTruncated) break;
          marker = page.NextMarker;
        }
        return { zones: out };
      } catch (err) {
        return fail(err);
      }
    },
    // Up to `max` records of the zone (the dangling check reads the zone).
    async records(zoneId, { max = 1000 } = {}) {
      try {
        const out = [];
        let start = {};
        while (out.length < max) {
          const page = await client.send(new ListResourceRecordSetsCommand({ HostedZoneId: zoneId, MaxItems: 300, ...start }));
          out.push(...(page.ResourceRecordSets || []).map(recordFrom));
          if (!page.IsTruncated) break;
          start = { StartRecordName: page.NextRecordName, StartRecordType: page.NextRecordType, StartRecordIdentifier: page.NextRecordIdentifier };
        }
        return { records: out.slice(0, max), truncated: out.length >= max };
      } catch (err) {
        return fail(err);
      }
    },
    async testAnswer(zoneId, name, type = "A") {
      try {
        const out = await client.send(new TestDNSAnswerCommand({ HostedZoneId: zoneId, RecordName: name, RecordType: type }));
        return { code: out.ResponseCode, type: out.RecordType, values: out.RecordData || [], protocol: out.Protocol || "" };
      } catch (err) {
        return fail(err);
      }
    },
    async healthStatus(checkId) {
      try {
        const out = await client.send(new GetHealthCheckStatusCommand({ HealthCheckId: checkId }));
        const obs = out.HealthCheckObservations || [];
        const failing = obs.filter((o) => !/^Success/.test(o.StatusReport?.Status || ""));
        return { id: checkId, status: obs.length && failing.length > obs.length / 2 ? "Failure" : "Success", reason: failing[0]?.StatusReport?.Status || "" };
      } catch (err) {
        return { id: checkId, ...fail(err) };
      }
    },
    async zoneVpcs(zoneId) {
      try {
        const out = await client.send(new GetHostedZoneCommand({ Id: zoneId }));
        return { vpcs: (out.VPCs || []).map((v) => `${v.VPCId} (${v.VPCRegion})`) };
      } catch (err) {
        return fail(err);
      }
    },
  };
}

export function distributionFrom(d) {
  const behavior = (b, path) => ({
    pathPattern: path ?? b.PathPattern,
    targetOriginId: b.TargetOriginId,
    viewerProtocolPolicy: b.ViewerProtocolPolicy,
    allowedMethods: b.AllowedMethods?.Items || [],
  });
  return {
    id: d.Id,
    domain: d.DomainName,
    aliases: d.Aliases?.Items || [],
    enabled: d.Enabled !== false,
    status: d.Status,
    origins: (d.Origins?.Items || []).map((o) => ({
      id: o.Id,
      domain: o.DomainName,
      path: o.OriginPath || "",
      s3: Boolean(o.S3OriginConfig),
      oai: o.S3OriginConfig?.OriginAccessIdentity || "",
      oac: o.OriginAccessControlId || "",
      protocolPolicy: o.CustomOriginConfig?.OriginProtocolPolicy || "",
      httpPort: o.CustomOriginConfig?.HTTPPort ?? null,
      httpsPort: o.CustomOriginConfig?.HTTPSPort ?? null,
      readTimeout: o.CustomOriginConfig?.OriginReadTimeout ?? null,
      sslProtocols: o.CustomOriginConfig?.OriginSslProtocols?.Items || [],
    })),
    defaultBehavior: behavior(d.DefaultCacheBehavior || {}, "*"),
    behaviors: (d.CacheBehaviors?.Items || []).map((b) => behavior(b)),
    customErrors: (d.CustomErrorResponses?.Items || []).map((e) => ({ code: e.ErrorCode, responseCode: e.ResponseCode || "", page: e.ResponsePagePath || "", ttl: e.ErrorCachingMinTTL ?? null })),
    cert: { acm: d.ViewerCertificate?.ACMCertificateArn || "", iam: d.ViewerCertificate?.IAMCertificateId || "", default: d.ViewerCertificate?.CloudFrontDefaultCertificate === true, minProtocol: d.ViewerCertificate?.MinimumProtocolVersion || "" },
    webAclId: d.WebACLId || "",
  };
}

export function createCloudFrontReader({ client = new CloudFrontClient({ region: "us-east-1", ...RETRY }) } = {}) {
  return {
    async distributions() {
      try {
        const out = [];
        let marker;
        for (let i = 0; i < 10; i += 1) {
          const page = await client.send(new ListDistributionsCommand({ Marker: marker, MaxItems: 100 }));
          out.push(...(page.DistributionList?.Items || []).map(distributionFrom));
          if (!page.DistributionList?.IsTruncated) break;
          marker = page.DistributionList.NextMarker;
        }
        return { distributions: out };
      } catch (err) {
        return fail(err);
      }
    },
  };
}
