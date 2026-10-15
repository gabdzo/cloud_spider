// The EKS cluster on the main map: a fenced compound inside each subnet
// that holds cluster nodes. Nodes stay the subnet's buildings; the compound
// adds what runs on them, at one of three levels of detail:
//   1  the cluster and its nodes only (a summary line in the fence)
//   2  apps: one tent per workload, grouped per namespace, with replica
//      counts and a SVC flag when a Service selects it
//   3  every pod: the tents again, with one little figure per pod in front
// The data is the Cluster view's own kube diagram (kube-diagram.js), read
// with the viewer role and cached by the server. Pure: no DOM, no canvas.

export const MK = {
  PAD: 8,
  HEAD: 24,
  NS: 16,
  STALL_W: 92,
  STALL_H: 58,
  FIG_W: 14,
  FIG_H: 22,
  GAP: 8,
  LOD_W: 18,
  LOD_H: 14,
};
export const LOD_LEVELS = ["1", "2", "3", "auto"];
export const LOD_TEXT = { 1: "cluster and nodes", 2: "nodes and apps", 3: "every pod", auto: "fits the window" };
export const KUBE_MAP_KEY = "cloudspider.map.kube";
const CELL = { w: 96, h: 92, gap: 16 };

const SYSTEM = /^(kube-system|kube-public|kube-node-lease|amazon-.*|aws-.*)$/;

// A diagram (diagramFromKube) as what the map needs.
export function kubeModel(diagram, name = "") {
  const nodes = (diagram?.nodes || []).filter((n) => n.kind === "node");
  const byNodeName = new Map(nodes.map((n) => [n.host?.name || n.label, n]));
  const cp = (diagram?.nodes || []).find((n) => n.kind === "control-plane");
  const services = new Map();
  for (const edge of diagram?.edges || []) {
    if (!String(edge.from).startsWith("svc:")) continue;
    if (!services.has(edge.to)) services.set(edge.to, []);
    services.get(edge.to).push(String(edge.from).split("/").pop());
  }
  const apps = (diagram?.nodes || [])
    .filter((n) => n.kind === "workload")
    .map((n) => ({ id: n.id, ns: n.ns, label: n.label, kind: n.workloadKind || "Deployment", want: n.want ?? 0, have: n.have ?? 0, status: n.status || "ok", system: SYSTEM.test(n.ns || ""), services: services.get(n.id) || [], pods: [] }));
  const byApp = new Map(apps.map((a) => [a.id, a]));
  const loose = [];
  for (const pod of (diagram?.nodes || []).filter((n) => n.kind === "pod")) {
    const node = byNodeName.get(pod.pod?.node || "");
    const item = { id: pod.id, ns: pod.ns, label: pod.label, status: pod.status || "ok", caption: pod.caption || "", instanceId: node?.host?.instanceId || "", nodeName: pod.pod?.node || "", pod: pod.pod };
    const app = byApp.get(pod.owner);
    if (app) app.pods.push(item);
    else loose.push(item);
  }
  // Bare pods (no workload) get a tent of their own, named after the pod.
  for (const pod of loose) apps.push({ id: pod.id, ns: pod.ns, label: pod.label, kind: "Pod", want: 1, have: pod.status === "ok" ? 1 : 0, status: pod.status, system: SYSTEM.test(pod.ns || ""), services: [], pods: [pod], bare: true });
  return {
    cluster: name || cp?.label || "",
    nodes: nodes.map((n) => ({ id: n.id, name: n.host?.name || n.label, label: n.label, instanceId: n.host?.instanceId || "", status: n.status, ready: n.host?.ready })),
    apps,
    pods: apps.reduce((sum, a) => sum + a.pods.length, 0),
    netpol: diagram?.netpol || null,
    namespaces: [...new Set(apps.map((a) => a.ns))].sort((a, b) => Number(SYSTEM.test(a)) - Number(SYSTEM.test(b)) || a.localeCompare(b)),
  };
}

