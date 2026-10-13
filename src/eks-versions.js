// EKS Kubernetes versions: which ones the EKS card offers, their support
// window and what an hour of control plane costs on each. Pure, no network:
// the schema (upgrades/schema/eks.js), the program (upgrades/eks), the card
// (src/upgrade.js, src/run-pane.js, served to the page) and SCORE (AWS-FIN-002)
// all read it; upgrades/eks-versions.js re-exports it for the programs.
//
// Calendar: docs.aws.amazon.com/eks/latest/userguide/kubernetes-versions.html
// (read 2026-10-13, dates UTC). Standard support is 14 months, then 12 months
// of EXTENDED support at an extra fee per cluster hour; after that EKS
// upgrades the control plane by itself. Price (eu-north-1, the same as every
// region): $0.10/h standard, $0.60/h extended ($0.10 + $0.50 extended fee).
export const EKS_CALENDAR = {
  "1.31": { standardEnd: "2025-11-26", extendedEnd: "2026-11-26" },
  "1.32": { standardEnd: "2026-03-23", extendedEnd: "2027-03-23" },
  "1.33": { standardEnd: "2026-07-29", extendedEnd: "2027-07-29" },
  "1.34": { standardEnd: "2026-12-02", extendedEnd: "2027-12-02" },
  "1.35": { standardEnd: "2027-03-27", extendedEnd: "2028-03-27" },
  "1.36": { standardEnd: "2027-08-02", extendedEnd: "2028-08-02" },
  "1.37": { standardEnd: "2027-12-01", extendedEnd: "2028-12-01" },
};

// What the card and the stack accept. A deployed cluster moves up one minor
// at a time (EKS UpdateClusterVersion refuses a skip) and never down.
export const EKS_VERSIONS = ["1.32", "1.33", "1.34", "1.35"];
// A NEW cluster (no cluster of that name in the account yet): the newest
// minor every pinned add-on supports, so the longest standard support we can
// use (1.35: until 2027-03-27). Not 1.36/1.37 (both standard on EKS): Kyverno
// 1.19 supports Kubernetes 1.33-1.35 only. The pins and their ranges:
// ADDON_K8S below; test/eks-versions.test.js keeps this in their range.
export const EKS_NEW_VERSION = "1.35";

// The Kubernetes minors each pinned add-on supports upstream (read
// 2026-10-13): [oldest, newest]. Helm pins: upgrades/addons/catalog.js and
// upgrades/pgcluster (CNPG). The EKS managed add-ons (vpc-cni, Pod Identity,
// metrics-server, EBS CSI; CoreDNS and kube-proxy come with the cluster) are
// not pinned: upgrades/eks resolves each one's default version for the
// cluster's Kubernetes version (aws.eks.getAddonVersion) when it creates it.
export const ADDON_K8S = {
  kyverno: { pin: "v1.19.1", min: "1.33", max: "1.35", source: "kyverno.io/docs/installation/releases" },
  karpenter: { pin: "1.15.0", min: "1.31", max: "1.37", source: "karpenter.sh/docs/upgrading/compatibility (1.35 needs >= 1.9)" },
  lbc: { pin: "v3.6.0", min: "1.22", max: "", source: "aws-load-balancer-controller installation guide (v2.5.0+: Kubernetes 1.22+)" },
  "cert-manager": { pin: "v1.21.2", min: "1.33", max: "1.36", source: "cert-manager.io/docs/releases" },
  keda: { pin: "2.21.0", min: "1.34", max: "1.36", source: "keda.sh/docs/latest/operate/cluster (tested window)" },
  cnpg: { pin: "1.30 (chart 0.29.1)", min: "1.34", max: "1.36", source: "cloudnative-pg 1.30 supported releases" },
};

// Does every pinned add-on support `version`? [] when yes, else the ids.
export function addonsBlocking(version) {
  const m = minor(version);
  return Object.entries(ADDON_K8S).filter(([, r]) => m < minor(r.min) || (r.max && m > minor(r.max))).map(([id]) => id);
}
// kubernetesVersion "auto": the version the live cluster runs, or
// EKS_NEW_VERSION when there is none. A RUN never changes the version by itself.
export const EKS_AUTO = "auto";

export const EKS_STANDARD_USD_H = 0.1;
export const EKS_EXTENDED_FEE_USD_H = 0.5;

