// VAULTS as clusters with perks (Fallout perk cards). Since auto-discovery
// (#201) every deployed stack became a vault, and a cluster's add-ons
// (karpenter, kyverno, keda…) crowded out the things that serve users.
// Grouping, pure and shared by the server tests and the page:
//   cluster vaults  one per EKS cluster (the add-on tree's clusters); its
//                   add-ons are PERKS: unlocked (in the cluster) or
//                   available (INSTALL through the Stacks card, preview and
//                   approve as ever), with a rank 0-3 and a lamp
//   app vaults      what serves users (Shop API, the demo, the scaling
//                   demo), each naming the cluster vault it lives in
//   other vaults    everything else, as before
// A vault file can say where it belongs: kind: Perk or spec.perkOf: <cluster>
// makes it a perk (spec.perkId picks the perk, default its name);
// spec.perkOf: none keeps an add-on stack a top-level vault; spec.cluster
// names an app's cluster.

// Perk catalog, in grid order. effect: the one-line "+ …" a perk card shows.
// controls: the scorecard controls whose remediation installs it (kept in
// step with scorecard/controls by test/vault-perks.test.js). builtIn: comes
// with every EKS cluster (no stack of its own, nothing to install).
export const PERKS = [
  { id: "karpenter", title: "Karpenter", icon: "perk-karpenter", effect: "+ zone-aware node autoscaling, spot first", controls: ["K8S-PLT-005"] },
  { id: "lbc", title: "Load Balancer Ctrl", icon: "perk-lbc", effect: "+ ALB and NLB from Ingress and Services", controls: ["K8S-PLT-003"] },
  { id: "kyverno", title: "Kyverno", icon: "perk-kyverno", effect: "+ policy guard: audits every pod", controls: ["K8S-PLT-001", "K8S-SEC-009"] },
  { id: "keda", title: "KEDA", icon: "perk-keda", effect: "+ event-driven scaling, down to zero", controls: ["K8S-PLT-007"] },
  { id: "cert-manager", title: "cert-manager", icon: "perk-cert", effect: "+ TLS certificates that renew themselves", controls: ["K8S-PLT-004"] },
  { id: "pod-identity", title: "Pod Identity", icon: "perk-identity", effect: "+ AWS access for pods, no keys", controls: ["K8S-PLT-006"] },
  { id: "metrics-server", title: "Metrics Server", icon: "perk-metrics", effect: "+ live CPU and memory; unlocks HPA", controls: ["K8S-PLT-002", "K8S-REL-008"] },
  { id: "external-dns", title: "ExternalDNS", icon: "perk-dns", effect: "+ DNS records follow your Services", controls: [] },
  { id: "vpc-cni", title: "VPC CNI", icon: "perk-cni", effect: "+ every pod gets a VPC address", controls: [], builtIn: true },
  { id: "coredns", title: "CoreDNS", icon: "perk-coredns", effect: "+ names for every Service", controls: [], builtIn: true },
  { id: "kube-proxy", title: "kube-proxy", icon: "perk-proxy", effect: "+ Service traffic finds its pods", controls: [], builtIn: true },
  { id: "ebs-csi", title: "EBS CSI", icon: "perk-ebs", effect: "+ persistent volumes on EBS", controls: [], builtIn: true },
];
const BY_ID = new Map(PERKS.map((perk) => [perk.id, perk]));
export const perkInfo = (id) => BY_ID.get(id) || null;
// Add-on stacks that serve users: apps, not perks.
export const APP_ADDONS = new Set(["scaling-demo"]);
// EKS add-on names (a vault bound to one resource of the EKS stack).
const EKS_ADDON_PERK = { "eks-pod-identity-agent": "pod-identity", "metrics-server": "metrics-server", "vpc-cni": "vpc-cni", coredns: "coredns", "kube-proxy": "kube-proxy", "aws-ebs-csi-driver": "ebs-csi" };
const ADDON_DIR = "upgrades/addons";
const EKS_DIR = "upgrades/eks";
const CLUSTER_TAGS = new Set(["eks", "kubernetes"]);

// upgrades/addons stack "<addon>-<cluster>" → { addon, cluster }.
export function addonStack(stack, ids = [...BY_ID.keys(), ...APP_ADDONS]) {
  if (stack?.dir !== ADDON_DIR || !stack.name || stack.name.includes("*")) return null;
  const addon = [...ids].sort((a, b) => b.length - a.length).find((id) => stack.name.startsWith(`${id}-`));
  return addon ? { addon, cluster: stack.name.slice(addon.length + 1) } : null;
}

export const isClusterVault = (vault) => vault?.stack?.dir === EKS_DIR && !vault.stack.resource;

// { perk, cluster } when the vault is one of a cluster's perks, else null.
export function perkOf(vault) {
  if (!vault || vault.damaged) return null;
  if (vault.perkOf === "none") return null;
  const parsed = addonStack(vault.stack);
  const viaEks = vault.stack?.dir === EKS_DIR && vault.stack.resource ? EKS_ADDON_PERK[vault.stack.resource] : null;
  if (vault.kind === "perk" || vault.perkOf) return { perk: vault.perkId || parsed?.addon || viaEks || vault.name, cluster: vault.perkOf || parsed?.cluster || "" };
  if (parsed && !APP_ADDONS.has(parsed.addon)) return { perk: parsed.addon, cluster: parsed.cluster };
  if (viaEks) return { perk: viaEks, cluster: "" };
  return null;
}

