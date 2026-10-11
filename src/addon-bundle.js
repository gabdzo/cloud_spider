// The ADD-ONS bundle on the EKS card: a checklist of the toolbox add-ons for
// one cluster, what each costs and how many pod slots it takes, and the
// plan INSTALL SELECTED runs (dependency order, preview then up per add-on,
// stop at the first failure). Pure: the app feeds it the add-on tree
// (addons.js), what the cluster's kube context shows, and its pod room.
import { addonById } from "../upgrades/addons/catalog.js";
import { costFor, estimate } from "./stack-costs.js";

// Install order: Pod Identity first (Karpenter, LBC and KEDA get their AWS
// credentials through it), metrics-server before the HPA demo, Karpenter
// early so later pods have somewhere to go. Pod Identity and metrics-server
// are included with EKS (the EKS stack installs them): their rows show
// whether they are there, and nothing here installs them.
export const BUNDLE_ORDER = ["pod-identity", "metrics-server", "karpenter", "lbc", "cert-manager", "kyverno", "keda", "scaling-demo"];

export function bundleItems() {
  return BUNDLE_ORDER.map((id) => addonById(id)).filter((addon) => addon && addon.offered !== false);
}

// { hour, usage: [..], text, perNode } for an add-on's own lines.
export function addonCost(addon) {
  const own = estimate(costFor(addon?.cost || []));
  const node = addon?.nodeCost ? estimate(costFor(addon.nodeCost)) : null;
  const bits = [];
  bits.push(own.hour > 0 ? `$${own.hour.toFixed(4)}/h` : "free");
  if (own.usage.length) bits.push("+ use");
  if (node) bits.push(`+ $${node.hour.toFixed(4)}/h per node it adds`);
  const short = `${own.hour > 0 ? `$${own.hour.toFixed(4)}/h` : "free"}${own.usage.length ? " + use" : ""}${node ? " + nodes" : ""}`;
  return { hour: own.hour, usage: own.usage, perNode: node?.hour || 0, text: bits.join(" "), short };
}

// node: the cluster's row of addonTree(); detected: detectAddons() of the
// cluster's own context (or null); room: podRoom() or null.
export function bundleView({ cluster, node = null, detected = null, room = null, connected = false } = {}) {
  const items = bundleItems().map((addon) => {
    const row = node?.addons?.find((item) => item.id === addon.id) || null;
    const seen = detected?.[addon.id] || null;
    let state = row?.state === "installed" ? "installed" : row?.state === "present" || seen ? "present" : "absent";
    if (row?.busy) state = "busy";
    const where = state === "installed" ? row.source : state === "present" ? row?.source || seen?.where || "" : "";
    return {
      id: addon.id,
      title: addon.title,
      needs: addon.needs,
      pods: addon.pods || 0,
      cost: addonCost(addon),
      recommended: Boolean(addon.recommended),
      included: Boolean(addon.includedWithEks),
      state,
      where,
      selected: state === "absent" && Boolean(addon.recommended) && !addon.includedWithEks,
    };
  });
  return {
    cluster,
    connected,
    seen: Boolean(detected) || Boolean(node?.seen),
    room: room ? { free: room.free, capacity: room.capacity, used: room.used, waiting: room.waiting, nodes: room.nodes.length } : null,
    items,
  };
}