// AUTO: as much detail as the room allows without turning into a carpet.
export function autoLevel(model, room) {
  if (!model?.apps?.length) return 1;
  const across = Math.max(1, Math.floor((room - 2 * MK.PAD + MK.GAP) / (MK.STALL_W + MK.GAP)));
  const stallRows = model.namespaces.reduce((rows, ns) => rows + Math.ceil(model.apps.filter((a) => a.ns === ns).length / across), 0);
  if (stallRows > 10) return 1;
  if (model.pods > 40 || room < 420) return 2;
  return 3;
}

export function levelOf(choice, model, room) {
  if (choice === "1" || choice === "2" || choice === "3") return Number(choice);
  return autoLevel(model, room);
}

// Which subnet each app's tent stands in. Level 3: every subnet where it
// has pods (with those pods). Otherwise the subnet with most of its pods.
// Apps with no pods at all go to the first compound.
export function assignApps(model, nodeSubnet, level) {
  const out = new Map();
  const subnets = [...new Set(nodeSubnet.values())].sort();
  const push = (subnet, app) => {
    if (!out.has(subnet)) out.set(subnet, []);
    out.get(subnet).push(app);
  };
  for (const app of model.apps) {
    const bySubnet = new Map();
    for (const pod of app.pods) {
      const subnet = nodeSubnet.get(pod.instanceId);
      if (!subnet) continue;
      if (!bySubnet.has(subnet)) bySubnet.set(subnet, []);
      bySubnet.get(subnet).push(pod);
    }
    if (!bySubnet.size) {
      if (subnets[0]) push(subnets[0], { ...app, pods: level === 3 ? app.pods : [] });
      continue;
    }
    if (level === 3) {
      for (const [subnet, pods] of bySubnet) push(subnet, { ...app, pods, split: bySubnet.size > 1 });
    } else {
      const best = [...bySubnet.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0][0];
      push(best, app);
    }
  }
  return out;
}

function nsSummary(apps) {
  const pods = apps.reduce((sum, a) => sum + a.pods.length, 0);
  const failing = apps.filter((a) => a.status === "broken").length;
  return `${apps.length} app${apps.length === 1 ? "" : "s"} · ${pods} pod${pods === 1 ? "" : "s"}${failing ? ` · ${failing} failing` : ""}`;
}

