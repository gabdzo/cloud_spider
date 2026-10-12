// VAULTS › what a vault is, where it lives, whether it is up and whether it
// is what its stack last deployed. Pure functions over what the server
// already has: the stack state (vault-stacks.js, read-only `pulumi stack
// export`), the map (owned resources and their tags), the kube snapshots
// (kube-health.js findings), HTTP checks, CloudTrail trouble, SLOs and the
// live metric flags. No AWS or cluster call here.
import { findIssues, HEALTH_KINDS } from "./kube-health.js";
import { typeLabel } from "./stack-resources.js";

const skip = (type) => !type || type === "pulumi:pulumi:Stack" || String(type).startsWith("pulumi:providers:");
const outputsOf = (r) => (r?.outputs && typeof r.outputs === "object" ? r.outputs : {});
const metaOf = (r) => {
  const m = outputsOf(r).metadata;
  return m && typeof m === "object" ? m : {};
};
const pathOf = (url) => {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return String(url || "?");
  }
};
const uniq = (list) => [...new Set(list.filter(Boolean))];
export const shortName = (r) => {
  const o = outputsOf(r);
  const m = metaOf(r);
  if (m.name) return String(m.name);
  if (typeof o.tags?.Name === "string" && o.tags.Name) return o.tags.Name;
  for (const k of ["functionName", "name", "bucket", "addonName", "nodeGroupName", "clusterName"]) if (typeof o[k] === "string" && o[k]) return o[k];
  return String(r?.urn || "").split("::").pop() || "?";
};

// ── where ─────────────────────────────────────────────────────────────
const REGION = /^arn:aws[\w-]*:[\w-]+:([a-z]{2}-[a-z]+-\d):/;
function regionOf(value) {
  const m = REGION.exec(String(value || ""));
  return m ? m[1] : "";
}
function namespaceOf(r) {
  const type = String(r?.type || "");
  if (!type.startsWith("kubernetes:")) return "";
  const m = metaOf(r);
  if (type === "kubernetes:core/v1:Namespace") return String(m.name || "");
  return String(m.namespace || outputsOf(r).namespace || "");
}

// vaultLocation({ resources, owned, cluster, region }) → { cluster, namespaces,
// region, vpcs, subnets, mapIds, text }. resources: the stack's state
// resources; owned: the vault's resources as the map has them
// (placeResources items, with subnetId/region when known).
export function vaultLocation({ resources = [], owned = [], cluster = "", region = "" } = {}) {
  const live = resources.filter((r) => !skip(r?.type));
  const namespaces = uniq(live.map(namespaceOf)).sort();
  const clusters = uniq([cluster, ...live.filter((r) => r.type === "aws:eks/cluster:Cluster").map((r) => outputsOf(r).name || r.id)]);
  const vpcs = uniq([
    ...live.filter((r) => r.type === "aws:ec2/vpc:Vpc").map((r) => r.id || outputsOf(r).id),
    ...live.map((r) => outputsOf(r).vpcId),
    ...live.map((r) => outputsOf(r).vpcConfig?.vpcId),
    ...owned.map((item) => (item.kind === "vpc" ? item.id : item.vpcId)),
  ]);
  const subnets = uniq([
    ...live.filter((r) => r.type === "aws:ec2/subnet:Subnet").map((r) => r.id || outputsOf(r).id),
    ...live.map((r) => outputsOf(r).subnetId),
    ...live.flatMap((r) => outputsOf(r).subnetIds || outputsOf(r).vpcConfig?.subnetIds || []),
    ...owned.map((item) => (item.kind === "subnet" ? item.id : item.subnetId)),
    ...owned.flatMap((item) => item.lbSubnetIds || []),
  ]);
  const regions = uniq([...live.map((r) => regionOf(outputsOf(r).arn || r.id)), ...owned.map((item) => regionOf(item.arn))]);
  const where = [];
  if (clusters.length) where.push(`${clusters.join(", ")}${namespaces.length ? ` › ${namespaces.join(", ")}` : ""}`);
  else if (namespaces.length) where.push(`ns ${namespaces.join(", ")}`);
  const aws = [regions[0] || region, vpcs.length ? vpcs.join(", ") : "", subnets.length ? `${subnets.length} subnet${subnets.length === 1 ? "" : "s"}` : ""].filter(Boolean);
  const regional = !vpcs.length && (owned.length > 0 || regions.length > 0);
  if (vpcs.length || subnets.length) where.push(aws.join(" › "));
  else if (regional || !where.length) where.push(`${regions[0] || region || "regional"}${regional ? " · outside the VPCs" : ""}`);
  return {
    cluster: clusters[0] || "",
    namespaces,
    region: regions[0] || region || "",
    vpcs,
    subnets,
    mapIds: owned.map((item) => item.id),
    regional,
    text: where.filter((w) => w !== "regional").join(" · "),
  };
}

