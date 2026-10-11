// Cluster add-ons per cluster, for the Stacks view: which of the toolbox
// (upgrades/addons/catalog.js) each cluster has, from two read-only sources:
//   1. Pulumi: `pulumi stack ls --json` in upgrades/addons (stacks are
//      <addon>-<cluster>) and `pulumi stack output --json` for the ones with
//      resources (the deployed version)
//   2. inside the cluster the kube context points at: Deployments and
//      DaemonSets the catalog recognises, so an add-on another stack made
//      (the demo stack's metrics-server) shows as PRESENT
// Nothing here changes anything.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADDONS, DIR, displayVersion, parseStack, stackName } from "../upgrades/addons/catalog.js";
import { roomRefusal } from "../upgrades/addons/pod-room.js";
import { childEnvFor, capture } from "./upgrade.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const ADDON_TTL = 60_000;

// The version a workload runs: its app.kubernetes.io/version label, else the
// first container's image tag.
function workloadVersion(item) {
  const labels = item?.metadata?.labels || {};
  if (labels["app.kubernetes.io/version"]) return String(labels["app.kubernetes.io/version"]);
  const image = item?.spec?.template?.spec?.containers?.[0]?.image || "";
  const tag = String(image).split("@")[0].split("/").pop().split(":")[1] || "";
  return tag;
}

// { addonId: { version, where } } for what the snapshot shows.
export function detectAddons(snapshot) {
  const found = {};
  if (!snapshot) return found;
  const look = (items, kind) => {
    for (const item of items || []) {
      const name = item?.metadata?.name || "";
      const ns = item?.metadata?.namespace || "";
      for (const addon of ADDONS) {
        const names = addon.detect?.[kind] || [];
        if (!names.includes(name) || found[addon.id]) continue;
        found[addon.id] = { version: workloadVersion(item), where: `${kind} ${ns}/${name}`, ready: ready(item, kind) };
      }
    }
  };
  look(snapshot.deployments, "deployment");
  look(snapshot.daemonsets, "daemonset");
  // The scaling demo is its HPAs on the demo app.
  if ((snapshot.hpas || []).some((item) => item?.metadata?.labels?.["app.kubernetes.io/part-of"] === "cloudspider-addons")) {
    found["scaling-demo"] = { version: "", where: "hpa demo/web, demo/api", ready: true };
  }
  return found;
}

function ready(item, kind) {
  const status = item?.status || {};
  if (kind === "daemonset") return (status.numberReady || 0) >= (status.desiredNumberScheduled || 0) && (status.desiredNumberScheduled || 0) > 0;
  return (status.readyReplicas || 0) >= Math.max(1, item?.spec?.replicas ?? 1);
}

// The tree the Stacks view draws: clusters (live ones first), each with
// every add-on in catalog order and its state:
//   installed  this toolbox's stack holds resources (version from its outputs)
//   present    in the cluster, but not from an add-on stack (demo, by hand)
//   absent     neither
//   n/a        not offered (ExternalDNS: needs a domain)
// plus what it still needs (needs that are not installed or present).
export function addonTree({ clusters = [], stacks = [], outputs = {}, detected = {}, detectedCluster = "" } = {}) {
  const byCluster = new Map();
  for (const name of clusters) byCluster.set(name, { live: true });
  const ours = new Map();
  for (const row of stacks) {
    const parsed = parseStack(row?.name);
    if (!parsed) continue;
    if (!byCluster.has(parsed.cluster)) byCluster.set(parsed.cluster, { live: false });
    ours.set(`${parsed.addon}|${parsed.cluster}`, row);
  }
  return [...byCluster.entries()]
    .sort((a, b) => Number(b[1].live) - Number(a[1].live) || a[0].localeCompare(b[0]))
    .map(([cluster, info]) => {
      const seen = cluster === detectedCluster ? detected : null;
      const addons = ADDONS.map((addon) => {
        const stack = stackName(addon.id, cluster);
        const row = ours.get(`${addon.id}|${cluster}`);
        const resources = Number.isInteger(row?.resourceCount) ? row.resourceCount : 0;
        const inCluster = seen?.[addon.id];
        let state = "absent";
        let version = "";
        let source = "";
        if (addon.offered === false) state = inCluster ? "present" : "n/a";
        if (row && resources > 0) {
          state = "installed";
          version = String(outputs[stack]?.version || inCluster?.version || displayVersion(addon));
          source = `stack ${stack}`;
        } else if (inCluster) {
          state = "present";
          version = inCluster.version || displayVersion(addon);
          source = inCluster.where;
        }
        return {
          id: addon.id,
          title: addon.title,
          state,
          version,
          pinned: displayVersion(addon),
          source,
          stack,
          resources,
          busy: Boolean(row?.updateInProgress),
          ready: inCluster ? inCluster.ready : null,
          recommended: Boolean(addon.recommended),
          offered: addon.offered !== false,
          needs: addon.needs,
        };
      });
      const have = new Set(addons.filter((item) => item.state === "installed" || item.state === "present").map((item) => item.id));
      for (const item of addons) item.missing = item.needs.filter((need) => !have.has(need));
      return {
        cluster,
        live: info.live,
        seen: Boolean(seen),
        installed: addons.filter((item) => item.state === "installed").length,
        present: addons.filter((item) => item.state === "present").length,
        addons,
      };
    });
}