// One compound, laid out from (0, 0); placeYard moves it into the yard.
// nodeShacks: the subnet's node buildings (faces). apps: assignApps' list
// for this subnet. room: the width the yard can give.
export function layoutCompound({ cluster, model, nodeShacks, apps, level, choice, room }) {
  const netpol = model?.netpol?.ns || null;
  const inner = Math.max(CELL.w, room - 2 * MK.PAD);
  const items = { buildings: [], stalls: [], figures: [], ns: [], lod: [], badges: [] };
  let y = MK.HEAD;
  // Node buildings.
  const cols = Math.max(1, Math.min(nodeShacks.length || 1, Math.floor((inner + CELL.gap) / (CELL.w + CELL.gap))));
  nodeShacks.forEach((shack, index) => {
    items.buildings.push({ ...shack, x: MK.PAD + (index % cols) * (CELL.w + CELL.gap), y: y + Math.floor(index / cols) * (CELL.h + CELL.gap), w: CELL.w, h: CELL.h });
  });
  let right = MK.PAD + cols * (CELL.w + CELL.gap) - CELL.gap;
  if (nodeShacks.length) y += Math.ceil(nodeShacks.length / cols) * (CELL.h + CELL.gap);
  const pods = apps.reduce((sum, a) => sum + a.pods.length, 0);
  const summary = `${nodeShacks.length} node${nodeShacks.length === 1 ? "" : "s"} · ${apps.length} app${apps.length === 1 ? "" : "s"} · ${pods} pod${pods === 1 ? "" : "s"}`;
  if (level >= 2) {
    const namespaces = [...new Set(apps.map((a) => a.ns))].sort((a, b) => Number(SYSTEM.test(a)) - Number(SYSTEM.test(b)) || a.localeCompare(b));
    for (const ns of namespaces) {
      const mine = apps.filter((a) => a.ns === ns).sort((a, b) => Number(!!a.bare) - Number(!!b.bare) || a.label.localeCompare(b.label));
      const system = SYSTEM.test(ns);
      const badge = netpol ? policyBadge(netpol[ns]) : null;
      items.ns.push({ ns, x: MK.PAD, y, w: inner - (badge ? badge.w + 4 : 0), text: `${ns}${system ? " · system" : ""} · ${nsSummary(mine)}`, system });
      if (badge) items.badges.push({ ...badge, type: "netpol", cluster, ns, x: MK.PAD + inner - badge.w, y: y + 2, h: MK.NS - 4 });
      y += MK.NS;
      // Level 2 folds the system namespaces to their line; 3 shows them.
      if (system && level < 3) {
        y += 2;
        continue;
      }
      let x = MK.PAD;
      let rowH = 0;
      for (const app of mine) {
        const figs = level === 3 ? app.pods.length : 0;
        const w = Math.max(MK.STALL_W, figs ? MK.PAD + figs * MK.FIG_W + 4 : 0);
        const h = MK.STALL_H + (figs ? MK.FIG_H + 2 : 0);
        if (x > MK.PAD && x + w > MK.PAD + inner) {
          x = MK.PAD;
          y += rowH + MK.GAP;
          rowH = 0;
        }
        const stall = { type: "app", id: app.id, cluster, ns: app.ns, label: app.label, kind: app.kind, count: app.bare ? "" : `${app.have}/${app.want}`, status: app.status, services: app.services, system, split: !!app.split, x, y, w: Math.min(w, inner), h };
        items.stalls.push(stall);
        if (figs) {
          app.pods.forEach((pod, index) => {
            items.figures.push({ type: "pod", id: pod.id, cluster, ns: pod.ns, label: pod.label, caption: pod.caption, status: pod.status, app: app.id, x: x + 4 + index * MK.FIG_W, y: y + MK.STALL_H, w: MK.FIG_W - 2, h: MK.FIG_H });
          });
        }
        x += w + MK.GAP;
        right = Math.max(right, x - MK.GAP);
        rowH = Math.max(rowH, h);
      }
      y += rowH + MK.GAP;
    }
  }
  const w = Math.min(room, Math.max(right + MK.PAD, 384));
  // Badges sit at the compound's right edge; the ns line stops before them.
  for (const bd of items.badges) {
    bd.x = w - MK.PAD - bd.w;
    const line = items.ns.find((l) => l.ns === bd.ns);
    if (line) line.w = Math.max(40, bd.x - 4 - line.x);
  }
  // LOD switch, top right: 1 2 3 A.
  LOD_LEVELS.forEach((value, index) => {
    const lw = value === "auto" ? MK.LOD_W + 8 : MK.LOD_W;
    const lx = w - MK.PAD - (3 * MK.LOD_W + MK.LOD_W + 8 + 6) + index * (MK.LOD_W + 2);
    items.lod.push({ type: "lod", cluster, value, active: String(choice) === value, shown: String(level) === value, x: lx, y: 5, w: lw, h: MK.LOD_H });
  });
  return { cluster, level, choice, summary, w, h: Math.max(y, MK.HEAD + 20) + 2, ...items };
}

// Moves a compound (and everything in it) to x, y.
export function moveCompound(compound, x, y) {
  const shift = (item) => ({ ...item, x: item.x + x, y: item.y + y });
  return {
    ...compound,
    x,
    y,
    buildings: compound.buildings.map(shift),
    stalls: compound.stalls.map(shift),
    figures: compound.figures.map(shift),
    ns: compound.ns.map(shift),
    lod: compound.lod.map(shift),
    badges: (compound.badges || []).map(shift),
  };
}

// Every compound on a laid-out map.
export function compoundsOf(placed) {
  const out = [];
  for (const settlement of placed?.settlements || []) for (const plot of settlement.plots || []) if (plot.compound) out.push(plot.compound);
  return out;
}