// ── up? ───────────────────────────────────────────────────────────────
const podReady = (pod) => {
  const st = pod?.status || {};
  if (st.phase === "Succeeded") return null; // a finished job pod is neither
  const cs = st.containerStatuses || [];
  return st.phase === "Running" && cs.length > 0 && cs.every((c) => c.ready);
};
const selects = (selector, labels) => selector && Object.keys(selector).length > 0 && Object.entries(selector).every(([k, v]) => labels?.[k] === v);

// kubeSignals(snapshots, namespaces) → { read, pods, ready, issues, empty }
// snapshots: [{ cluster, snap }]. issues: kube-health findings in these
// namespaces; empty: Services that select no ready pod (no endpoints).
export function kubeSignals(snapshots = [], namespaces = [], { now = Date.now() } = {}) {
  const want = new Set(namespaces);
  const out = { read: false, pods: 0, ready: 0, issues: [], empty: [], error: "" };
  if (!want.size) return out;
  for (const { snap } of snapshots) {
    if (!snap || snap.unset) continue;
    if (snap.error) {
      out.error = out.error || String(snap.error);
      continue;
    }
    const pods = (snap.pods || []).filter((p) => want.has(p.metadata?.namespace));
    const seen = (snap.namespaces || []).some((n) => want.has(n.metadata?.name)) || pods.length > 0;
    if (!seen) continue;
    out.read = true;
    for (const pod of pods) {
      const r = podReady(pod);
      if (r === null) continue;
      out.pods += 1;
      if (r) out.ready += 1;
    }
    for (const issue of findIssues(snap, { now })) if (want.has(issue.ns)) out.issues.push(issue);
    for (const svc of snap.services || []) {
      const ns = svc.metadata?.namespace;
      const sel = svc.spec?.selector;
      if (!want.has(ns) || !sel || !Object.keys(sel).length) continue;
      const any = pods.some((p) => p.metadata?.namespace === ns && podReady(p) && selects(sel, p.metadata?.labels));
      if (!any) out.empty.push(`${ns}/${svc.metadata?.name}`);
    }
  }
  return out;
}

