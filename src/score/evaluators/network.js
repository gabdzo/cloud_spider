// N10 (docs/design/network-debugging.md §8): the NET-* controls. Same
// contract as evaluators/kube.js and aws.js. Pure; they read the evidence
// the kube-network and aws net collectors leave, shaped by the netdebug
// readers, so a debug run and a scan judge a resource the same way.
import { cidrContains } from "../../cidr.js";
import { isUserNamespace } from "../../svc-endpoints.js";
import { danglingRecords } from "../../netdebug/aws-dns.js";
import { naclVerdict } from "../../netdebug/aws-vpc.js";
import { corednsPdb } from "../../netdebug/kube-checks.js";

const trim = (name) => String(name || "").toLowerCase().replace(/\.$/, "");
const pointsAt = (r) => trim(r.alias?.dnsName || (r.type === "CNAME" ? r.values?.[0] : ""));
const AWS_EDGE = /\.(elb\.amazonaws\.com|cloudfront\.net)$/;
const EPHEMERAL = [1024, 65535];
// ELBSecurityPolicy-TLS13-1-2-…, -TLS-1-2-…, -FS-1-2-…: the digit after
// "1-" is the lowest TLS minor version the policy accepts. Others
// (2016-08, FS-2018-06) still accept TLS 1.0.
const minTlsMinor = (policy) => Number((/(?:TLS13|TLS|FS)-1-(\d)/.exec(policy || "") || [])[1] ?? 0);
const MODERN_CF = /^TLSv1\.2_20(2[1-9]|[3-9]\d)$|^TLSv1\.3/;
const range = (a, b) => (a === b ? `${a}` : `${a}-${b}`);
const pct = (x) => `${(x * 100).toFixed(1)}%`;