const DAY = 86_400_000;
const minor = (v) => Number(String(v || "").split(".")[1]);
const major = (v) => Number(String(v || "").split(".")[0]);
const at = (date) => Date.parse(`${date}T00:00:00Z`);

// { version, status: standard | extended | ended | unknown, standardEnd,
//   extendedEnd, usdPerHour, feePerHour, daysLeft (in the current window) }
export function eksSupport(version, now = Date.now()) {
  const v = String(version || "").replace(/^v/, "").split(".").slice(0, 2).join(".");
  const row = EKS_CALENDAR[v];
  if (!row) return { version: v, status: "unknown", standardEnd: "", extendedEnd: "", usdPerHour: EKS_STANDARD_USD_H, feePerHour: 0, daysLeft: null };
  const t = typeof now === "number" ? now : Date.parse(now);
  const status = t < at(row.standardEnd) ? "standard" : t < at(row.extendedEnd) ? "extended" : "ended";
  const until = status === "standard" ? at(row.standardEnd) : at(row.extendedEnd);
  const fee = status === "standard" ? 0 : EKS_EXTENDED_FEE_USD_H;
  return { version: v, status, ...row, usdPerHour: EKS_STANDARD_USD_H + fee, feePerHour: fee, daysLeft: Math.max(0, Math.ceil((until - t) / DAY)) };
}

// One minor up from `version` ("1.32" -> "1.33").
export function nextVersion(version) {
  const m = minor(version);
  return Number.isFinite(m) ? `${major(version)}.${m + 1}` : "";
}

// What a run would put on the control plane: an explicit version as set,
// "auto" (or nothing) the live one, else the new-cluster default.
export function resolveEksVersion(configured, live = "") {
  const want = String(configured || "");
  if (!want || want === EKS_AUTO) return live ? String(live) : EKS_NEW_VERSION;
  return want;
}

// "" when a live cluster on `live` may go to `target` in one up; else why not.
// No live cluster: any offered version is fine (a new cluster).
export function versionStepProblem(target, live = "") {
  if (!live || !target || target === live) return "";
  const from = minor(live);
  const to = minor(target);
  if (major(target) !== major(live) || !Number.isFinite(from) || !Number.isFinite(to)) return `kubernetesVersion ${target} is not an upgrade of the live ${live}`;
  if (to < from) return `kubernetesVersion ${target} is a downgrade: the live cluster runs ${live} and EKS never goes down a minor (set ${live} or auto)`;
  if (to > from + 1) return `kubernetesVersion ${target} skips a minor: the live cluster runs ${live} and EKS upgrades one minor at a time (UPGRADE TO ${nextVersion(live)} first, then ${target})`;
  return "";
}

// The card's one-line text for a version: "1.32 · EXTENDED SUPPORT · $0.60/h".
export function supportText(version, now = Date.now()) {
  const s = eksSupport(version, now);
  if (s.status === "standard") return `${s.version} · standard support until ${s.standardEnd} · $${s.usdPerHour.toFixed(2)}/h`;
  if (s.status === "extended") return `${s.version} · EXTENDED SUPPORT (since ${s.standardEnd}) · $${s.usdPerHour.toFixed(2)}/h, +$${s.feePerHour.toFixed(2)}/h fee`;
  if (s.status === "ended") return `${s.version} · END OF SUPPORT (${s.extendedEnd}): EKS upgrades it by itself`;
  return `${s.version} · support unknown`;
}

// The loud warning for a version on extended support ("" otherwise), with
// the next step: one minor up.
export function supportWarning(version, { live = false, now = Date.now() } = {}) {
  const s = eksSupport(version, now);
  if (s.status === "standard" || s.status === "unknown") return "";
  const who = live ? `the live cluster runs ${s.version}` : `${s.version} is selected`;
  const next = nextVersion(s.version);
  const fee = `$${s.usdPerHour.toFixed(2)}/h instead of $${EKS_STANDARD_USD_H.toFixed(2)}/h (~$${Math.round(s.feePerHour * 730)}/mo extra)`;
  const step = next && EKS_VERSIONS.includes(next) ? `; next step: UPGRADE TO ${next} (one minor at a time)` : "";
  return s.status === "ended"
    ? `⚠ END OF SUPPORT: ${who}; EKS will upgrade the control plane on its own${step}`
    : `⚠ EXTENDED SUPPORT: ${who}, billed ${fee}${step}`;
}