// vaultHealth(vault, signals) → { state: "ok" | "issues" | "down" | "unknown",
// word, count, issues: [{ source, text }], read: [source…], text }
// vault: the /api/vaults fields (stack, stackInfo, checks, trouble, slos,
// sloLamp, damaged). signals: { kube (kubeSignals), mapItems (raw map items
// owned), metrics ({id: {flag, headline, name}}) }.
export function vaultHealth(vault, { kube = null, mapItems = [], metrics = {} } = {}) {
  const issues = [];
  const read = [];
  const add = (source, text) => issues.push({ source, text });
  const word = (state, n) => ({ ok: "UP · OK", issues: `UP · ${n} ISSUE${n === 1 ? "" : "S"}`, down: "DOWN", unknown: "UNKNOWN" })[state];
  const done = (state, text) => ({ state, word: word(state, issues.length), count: issues.length, issues, read, text });
  if (vault.damaged) return done("unknown", "the vault file does not parse, nothing to read");
  const info = vault.stackInfo;
  if (vault.stack && info) {
    read.push("stack");
    if (info.error) add("stack", `stack state: ${info.error}`);
    else if (!info.stacks?.length || !info.resources) return done("down", `stack ${vault.stack.dir} › ${vault.stack.name} is not deployed`);
  }
  if (kube?.read) {
    read.push("pods");
    if (kube.pods > 0 && kube.ready === 0) {
      for (const issue of kube.issues) add("pods", `${issue.ns}/${issue.name}: ${HEALTH_KINDS[issue.kind]?.word || issue.kind}${issue.detail ? ` (${issue.detail})` : ""}`);
      return done("down", `0 of ${kube.pods} pods ready`);
    }
    for (const issue of kube.issues) add("pods", `${issue.ns}/${issue.name}: ${HEALTH_KINDS[issue.kind]?.word || issue.kind}${issue.detail ? ` (${issue.detail})` : ""}`);
    if (kube.empty.length) read.push("endpoints");
    for (const svc of kube.empty) add("endpoints", `service ${svc} has no ready endpoint`);
  } else if (kube?.error) add("pods", `the cluster did not answer (${kube.error})`);
  const checks = vault.checks || [];
  if (checks.length) read.push("checks");
  const failed = checks.filter((c) => c.status === "fail");
  for (const c of failed) add("checks", `check ${c.name || pathOf(c.url)}: ${c.error || "failed"}`);
  for (const c of checks.filter((c) => c.status === "slow")) add("checks", `check ${c.name || pathOf(c.url)}: slow${c.ms ? ` (${c.ms} ms)` : ""}`);
  if (checks.length && failed.length === checks.length && !kube?.ready) return done("down", "every HTTP check fails");
  if (vault.trouble?.length) add("cloudtrail", `${vault.trouble.length} failed AWS call${vault.trouble.length === 1 ? "" : "s"} since the last deploy`);
  if (vault.trouble) read.push("cloudtrail");
  if (vault.sloLamp && vault.sloLamp !== "none" && vault.sloLamp !== "nodata") read.push("slo");
  for (const s of (vault.slos || []).filter((s) => s.flag === "burning")) add("slo", `SLO ${s.name} is burning its budget${Number.isFinite(s.sliPct) ? ` (${s.sliPct}% ${s.sli === "error-rate" ? "good" : "up"})` : ""}`);
  if (vault.sloLamp === "burning" && !issues.some((i) => i.source === "slo")) add("slo", "an SLO is burning its budget");
  for (const item of mapItems) {
    const name = item.name || item.id;
    if (item.state && !/^(running|available|active|ok|in-use|deployed)$/i.test(item.state)) add("map", `${name} is ${item.state}`);
    else if (item.status && /fail|broken|down|error/i.test(item.status)) add("map", `${name}: ${item.status}`);
    const hit = metrics?.[item.id];
    if (hit) {
      if (!read.includes("live")) read.push("live");
      if (hit.flag && hit.flag !== "ok") add("live", `${hit.name || name}: ${hit.headline}`);
    }
  }
  if (mapItems.length && !read.includes("map")) read.push("map");
  const signals = read.filter((s) => s !== "stack" && s !== "cloudtrail");
  if (!signals.length && info?.error) return done("unknown", `the stack state did not read (${info.error}) and nothing else says`);
  if (!signals.length && kube && !kube.read && !issues.length) return done("unknown", `stack up${info?.resources ? ` (${info.resources} resources)` : ""}, but ${kube.why || "no polled cluster shows its pods"}`);
  if (!signals.length && !(vault.stack && info?.resources)) return done("unknown", "no stack, checks, pods or map resources to read");
  if (issues.length) return done("issues", issues.map((i) => i.text).join("\n"));
  if (!signals.length) return done("ok", `stack up (${info.resources} resources); no pods, checks or live metrics to read yet`);
  return done("ok", `read: ${read.join(", ")}; nothing wrong`);
}

// ── latest? whose? ───────────────────────────────────────────────────
const projectOf = (stack) => String(stack?.dir || "").split("/").pop();
const day = (t) => new Date(t).toISOString().slice(0, 16).replace("T", " ");