// The cluster an app vault lives in, or "".
export function appCluster(vault, clusters = []) {
  if (vault?.cluster) return vault.cluster;
  const parsed = addonStack(vault?.stack);
  if (parsed) return parsed.cluster;
  if ((vault?.tags || []).some((tag) => CLUSTER_TAGS.has(tag))) return clusters[0] || "";
  return "";
}

const healthy = (ready, vault) => ready === true || (ready == null && vault && vault.status !== "fail" && !(vault.trouble || []).length);

// One perk card for a cluster: catalog facts + the add-on tree row + its vault.
export function perkCard(perk, { row = null, vault = null, live = true } = {}) {
  const base = { id: perk.id, title: perk.title, icon: perk.icon, effect: perk.effect, controls: perk.controls, builtIn: Boolean(perk.builtIn), vault: vault?.key || null, version: row?.version || "", source: row?.source || "", stack: row?.stack || vault?.stack?.name || "", needs: row?.missing || [] };
  if (perk.builtIn) {
    return { ...base, state: live ? "unlocked" : "available", rank: live ? 3 : 0, lamp: live ? "ok" : "off", stateText: live ? "BUILT IN" : "WITH THE CLUSTER", source: base.source || "comes with every EKS cluster" };
  }
  const state = row?.state || (vault ? "installed" : "absent");
  if (state === "n/a") return { ...base, state: "locked", rank: 0, lamp: "na", stateText: "NEEDS A DOMAIN" };
  if (state !== "installed" && state !== "present") return { ...base, state: "available", rank: 0, lamp: "off", stateText: base.needs.length ? `NEEDS ${base.needs.join(", ").toUpperCase()}` : "AVAILABLE" };
  const ok = healthy(row?.ready ?? null, vault);
  const owned = state === "installed" || Boolean(row?.included);
  const rank = 1 + (ok ? 1 : 0) + (owned ? 1 : 0);
  return { ...base, state: "unlocked", rank, lamp: !ok ? "warn" : rank === 3 ? "ok" : "warn", stateText: !ok ? "UNHEALTHY" : owned ? `RANK ${rank}` : "PRESENT · NOT OURS" };
}

// vaults: /api/vaults' list; tree: /api/addons' tree.
// → { clusters: [{ name, live, vault, perks, unlocked, healthy, available, apps }], apps: [{ vault, cluster }], vaults: [...] }
// primary: the cluster apps without a named cluster live in (the kube
// context's, /api/addons detectedCluster); else the live cluster with the
// most add-ons in it.
export function groupVaults(vaults = [], tree = [], { primary: wanted = "" } = {}) {
  const perkVaults = [];
  const clusterVaults = [];
  const rest = [];
  for (const vault of vaults) {
    const perk = perkOf(vault);
    if (perk) perkVaults.push({ vault, ...perk });
    else if (isClusterVault(vault) && vault.perkOf !== "none") clusterVaults.push(vault);
    else rest.push(vault);
  }
  const names = tree.map((item) => item.cluster);
  for (const item of perkVaults) if (item.cluster && !names.includes(item.cluster)) names.push(item.cluster);
  const filled = (item) => (item.installed || 0) + (item.present || 0);
  const liveRows = tree.filter((item) => item.live).sort((a, b) => filled(b) - filled(a));
  const primary = (names.includes(wanted) && wanted) || liveRows[0]?.cluster || names[0] || "";
  const liveNames = [primary, ...liveRows.map((item) => item.cluster).filter((name) => name !== primary)].filter(Boolean);
  for (const item of perkVaults) if (!item.cluster) item.cluster = primary;
  const clusterVault = (name) => clusterVaults.find((v) => (v.selector?.ids || []).includes(name)) || clusterVaults[0] || null;
  const apps = [];
  const others = [];
  for (const vault of rest) {
    const cluster = appCluster(vault, liveNames.length ? liveNames : names);
    if (cluster) apps.push({ vault, cluster });
    else others.push(vault);
  }
  names.sort((a, b) => Number(b === primary) - Number(a === primary));
  const clusters = names.map((name) => {
    const row = tree.find((item) => item.cluster === name);
    const live = row ? Boolean(row.live) : true;
    const mine = perkVaults.filter((item) => item.cluster === name);
    const perks = PERKS.map((perk) => perkCard(perk, { row: row?.addons?.find((a) => a.id === perk.id) || null, vault: mine.find((item) => item.perk === perk.id)?.vault || null, live }));
    // Perk vaults the catalog does not know (a kind: Perk override): their own card.
    for (const item of mine.filter((m) => !BY_ID.has(m.perk))) {
      perks.push(perkCard({ id: item.perk, title: item.vault.title || item.perk, icon: "perk-generic", effect: item.vault.description ? `+ ${item.vault.description}` : "", controls: [] }, { vault: item.vault, live }));
    }
    const unlocked = perks.filter((p) => p.state === "unlocked");
    return {
      name,
      live,
      vault: clusterVault(name),
      perks,
      unlocked: unlocked.length,
      healthy: unlocked.filter((p) => p.lamp === "ok").length,
      available: perks.filter((p) => p.state === "available").length,
      apps: apps.filter((a) => a.cluster === name).map((a) => a.vault.key),
    };
  });
  // An app whose cluster is not on the list still shows, under apps.
  return { clusters, apps, vaults: others };
}
