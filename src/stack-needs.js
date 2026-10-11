// What a Stacks card needs on its cluster before pulumi runs, and whether it
// is there (docs/design/stack-dependencies.md). Four kinds of need:
//   eks        the EKS cluster itself (Stacks → EKS)
//   eks-addon  an EKS add-on the EKS stack installs (Pod Identity agent,
//              metrics-server, EBS CSI driver): RUN the EKS stack
//   card       another stack on the cluster (Shop API needs pgcluster)
//   addon      a cluster add-on with its own card under ADD-ONS (lbc)
// A state is ok, missing, or unknown (the read could not tell); only a
// missing need refuses a run, so a cluster Cloud Spider cannot read is never
// blocked by a guess.
import { ADDONS } from "../upgrades/addons/catalog.js";
import { needsText } from "../upgrades/eks-addons.js";
import { UPGRADES } from "./upgrade.js";

const addonOf = (id) => ADDONS.find((item) => item.id === id);
// How a card need reads in a refusal.
const LONG = { pgcluster: "the Postgres cluster" };

export function needsOf(spec, params = {}) {
  if (!spec) return [];
  const cluster = String(params.clusterName || "cloudspider-up");
  const out = [];
  const add = (need) => {
    if (!out.some((item) => item.kind === need.kind && item.id === need.id)) out.push({ cluster, ...need });
  };
  const fromId = (id, because = "") => {
    if (id === "eks") return add({ kind: "eks", id, title: `EKS ${cluster}`, open: { card: "eks", cluster } });
    const addon = addonOf(id);
    if (addon?.includedWithEks && addon.eksAddon) return add({ kind: "eks-addon", id: addon.eksAddon, title: addon.title, open: { card: "eks", cluster }, ...(because ? { because } : {}) });
    if (addon) return add({ kind: "addon", id, title: addon.title, open: { card: `${id}@${cluster}`, cluster }, ...(because ? { because } : {}) });
    const card = UPGRADES.find((item) => item.id === id);
    add({ kind: "card", id, title: card?.title || id, open: { card: id, cluster }, ...(because ? { because } : {}) });
  };
  const ids = spec.needs || [];
  if (ids.includes("eks")) fromId("eks");
  for (const name of spec.eksAddons || []) {
    const addon = ADDONS.find((item) => item.eksAddon === name);
    add({ kind: "eks-addon", id: name, title: addon?.title || name, open: { card: "eks", cluster } });
  }
  for (const id of ids) if (id !== "eks") fromId(id);
  for (const when of spec.needsWhen || []) {
    if (String(params[when.param] ?? "") !== String(when.value)) continue;
    for (const id of when.needs) fromId(id, `${when.param}=${when.value}`);
  }
  // EKS first, then EKS add-ons, then what runs on them.
  const rank = { eks: 0, "eks-addon": 1, card: 2, addon: 3 };
  return out.map((need, index) => ({ need, index })).sort((a, b) => rank[a.need.kind] - rank[b.need.kind] || a.index - b.index).map((item) => item.need);
}

// probes: { cluster, eksAddons: {name}, cards: {id}, addons: {id} }, each
// true (there), false (not there) or null/absent (could not tell).
export function needStates(needs, probes = {}) {
  const answer = (need) => {
    if (need.kind === "eks") return probes.cluster;
    if (need.kind === "eks-addon") return probes.eksAddons?.[need.id];
    if (need.kind === "card") return probes.cards?.[need.id];
    return probes.addons?.[need.id];
  };
  return needs.map((need) => {
    const value = answer(need);
    return { ...need, state: value === true ? "ok" : value === false ? "missing" : "unknown" };
  });
}

// The refusal for the first missing need ("" when nothing is missing).
export function needRefusal(spec, needs, cluster) {
  const need = needs.find((item) => item.state === "missing");
  if (!need) return "";
  const who = need.because || spec.title;
  if (need.kind === "eks") return `${who} needs the EKS cluster ${cluster}: RUN the EKS stack for it first`;
  if (need.kind === "eks-addon") return `${who} ${needsText(need.id, cluster)}`;
  if (need.kind === "card") return `${who} needs ${LONG[need.id] || `the ${need.title} stack`} (Stacks → ${need.title}, ${need.id}) on ${cluster} first: RUN that card, then this one`;
  return `${who} needs the ${need.title} add-on (${need.id}) on ${cluster} first: RUN its card under ADD-ONS`;
}