// vaultVersion(vault, { codeChangedAt, owned }) → { state: "latest" |
// "outdated" | "foreign" | "unmanaged" | "owned" | "notdeployed" | "unknown",
// word, owner, text }. codeChangedAt: last commit time (ms) touching the
// stack's directory; owned: map items with tags.
export function vaultVersion(vault, { codeChangedAt = 0, owned = [] } = {}) {
  const project = projectOf(vault.stack);
  const tagged = owned.map((item) => ({ item, project: item.tags?.project || "", managed: item.tags?.["managed-by"] || "" }));
  const out = (state, word, owner, text) => ({ state, word, owner, text });
  if (!vault.stack) {
    const projects = uniq(tagged.map((t) => t.project));
    if (projects.length === 1) return out("owned", `OWNED BY ${projects[0]}`, projects[0], `no stack named in the vault; the resources carry project=${projects[0]}`);
    if (projects.length > 1) return out("foreign", "MIXED OWNERS", projects.join(", "), `resources from ${projects.join(", ")}; the vault names no stack`);
    return out("unmanaged", "UNMANAGED", "", owned.length ? "no stack and no project tag: made by hand or by another tool" : "no stack named in the vault");
  }
  const info = vault.stackInfo || {};
  if (info.error) return out("unknown", "VERSION ?", project, `the stack state did not read: ${info.error}`);
  if (!info.stacks?.length || !info.resources) return out("notdeployed", "NOT DEPLOYED", project, `${vault.stack.dir} › ${vault.stack.name} has no resources`);
  const foreign = tagged.filter((t) => t.project && t.project !== project && !(vault.selector?.tags?.project === t.project));
  if (foreign.length) return out("foreign", `FOREIGN · ${uniq(foreign.map((t) => t.project)).join(", ")}`, project, `${foreign.map((t) => t.item.name || t.item.id).join(", ")} belong${foreign.length === 1 ? "s" : ""} to another stack (project=${uniq(foreign.map((t) => t.project)).join(", ")})`);
  const updated = info.updated || 0;
  const owner = `${project}/${(info.stacks || []).join(",") || vault.stack.name}`;
  if (!updated) return out("owned", `OWNED BY ${owner}`, owner, "the stack does not say when it last deployed");
  if (codeChangedAt && codeChangedAt > updated + 60_000) return out("outdated", "OUTDATED", owner, `${vault.stack.dir} changed ${day(codeChangedAt)} UTC, after the last deploy ${day(updated)} UTC: a pulumi up would change it`);
  return out("latest", "LATEST", owner, `last deploy ${day(updated)} UTC${codeChangedAt ? `; no change in ${vault.stack.dir} since` : ""}`);
}

