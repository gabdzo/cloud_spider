// Evaluators for AWS controls. Same contract as evaluators/kube.js. Pure.
const OPEN = (p) => p.cidrs.includes("0.0.0.0/0") || p.ipv6.includes("::/0");
const covers = (p, port) => p.protocol === "-1" || ((p.protocol === "tcp" || p.protocol === "6") && p.from <= port && port <= p.to);
export const ADMIN_PORTS = [22, 3389, 10250];

export const awsEvaluators = {
  "sg-no-open-admin-ports"({ data }) {
    return { items: data["aws-network"].groups.map((g) => { const hits = ADMIN_PORTS.filter((port) => g.ingress.some((p) => OPEN(p) && covers(p, port))); return { id: `${g.region}/${g.id}`, pass: hits.length === 0, detail: hits.length ? `open to the internet on ${hits.join(", ")}` : "", exposure: hits.length ? 2 : 1 }; }) };
  },
  // Runtime: a load balancer with listeners has at least one healthy target.
  "lb-has-healthy-targets"({ data }) {
    const live = data["aws-elbv2"].loadBalancers.filter((lb) => lb.listeners > 0 && lb.targetGroups.length);
    return { items: live.map((lb) => { const targets = lb.targetGroups.flatMap((tg) => tg.targets); const healthy = targets.filter((t) => t.state === "healthy").length; return { id: `${lb.region}/${lb.name}`, pass: healthy > 0, detail: healthy ? "" : `0 of ${targets.length} targets healthy${targets[0]?.reason ? ` (${targets[0].reason})` : ""}` }; }) };
  },
  "eks-active"({ data }) {
    return { items: data["aws-eks"].clusters.map((c) => ({ id: `${c.region}/${c.name}`, pass: c.status === "ACTIVE", detail: c.status === "ACTIVE" ? "" : `status ${c.status}` })) };
  },
  "eks-endpoint-restricted"({ data }) {
    return { items: data["aws-eks"].clusters.map((c) => { const open = c.endpointPublic && (c.publicCidrs.length === 0 || c.publicCidrs.includes("0.0.0.0/0")); return { id: `${c.region}/${c.name}`, pass: !open, detail: open ? "public API endpoint open to 0.0.0.0/0" : "" }; }) };
  },
  // Critical: a database both public and reachable from anywhere on its port.
  // Exposure 2.0 = internet-reachable (spec §6.8: 2.0 · 1.5 · 1.0).
  "rds-not-public"({ data }) {
    const groups = new Map(data["aws-network"].groups.map((g) => [g.id, g]));
    return { items: data["aws-rds"].instances.map((db) => { const open = db.public && db.securityGroups.some((id) => (groups.get(id)?.ingress || []).some((p) => OPEN(p) && (db.port == null || covers(p, db.port)))); return { id: `${db.region}/${db.id}`, pass: !open, detail: open ? `PubliclyAccessible with a security group open to the internet on ${db.port}` : "", exposure: open ? 2 : 1 }; }) };
  },
  "rds-multi-az"({ data }) {
    return { items: data["aws-rds"].instances.map((db) => ({ id: `${db.region}/${db.id}`, pass: db.multiAz, detail: db.multiAz ? "" : "single-AZ" })) };
  },
  "rds-encrypted"({ data }) {
    return { items: data["aws-rds"].instances.map((db) => ({ id: `${db.region}/${db.id}`, pass: db.encrypted, detail: db.encrypted ? "" : "storage not encrypted" })) };
  },
  "rds-backups-7d"({ data }) {
    return { items: data["aws-rds"].instances.map((db) => ({ id: `${db.region}/${db.id}`, pass: db.backupDays >= 7, detail: `${db.backupDays} days of automated backups` })) };
  },
  // Each internet-facing ALB has a 5XX alarm (ELB or target) with an action.
  "lb-5xx-alarm"({ data }) {
    const alarms = data["aws-alarms"].alarms.filter((a) => a.namespace === "AWS/ApplicationELB" && /^HTTPCode_(ELB|Target)_5XX_Count$/.test(a.metric) && a.actions > 0);
    const public_ = data["aws-elbv2"].loadBalancers.filter((lb) => lb.type === "application" && lb.scheme === "internet-facing");
    const suffix = (arn) => String(arn).split(":loadbalancer/").pop();
    return { items: public_.map((lb) => ({ id: `${lb.region}/${lb.name}`, pass: alarms.some((a) => a.region === lb.region && a.dimensions.LoadBalancer === suffix(lb.arn)), detail: "no 5XX alarm with an action" })) };
  },
  "log-retention"({ data }) {
    return { items: data["aws-loggroups"].logGroups.map((g) => ({ id: `${g.region}/${g.name}`, pass: g.retentionDays != null, detail: g.retentionDays == null ? "never expires" : "" })) };
  },
  "cloudtrail-on"({ data }) {
    const good = data["aws-cloudtrail"].trails.find((t) => t.multiRegion && t.logging && t.management);
    return { items: [{ id: "account", pass: Boolean(good), detail: good ? `trail ${good.name}` : "no multi-region trail logging management events" }] };
  },
};
