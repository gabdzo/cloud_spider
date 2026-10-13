#!/usr/bin/env node
// Post-apply (after `pulumi up` of eks-demo-prod + showcase-demo-prod): read
// the showcase load balancers (tag project=showcase, read-only ELBv2 calls),
// their listeners, rules and target health, probe each rule from outside
// (Host header for the shared ALB's host rules) and the NLB, and write the
// result to samples/demo-prod/snapshot.json for the SAMPLE demo data.
//   AWS_PROFILE=default node scripts/showcase-snapshot.mjs [--domain showcase.example.com] [--out path]
// Never touches a kubeconfig. No secrets in the output (DNS names, rules, codes).
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ElasticLoadBalancingV2Client, DescribeLoadBalancersCommand, DescribeTagsCommand, DescribeListenersCommand, DescribeRulesCommand, DescribeTargetHealthCommand } from "@aws-sdk/client-elastic-load-balancing-v2";
import { PRODUCTS, SHARED_GROUP } from "../upgrades/showcase/plan.js";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : fallback; };
const domain = arg("domain", "showcase.example.com");
const out = arg("out", "samples/demo-prod/snapshot.json");
const elb = new ElasticLoadBalancingV2Client({ region: "eu-north-1" });

export async function probe(url, host) {
  const started = Date.now();
  try {
    const res = await fetch(url, { headers: host ? { Host: host } : {}, redirect: "manual", signal: AbortSignal.timeout(10000) });
    return { code: res.status, ms: Date.now() - started };
  } catch (error) { return { code: 0, error: String(error.cause?.code || error.name), ms: Date.now() - started }; }
}

const lbs = (await elb.send(new DescribeLoadBalancersCommand({}))).LoadBalancers || [];
const tagged = [];
for (let i = 0; i < lbs.length; i += 20) {
  const chunk = lbs.slice(i, i + 20);
  const tags = (await elb.send(new DescribeTagsCommand({ ResourceArns: chunk.map((l) => l.LoadBalancerArn) }))).TagDescriptions || [];
  for (const t of tags) if ((t.Tags || []).some((x) => x.Key === "project" && x.Value === "showcase")) tagged.push(chunk.find((l) => l.LoadBalancerArn === t.ResourceArn));
}
const snapshot = { takenAt: new Date().toISOString(), domain, loadBalancers: [] };
for (const lb of tagged) {
  const listeners = (await elb.send(new DescribeListenersCommand({ LoadBalancerArn: lb.LoadBalancerArn }))).Listeners || [];
  const entry = { name: lb.LoadBalancerName, type: lb.Type, scheme: lb.Scheme, dns: lb.DNSName, zones: (lb.AvailabilityZones || []).map((z) => z.ZoneName), listeners: [] };
  for (const l of listeners) {
    const rules = lb.Type === "application" ? (await elb.send(new DescribeRulesCommand({ ListenerArn: l.ListenerArn }))).Rules || [] : [];
    const scheme = l.Protocol === "HTTPS" ? "https" : "http";
    const rows = [];
    for (const r of rules) {
      const host = (r.Conditions || []).find((c) => c.Field === "host-header")?.HostHeaderConfig?.Values?.[0] || "";
      const tg = r.Actions?.find((a) => a.TargetGroupArn)?.TargetGroupArn;
      const health = tg ? ((await elb.send(new DescribeTargetHealthCommand({ TargetGroupArn: tg }))).TargetHealthDescriptions || []).map((h) => h.TargetHealth?.State) : [];
      const product = PRODUCTS.find((p) => (host ? host.startsWith(`${p.host}.`) && p.alb === SHARED_GROUP : p.alb !== SHARED_GROUP));
      rows.push({ priority: r.Priority, host, product: product?.id || "", targets: health, probe: r.IsDefault && host === "" && lb.Type === "application" && product?.alb === SHARED_GROUP ? null : await probe(`${scheme}://${lb.DNSName}:${l.Port}/`, host) });
    }
    entry.listeners.push({ port: l.Port, protocol: l.Protocol, rules: rows, ...(lb.Type === "network" ? { probe: await probe(`http://${lb.DNSName}:${l.Port}/`) } : {}) });
  }
  snapshot.loadBalancers.push(entry);
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(snapshot, null, 2)}\n`);
for (const lb of snapshot.loadBalancers) for (const l of lb.listeners) {
  if (l.probe) console.log(`${lb.type} ${lb.dns}:${l.port} -> ${l.probe.code}`);
  for (const r of l.rules) if (r.probe) console.log(`${lb.type} ${r.host || lb.dns}:${l.port} (${r.product || "default"}) -> ${r.probe.code} targets=${r.targets.join(",")}`);
}
console.log(`wrote ${out} (${snapshot.loadBalancers.length} load balancers)`);