// ── how the pieces connect ───────────────────────────────────────────
// Lanes, left to right: traffic enters at EDGE and lands in DATA.
export const LANES = [
  ["edge", "EDGE"],
  ["service", "SERVICE"],
  ["workload", "WORKLOAD"],
  ["config", "CONFIG"],
  ["data", "DATA"],
  ["platform", "PLATFORM"],
];
const LANE_OF = [
  [/networking\.k8s\.io\/v1:Ingress$|lb\/loadBalancer|lb\/listener|lb\/targetGroup|alb\/|cloudfront|functionUrl|apigateway|route53/i, "edge"],
  [/core\/v1:Service$/, "service"],
  [/apps\/v1:(Deployment|StatefulSet|DaemonSet)$|batch\/v1:(Job|CronJob)$|lambda\/function:Function$|helm\.sh\/v\d:(Release|Chart)$|ecs\/service|autoscaling\/v2:HorizontalPodAutoscaler$/i, "workload"],
  [/core\/v1:(ConfigMap|Secret|ServiceAccount|PersistentVolumeClaim)$|secretsmanager|ssm\/parameter|iam\/(role|policy):/i, "config"],
  [/dynamodb|s3\/bucket|rds\/|postgresql\.cnpg\.io|elasticache|sqs|sns\/topic|efs\//i, "data"],
];
// Plumbing that would only clutter the picture: listed, not drawn.
const QUIET = /Attachment$|Association$|AccessPolicy|AccessEntry|BucketPolicy|PublicAccessBlock|Ownership|Versioning|ServerSideEncryption|RouteTable|Route$|:Permission$|LogGroup$|kubernetes:core\/v1:Namespace$|Addon$|InternetGateway|SecurityGroupRule/;
export function laneOf(type) {
  for (const [re, lane] of LANE_OF) if (re.test(type)) return lane;
  return "platform";
}
const KIND_ICON = { edge: "url", service: "lb", workload: "pod", config: "lock", data: "database", platform: "cluster" };

function k8sLinks(nodes) {
  const edges = [];
  const by = (kind, ns, name) => nodes.find((n) => n.kind === kind && n.namespace === ns && n.name === name);
  const workloads = nodes.filter((n) => /^(Deployment|StatefulSet|DaemonSet|Job|CronJob)$/.test(n.kind));
  for (const n of nodes) {
    const o = n.outputs;
    if (n.kind === "Ingress") {
      const backs = [o.spec?.defaultBackend?.service?.name, ...(o.spec?.rules || []).flatMap((rule) => (rule.http?.paths || []).map((p) => p.backend?.service?.name))];
      for (const name of uniq(backs)) {
        const svc = by("Service", n.namespace, name);
        if (svc) edges.push([n.id, svc.id, "routes"]);
      }
    }
    if (n.kind === "Service") {
      const sel = o.spec?.selector;
      for (const w of workloads) if (w.namespace === n.namespace && selects(sel, w.outputs.spec?.template?.metadata?.labels || w.outputs.spec?.jobTemplate?.spec?.template?.metadata?.labels)) edges.push([n.id, w.id, "selects"]);
    }
    if (n.kind === "HorizontalPodAutoscaler") {
      const ref = o.spec?.scaleTargetRef;
      const w = ref && by(ref.kind, n.namespace, ref.name);
      if (w) edges.push([n.id, w.id, "scales"]);
    }
    if (workloads.includes(n)) {
      const pod = n.outputs.spec?.template?.spec || n.outputs.spec?.jobTemplate?.spec?.template?.spec || {};
      const uses = [];
      if (pod.serviceAccountName) uses.push(["ServiceAccount", pod.serviceAccountName]);
      for (const v of pod.volumes || []) {
        if (v.configMap?.name) uses.push(["ConfigMap", v.configMap.name]);
        if (v.secret?.secretName) uses.push(["Secret", v.secret.secretName]);
        if (v.persistentVolumeClaim?.claimName) uses.push(["PersistentVolumeClaim", v.persistentVolumeClaim.claimName]);
      }
      for (const c of [...(pod.containers || []), ...(pod.initContainers || [])]) {
        for (const e of c.envFrom || []) {
          if (e.configMapRef?.name) uses.push(["ConfigMap", e.configMapRef.name]);
          if (e.secretRef?.name) uses.push(["Secret", e.secretRef.name]);
        }
        for (const e of c.env || []) {
          if (e.valueFrom?.secretKeyRef?.name) uses.push(["Secret", e.valueFrom.secretKeyRef.name]);
          if (e.valueFrom?.configMapKeyRef?.name) uses.push(["ConfigMap", e.valueFrom.configMapKeyRef.name]);
        }
      }
      for (const [kind, name] of uses) {
        const hit = by(kind, n.namespace, name);
        if (hit) edges.push([n.id, hit.id, "uses"]);
      }
    }
  }
  return edges;
}

// vaultRelations(resources, { kube, mapIds }) → { nodes, edges, lanes, quiet }
// nodes: { id (urn), name, kind, type, lane, icon, namespace, status?, pods?,
// mapId? }; edges: [from, to, why] (from the k8s specs, else from the
// Pulumi dependency list); quiet: plumbing resources listed, not drawn.
export function vaultRelations(resources = [], { kube = [], handles = new Map(), extra = [] } = {}) {
  const all = resources.filter((r) => !skip(r?.type) && r.custom !== false);
  const quiet = [];
  const nodes = [];
  for (const r of all) {
    const type = String(r.type);
    const { label, service } = typeLabel(type);
    const node = { id: String(r.urn || r.id), name: shortName(r), kind: label, service, type, lane: laneOf(type), namespace: namespaceOf(r), outputs: outputsOf(r), deps: uniq([...(r.dependencies || []), r.parent]) };
    node.icon = KIND_ICON[node.lane];
    const o = node.outputs;
    for (const h of [r.id, o.id, o.arn, o.name, o.functionName, o.bucket, o.clusterName].filter((x) => typeof x === "string")) if (handles.has(h)) node.mapId = handles.get(h);
    (QUIET.test(type) ? quiet : nodes).push(node);
  }
  // The vault's pieces on the map that its stack state does not hold (an
  // ALB the load balancer controller made, a tagged bucket): drawn too.
  const MAP_LANE = { alb: ["edge", "LoadBalancer"], nlb: ["edge", "LoadBalancer"], cdn: ["edge", "CloudFront"], gate: ["edge", "LoadBalancer"], ec2: ["workload", "Instance"], function: ["workload", "Function"], rds: ["data", "RDS"], bucket: ["data", "Bucket"], table: ["data", "Table"], secret: ["config", "Secret"], eks: ["platform", "EKS"], vpc: ["platform", "VPC"], subnet: ["platform", "Subnet"], endpoint: ["platform", "Endpoint"] };
  const placed = new Set(nodes.map((n) => n.mapId).filter(Boolean));
  for (const item of extra) {
    if (placed.has(item.id) || item.kind === "subnet") continue;
    const [lane, kind] = MAP_LANE[item.kind] || ["platform", String(item.kind || "resource").toUpperCase()];
    nodes.push({ id: `map:${item.id}`, name: item.name || item.id, kind, service: "on the map", type: `map:${item.kind}`, lane, icon: KIND_ICON[lane], namespace: "", outputs: {}, deps: [], mapId: item.id, ingress: item.ingress || "", handles: [item.id, item.arn, item.name, item.dns].filter(Boolean) });
  }
  // pods behind each workload, from the snapshot
  for (const { snap } of kube) {
    for (const n of nodes.filter((x) => /^(Deployment|StatefulSet|DaemonSet)$/.test(x.kind))) {
      const sel = n.outputs.spec?.selector?.matchLabels || n.outputs.spec?.template?.metadata?.labels || { app: n.name };
      const pods = (snap?.pods || []).filter((p) => p.metadata?.namespace === n.namespace && selects(sel, p.metadata?.labels));
      if (!pods.length) continue;
      const ready = pods.filter((p) => podReady(p)).length;
      n.pods = { ready, total: pods.length };
      const bad = findIssues({ pods }, {}).map((i) => HEALTH_KINDS[i.kind]?.word || i.kind);
      n.status = ready === 0 ? "down" : bad.length || ready < pods.length ? "issues" : "ok";
      if (bad.length) n.note = uniq(bad).join(", ");
    }
  }
  const ids = new Set(nodes.map((n) => n.id));
  const seen = new Set();
  const edges = [];
  const push = ([a, b, why]) => {
    const key = `${a}>${b}`;
    if (a === b || seen.has(key) || seen.has(`${b}>${a}`) || !ids.has(a) || !ids.has(b)) return;
    seen.add(key);
    edges.push([a, b, why]);
  };
  // an Ingress lands on the load balancer its status names
  for (const ing of nodes.filter((n) => n.kind === "Ingress")) {
    const hosts = (ing.outputs.status?.loadBalancer?.ingress || []).map((x) => x.hostname || x.ip).filter(Boolean);
    for (const lb of nodes.filter((n) => n.lane === "edge" && n.handles)) if (lb.ingress === `${ing.namespace}/${ing.name}` || hosts.some((h) => lb.handles.includes(h))) push([lb.id, ing.id, "routes"]);
  }
  const k8s = k8sLinks(nodes);
  k8s.forEach(push);
  const k8sNodes = new Set(k8s.flat());
  for (const n of nodes) {
    // a k8s piece that the specs already placed keeps its spec edges only
    if (n.type.startsWith("kubernetes:") && k8sNodes.has(n.id)) continue;
    for (const dep of n.deps) {
      const d = nodes.find((x) => x.id === dep);
      if (!d) continue;
      // traffic order: the earlier lane points at the later one
      const order = (x) => LANES.findIndex(([l]) => l === x.lane);
      push(order(n) <= order(d) ? [n.id, d.id, "uses"] : [d.id, n.id, "uses"]);
    }
  }
  const strip = (n) => {
    const { outputs, deps, handles, ...rest } = n;
    return rest;
  };
  const used = LANES.filter(([l]) => nodes.some((n) => n.lane === l)).map(([id, label]) => ({ id, label, count: nodes.filter((n) => n.lane === id).length }));
  return { nodes: nodes.map(strip), edges, lanes: used, quiet: quiet.map((n) => ({ name: n.name, kind: n.kind, service: n.service })) };
}