// The KUBE chip left of the LOD switch: the compound's kube connection
// (CONNECTED / NO ACCESS), a click opens its EKS card.
export const KUBE_CHIP_W = 52;
export function kubeChip(compound) {
  const first = compound.lod[0];
  return { type: "kube", cluster: compound.cluster, x: first.x - KUBE_CHIP_W - 6, y: first.y, w: KUBE_CHIP_W, h: first.h };
}

// What is under the pointer: the KUBE chip, a LOD button, a pod, an app, or the compound.
export function compoundHit(placed, x, y) {
  const inside = (item) => x >= item.x && x < item.x + item.w && y >= item.y && y < item.y + item.h;
  for (const compound of compoundsOf(placed)) {
    if (!inside(compound)) continue;
    const lod = compound.lod.find(inside);
    if (lod) return { ...lod };
    const chip = kubeChip(compound);
    if (inside(chip)) return chip;
    const badge = (compound.badges || []).find(inside);
    if (badge) return { ...badge };
    const pod = compound.figures.find(inside);
    if (pod) return { ...pod };
    const app = compound.stalls.find(inside);
    if (app) return { ...app };
    if (y < compound.y + MK.HEAD) return { type: "compound", cluster: compound.cluster };
    return null;
  }
  return null;
}

export function compoundHover(hit) {
  if (!hit) return "";
  if (hit.type === "netpol") return badgeHover(hit);
  if (hit.type === "lod") return `detail ${hit.value === "auto" ? "AUTO" : hit.value}: ${LOD_TEXT[hit.value]}`;
  if (hit.type === "pod") return `${hit.ns}/${hit.label}${hit.caption ? ` · ${hit.caption}` : ""} · click: deep-inspect in the Cluster view`;
  if (hit.type === "app") return `${hit.kind} ${hit.ns}/${hit.label}${hit.count ? ` · ${hit.count} ready` : ""}${hit.services.length ? ` · svc ${hit.services.join(", ")}` : ""} · click: open in the Cluster view`;
  if (hit.type === "compound") return `${hit.cluster}: open the Cluster view`;
  if (hit.type === "kube") return hit.text || `${hit.cluster}: kube connection · click: CONNECT / DISCONNECT`;
  return "";
}

export function readKubeChoices(storage) {
  try {
    const saved = JSON.parse(storage?.getItem(KUBE_MAP_KEY) || "{}");
    return saved && typeof saved === "object" && !Array.isArray(saved) ? Object.fromEntries(Object.entries(saved).filter(([, v]) => LOD_LEVELS.includes(v))) : {};
  } catch {
    return {};
  }
}

// The namespace's NetworkPolicy badge (netpol-model.js): DENY · n when a
// policy picks every pod (one badge for ingress and egress), PARTIAL when
// some pods have no policy, OPEN when none does. No summary: no badge.
export function policyBadge(summary) {
  if (!summary) return { badge: "open", text: "OPEN", w: 34, policies: [], uncovered: 0 };
  const n = summary.policies.length;
  const text = summary.badge === "deny" ? `DENY · ${n}` : summary.badge === "partial" ? `PARTIAL · ${n}` : "OPEN";
  return { badge: summary.badge, text, w: 10 + text.length * 5.6, policies: summary.policies.map((p) => p.name), denyIn: !!summary.denyIn, denyOut: !!summary.denyOut, uncovered: summary.uncovered || 0 };
}

export function badgeHover(hit) {
  if (hit.badge === "open") return `${hit.ns}: no NetworkPolicy · every pod accepts traffic from anywhere in the cluster`;
  const dirs = [hit.denyIn && "ingress", hit.denyOut && "egress"].filter(Boolean).join(" + ");
  const head = hit.badge === "deny" ? `${hit.ns}: default deny${dirs ? ` (${dirs})` : ""}` : `${hit.ns}: ${hit.uncovered} workload${hit.uncovered === 1 ? "" : "s"} with no NetworkPolicy`;
  const names = hit.policies.slice(0, 6).join(", ") + (hit.policies.length > 6 ? ` +${hit.policies.length - 6}` : "");
  return `${head} · ${names}`;
}
