// Protections that must be seen, not assumed (2026-10-12): CloudNativePG
// high availability and backups, backup coverage of every PVC, image
// scanning, service-account tokens. Pure: { data, params, now } → items.
import { SYSTEM_NAMESPACES } from "./kube.js";

const ref = (item) => `${item.namespace}/${item.name}`;
const isApp = (item) => !SYSTEM_NAMESPACES.has(item.namespace);
const hours = (ms) => Math.round(ms / 360_000) / 10;

// A CNPG cluster's backup setup, in words; "" when it has none.
export function cnpgBackupMethod(c) {
  if (c.walPlugin) return `plugin ${c.walPlugin}`;
  if (c.barmanObjectStore) return "in-tree barmanObjectStore (deprecated, removed in CNPG 1.31)";
  if (c.volumeSnapshot) return "volume snapshots";
  return "";
}

function lastCompleted(backups, c) {
  return backups.filter((b) => b.namespace === c.namespace && b.cluster === c.name && b.phase === "completed" && b.stoppedAt).sort((a, b) => Date.parse(b.stoppedAt) - Date.parse(a.stoppedAt))[0] || null;
}

const noCnpg = (cnpg) => (!cnpg.installed ? "CloudNativePG is not installed" : !cnpg.clusters.length ? "no CloudNativePG clusters" : "");