export const networkEvaluators = {
  // NET-DNS-003: ≥2 ready CoreDNS replicas on ≥2 nodes, and a PDB.
  "coredns-resilient"({ data }) {
    const pods = data["kube-coredns"].pods || [];
    if (!pods.length) return { notApplicable: "no CoreDNS (k8s-app=kube-dns) pods" };
    const ready = pods.filter((p) => p.ready);
    const nodes = [...new Set(ready.map((p) => p.node).filter(Boolean))];
    // The PDB selects the CoreDNS pods by their own labels: the EKS add-on's
    // is { eks.amazonaws.com/component: coredns, k8s-app: kube-dns }, which
    // the bare { k8s-app: kube-dns } never matched.
    const pdb = corednsPdb((data["kube-pdbs"].items || []).filter((p) => p.namespace === "kube-system").map((p) => ({ name: p.name, selector: { matchLabels: p.selector, matchExpressions: p.expressions || [] } })), pods.map((p) => p.labels));
    const issues = [];
    if (ready.length < 2) issues.push(`${ready.length} ready replica${ready.length === 1 ? "" : "s"}`);
    else if (nodes.length < 2) issues.push(`${ready.length === 2 ? "both" : `all ${ready.length}`} on ${nodes[0] || "one node"}`);
    if (!pdb) issues.push("no PodDisruptionBudget");
    return { items: [{ id: "kube-system/coredns", pass: issues.length === 0, detail: issues.length ? issues.join("; ") : `${ready.length} ready on ${nodes.length} nodes, PDB ${pdb.name}` }] };
  },
  // NET-DNS-004: SERVFAIL share of CoreDNS answers (counters since start).
  "coredns-servfail-rate"({ data, params = {} }) {
    const { total = 0, servfail = 0, forbidden = false } = data["kube-coredns-metrics"];
    if (forbidden) return { items: [], unknown: [{ id: "kube-system/coredns", reason: "the viewer may not read CoreDNS metrics (get services/proxy on kube-dns:metrics is an opt-in rule)" }] };
    const max = params.maxRatio ?? 0.01;
    if (!total) return { items: [], unknown: [{ id: "kube-system/coredns", reason: "CoreDNS has answered nothing yet" }] };
    const ratio = servfail / total;
    return { items: [{ id: "kube-system/coredns", pass: ratio < max, detail: `SERVFAIL ${pct(ratio)} of ${total} answers since the pods started` }] };
  },
  // NET-K8S-001: NetworkPolicies exist and something enforces them.
  // (K8S-SEC-005 asks for default deny; this asks that it is not decoration.)
  "netpol-enforced"({ data }) {
    const policies = data["kube-networkPolicies"].items || [];
    if (!policies.length) return { notApplicable: "no NetworkPolicies in the cluster" };
    const who = data["kube-cni"].enforcer;
    const n = `${policies.length} NetworkPolic${policies.length === 1 ? "y" : "ies"}`;
    return { items: [{ id: "cluster", pass: Boolean(who), detail: who ? `${who} enforces ${n}` : `${n} exist but nothing enforces them (no VPC CNI policy agent, Calico or Cilium)` }] };
  },
  // NET-K8S-002: Services behind an Ingress or a load balancer have ready
  // endpoints in ≥2 zones.
  "service-endpoints-zones"({ data, params = {} }) {
    const minZones = params.minZones ?? 2;
    const services = data["kube-services"].items || [];
    const exists = new Set(services.map((s) => `${s.namespace}/${s.name}`));
    const wanted = [];
    const add = (id) => !wanted.includes(id) && wanted.push(id);
    for (const ing of data["kube-ingresses"].items || []) for (const svc of ing.services) add(`${ing.namespace}/${svc}`);
    for (const s of services.filter((x) => x.type === "LoadBalancer")) add(`${s.namespace}/${s.name}`);
    const slices = data["kube-endpointslices"].items || [];
    const items = [];
    const unknown = [];
    for (const id of wanted) {
      if (!exists.has(id)) {
        items.push({ id, pass: false, detail: "an Ingress routes to it but the Service does not exist" });
        continue;
      }
      const ready = slices.filter((s) => `${s.namespace}/${s.service}` === id).flatMap((s) => s.endpoints).filter((e) => e.ready);
      if (!ready.length) {
        items.push({ id, pass: false, detail: "no ready endpoints: requests to it fail" });
        continue;
      }
      const zones = [...new Set(ready.map((e) => e.zone).filter(Boolean))].sort();
      if (!zones.length) unknown.push({ id, reason: "its endpoints carry no zone" });
      else items.push({ id, pass: zones.length >= minZones, detail: zones.length >= minZones ? `${ready.length} ready in ${zones.join(", ")}` : `${ready.length} ready, only in ${zones[0]}: one zone outage takes it down` });
    }
    return { items, unknown };
  },

  // NET-K8S-003: every Service with a selector in the user's namespaces has
  // at least one ready endpoint (0 = every request to it fails).
  "service-has-ready-endpoints"({ data }) {
    const slices = data["kube-endpointslices"].items || [];
    const items = (data["kube-services"].items || []).filter((s) => s.selector && isUserNamespace(s.namespace)).map((s) => {
      const id = `${s.namespace}/${s.name}`;
      const ready = slices.filter((x) => `${x.namespace}/${x.service}` === id).flatMap((x) => x.endpoints).filter((e) => e.ready).length;
      return { id, pass: ready > 0, detail: ready ? `${ready} ready endpoint${ready === 1 ? "" : "s"}` : "0 ready endpoints: the selector matches no ready pod, requests fail" };
    });
    return { items };
  },

  // NET-DNS-001: no alias/CNAME points at a load balancer or CloudFront
  // distribution that no longer exists (subdomain takeover).
  "dns-no-dangling"({ data }) {
    const records = (data["aws-route53"].records || []).filter((r) => AWS_EDGE.test(pointsAt(r)));
    const gone = danglingRecords(records, { loadBalancers: data["aws-lb-edge"].loadBalancers || [], distributions: data["aws-cloudfront"].distributions || [] });
    return {
      items: records.map((r) => {
        const bad = gone.find((g) => g.name === trim(r.name) && g.type === r.type && g.target === pointsAt(r));
        return { id: `${trim(r.name)} ${r.type}`, pass: !bad, detail: bad ? `points at ${bad.target}, a ${bad.what} that no longer exists in the scanned regions` : `→ ${pointsAt(r)}`, exposure: bad && !r.private ? 2 : 1 };
      }),
    };
  },
  // NET-DNS-002: failover and weighted records carry a health check (or an
  // alias that evaluates its target's health).
  "dns-routing-health-checks"({ data }) {
    const routed = (data["aws-route53"].records || []).filter((r) => r.policy === "failover" || r.policy === "weighted");
    return { items: routed.map((r) => {
      const ok = Boolean(r.healthCheckId) || r.alias?.evaluate === true;
      return { id: `${trim(r.name)} ${r.type} ${r.setId}`, pass: ok, detail: ok ? "" : `${r.policy} record without a health check: Route 53 keeps answering with it when it is down` };
    }) };
  },
  // NET-TLS-002: TLS 1.2+ on CloudFront (own certificate) and on HTTPS/TLS
  // listeners.
  "tls-modern"({ data }) {
    const items = [];
    for (const d of data["aws-cloudfront"].distributions || []) {
      if (d.cert?.default) continue; // *.cloudfront.net: the minimum cannot be set
      const ok = MODERN_CF.test(d.cert?.minProtocol || "");
      items.push({ id: `cloudfront/${d.id}`, pass: ok, detail: ok ? d.cert.minProtocol : `minimum protocol ${d.cert?.minProtocol || "?"}; use TLSv1.2_2021` });
    }
    for (const lb of data["aws-lb-edge"].loadBalancers || []) {
      for (const l of lb.listeners.filter((x) => x.protocol === "HTTPS" || x.protocol === "TLS")) {
        const ok = minTlsMinor(l.sslPolicy) >= 2;
        items.push({ id: `${lb.region}/${lb.name}:${l.port}`, pass: ok, detail: ok ? l.sslPolicy : `${l.sslPolicy || "no policy"} still accepts TLS 1.0/1.1; use ELBSecurityPolicy-TLS13-1-2-2021-06` });
      }
    }
    return { items };
  },
  // NET-HTTP-001: viewers never get plain HTTP: CloudFront behaviors are not
  // allow-all, internet-facing ALB HTTP listeners redirect to HTTPS.
  "http-to-https"({ data }) {
    const items = [];
    for (const d of data["aws-cloudfront"].distributions || []) {
      const loose = [d.defaultBehavior, ...(d.behaviors || [])].filter((b) => b?.viewerProtocolPolicy === "allow-all").map((b) => b.pathPattern);
      items.push({ id: `cloudfront/${d.id}`, pass: !loose.length, detail: loose.length ? `viewer protocol policy allow-all on ${loose.join(", ")}` : "" });
    }
    for (const lb of (data["aws-lb-edge"].loadBalancers || []).filter((x) => x.type === "application" && x.scheme === "internet-facing")) {
      for (const l of lb.listeners.filter((x) => x.protocol === "HTTP")) {
        items.push({ id: `${lb.region}/${lb.name}:${l.port}`, pass: l.redirectHttps, detail: l.redirectHttps ? "redirects to HTTPS" : "the default action forwards plain HTTP instead of redirecting to HTTPS" });
      }
    }
    return { items };
  },
  // NET-VPC-001: VPCs that take internet traffic keep flow logs.
  "vpc-flow-logs"({ data }) {
    const vpcs = [...new Set((data["aws-lb-edge"].loadBalancers || []).filter((lb) => lb.scheme === "internet-facing" && lb.vpcId).map((lb) => `${lb.region}/${lb.vpcId}`))];
    const logs = data["aws-vpc-net"].flowLogs || [];
    return { items: vpcs.map((id) => {
      const [region, vpcId] = id.split("/");
      const on = logs.find((f) => f.region === region && f.resourceId === vpcId && f.status === "ACTIVE");
      return { id, pass: Boolean(on), detail: on ? `flow log ${on.id} → ${on.destination}` : "no active VPC flow log: a REJECT on the path leaves no trace" };
    }) };
  },
  // NET-VPC-002: NACLs on the load balancer → target path let the traffic
  // and its return through (NACLs are stateless; SGs are not).
  "nacl-return-path"({ data }) {
    const { subnets = [], nacls = [] } = data["aws-vpc-net"];
    const naclOf = (region, subnetId, vpcId) => nacls.find((n) => n.region === region && n.subnetIds.includes(subnetId)) || nacls.find((n) => n.region === region && n.vpcId === vpcId && n.default) || null;
    const items = [];
    for (const lb of (data["aws-lb-edge"].loadBalancers || []).filter((x) => x.scheme === "internet-facing")) {
      const lbSubnets = lb.subnets.map((id) => subnets.find((s) => s.region === lb.region && s.id === id)).filter(Boolean);
      for (const tg of lb.targetGroups) {
        const problems = [];
        const check = (nacl, where, rule) => {
          if (!nacl) return;
          const v = naclVerdict(nacl, rule);
          if (!v.allowed) problems.push(`${nacl.id} (${where}) ${rule.egress ? "egress" : "ingress"} ${v.denied.map((d) => `${range(d.from, d.to)} (rule ${d.rule})`).join(", ")} ${rule.egress ? "to" : "from"} ${rule.peer}`);
        };
        const ips = tg.type === "ip" ? tg.targets.filter((x) => x.includes(".")) : [];
        for (const ls of lbSubnets) {
          const nacl = naclOf(lb.region, ls.id, lb.vpcId);
          for (const ip of ips) {
            check(nacl, ls.id, { egress: true, peer: ip, from: tg.port, to: tg.port });
            check(nacl, ls.id, { egress: false, peer: ip, from: EPHEMERAL[0], to: EPHEMERAL[1] });
          }
        }
        for (const ip of ips) {
          const sub = subnets.find((s) => s.region === lb.region && s.vpcId === lb.vpcId && s.cidr && cidrContains(s.cidr, `${ip}/32`));
          if (!sub) continue;
          const nacl = naclOf(lb.region, sub.id, lb.vpcId);
          for (const ls of lbSubnets) {
            check(nacl, sub.id, { egress: false, peer: ls.cidr, from: tg.port, to: tg.port });
            check(nacl, sub.id, { egress: true, peer: ls.cidr, from: EPHEMERAL[0], to: EPHEMERAL[1] });
          }
        }
        const unique = [...new Set(problems)];
        items.push({ id: `${lb.region}/${lb.name} → ${tg.name}`, pass: unique.length === 0, detail: unique.length ? `${unique.slice(0, 2).join("; ")}${unique.length > 2 ? ` (+${unique.length - 2})` : ""}` : ips.length ? `${ips.length} target${ips.length === 1 ? "" : "s"} on ${tg.port}: both directions allowed` : "instance targets: the load balancer side only" });
      }
    }
    return { items };
  },
  // NET-VPC-003: subnets that hold Kubernetes nodes or pods keep >20% of
  // their addresses free (the VPC CNI gives every pod one).
  "subnet-free-ips"({ data, params = {} }) {
    const min = params.minFree ?? 0.2;
    const nodeSubnets = new Set((data["aws-eks"]?.clusters || []).flatMap((c) => (c.nodegroups || []).flatMap((g) => g.subnets || [])));
    const wanted = (data["aws-vpc-net"].subnets || []).filter((s) => (s.k8s || nodeSubnets.has(s.id)) && s.free != null && /\/\d+$/.test(s.cidr));
    return { items: wanted.map((s) => {
      const size = 2 ** (32 - Number(s.cidr.split("/")[1])) - 5;
      const share = size > 0 ? s.free / size : 0;
      return { id: `${s.region}/${s.id}`, pass: share > min, detail: `${s.free} of ${size} free (${(share * 100).toFixed(1)}%)` };
    }) };
  },
  // NET-TLS-001: certificates that load balancers or CloudFront serve
  // expire in ≥ failDays (FAIL) and ≥ warnDays (else a pass marked WARN).
  // Certificates used by anything else, or by nothing, are not judged.
  "cert-expiry"({ data, now = Date.now(), params = {} }) {
    const failDays = params.failDays ?? 14;
    const warnDays = params.warnDays ?? 30;
    const users = (arns) => arns.map((a) => {
      const lb = /:loadbalancer\/(?:app|net)\/([^/]+)/.exec(a);
      if (lb) return `load balancer ${lb[1]}`;
      const cf = /^arn:aws[\w-]*:cloudfront::\d*:distribution\/(.+)$/.exec(a);
      return cf ? `CloudFront ${cf[1]}` : null;
    }).filter(Boolean);
    const items = [];
    const unknown = [];
    for (const c of data["aws-acm"].certificates || []) {
      const by = users(c.inUseBy || []);
      if (!by.length) continue;
      const id = `${c.region}/${c.domain}`;
      if (!c.notAfter) {
        unknown.push({ id, reason: "no expiry date (certificate not issued yet?)" });
        continue;
      }
      const days = Math.floor((Date.parse(c.notAfter) - now) / 86_400_000);
      const when = days < 0 ? `expired ${-days} day${days === -1 ? "" : "s"} ago` : `expires in ${days} day${days === 1 ? "" : "s"}`;
      const where = `${c.notAfter.slice(0, 10)}${c.type === "IMPORTED" ? ", imported: no automatic renewal" : ""}; used by ${by.slice(0, 2).join(", ")}${by.length > 2 ? ` (+${by.length - 2})` : ""}`;
      if (days < failDays) items.push({ id, pass: false, detail: `${when} (${where})`, exposure: days < 7 ? 2 : 1 });
      else if (days < warnDays) items.push({ id, pass: true, warn: true, detail: `WARN: ${when} (${where})` });
      else items.push({ id, pass: true, detail: `${when}` });
    }
    return { items, unknown };
  },
};