// Why an `up` should not run: the add-on is already there from elsewhere
// (the demo's metrics-server), or what it needs is missing.
// room: podRoom() of that cluster when the viewer read it (pod-room.js).
export function refuseUp(tree, addonId, cluster, room = null) {
  const node = (tree || []).find((item) => item.cluster === cluster);
  const addon = node?.addons.find((item) => item.id === addonId);
  if (!addon) return "";
  if (addon.state === "present") return `${addon.title} is already on ${cluster} (${addon.source}); nothing to add`;
  if (addon.state !== "installed") {
    const tight = roomRefusal(ADDONS.find((item) => item.id === addonId), room, cluster);
    if (tight) return tight;
  }
  // Missing needs only count when the viewer context could look inside this
  // cluster; otherwise "not seen" is not "not there".
  if (addon.missing?.length && node.seen) return `${addon.title} needs ${addon.missing.join(", ")} on ${cluster} first`;
  return "";
}

export function createAddons({ run = spawn, cwd = root, env = process.env, clock = () => Date.now(), eks = null, kube = null, ttl = ADDON_TTL } = {}) {
  let cache = null;
  let flight = null;
  const directory = join(cwd, DIR);
  async function read() {
    const childEnv = childEnvFor(env);
    const notes = [];
    const listed = await capture(run, directory, childEnv, ["stack", "ls", "--json"]);
    let stacks = [];
    if (listed.error) notes.push(`pulumi stack ls: ${listed.error.split("\n").pop()}`);
    else {
      try {
        stacks = JSON.parse(listed.text);
      } catch {
        notes.push("pulumi stack ls did not answer JSON");
      }
    }
    const outputs = {};
    await Promise.all(stacks.filter((row) => parseStack(row?.name) && row.resourceCount > 0).map(async (row) => {
      const out = await capture(run, directory, childEnv, ["stack", "output", "--json", "--stack", row.name]);
      if (out.error) return;
      try {
        outputs[row.name] = JSON.parse(out.text);
      } catch {
        // version unknown
      }
    }));
    let clusters = [];
    if (eks?.listClusters) {
      const answer = await eks.listClusters().catch((error) => ({ error: error?.message || "ListClusters failed" }));
      if (answer.error) notes.push(answer.error);
      else clusters = answer.names || [];
    }
    let detected = {};
    let detectedCluster = "";
    if (kube?.ops) {
      const snap = await kube.ops().catch(() => null);
      if (snap && !snap.error) {
        detectedCluster = snap.clusterName;
        detected = detectAddons(snap);
      }
    }
    return { tree: addonTree({ clusters, stacks, outputs, detected, detectedCluster }), notes, detectedCluster, at: clock() };
  }
  return {
    async view({ fresh = false } = {}) {
      if (!fresh && cache && clock() - cache.at < ttl) return cache;
      if (!flight) {
        flight = read().then((value) => {
          cache = value;
          return value;
        }).finally(() => {
          flight = null;
        });
      }
      return flight;
    },
    forget() {
      cache = null;
    },
  };
}

export function sampleAddons() {
  const stacks = [
    { name: "kyverno-cloudspider-up", resourceCount: 9 },
    { name: "karpenter-cloudspider-up", resourceCount: 39 },
    { name: "scaling-demo-cloudspider-up", resourceCount: 9 },
    { name: "cert-manager-cloudspider-lab", resourceCount: 6 },
  ];
  const outputs = { "kyverno-cloudspider-up": { version: "v1.19.1" }, "karpenter-cloudspider-up": { version: "1.15.0" }, "cert-manager-cloudspider-lab": { version: "v1.21.2" } };
  const detected = {
    "pod-identity": { version: "v1.3.10-eksbuild.1", where: "daemonset kube-system/eks-pod-identity-agent", ready: true },
    "metrics-server": { version: "v0.8.0-eksbuild.2", where: "deployment kube-system/metrics-server", ready: true },
    kyverno: { version: "v1.19.1", where: "deployment kyverno/kyverno-admission-controller", ready: true },
    karpenter: { version: "1.15.0", where: "deployment kube-system/karpenter", ready: true },
  };
  return { tree: addonTree({ clusters: ["cloudspider-up", "cloudspider-lab"], stacks, outputs, detected, detectedCluster: "cloudspider-up" }), notes: [], detectedCluster: "cloudspider-up", sample: true };
}
