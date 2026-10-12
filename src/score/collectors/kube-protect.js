// Protections the scanner must see rather than assume (2026-10-12: missing
// protections FAIL with a fix, never NOT ASSESSED): service accounts, PVCs
// and PVs, CloudNativePG clusters and their backups, Velero schedules.
// Named GETs only, minimised. A CRD that is not installed (404) is
// "installed: false", which controls read as "nothing of that kind here";
// a 403 stays denied (UNKNOWN).
import { evidence } from "../evidence.js";
import { kubeStatus } from "./kube-workloads.js";

const meta = (i) => i?.metadata || {};
const ref = (i) => ({ namespace: meta(i).namespace || "", name: meta(i).name || "" });
const condition = (item, type) => (item?.status?.conditions || []).find((c) => c.type === type) || null;

export function cnpgClusterFacts(c) {
  const spec = c?.spec || {};
  const archiving = condition(c, "ContinuousArchiving");
  return {
    ...ref(c),
    instances: Number(spec.instances || 1),
    readyInstances: Number(c?.status?.readyInstances || 0),
    phase: c?.status?.phase || "",
    zoneAffinity: spec.affinity?.enablePodAntiAffinity !== false && spec.affinity?.topologyKey === "topology.kubernetes.io/zone",
    zoneSpread: (spec.topologySpreadConstraints || []).some((t) => t.topologyKey === "topology.kubernetes.io/zone"),
    walPlugin: (spec.plugins || []).find((p) => p.isWALArchiver && p.enabled !== false)?.name || "",
    barmanObjectStore: Boolean(spec.backup?.barmanObjectStore),
    volumeSnapshot: Boolean(spec.backup?.volumeSnapshot),
    archiving: archiving ? { status: archiving.status, reason: archiving.reason || "", message: String(archiving.message || "").slice(0, 160) } : null,
  };
}

export function cnpgBackupFacts(b) {
  return { ...ref(b), cluster: b?.spec?.cluster?.name || "", method: b?.spec?.method || b?.status?.method || "", phase: b?.status?.phase || "", stoppedAt: b?.status?.stoppedAt || null, error: String(b?.status?.error || "").slice(0, 160) };
}

export function veleroScheduleFacts(s) {
  const t = s?.spec?.template || {};
  return { ...ref(s), paused: s?.spec?.paused === true, included: t.includedNamespaces || ["*"], excluded: t.excludedNamespaces || [], lastBackup: s?.status?.lastBackup || null, phase: s?.status?.phase || "" };
}

const CRDS = [
  ["cnpgClusters", "clusters", cnpgClusterFacts],
  ["cnpgBackups", "backups", cnpgBackupFacts],
  ["cnpgScheduledBackups", "scheduled", (s) => ({ ...ref(s), cluster: s?.spec?.cluster?.name || "", method: s?.spec?.method || "", schedule: s?.spec?.schedule || "", suspended: s?.spec?.suspend === true })],
];

export const kubeProtect = {
  key: "kube-protect",
  target: "kubernetes",
  reads: ["GET serviceAccounts", "GET pvcs", "GET pvs", "GET cnpgClusters", "GET cnpgBackups", "GET cnpgScheduledBackups", "GET veleroSchedules"],
  async collect({ kube }) {
    const [sas, pvcs, pvs, ...rest] = await Promise.all([kube.read("serviceAccounts"), kube.read("pvcs"), kube.read("pvs"), ...CRDS.map(([read]) => kube.read(read)), kube.read("veleroSchedules")]);
    const out = [];
    const core = (key, read, res, shape) => {
      const { status, error } = kubeStatus(res);
      const final = status === "absent" ? "error" : status;
      out.push(evidence({ key, collector: "kube-protect", read, target: "kubernetes", status: final, fields: final === "ok" ? { items: (res.json.items || []).map(shape) } : {}, error: final === "error" && !error ? { code: "404", message: `${read} is not served` } : error }));
    };
    core("kube-serviceaccounts", "GET serviceAccounts", sas, (sa) => ({ ...ref(sa), automount: typeof sa?.automountServiceAccountToken === "boolean" ? sa.automountServiceAccountToken : null }));
    core("kube-pvcs", "GET pvcs", pvcs, (c) => ({ ...ref(c), labels: meta(c).labels || {}, phase: c?.status?.phase || "", volume: c?.spec?.volumeName || "", storageClass: c?.spec?.storageClassName || "" }));
    core("kube-pvs", "GET pvs", pvs, (v) => ({ name: meta(v).name || "", handle: v?.spec?.csi?.volumeHandle || v?.spec?.awsElasticBlockStore?.volumeID || "", driver: v?.spec?.csi?.driver || "" }));
    // CloudNativePG: one record, installed or not.
    const cnpgAnswers = rest.slice(0, CRDS.length);
    const denied = cnpgAnswers.find((res) => kubeStatus(res).status === "denied");
    const failed = cnpgAnswers.find((res) => kubeStatus(res).status === "error");
    if (denied || failed) {
      const { status, error } = kubeStatus(denied || failed);
      out.push(evidence({ key: "kube-cnpg", collector: "kube-protect", read: "GET cnpgClusters", target: "kubernetes", status, error }));
    } else {
      const installed = kubeStatus(cnpgAnswers[0]).status !== "absent";
      const fields = { installed };
      CRDS.forEach(([, field, shape], i) => (fields[field] = (cnpgAnswers[i]?.json?.items || []).map(shape)));
      out.push(evidence({ key: "kube-cnpg", collector: "kube-protect", read: "GET cnpgClusters", target: "kubernetes", status: "ok", fields }));
    }
    const velero = rest[CRDS.length];
    const v = kubeStatus(velero);
    if (v.status === "denied" || v.status === "error") out.push(evidence({ key: "kube-velero", collector: "kube-protect", read: "GET veleroSchedules", target: "kubernetes", status: v.status, error: v.error }));
    else out.push(evidence({ key: "kube-velero", collector: "kube-protect", read: "GET veleroSchedules", target: "kubernetes", status: "ok", fields: { installed: v.status !== "absent", schedules: (velero?.json?.items || []).map(veleroScheduleFacts) } }));
    return out;
  },
};