export const protectEvaluators = {
  "cnpg-instances"({ data, params }) {
    const cnpg = data["kube-cnpg"];
    if (noCnpg(cnpg)) return { notApplicable: noCnpg(cnpg) };
    const min = params.minInstances || 2;
    return {
      items: cnpg.clusters.map((c) => {
        const pass = c.instances >= min && c.readyInstances >= min;
        const detail = c.instances < min ? `${c.instances} instance(s): no standby to fail over to` : c.readyInstances < min ? `${c.readyInstances}/${c.instances} instances ready` : `${c.readyInstances}/${c.instances} instances ready`;
        return { id: ref(c), pass, detail };
      }),
    };
  },
  "cnpg-zones"({ data }) {
    const cnpg = data["kube-cnpg"];
    if (noCnpg(cnpg)) return { notApplicable: noCnpg(cnpg) };
    const zoneOf = new Map(data["kube-nodes"].items.map((n) => [n.name, n.zone]));
    return {
      items: cnpg.clusters.map((c) => {
        const pods = data["kube-pods"].items.filter((p) => p.namespace === c.namespace && p.labels?.["cnpg.io/cluster"] === c.name && (p.labels?.["cnpg.io/podRole"] === "instance" || p.labels?.role || p.labels?.["cnpg.io/instanceRole"]) && p.phase === "Running");
        const zones = [...new Set(pods.map((p) => zoneOf.get(p.node)).filter(Boolean))].sort();
        const pinned = c.zoneAffinity || c.zoneSpread;
        const pass = zones.length >= 2 && pinned;
        const detail = zones.length < 2 ? `instances in ${zones.length} zone(s)${zones.length ? ` (${zones.join(", ")})` : ""}` : !pinned ? `in ${zones.join(", ")} by chance: no zone anti-affinity or spread, a reschedule may put them together` : `one per zone: ${zones.join(", ")}`;
        return { id: ref(c), pass, detail };
      }),
    };
  },
  "cnpg-backups"({ data, params, now = Date.now() }) {
    const cnpg = data["kube-cnpg"];
    if (noCnpg(cnpg)) return { notApplicable: noCnpg(cnpg) };
    const maxMs = (params.maxAgeHours || 26) * 3_600_000;
    return {
      items: cnpg.clusters.map((c) => {
        const method = cnpgBackupMethod(c);
        if (!method) return { id: ref(c), pass: false, detail: "no backup configured (no WAL-archiver plugin, no barmanObjectStore, no volume snapshots)" };
        const scheduled = cnpg.scheduled.filter((s) => s.namespace === c.namespace && s.cluster === c.name && !s.suspended);
        const last = lastCompleted(cnpg.backups, c);
        if (!scheduled.length && !last) return { id: ref(c), pass: false, detail: `${method}, but no ScheduledBackup and no completed backup` };
        if (!last) return { id: ref(c), pass: false, detail: `${method}; no completed backup yet${cnpg.backups.some((b) => b.cluster === c.name && b.phase === "failed") ? " (the last one failed)" : ""}` };
        const age = now - Date.parse(last.stoppedAt);
        return { id: ref(c), pass: age <= maxMs, detail: `${method}; last completed ${hours(age)} h ago (${last.name})${scheduled.length ? `, scheduled ${scheduled[0].schedule}` : ", no ScheduledBackup"}` };
      }),
    };
  },
  "cnpg-wal-archiving"({ data }) {
    const cnpg = data["kube-cnpg"];
    if (noCnpg(cnpg)) return { notApplicable: noCnpg(cnpg) };
    return {
      items: cnpg.clusters.map((c) => {
        if (!c.walPlugin && !c.barmanObjectStore) return { id: ref(c), pass: false, detail: "WAL archiving is not configured: no point-in-time recovery" };
        if (!c.archiving) return { id: ref(c), pass: false, detail: "no ContinuousArchiving condition yet" };
        return { id: ref(c), pass: c.archiving.status === "True", detail: c.archiving.status === "True" ? "ContinuousArchiving: True" : `ContinuousArchiving: ${c.archiving.status} ${c.archiving.reason} ${c.archiving.message}`.trim() };
      }),
    };
  },
  // Every bound PVC is covered by CNPG backups (its cluster), a Velero
  // schedule for its namespace, or AWS Backup protecting its EBS volume.
  "pv-backup-coverage"({ data }) {
    const pvcs = data["kube-pvcs"].items.filter((c) => c.phase === "Bound");
    if (!pvcs.length) return { notApplicable: "no bound PersistentVolumeClaims" };
    const cnpg = data["kube-cnpg"];
    const velero = data["kube-velero"];
    const awsb = data["aws-backup-protected"];
    const handleOf = new Map((data["kube-pvs"]?.items || []).map((v) => [v.name, v.handle]));
    const protectedVols = new Set((awsb?.volumes || []).map((v) => v.volume));
    return {
      items: pvcs.map((c) => {
        const cluster = c.labels?.["cnpg.io/cluster"];
        const owner = cluster ? (cnpg.clusters || []).find((x) => x.namespace === c.namespace && x.name === cluster) : null;
        if (owner && cnpgBackupMethod(owner)) return { id: ref(c), pass: true, detail: `CNPG ${owner.name}: ${cnpgBackupMethod(owner)}` };
        const schedule = (velero.schedules || []).find((s) => !s.paused && (s.included.includes("*") || s.included.includes(c.namespace)) && !s.excluded.includes(c.namespace));
        if (schedule) return { id: ref(c), pass: true, detail: `Velero schedule ${schedule.namespace}/${schedule.name}` };
        const vol = handleOf.get(c.volume);
        if (vol && protectedVols.has(vol)) return { id: ref(c), pass: true, detail: `AWS Backup protects ${vol}` };
        const why = [owner ? `CNPG ${owner.name} has no backup configured` : "", velero.installed ? "no Velero schedule covers the namespace" : "Velero is not installed", awsb?.available ? `AWS Backup does not protect ${vol || "its volume"}` : awsb?.note || "AWS Backup not read"].filter(Boolean).join("; ");
        return { id: ref(c), pass: false, detail: why };
      }),
    };
  },
  // A running image: private ECR → scanning on and no critical findings;
  // public registries → WARN (nobody scans it for you); AWS-managed → pass.
  "image-scanning"({ data, params }) {
    const imgs = data["kube-images"];
    const maxCritical = params.maxCritical ?? 0;
    const items = [];
    const unknown = [];
    for (const i of imgs.images) {
      const id = i.image.length > 90 ? `…${i.image.slice(-88)}` : i.image;
      if (i.kind === "aws-managed") items.push({ id, pass: true, detail: "AWS-managed image (EKS add-on): scanned and patched by AWS" });
      else if (i.kind === "public") items.push({ id, pass: true, warn: true, detail: `public registry ${i.registry}: no scan of yours covers it; pin a digest and scan it in CI, or pull it through an ECR pull-through cache with scanning on (e.g. ${i.pod})` });
      else if (i.kind === "other-ecr") items.push({ id, pass: true, warn: true, detail: `ECR in account ${i.account}: its scanning is that account's to check` });
      else if (!imgs.aws) unknown.push({ id, reason: "no AWS access to read the ECR scan" });
      else if (i.error) unknown.push({ id, reason: `ECR: ${i.error.code || i.error.message}` });
      else if (!i.scanOnPush && !i.enhanced) items.push({ id, pass: false, detail: `ECR repository ${i.repo} has no scanning (scan on push off, not covered by enhanced scanning)` });
      else if (!i.scan || i.scan.status !== "COMPLETE") items.push({ id, pass: false, detail: `no completed scan for this image (${i.scan?.status || "none"}): push it again or start a scan` });
      else items.push({ id, pass: i.scan.critical <= maxCritical, detail: `${i.scan.critical} critical, ${i.scan.high} high findings (${i.enhanced ? "enhanced" : "basic"} scanning)` });
    }
    return { items, unknown };
  },
  // Pods on a namespace's default service account do not need API tokens:
  // an automounted one is a credential for nothing. A dedicated service
  // account is taken to call the API (operators, CNPG instances).
  "sa-token-automount"({ data }) {
    const sas = new Map(data["kube-serviceaccounts"].items.map((sa) => [`${sa.namespace}/${sa.name}`, sa]));
    const pods = data["kube-pods"].items.filter((p) => isApp(p) && p.phase === "Running");
    return {
      items: pods.map((p) => {
        const sa = sas.get(`${p.namespace}/${p.serviceAccount}`);
        const mounted = p.automount ?? sa?.automount ?? true;
        if (!mounted) return { id: ref(p), pass: true, detail: "no token mounted" };
        if (p.serviceAccount !== "default") return { id: ref(p), pass: true, detail: `dedicated service account ${p.serviceAccount} (taken to call the API)` };
        return { id: ref(p), pass: false, detail: `runs as ${p.namespace}/default with an automounted API token it does not need` };
      }),
    };
  },
  // K8S-SEC-010: a Kyverno generate rule that gives every new namespace a
  // default-deny NetworkPolicy, kept in sync.
  "new-namespace-default-deny"({ data, status = {} }) {
    if (status["kube-clusterPolicies"] === "absent") return { items: [{ id: "kyverno", pass: false, detail: "Kyverno is not installed: new namespaces start open (install it with defaultDeny on)" }] };
    const rules = (data["kube-clusterPolicies"]?.items || []).flatMap((p) => p.generates.map((g) => ({ ...g, policy: p.name, ready: p.ready })));
    const deny = rules.filter((g) => g.kind === "NetworkPolicy" && g.triggers.includes("Namespace") && g.ingress && !g.allowsIngress);
    if (!deny.length) return { items: [{ id: "kyverno", pass: false, detail: "no Kyverno generate rule makes a default-deny NetworkPolicy for new namespaces" }] };
    const best = deny.find((g) => g.synchronize && g.egress) || deny.find((g) => g.synchronize) || deny[0];
    const id = `clusterpolicy/${best.policy}`;
    if (!best.synchronize) return { items: [{ id, pass: true, warn: true, detail: `${best.policy} generates default-deny without synchronize: a deleted policy stays deleted` }] };
    if (!best.egress) return { items: [{ id, pass: true, warn: true, detail: `${best.policy} denies ingress only; egress stays open` }] };
    return { items: [{ id, pass: true, detail: `${best.policy}: new namespaces get default-deny ingress + egress, kept in sync` }] };
  },
};