// What INSTALL SELECTED would do with `chosen` (add-on ids):
//   order    the ids to run, in BUNDLE_ORDER, needs added
//   skipped  [{ id, why }] already installed or present
//   added    [{ id, for }] pulled in as a need
//   need     pod slots the run adds; free: the cluster's (null: not counted)
//   refusal  "" or why it cannot start
export function bundlePlan(view, chosen = []) {
  const byId = new Map((view?.items || []).map((item) => [item.id, item]));
  const want = new Set((chosen || []).filter((id) => byId.has(id)));
  const skipped = [];
  const added = [];
  const have = (id) => ["installed", "present"].includes(byId.get(id)?.state);
  // One included with EKS comes from the EKS stack, never from here.
  const fromEks = [];
  for (const id of [...want]) {
    if (!byId.get(id)?.included) continue;
    want.delete(id);
    skipped.push({ id, why: have(id) ? `included with EKS, on the cluster (${byId.get(id).where || "EKS add-on"})` : `included with EKS: RUN the EKS stack for ${view?.cluster} (it installs it)` });
  }
  // Needs first: a chosen add-on pulls in what it needs when that is absent.
  for (const id of [...want]) {
    for (const need of byId.get(id)?.needs || []) {
      if (byId.get(need)?.included) {
        if (!have(need) && view?.seen) fromEks.push({ id: need, for: id });
        continue;
      }
      if (!want.has(need) && !have(need) && byId.has(need)) {
        want.add(need);
        added.push({ id: need, for: id });
      }
    }
  }
  const order = [];
  for (const id of BUNDLE_ORDER) {
    if (!want.has(id)) continue;
    const item = byId.get(id);
    if (item.state === "installed") skipped.push({ id, why: `already installed (${item.where})` });
    else if (item.state === "present") skipped.push({ id, why: `already on the cluster (${item.where || "from elsewhere"})` });
    else if (item.state === "busy") skipped.push({ id, why: "its stack is busy" });
    else order.push(id);
  }
  const items = order.map((id) => byId.get(id));
  const need = items.reduce((sum, item) => sum + item.pods, 0);
  const free = view?.room ? view.room.free : null;
  const hour = Math.round(items.reduce((sum, item) => sum + item.cost.hour, 0) * 10000) / 10000;
  const usage = [...new Set(items.flatMap((item) => item.cost.usage))];
  const perNode = items.find((item) => item.cost.perNode)?.cost.perNode || 0;
  let refusal = "";
  if (fromEks.length) {
    const first = fromEks[0];
    refusal = `${byId.get(first.for).title} needs ${byId.get(first.id).title}: RUN the EKS stack for ${view.cluster} (it installs ${byId.get(first.id).title})`;
  } else if (!order.length) refusal = want.size || skipped.length ? (skipped.some((skip) => byId.get(skip.id)?.included) ? "everything chosen is already on the cluster or comes with EKS" : "everything chosen is already on the cluster") : "nothing is chosen";
  else if (free != null && need > free) refusal = `the add-ons need ${need} free pod slots and ${view.cluster} has ${free}. ${slotHint(view)}`;
  return { cluster: view?.cluster || "", order, skipped, added, need, free, hour, usage, perNode, refusal };
}

export function slotHint(view) {
  const room = view?.room;
  if (!room) return "CONNECT the cluster so Cloud Spider can count its free pod slots.";
  return `Add a node first (RUN-ME §16, "Room for pods": a t4g.small holds 11 pods, a t4g.medium 17), or untick some add-ons.`;
}

// The one line under the checklist.
export function slotLine(view, plan) {
  if (!plan.order.length) return "nothing to install";
  if (plan.free == null) return `needs ${plan.need} free pod slots; not counted (${view?.connected ? "the cluster did not answer" : "not connected"})`;
  return `needs ${plan.need} free pod slots, you have ${plan.free}`;
}

// The confirm text: what will be created and what it costs per hour.
export function confirmText(view, plan) {
  const byId = new Map(view.items.map((item) => [item.id, item]));
  const lines = [`Install on ${plan.cluster}, in this order (each: preview, then up; stops at the first failure):`];
  plan.order.forEach((id, index) => {
    const item = byId.get(id);
    lines.push(`${index + 1}. ${item.title} — stack ${id}-${plan.cluster} · ${item.cost.text} · ${item.pods} pod${item.pods === 1 ? "" : "s"}`);
  });
  for (const add of plan.added) lines.push(`(${byId.get(add.id).title} added: ${byId.get(add.for).title} needs it)`);
  for (const skip of plan.skipped) lines.push(`skipped: ${byId.get(skip.id).title}, ${skip.why}`);
  lines.push(`${plan.hour ? `Adds $${plan.hour.toFixed(4)}/h while up` : "No hourly cost of their own"}${plan.usage.length ? `, plus use (${plan.usage.join("; ")})` : ""}${plan.perNode ? `; Karpenter adds about $${plan.perNode.toFixed(4)}/h per node it launches` : ""}.`);
  lines.push(slotLine(view, plan));
  return lines.join("\n");
}

export const BUNDLE_IDS = new Set(BUNDLE_ORDER);
