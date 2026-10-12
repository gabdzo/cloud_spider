import { originAllowed } from "./origin.js";
import { createReach, fetchOpenApi, reachAllowed } from "./reach.js";
import { ingressRoutes, listenerRoutes, openApiRoutes, rootRoute } from "./alb-routes.js";
import { isInstanceId } from "./ids.js";
import { report } from "./report.js";
import { pickRegion, readPlace } from "./map.js";
import { attemptVerb } from "./verbs.js";
import { createWaits } from "./waits.js";
import { createRadio } from "./radio.js";
import { readLogs } from "./logs.js";
import { readPath } from "./path-read.js";
import { pathResult, withPeers } from "./path-view.js";
import { costFailure } from "./cost.js";
import { diagramFromClusters } from "./cluster.js";
import { diagramFromKube } from "./kube-diagram.js";
import { createTelemetry } from "./kube-telemetry.js";
import { inspectPod } from "./kube-inspect.js";
import { opsView, sampleOps } from "./kube-ops.js";
import { demoAppSeen, detectAddons, refuseUp, sampleAddons } from "./addons.js";
import { HELD_BY, destroyRefusal } from "../upgrades/eks-addons.js";
import { needRefusal, needStates, needsOf } from "./stack-needs.js";
import { shopReadiness } from "./shop-check.js";
import { waitingLines } from "./run-waiting.js";
import { bundleById, bundleConfirm, bundleSteps, stackBundlePlan } from "./stack-bundles.js";
import { costFor, estimate } from "./stack-costs.js";
import { UPGRADES } from "./upgrade.js";
import { kubeCard } from "./modules.js";
import { BUNDLE_IDS, bundlePlan, bundleView, confirmText, slotLine } from "./addon-bundle.js";
import { daemonSetCheck, daemonSetRoom, podRoom } from "../upgrades/addons/pod-room.js";
import { buildTable, describe, findObject, viewFor, yamlOf } from "./kube-table.js";
import { sampleClusterSnapshot } from "./kube-sample.js";
import { addonById } from "../upgrades/addons/catalog.js";
import { createClusterSlo, createSloLedger } from "./slo.js";
import { campFixtures, nodeGroupChange, runHint, watchLine } from "./upgrade-rules.js";
import { CONNECT_REGION, connectCommand, connectionOf, contextsForCluster, sameEndpoint, validCluster, viewerAlias } from "./kube-connect.js";
import { sampleTerraformState } from "./terraform.js";
import { createLinkCache } from "./aws-path.js";
import { createMetricsCache, sampleMetrics, SLO_PERIOD, SLO_TTL, SLO_WINDOW, sloSpecs } from "./metrics.js";
import { idleCandidates, morningReport, nextIdleStreak } from "./layout.js";
import { createHealthWatch, morningLine, stuckPending } from "./kube-health.js";
import { DEFAULT_POLL_MS, scopeText } from "./kube-contexts.js";

const CALL = { stop: "StopInstances", start: "StartInstances" };
const ACCOUNT_HINT = "Set AWS_PROFILE=default and AWS_REGION=eu-north-1.";
const COST_TTL = 6 * 60 * 60 * 1000;
const WATCH_MS = 15_000;
// The map is re-read in the background once it is this old, so a VPC, a
// cluster or a node made after the page opened shows up without a restart.
export const PLACE_TTL = 60_000;

function accountRead(error) {
  return `${ACCOUNT_HINT} ${error}`;
}

export const KUBE_VIEW_TTL = 5_000;
export const KUBE_MAP_TTL = 30_000;

// How long RUN waits for the EKS card's live read (instance type check).
const LIVE_MS = 20_000;
// The NEEDS check before a run: bounded, no answer is no refusal.
const NEEDS_MS = 40_000;
// How often a running stack's pods are checked for what they wait on.
const WAIT_MS = Number(process.env.CLOUDSPIDER_WAIT_MS) || 20_000;

export function createApp({ ec2, trail, logs, metrics, path, peers = null, cost, upgrade, terraform, learn, eks, vaults, agent, kube, kubeContexts, telemetry, addons, sloLedger, logGroup, pageOrigin, clock, write, connector, loadKubeContexts, settings = null, autoConnect = undefined, regionsAllow = [], costTtl = COST_TTL }) {
  // The modules view main.js hands over (settings.modules): aws off = k8s-only.
  const awsOffHere = () => settings?.modules?.modules?.find((m) => m.id === "aws")?.on === false;
  const stdout = [];
  const sink = {
    push(line) {
      stdout.push(line);
      if (write) write(`${line}\n`);
    },
  };
  let region = "";
  let regions = [];
  let place = null;
  const reachProbe = createReach();
  const routeCache = new Map();
  const openApiCache = new Map();
  let placeAt = 0;
  let placeFlight = null;
  let error = "";
  let status = "";
  let loading = true;
  let generation = 0;
  let radioAt = 0;
  let booted = null;
  let costCache = null;
  let costFlight = null;
  let watchCache = null;
  let sawRunning = false;
  // OPS per kube context: context name -> { at, value } and the read in flight.
  const opsCaches = new Map();
  const opsFlights = new Map();
  // The idle-fire guard: per object, how many target reads in a row it
  // looked idle on (layout.js nextIdleStreak).
  let idleStreak = {};
  const radio = createRadio({
    lookup: (next) => trail.lookupEvents(next),
  });

  const now = typeof clock === "function" ? clock : Date.now;
  const tele = telemetry || (kube ? createTelemetry({ kube, clock: now }) : null);
  // TELEMETRY per kube context: the primary one keeps `tele` (and its hour
  // of history); any other gets its own sampler the first time it is shown.
  const teles = new Map();
  function teleFor(ctx) {
    if (!ctx) return null;
    if (tele && (ctx.kube === kube || !ctx.kube)) return tele;
    const had = teles.get(ctx.name);
    if (had && had.kube === ctx.kube) return had.tele;
    const made = { kube: ctx.kube, tele: createTelemetry({ kube: ctx.kube, clock: now }) };
    teles.set(ctx.name, made);
    return made.tele;
  }
  // The context a screen asked for: "" is the primary one; an unknown name is
  // refused (never read, never another context instead).
  function screenContext(name) {
    const wanted = String(name || "");
    if (!wanted) return { ctx: primary || (kube ? { name: kube.context, namespaces: kube.scope || "*", kube, primary: true } : null) };
    const ctx = contexts.find((c) => c.name === wanted);
    return ctx ? { ctx } : { error: `no kube context named ${wanted.slice(0, 80)} (cloudspider.yaml kube.contexts or cloudspider.contexts.yaml lists them)` };
  }
  function scopeFacts(ctx) {
    const list = Array.isArray(ctx?.namespaces) ? ctx.namespaces : Array.isArray(ctx?.kube?.scope) ? ctx.kube.scope : null;
    return { context: ctx?.name || "", clusterWide: !list, namespaces: list || [] };
  }

  // SLOs (slo.js): one ledger for vaults and the cluster, filled from reads
  // the app makes anyway (main.js keeps it on disk across restarts).
  const ledger = sloLedger || createSloLedger({ clock: now });
  const clusterSlo = createClusterSlo({ ledger, clock: now });
  let sloCluster = null;
  // context name -> its cluster's name, for every context read so far.
  const sloClusters = new Map();
  function sloClusterList() {
    return contexts.filter((ctx) => sloClusters.has(ctx.name)).map((ctx) => ({ context: ctx.name, cluster: sloClusters.get(ctx.name), primary: ctx.primary }));
  }
  // One kube snapshot shared by the Cluster view and the map's compound
  // (map-kube.js): one read in flight, reused for maxAge. Each fresh read
  // also feeds the cluster SLOs.
  // Every kube context (kube-contexts.js) keeps its own client and its own
  // snapshot cache, and feeds the cluster SLOs (within its namespaces). The
  // first is the primary one (`kube`), the only one behind the map,
  // TELEMETRY and OPS.
  const contexts = (kubeContexts?.length ? kubeContexts : kube ? [{ name: kube.context, label: kube.context, namespaces: kube.scope || "*", pollMs: DEFAULT_POLL_MS, kube }] : []).map((ctx, index) => ({ ...ctx, primary: index === 0 }));
  let primary = contexts[0] || null;
  if (primary && !kube) kube = primary.kube;
  // Hot reload (cloudspider.contexts.yaml changed, or CONNECT added one):
  // contexts that stay keep their client, cache and health; new ones join,
  // gone ones leave. The first stays the primary one.
  function setContexts(next = []) {
    const keep = new Map(contexts.map((ctx) => [ctx.name, ctx]));
    const list = next.filter((ctx) => ctx?.name && ctx.kube).map((ctx, index) => {
      const old = keep.get(ctx.name);
      const same = old && JSON.stringify(old.namespaces) === JSON.stringify(ctx.namespaces) && old.pollMs === ctx.pollMs;
      return same ? { ...old, label: ctx.label, primary: index === 0 } : { ...ctx, primary: index === 0 };
    });
    if (!list.length) return contextNames();
    for (const ctx of contexts) {
      if (!list.some((item) => item.name === ctx.name)) {
        kubeCaches.delete(ctx.name);
        polledAt.delete(ctx.name);
      }
    }
    contexts.splice(0, contexts.length, ...list);
    if (primary?.name !== contexts[0].name) {
      primary = contexts[0];
      kube = primary.kube;
      kubeCaches.delete(primary.name);
    } else {
      primary = contexts[0];
    }
    return contextNames();
  }
  function contextNames() {
    return contexts.map((ctx) => ctx.name);
  }
  async function reloadContexts() {
    if (!loadKubeContexts) return { error: "contexts cannot be reloaded here" };
    const got = await loadKubeContexts().catch((failure) => ({ error: failure?.message || "the contexts did not load", contexts: [] }));
    if (got.error && !got.contexts?.length) return { error: got.error };
    return { names: setContexts(got.contexts || []), source: got.source || "", errors: got.errors || [] };
  }
  const kubeCaches = new Map();
  const kubeFlights = new Map();
  const polledAt = new Map();
  const health = createHealthWatch({ clock: now });
  // CONNECT's access check, cached a minute per context.
  const probes = new Map();
  // A cluster's API endpoint (eks DescribeCluster, read-only), kept 10 min.
  const endpoints = new Map();
  async function endpointOf(cluster) {
    const hit = endpoints.get(cluster);
    if (hit && now() - hit.at < 600_000) return hit.value;
    const out = eks?.describeCluster ? await eks.describeCluster(cluster).catch(() => ({})) : {};
    const value = String(out?.endpoint || "");
    if (value) endpoints.set(cluster, { at: now(), value });
    return value;
  }
  async function probeContext(ctx, { fresh = false } = {}) {
    const hit = probes.get(ctx.name);
    if (!fresh && hit && now() - hit.at < 60_000) return hit.value;
    const got = ctx.kube?.probe ? await ctx.kube.probe().catch((failure) => ({ error: failure?.message || "the cluster did not answer" })) : { ok: true };
    const text = String(got.error || "");
    const value = got.ok ? { ok: true } : { noAccess: Boolean(got.unauthorized || got.forbidden || /401|forbidden|AccessDenied|not authorized to perform: sts:AssumeRole/i.test(text)), error: text };
    probes.set(ctx.name, { at: now(), value });
    return value;
  }
  function noAccessHint(cluster) {
    return `The cluster does not let the viewer role ${viewerAlias(cluster)} in (no access entry, or you may not assume the role). RUN the EKS card again for ${cluster}: its stack makes the access entry. Check: aws eks list-access-entries --cluster-name ${cluster} --region ${CONNECT_REGION}`;
  }
  function connectSteps(cluster, st, current = "") {
    const alias = viewerAlias(cluster);
    const steps = [];
    steps.push({ text: `back up ${connector.kubeconfigPath()} to ${connector.backupPath()}`, fn: () => connector.backupKubeconfig() });
    if (st.context) {
      steps.push({ text: `context ${st.context} already reads ${cluster} with its viewer role: nothing to write`, fn: async () => ({ skipped: true, lines: ["CONNECTED already; the kubeconfig is not touched"] }) });
    } else {
      steps.push({ cmd: "aws", args: connectCommand({ cluster, roleArn: st.roleArn }), text: `aws ${connectCommand({ cluster, roleArn: st.roleArn }).join(" ")}` });
      // update-kubeconfig switches the current context; put it back (or
      // unset it again when there was none).
      if (current) steps.push({ cmd: "kubectl", args: ["config", "use-context", current], text: `kubectl config use-context ${current}   (update-kubeconfig switched it; put it back)` });
      else steps.push({ cmd: "kubectl", args: ["config", "unset", "current-context"], text: "kubectl config unset current-context   (there was none; update-kubeconfig set one)" });
    }
    const name = st.context || alias;
    steps.push({ text: `add ${name} to cloudspider.contexts.yaml`, fn: () => connector.addToList({ context: name, label: cluster.replace(/^cloudspider-/, "").toUpperCase().slice(0, 24) || cluster, namespaces: "*" }, contexts) });
    steps.push({ text: "reload Cloud Spider's kube contexts (no restart)", fn: async () => {
      const got = await reloadContexts();
      if (got.error) return { error: got.error };
      if (!got.names.includes(name)) {
        return { error: `${name} is not among the contexts after the reload`, hint: got.source === "CLOUDSPIDER_KUBE_CONTEXTS" ? `CLOUDSPIDER_KUBE_CONTEXTS is set and wins over cloudspider.contexts.yaml: add ";${name}:*" to it and restart.` : `Check cloudspider.contexts.yaml${got.errors?.length ? `: ${got.errors.join("; ")}` : ""}.` };
      }
      return { lines: [`contexts now: ${got.names.join(", ")}`] };
    } });
    steps.push({ text: `check the viewer role can read ${cluster} (one GET)`, fn: async () => {
      const ctx = contexts.find((item) => item.name === name);
      const access = ctx ? await probeContext(ctx, { fresh: true }) : { error: "the context is not loaded" };
      if (access.ok) return { lines: [`CONNECTED: ${name} reads ${cluster}`] };
      if (access.noAccess) return { error: `NO ACCESS: ${access.error}`, hint: noAccessHint(cluster) };
      return { error: `the cluster did not answer: ${access.error}` };
    } });
    return steps;
  }
  // USE IT: an existing context that reads this cluster with another user
  // or role. Listed, reloaded, then one GET; refused access takes it out
  // of the list again. The kubeconfig is never written.
  function adoptSteps(cluster, name) {
    const steps = [];
    steps.push({ text: `add ${name} to cloudspider.contexts.yaml`, fn: () => connector.addToList({ context: name, label: cluster.replace(/^cloudspider-/, "").toUpperCase().slice(0, 24) || cluster, namespaces: "*" }, contexts) });
    steps.push({ text: "reload Cloud Spider's kube contexts (no restart)", fn: async () => {
      const got = await reloadContexts();
      if (got.error) return { error: got.error };
      if (!got.names.includes(name)) return { error: `${name} is not among the contexts after the reload`, hint: got.source === "CLOUDSPIDER_KUBE_CONTEXTS" ? `CLOUDSPIDER_KUBE_CONTEXTS is set and wins over cloudspider.contexts.yaml: add ";${name}:*" to it and restart.` : "Check cloudspider.contexts.yaml." };
      return { lines: [`contexts now: ${got.names.join(", ")}`] };
    } });
    steps.push({ text: `check ${name} can read ${cluster} (one GET)`, fn: async () => {
      const ctx = contexts.find((item) => item.name === name);
      const access = ctx ? await probeContext(ctx, { fresh: true }) : { error: "the context is not loaded" };
      if (access.ok) return { lines: [`CONNECTED: ${name} reads ${cluster}`] };
      await connector.removeFromList(name).catch(() => null);
      await reloadContexts().catch(() => null);
      probes.delete(name);
      const left = `${name} was taken out of cloudspider.contexts.yaml again`;
      if (access.noAccess) return { error: `NO ACCESS: ${access.error}; ${left}`, hint: `${name} cannot read ${cluster}. Rename it (kubectl config rename-context ${name} <other>) and press CONNECT to make the viewer context.` };
      return { error: `the cluster did not answer: ${access.error}; ${left}` };
    } });
    return steps;
  }
  function disconnectSteps(conn) {
    const steps = [{ text: `back up ${connector.kubeconfigPath()} to ${connector.backupPath()}`, fn: () => connector.backupKubeconfig() }];
    steps.push({ cmd: "kubectl", args: ["config", "delete-context", conn.alias], text: `kubectl config delete-context ${conn.alias}` });
    if (conn.userIsOurs && !conn.userShared) steps.push({ cmd: "kubectl", args: ["config", "delete-user", conn.alias], text: `kubectl config delete-user ${conn.alias}` });
    // update-kubeconfig also wrote the cluster entry; without this the
    // kubeconfig kept it after DISCONNECT (live test 2026-10-11).
    if (conn.clusterEntry) steps.push({ cmd: "kubectl", args: ["config", "delete-cluster", conn.clusterEntry], text: `kubectl config delete-cluster ${conn.clusterEntry}` });
    steps.push({ text: `remove ${conn.alias} from cloudspider.contexts.yaml`, fn: () => connector.removeFromList(conn.alias, contexts) });
    steps.push({ text: "reload Cloud Spider's kube contexts (no restart)", fn: async () => {
      const got = await reloadContexts();
      probes.delete(conn.alias);
      return got.error ? { error: got.error } : { lines: [`contexts now: ${got.names.join(", ")}`] };
    } });
    return steps;
  }
  // Pods stuck in Pending: their namespaces' events (GET, cached 60 s,
  // at most 3 namespaces a read) so the radio can say why, e.g.
  // FailedAttachVolume / Multi-Attach (drill 2026-10-11, finding 11).
  const pendingEvents = new Map();
  async function withPendingEvents(ctx, snap) {
    if (!snap || snap.error || !ctx.kube?.events) return snap;
    const stuck = stuckPending(snap, now());
    if (!stuck.length) return snap;
    const namespaces = [...new Set(stuck.map((pod) => pod.metadata?.namespace).filter(Boolean))].slice(0, 3);
    const items = [];
    for (const ns of namespaces) {
      const key = `${ctx.name}|${ns}`;
      const hit = pendingEvents.get(key);
      if (hit && now() - hit.at < 60_000) {
        items.push(...hit.items);
        continue;
      }
      const got = await ctx.kube.events(ns).catch(() => ({ items: [] }));
      const list = (got?.items || []).filter((e) => e?.type === "Warning" && e.involvedObject?.kind === "Pod");
      pendingEvents.set(key, { at: now(), items: list });
      items.push(...list);
    }
    return { ...snap, podEvents: items };
  }
  async function readContext(ctx, maxAge) {
    const cached = kubeCaches.get(ctx.name);
    if (cached && now() - cached.at < maxAge) return cached.snap;
    if (!kubeFlights.has(ctx.name)) {
      const flight = Promise.resolve()
        .then(() => ctx.kube.snapshot())
        .catch((failure) => ({ error: failure?.message || "the cluster did not answer" }))
        .then((snap) => withPendingEvents(ctx, snap))
        .then((snap) => {
          const name = snap.clusterName || sloClusters.get(ctx.name) || (ctx.primary ? sloCluster : null) || ctx.name;
          if (!snap.unset) {
            sloClusters.set(ctx.name, name);
            clusterSlo.record(name, snap, { from: ctx.name, namespaces: ctx.namespaces });
          }
          if (ctx.primary && snap.clusterName) sloCluster = snap.clusterName;
          kubeCaches.set(ctx.name, { at: now(), snap });
          polledAt.set(ctx.name, now());
          health.take(ctx, snap);
          return snap;
        })
        .finally(() => {
          kubeFlights.delete(ctx.name);
        });
      kubeFlights.set(ctx.name, flight);
    }
    return kubeFlights.get(ctx.name);
  }
  // kube.autoConnect (default on): after an EKS RUN on Stacks the cluster is
  // CONNECTed, after TAKE IT DOWN it is DISCONNECTed. Each run has its own
  // log (the cluster stack's run log); the outcome goes on the radio.
  const autoConnectOn = autoConnect ?? settings?.config?.kube?.autoConnect ?? true;
  const connectNotes = [];
  function connectNote(status, text) {
    connectNotes.unshift({ time: now(), status, text, issue: "", count: 1, key: `connect|${now()}|${text}` });
    if (connectNotes.length > 6) connectNotes.length = 6;
  }
  async function autoConnectAfter(cluster, done) {
    if (done?.error || done?.state !== "done") return;
    const st = await api.connectStatus(cluster, { fresh: true }).catch((failure) => ({ state: "error", text: failure?.message || "no answer" }));
    if (st.state === "connected") {
      connectNote("ok", `EKS ${cluster}: ${st.text}`);
      return;
    }
    const action = st.state === "clash-same" ? "adopt" : ["not-connected", "not-listed"].includes(st.state) ? "connect" : "";
    if (!action) {
      connectNote("warn", `EKS ${cluster} is up but not connected: ${st.text}${st.hint ? ` · ${st.hint}` : ""}`);
      return;
    }
    const started = await api.connectRun(pageOrigin, { cluster, action, onDone: async (run) => {
      const after = run?.state === "done" ? await api.connectStatus(cluster, { fresh: true }).catch(() => null) : null;
      if (after?.state === "connected") connectNote("ok", `EKS ${cluster} connected by itself after its RUN: ${after.text} (current context unchanged)`);
      else connectNote("fail", `EKS ${cluster}: auto CONNECT ${run?.state === "done" ? `ended ${after?.text || "not connected"}` : `failed: ${run?.error || "see its log"}`} · press CONNECT on Stacks › EKS`);
    } }).catch((failure) => ({ error: failure?.message || "did not start" }));
    if (started?.error) connectNote("warn", `EKS ${cluster}: auto CONNECT did not start (${started.error}) · press CONNECT on Stacks › EKS`);
  }
  // After TAKE IT DOWN: CONNECT's own context goes (kubeconfig and list);
  // a context it did not make is only taken out of the contexts file.
  async function autoDisconnectAfter(cluster, done) {
    if (done?.error || done?.state !== "done") return;
    const st = await api.connectStatus(cluster, { fresh: true }).catch(() => null);
    endpoints.delete(cluster);
    if (st?.context && st.ours) {
      const started = await api.connectRun(pageOrigin, { cluster, action: "disconnect", onDone: (run) => {
        connectNote(run?.state === "done" ? "ok" : "fail", run?.state === "done" ? `EKS ${cluster} is down: ${st.context} removed from the kubeconfig and the contexts (current context unchanged)` : `EKS ${cluster} is down; auto DISCONNECT failed: ${run?.error || "see its log"}`);
      } }).catch((failure) => ({ error: failure?.message || "did not start" }));
      if (started?.error) connectNote("warn", `EKS ${cluster} is down; auto DISCONNECT did not start (${started.error})`);
      return;
    }
    const listed = contexts.filter((ctx) => ctx.origin !== "config" && (ctx.name === viewerAlias(cluster) || ctx.name === st?.context || sloClusters.get(ctx.name) === cluster));
    if (!listed.length) return;
    const steps = listed.flatMap((ctx) => [{ text: `remove ${ctx.name} from cloudspider.contexts.yaml (the kubeconfig is not touched: CONNECT did not make it)`, fn: () => connector.removeFromList(ctx.name, contexts) }]);
    steps.push({ text: "reload Cloud Spider's kube contexts (no restart)", fn: async () => {
      const got = await reloadContexts();
      for (const ctx of listed) probes.delete(ctx.name);
      return got.error ? { error: got.error } : { lines: [`contexts now: ${got.names.join(", ")}`] };
    } });
    const started = upgrade.runSteps({ module: "eks", action: "forget", stack: st?.stack || "", steps, onDone: (run) => {
      connectNote(run?.state === "done" ? "ok" : "fail", `EKS ${cluster} is down: ${listed.map((ctx) => ctx.name).join(", ")} ${run?.state === "done" ? "taken out of the contexts file" : "not taken out of the contexts file"}`);
    } });
    if (started?.error) connectNote("warn", `EKS ${cluster} is down; its contexts were not taken out of the list (${started.error})`);
  }
  // cluster -> { items, stage, text }: add-ons queued behind a create.
  const bundleQueue = new Map();
  function queueSay(cluster, stage, text) {
    const item = bundleQueue.get(cluster);
    if (item) bundleQueue.set(cluster, { ...item, stage, text });
  }
  async function afterCreate(cluster, items, done) {
    if (done?.error || done?.state !== "done") {
      queueSay(cluster, "stopped", `add-ons not installed: the cluster run ${done?.state || "stopped"}`);
      return;
    }
    const st = await api.connectStatus(cluster).catch(() => null);
    const install = async () => {
      queueSay(cluster, "add-ons", `installing ${items.length} add-on${items.length === 1 ? "" : "s"}`);
      const started = await api.bundleRun(pageOrigin, { cluster, items }).catch((failure) => ({ error: failure?.message || "the add-ons did not start" }));
      if (started?.error) queueSay(cluster, "stopped", `add-ons not installed: ${started.error}`);
      else bundleQueue.delete(cluster);
    };
    if (st?.state === "connected") return install();
    queueSay(cluster, "connect", "connecting the cluster");
    const started = await api.connectRun(pageOrigin, { cluster, action: "connect", onDone: async (connected) => {
      const after = connected?.state === "done" ? await api.connectStatus(cluster, { fresh: true }).catch(() => null) : null;
      if (after?.state === "connected") return install();
      queueSay(cluster, "stopped", `add-ons not installed: CONNECT ${connected?.state === "done" ? `ended ${after?.text || "not connected"}` : "failed"}`);
    } }).catch((failure) => ({ error: failure?.message }));
    if (started?.error) queueSay(cluster, "stopped", `add-ons not installed: CONNECT did not start (${started.error})`);
  }
  const k9sEvents = new Map(); // context -> { at, items, note }
  async function k9sRead(name, sample, wantEvents) {
    if (sample) {
      const snap = sampleClusterSnapshot();
      return { ctx: { name: "sample", label: "SAMPLE" }, scope: "*", snap, events: snap.events || [], at: now() };
    }
    const ctx = contextFor(name);
    if (!ctx) return { error: "the kube context is not set up" };
    // The watch keeps this fresh; the window never adds a poll of its own.
    const snap = await readContext(ctx, Math.max(15_000, ctx.pollMs || 0));
    if (snap?.error) return { error: snap.error, ctx };
    let events = [];
    let eventNote = "";
    if (wantEvents && ctx.kube.events) {
      const hit = k9sEvents.get(ctx.name);
      if (hit && now() - hit.at < 15_000) ({ items: events, note: eventNote } = hit);
      else {
        const got = await ctx.kube.events().catch((failure) => ({ error: failure?.message || "events did not answer" }));
        events = got.items || [];
        eventNote = got.error || "";
        k9sEvents.set(ctx.name, { at: now(), items: events, note: eventNote });
      }
    }
    return { ctx, scope: Array.isArray(ctx.namespaces) ? ctx.namespaces : "*", snap, events, eventNote, at: kubeCaches.get(ctx.name)?.at || now() };
  }
  async function readKube(maxAge) {
    return readContext(primary, maxAge);
  }
  function contextList() {
    return contexts.map((ctx) => ({ ...health.summary(ctx), primary: ctx.primary, poll: ctx.pollMs }));
  }
  function contextFor(name) {
    return name ? contexts.find((ctx) => ctx.name === name) || null : primary;
  }
  async function contextView(ctx) {
    const snap = await readContext(ctx, KUBE_VIEW_TTL);
    if (snap.error) {
      return { context: ctx.name, error: "", unset: !!snap.unset, reason: snap.error, diagram: null, headline: "", note: snap.unset ? `kube context ${ctx.name}: ${snap.error} (docs/RUN-ME.md §19)` : `kube context ${ctx.name}: ${snap.error}` };
    }
    return {
      context: ctx.name,
      error: "",
      diagram: diagramFromKube(snap, { cluster: { name: snap.clusterName } }),
      slos: clusterSlo.view(sloClusters.get(ctx.name) || snap.clusterName || ctx.name),
      headline: "",
      note: [`inside ${snap.clusterName} via kube context ${ctx.name} (read-only, ${scopeText(ctx.namespaces)})`, ...(snap.notes || [])].join(" · "),
    };
  }
  const linkCache = createLinkCache({
    read: (name, balancers) => path.targetLines(name, balancers),
    clock: now,
  });

  const metricsCache = createMetricsCache({
    read: (name, queries, range) => (typeof metrics?.read === "function" ? metrics.read(name, queries, range) : { error: "metrics are not set up" }),
    clock: now,
  });
  // The SLO reader: one-minute points for the ALBs a vault's alb SLO needs
  // (and nothing else), read by watchSlos in the background, cached 60 s.
  const sloMetricsCache = createMetricsCache({
    read: (name, queries, range) => (typeof metrics?.read === "function" ? metrics.read(name, queries, range) : { error: "metrics are not set up" }),
    clock: now,
    ttl: SLO_TTL,
    period: SLO_PERIOD,
    window: SLO_WINDOW,
    kinds: ["alb"],
  });
  let sloAlbIds = new Set();
  // The last vault evaluation's SLO answers, for the morning's HURTING.
  let lastSlos = [];
  // Stacks still up on a cluster: add-on stacks with resources (the add-on
  // tree) and pgcluster / shopapi / demo whose clusterName is this cluster.
  // Read-only; a read that fails counts nothing.
  // The kube read of one cluster, through the context CONNECT made for it
  // (or the primary one when that is the same cluster); null if none.
  async function clusterSnapshot(cluster) {
    const conn = connector ? await api.connectStatus(cluster).catch(() => null) : null;
    const ctx = conn?.state === "connected" ? contexts.find((item) => item.name === conn.context) : null;
    if (ctx) return readContext(ctx, 30_000).catch(() => null);
    const snap = primary ? await readContext(primary, 30_000).catch(() => null) : null;
    return snap && !snap.error && (snap.clusterName === cluster || String(snap.clusterName || "").endsWith(`/${cluster}`)) ? snap : null;
  }
  // scaling-demo's HPAs scale demo/web and demo/api (the EKS demo app). Not
  // seen there (or not checked): hpa off, demoApp absent, and a note in the
  // run log, instead of an up that fails on namespaces "demo" not found.
  async function scalingDemoCheck(cluster, params = {}) {
    const seen = demoAppSeen(await clusterSnapshot(cluster));
    const present = seen === true;
    const wanted = String(params.hpa ?? "on") === "on";
    const next = { ...params, demoApp: present ? "present" : "absent", ...(present ? {} : { hpa: "off" }) };
    if (!wanted || present) return { params: next, notes: [] };
    const why = seen === false
      ? `the EKS demo app (namespace demo, web and api) is not on ${cluster}`
      : `could not check ${cluster} for the EKS demo app (CONNECT it so Cloud Spider can read it)`;
    return { params: next, notes: [{ text: `check: the EKS demo app on ${cluster}`, lines: [`HPA on demo/web+api skipped: ${why}. Deploy the EKS demo app first (Stacks → EKS demo app), then run scaling-demo again for its HPAs. burst and inflate run as asked.`] }] };
  }

  // What a card's needs look like on its cluster (src/stack-needs.js):
  // true there, false not there, null could not tell. Read-only: EKS
  // ListClusters / DescribeAddon, the kube read through the connected
  // context, the add-on tree, the stacks' outputs.
  async function needProbes(needs, cluster, params = {}) {
    const probes = { eksAddons: {}, cards: {}, addons: {} };
    const listed = eks?.listClusters ? await eks.listClusters().catch(() => null) : null;
    probes.cluster = listed && !listed.error && Array.isArray(listed.names) ? listed.names.includes(cluster) : null;
    if (probes.cluster === false) return probes;
    for (const need of needs.filter((item) => item.kind === "eks-addon")) {
      const got = eks?.describeAddon ? await eks.describeAddon(cluster, need.id).catch(() => null) : null;
      probes.eksAddons[need.id] = got && !got.error && typeof got.found === "boolean" ? got.found : null;
    }
    const kube = needs.some((item) => item.kind === "card" || item.kind === "addon");
    const snap = kube ? await clusterSnapshot(cluster) : null;
    const whole = snap && !snap.error && !Array.isArray(snap.scope);
    for (const need of needs.filter((item) => item.kind === "card")) {
      let seen = need.id === "pgcluster" ? shopReadiness(snap, { dbSecret: params.dbSecret }) : need.id === "demo" ? demoAppSeen(snap) : null;
      // Not seen in the kube read: a stack with resources on this cluster still counts.
      if (seen !== true && upgrade?.dependentsOf) {
        const stacks = await upgrade.dependentsOf(cluster).catch(() => null);
        if (stacks?.includes(need.id)) seen = true;
      }
      probes.cards[need.id] = seen;
    }
    const addonNeeds = needs.filter((item) => item.kind === "addon");
    if (addonNeeds.length) {
      const tree = addons?.view ? await addons.view({ fresh: true }).catch(() => null) : null;
      const node = tree?.tree?.find((item) => item.cluster === cluster);
      const found = whole ? detectAddons(snap) : {};
      for (const need of addonNeeds) {
        const row = node?.addons?.find((item) => item.id === need.id);
        if (row && ["installed", "present"].includes(row.state)) probes.addons[need.id] = true;
        else if (whole) probes.addons[need.id] = Boolean(found[need.id]);
        else probes.addons[need.id] = row && node.seen ? false : null;
      }
    }
    return probes;
  }

  async function stackNeeds(module, params = {}) {
    const spec = UPGRADES.find((item) => item.id === module);
    if (!spec) return { error: "no such stack", needs: [], refusal: "" };
    const cluster = String(params.clusterName || "cloudspider-up");
    const needs = needsOf(spec, params);
    if (!needs.length) return { module, cluster, needs: [], refusal: "" };
    const states = needStates(needs, await needProbes(needs, cluster, params));
    return { module, cluster, needs: states, refusal: needRefusal(spec, states, cluster) };
  }

  // While a stack's run goes, every WAIT_MS: why its pods wait (not
  // scheduled, image pull, crash loop), from the kube read through the
  // connected context, into the run pane. Each distinct line once; stops
  // when the run ends.
  function watchWaiting(stack, cluster, namespaces) {
    if (!upgrade?.say || !namespaces?.length) return;
    const said = new Set();
    const tick = async () => {
      if (!upgrade.say(stack, "")) return;
      const snap = await clusterSnapshot(cluster).catch(() => null);
      for (const line of waitingLines(snap, namespaces)) {
        if (said.has(line)) continue;
        said.add(line);
        if (!upgrade.say(stack, line)) return;
      }
      setTimeout(tick, WAIT_MS).unref?.();
    };
    setTimeout(tick, WAIT_MS).unref?.();
  }

  async function stacksOn(cluster) {
    const found = [];
    const tree = addons?.view ? await addons.view({ fresh: true }).catch(() => null) : null;
    const node = tree?.tree?.find((item) => item.cluster === cluster);
    for (const item of node?.addons || []) if (item.state === "installed") found.push(`${item.id}-${cluster}`);
    if (upgrade?.dependentsOf) found.push(...(await upgrade.dependentsOf(cluster).catch(() => [])));
    return found;
  }

  function keepSlos(view) {
    lastSlos = (view?.vaults || []).flatMap((vault) => (vault.slos || []).map((slo) => ({ vault: vault.name || vault.key, name: slo.name, flag: slo.flag, fast: slo.fast, burn: slo.burn, owned: vault.owned || [] })));
  }
  let sloPercentiles = ["p95"];
  let sloWatch = { at: 0, albs: 0, error: "" };
  // The map's 5-minute answer with the SLO reader's ALB points on top.
  function sloMetrics() {
    const base = metricsCache.peek(region);
    const fine = sloMetricsCache.peek(region);
    if (!fine?.targets) return base;
    return { ...(base || { region }), targets: { ...(base?.targets || {}), ...fine.targets } };
  }
  // Which owned ALBs the vaults' alb SLOs read (and which percentiles).
  function albIdsOf(view) {
    const ids = new Set();
    const pcts = new Set();
    const albs = new Set((place?.fixtures || []).filter((item) => item.kind === "alb").map((item) => item.id));
    for (const vault of view?.vaults || []) {
      const mine = (vault.slos || []).filter((slo) => slo.source === "alb");
      if (!mine.length) continue;
      for (const slo of mine) if (slo.percentile) pcts.add(slo.percentile);
      for (const id of vault.owned || []) if (albs.has(id)) ids.add(id);
    }
    sloPercentiles = pcts.size ? [...pcts].sort() : ["p95"];
    return ids;
  }

  function stampLinks() {
    if (!place) return;
    const cached = linkCache.current(region);
    if (!cached.known) return;
    place.links = cached.edges;
    place.linkNote = cached.error || "";
    place.linksRead = true;
    place.targetCounts = cached.counts || {};
    idleStreak = nextIdleStreak(idleStreak, idleCandidates(place).map((item) => item.id), cached.at);
  }

  // The morning: three sentences from reads already made. The bill is the
  // six-hour cache only; this never calls Cost Explorer.
  function morning() {
    if (!place) return null;
    const report = morningReport({
      place,
      metrics: sloMetrics(),
      slos: lastSlos,
      events: radio.changes(),
      trail: radio.trailState(),
      bill: costCache?.bill || null,
      idleStreak,
    });
    // One line per kube context that has been read: counts and the worst pods.
    const pods = contexts.filter((ctx) => polledAt.has(ctx.name)).map((ctx) => health.summary(ctx)).filter((sum) => sum.lamp !== "off").map((sum) => ({ context: sum.context, label: sum.label, ...morningLine(sum) }));
    return pods.length ? { ...report, pods } : report;
  }

  const waits = createWaits({
    describe: (gotRegion, id) => ec2.describeInstance(gotRegion, id),
    redraw: (gotRegion) => loadPlace(gotRegion),
  });

  async function loadPlace(next) {
    const mine = ++generation;
    placeAt = now();
    const result = await readPlace(ec2, next);
    if (mine !== generation || next !== region) return;
    if (result.error) {
      place = null;
      error = accountRead(result.error);
      report(sink, { call: "DescribeInstances", sentence: error });
      return;
    }
    error = "";
    // A re-read keeps the camp shelf (merged per view from Pulumi state)
    // so the camp does not blink out between the read and the next merge.
    const camp = place && place.region === result.place.region ? (place.fixtures || []).filter((item) => item.camp) : [];
    const own = new Set(result.place.fixtures.map((item) => item.id));
    result.place.fixtures = [...result.place.fixtures, ...camp.filter((item) => !own.has(item.id))];
    if (place?.shelfNote) result.place.shelfNote = place.shelfNote;
    place = result.place;
  }

  function applyUpdates(updates) {
    if (!place) return;
    for (const update of updates) {
      if (!update.state) continue;
      const found = place.instances.find((item) => item.id === update.id);
      if (found) found.state = update.state;
    }
  }

  function view() {
    stampLinks();
    return {
      region,
      regions,
      place,
      error,
      status,
      radio: radio.line(),
      trail: radio.entries(),
      morning: morning(),
      loading,
      pageOrigin,
    };
  }

  const api = {
    // The page's own origin: the server answers 403 to a write from any other.
    pageOrigin,
    // The effective config (config.js effectiveConfig: redacted, with
    // sources) for /api/config and the settings panel; null in tests.
    settings() {
      return settings;
    },
    stdout,
    fail(call, error) {
      report(sink, { call, sentence: error?.message || "the read failed" });
    },
    view,
    // Re-read the map when it is older than PLACE_TTL. One read at a time;
    // the caller does not have to wait (the next two-second pull sees it).
    freshen() {
      if (!region || !place || placeFlight) return placeFlight;
      if (now() - placeAt < PLACE_TTL) return null;
      placeFlight = loadPlace(region)
        .catch((failure) => report(sink, { call: "DescribeVpcs", sentence: failure?.message || "the re-read failed" }))
        .finally(() => {
          placeFlight = null;
        });
      return placeFlight;
    },
    kickLinks() {
      if (!place || typeof path?.targetLines !== "function") return;
      const balancers = (place.fixtures || []).filter((item) => item.kind === "alb");
      linkCache.kick(region, balancers);
    },
    async mergeCamp(grain) {
      if (region !== "eu-north-1" || !place || typeof upgrade?.campShelf !== "function") return;
      let shelf;
      try {
        shelf = await upgrade.campShelf();
      } catch {
        shelf = { resources: [], error: "the camp shelf did not load" };
      }
      if (shelf?.error) {
        place.shelfNote = shelf.error;
        return;
      }
      place.shelfNote = "";
      const extras = campFixtures(shelf?.resources, grain).map((item) => ({ ...item, camp: true }));
      // The account read (Lambda, tagging API) can see the camp's pieces
      // too; the camp's own copy (with its wires) wins.
      const arns = new Set(extras.map((item) => item.arn).filter(Boolean));
      const names = new Set(extras.map((item) => `${item.kind}|${item.name}`));
      const own = (place.fixtures || []).filter((item) => !item.camp && !(item.arn && arns.has(item.arn)) && !names.has(`${item.kind}|${item.name}`));
      place.fixtures = [...own, ...extras];
    },
    async boot() {
      if (!booted) booted = loadBoot();
      await booted;
      if (error) booted = null;
      return view();
    },
    async stop(requestOrigin, id) {
      return verb("stop", requestOrigin, id);
    },
    async start(requestOrigin, id) {
      return verb("start", requestOrigin, id);
    },
    async poll(at = clock()) {
      const result = await waits.poll(at);
      applyUpdates(result.updates);
      if (result.status) {
        status = result.status;
        for (const item of result.fresh) {
          report(sink, {
            call: "DescribeInstances",
            id: item.status.split(" ")[0],
            sentence: item.status,
          });
        }
      }
      return view();
    },
    async refreshRadio(force = false) {
      const at = clock();
      if (!region || (!force && at - radioAt < 30_000)) return view();
      radioAt = at;
      await radio.refresh(region);
      return view();
    },
    async switchRegion(next) {
      if (!regions.includes(next)) {
        status = report(sink, {
          call: "DescribeRegions",
          sentence: "that region is not enabled",
        });
        return view();
      }
      const cancelled = waits.cancelRegion(region);
      region = next;
      place = null;
      idleStreak = {};
      radio.clear();
      if (cancelled.count > 0) {
        status = cancelled.status;
        report(sink, { call: "DescribeRegions", sentence: cancelled.status });
      }
      await loadPlace(next);
      radioAt = clock();
      await radio.refresh(next);
      return view();
    },
    // REACH: GET a public load balancer's URL from this machine (the map's
    // OPEN strip, the vault and the card show the lamp). Only hosts that
    // are public load balancers on the map.
    async reach(url) {
      const allowed = reachAllowed(url, place?.fixtures || []);
      if (!allowed) return { ok: false, status: 0, error: "only a public load balancer on the map can be probed" };
      return reachProbe(allowed.url);
    },
    // ALB ROUTES: the Ingress rules behind a public ALB on the map (read
    // through the kube context), else its listener rules; plus PostgREST's
    // root OpenAPI paths. Reads only; cached 60 s, the OpenAPI 5 min.
    async albRoutes(id) {
      const alb = (place?.fixtures || []).find((item) => item.id === id && item.kind === "alb");
      if (!alb) return { id, error: "no such load balancer on the map", routes: [] };
      if (!alb.public) return { id, error: "only public load balancers list routes", routes: [] };
      const hit = routeCache.get(id);
      if (hit && now() - hit.at < 60_000) return hit.value;
      let routes = [];
      let from = "";
      const notes = [];
      if (kube) {
        try {
          const snap = await readKube(KUBE_VIEW_TTL);
          if (!snap.error) routes = ingressRoutes(alb, snap.ingresses || []);
          if (routes.length) from = "ingress";
        } catch (err) {
          notes.push(`Ingress read: ${err?.message || err}`);
        }
      }
      if (!routes.length && path?.listeners && region) {
        const listeners = await path.listeners(region, alb.id);
        if (listeners.error) notes.push(`DescribeListeners: ${listeners.error}`);
        const rules = [];
        for (const listener of listeners.items || []) {
          const out = await path.rules(region, listener.arn);
          if (out.error) notes.push(`DescribeRules: ${out.error}`);
          rules.push(...(out.items || []));
        }
        const groups = rules.length && path.targetGroups ? await path.targetGroups(region) : { items: [] };
        routes = listenerRoutes(alb, { listeners: listeners.items || [], rules, targetGroups: groups.items || [] });
        if (routes.length) from = "listener";
      }
      const base = rootRoute(routes);
      let api = [];
      if (base) {
        const cached = openApiCache.get(base.url);
        const doc = cached && now() - cached.at < 300_000 ? cached.doc : await fetchOpenApi(base.url, place?.fixtures || []);
        if (!cached || cached.doc !== doc) openApiCache.set(base.url, { doc, at: now() });
        api = openApiRoutes(alb, doc, base);
      }
      const value = { id, from, openapi: api.length > 0, routes: [...routes, ...api], notes };
      routeCache.set(id, { value, at: now() });
      return value;
    },
    async logsFor(id) {
      const result = await readLogs({ logs, logGroup, region, id });
      if (result.note) {
        report(sink, { call: "GetLogEvents", id, sentence: result.note });
      }
      return result;
    },
    upgrades() {
      const cards = upgrade?.list?.() || [];
      return awsOffHere() ? cards.filter(kubeCard) : cards;
    },
    // Terraform stacks: listed with their commands; state is read-only.
    terraformStacks() {
      return terraform?.list?.() || [];
    },
    async terraformState(id = "", { fresh = false, sample = false } = {}) {
      if (sample) return sampleTerraformState(id);
      if (!terraform?.state) return { error: "terraform is not set up" };
      try {
        return await terraform.state(String(id), { fresh });
      } catch (failure) {
        return { error: failure?.message || "terraform did not answer" };
      }
    },
    // LEARN: the lab shelf. Listing is read-only; a check or a progress
    // change needs a same-origin POST like every other action.
    learnList({ sample = false } = {}) {
      if (!learn?.list) return { tracks: [], labs: [], progress: {} };
      const list = learn.list();
      return sample ? { ...list, progress: {}, sample: true } : list;
    },
    async learnCheck(requestOrigin, body = {}) {
      if (!originAllowed(requestOrigin, pageOrigin)) return { error: "the check did not run" };
      if (!learn?.check) return { error: "labs are not set up" };
      return learn.check(String(body?.key || ""), { sample: Boolean(body?.sample), attempt: Number(body?.attempt) || 0 });
    },
    learnProgress(requestOrigin, body = {}) {
      if (!originAllowed(requestOrigin, pageOrigin)) return { error: "progress was not saved" };
      if (!learn?.progress) return { error: "labs are not set up" };
      const change = {};
      if (Number.isFinite(Number(body?.hints))) change.hints = Number(body.hints);
      if (body?.started) change.started = true;
      if (body?.reset) change.reset = true;
      return learn.progress(String(body?.key || ""), change);
    },
    async upgradeStatus(module = "", fresh = false, values = {}) {
      // The card's own stack (its live run or its last run on disk); the
      // old single job when the upgrade object is a simple stand-in.
      const job = module && upgrade?.statusFor
        ? await upgrade.statusFor(module, values).catch(() => upgrade?.status?.() || { running: false, lines: [] })
        : upgrade?.status?.() || { running: false, lines: [] };
      if (!module || !upgrade?.facts) return job;
      if (sawRunning && !job.running) fresh = true;
      sawRunning = Boolean(job.running);
      const at = clock();
      const watchKey = `${module}|${values.clusterName || values.name || ""}`;
      if (!fresh && watchCache && watchCache.module === watchKey && at - watchCache.at < WATCH_MS) {
        return { ...job, watch: watchCache.line };
      }
      const history = await upgrade.facts(module, values);
      let cluster = null;
      if (module === "eks") {
        try {
          cluster = eks?.describeCluster
            ? await eks.describeCluster(history.name || values.clusterName || "cloudspider-up")
            : { error: "the cluster did not answer" };
        } catch (error) {
          cluster = { error: error?.message || "the cluster did not answer" };
        }
      }
      const line = history.error
        ? { status: "fail", text: history.error }
        : watchLine({ cluster, history });
      watchCache = { module: watchKey, at, line };
      return { ...job, watch: line };
    },
    // The TERMINAL: only an explicit same-origin POST starts the agent.
    agentAsk(requestOrigin, body = {}, send = () => {}) {
      if (!originAllowed(requestOrigin, pageOrigin)) return { status: 403, error: "the agent did not run" };
      if (!agent) return { status: 503, error: "the agent is not set up" };
      return agent.ask({ question: body.question, context: body.context, sample: body.sample === true, send });
    },
    agentCancel(requestOrigin) {
      if (!originAllowed(requestOrigin, pageOrigin)) return { status: 403, error: "nothing was cancelled" };
      return agent ? agent.cancel() : { cancelled: false };
    },
    // ---- CONNECT: a viewer kube context per EKS cluster (kube-connect.js) ----
    contextNames,
    reloadContexts,
    // The kube client for a context by name, from the live list (so a
    // context CONNECT just added is found without a restart); "" is the
    // primary one. SCORE scans through this.
    kubeOf(name = "") {
      if (!name) return kube || null;
      return contexts.find((ctx) => ctx.name === name)?.kube || null;
    },
    async connectStatus(cluster = "", { fresh = false, inAccount = false } = {}) {
      if (!validCluster(cluster)) return { cluster, state: "error", text: "not a cluster name", hint: "" };
      if (!connector || !upgrade?.outputs) return { cluster, state: "error", text: "CONNECT is not set up", hint: "" };
      const out = await upgrade.outputs("eks", { clusterName: cluster }, { fresh }).catch((failure) => ({ error: failure?.message || "pulumi did not answer" }));
      const roleArn = String(out?.outputs?.viewerRoleArn || "");
      const kc = await connector.readKubeconfig();
      const conn = connectionOf(kc.config, { cluster, roleArn });
      const base = { cluster, stack: out?.stack || "", alias: conn.alias, context: conn.match, ours: conn.ours, roleArn, kubeconfig: kc.path };
      if (kc.error) return { ...base, state: "error", text: kc.error, hint: "Fix or restore the kubeconfig (a backup is ~/.kube/config.cloudspider.bak after a CONNECT)." };
      if (!conn.match) {
        if (!roleArn) {
          // A cluster made outside Stacks (or one whose stack has no viewer
          // role): any kube context that reads it counts. Listed: it is
          // connected; in the kubeconfig only: FOUND, USE IT lists it.
          const found = contextsForCluster(kc.config, cluster);
          const pick = found.find((c) => contexts.some((item) => item.name === c.name)) || found[0];
          if (pick) {
            const listed = contexts.find((item) => item.name === pick.name);
            const other = pick.role ? `role ${pick.role.split("/").pop()}` : "your own user";
            if (listed) {
              const access = await probeContext(listed);
              if (access.noAccess) return { ...base, context: pick.name, state: "no-access", text: "NO ACCESS", hint: `${pick.name} reads ${cluster} with ${other}, and the cluster refuses it.`, detail: access.error };
              return { ...base, context: pick.name, adopted: true, state: "connected", text: `CONNECTED as ${pick.name} (${other})`, hint: access.ok ? "" : access.error || "" };
            }
            return { ...base, state: "clash-same", adopt: pick.name, text: `kube context ${pick.name} already reads ${cluster} (${other})`, hint: `USE IT checks with one GET that ${pick.name} can read ${cluster} and adds it to Cloud Spider; the kubeconfig is not touched.` };
          }
          // inAccount: connectAll saw it in eks list-clusters, so it is up.
          if (out?.missing && inAccount) {
            return { ...base, state: "outside", text: "NOT CONNECTED", hint: `${cluster} was made outside Stacks, so there is no viewer role to CONNECT with. On this Mac: aws eks update-kubeconfig --region ${CONNECT_REGION} --name ${cluster} --alias ${cluster} (it switches kubectl to that context; add && kubectl config use-context <yours> to switch back). The lamp then says FOUND and USE IT adds it.` };
          }
          return { ...base, state: "no-cluster", text: out?.missing ? `no stack ${out.stack} yet` : `stack ${out?.stack || "?"} has no viewer role output${out?.error ? ` (${String(out.error).split("\n").pop()})` : ""}`, hint: out?.error && !out.missing ? runHint(out.error).hint || "pulumi could not read the cluster's stack; see the error." : "RUN the cluster on the Stacks EKS card first; CONNECT needs its viewer role." };
        }
        if (conn.clash) {
          // Same API server: the cluster, read with another user or role.
          // USE IT adopts it (one GET first); otherwise only a rename helps.
          const endpoint = await endpointOf(cluster);
          if (endpoint && sameEndpoint(endpoint, conn.clashServer)) {
            const listed = contexts.find((item) => item.name === conn.clash);
            const other = `${conn.clashRole ? `role ${conn.clashRole.split("/").pop()}` : "another user"}`;
            if (listed) {
              const access = await probeContext(listed);
              if (access.noAccess) return { ...base, context: conn.clash, state: "no-access", text: "NO ACCESS", hint: `${conn.clash} reads ${cluster} with ${other}, and the cluster refuses it. ${noAccessHint(cluster)}`, detail: access.error };
              return { ...base, context: conn.clash, adopted: true, state: "connected", text: `CONNECTED as ${conn.clash} (${other})`, hint: access.ok ? "" : access.error || "" };
            }
            return { ...base, state: "clash-same", adopt: conn.clash, text: `kube context ${conn.clash} already reads ${cluster} (${other})`, hint: `USE IT checks with one GET that ${conn.clash} can read ${cluster} and adds it to Cloud Spider; the kubeconfig is not touched.` };
          }
          const why = endpoint ? `it points at ${conn.clashServer || "another server"}, not ${cluster} (${endpoint})` : `Cloud Spider could not read ${cluster}'s endpoint to compare`;
          return { ...base, state: "error", text: `a kube context ${conn.clash} already exists and is not this cluster's viewer`, hint: `${why}. CONNECT never overwrites it. Rename it (kubectl config rename-context ${conn.clash} <other>) and press CONNECT again.` };
        }
        return { ...base, state: "not-connected", text: "NOT CONNECTED", hint: `CONNECT writes kube context ${conn.alias} (viewer role, read-only) to ${kc.path} and adds it to Cloud Spider.` };
      }
      const ctx = contexts.find((item) => item.name === conn.match);
      if (!ctx) return { ...base, state: "not-listed", text: `context ${conn.match} exists, not in Cloud Spider's list`, hint: "CONNECT adds it to cloudspider.contexts.yaml; nothing is written to the kubeconfig." };
      const access = await probeContext(ctx);
      if (access.ok) return { ...base, state: "connected", text: `CONNECTED as ${conn.match}`, hint: "" };
      if (access.noAccess) return { ...base, state: "no-access", text: "NO ACCESS", hint: noAccessHint(cluster), detail: access.error };
      return { ...base, state: "connected", text: `CONNECTED as ${conn.match}; the cluster did not answer`, hint: access.error || "", detail: access.error };
    },
    async connectAll() {
      const listed = eks?.listClusters ? await eks.listClusters().catch((failure) => ({ error: failure?.message })) : { names: [] };
      if (listed.error) return { clusters: [], error: listed.error, hint: runHint(listed.error).hint };
      const clusters = await Promise.all((listed.names || []).filter(validCluster).map((name) => this.connectStatus(name, { inAccount: true })));
      return { clusters };
    },
    async connectRun(requestOrigin, body = {}) {
      if (!originAllowed(requestOrigin, pageOrigin)) return { error: "nothing was connected", hint: "Open Cloud Spider at the address npm start printed." };
      const cluster = String(body.cluster || "");
      const action = ["disconnect", "adopt"].includes(body.action) ? body.action : "connect";
      if (!validCluster(cluster)) return { error: "not a cluster name", hint: "" };
      if (!connector || !upgrade?.runSteps) return { error: "CONNECT is not set up", hint: "" };
      const st = await this.connectStatus(cluster);
      const stack = st.stack || "";
      const no = (error, hint = "") => upgrade.refuse ? { ...upgrade.refuse({ module: "eks", action, stack, error }), ...(hint ? { hint } : {}) } : { error, hint };
      if (action === "adopt") {
        if (st.state !== "clash-same" || !st.adopt) return no(st.state === "connected" ? `${cluster} is already connected` : `nothing to adopt for ${cluster}`, st.hint || "");
        return upgrade.runSteps({ module: "eks", action: "use it", stack, steps: adoptSteps(cluster, st.adopt), command: "", where: st.kubeconfig, onDone: typeof body.onDone === "function" ? body.onDone : undefined });
      }
      if (action === "connect") {
        if (["no-cluster", "outside", "error"].includes(st.state)) return no(st.state === "outside" ? `${cluster} was made outside Stacks: no viewer role to CONNECT with` : st.text, st.hint);
        const kc = await connector.readKubeconfig();
        const current = String(kc.config?.["current-context"] || "");
        const steps = connectSteps(cluster, st, current);
        const command = st.context ? "" : `aws ${connectCommand({ cluster, roleArn: st.roleArn }).join(" ")}${current ? ` && kubectl config use-context ${current}` : ""}`;
        return upgrade.runSteps({ module: "eks", action: "connect", stack, steps, command, where: st.kubeconfig, onDone: typeof body.onDone === "function" ? body.onDone : undefined });
      }
      if (!st.context) return no(`${cluster} is not connected`, "");
      if (!st.ours) return no(`${st.context} was not made by CONNECT`, `Cloud Spider only removes the context it made (${st.alias}). Remove ${st.context} yourself if you want it gone.`);
      const kc = await connector.readKubeconfig();
      const conn = connectionOf(kc.config, { cluster, roleArn: st.roleArn });
      return upgrade.runSteps({ module: "eks", action: "disconnect", stack, steps: disconnectSteps(conn), command: `kubectl config delete-context ${conn.alias}`, where: st.kubeconfig, onDone: typeof body.onDone === "function" ? body.onDone : undefined });
    },
    // ADD-ONS on the EKS card: the checklist for one cluster.
    async bundleStatus(cluster = "", { fresh = false, items = null } = {}) {
      if (!validCluster(cluster)) return { error: "not a cluster name" };
      if (!addons?.view) return { error: "add-ons are not set up" };
      const tree = await addons.view({ fresh }).catch(() => null);
      const node = tree?.tree?.find((item) => item.cluster === cluster) || null;
      const conn = connector ? await this.connectStatus(cluster).catch(() => null) : null;
      const ctx = conn?.state === "connected" ? contexts.find((item) => item.name === conn.context) : null;
      const snap = ctx ? await readContext(ctx, 30_000).catch(() => null) : null;
      const good = snap && !snap.error;
      // No pod cap on the nodes (allocatable not read) is "not counted".
      const counted = good && snap.nodes?.length ? podRoom({ nodes: snap.nodes, pods: snap.pods || [] }) : null;
      const view = bundleView({
        cluster,
        node,
        detected: good ? detectAddons(snap) : null,
        room: counted?.capacity > 0 ? counted : null,
        connected: conn?.state === "connected",
      });
      const chosen = Array.isArray(items) ? items.filter((id) => BUNDLE_IDS.has(id)) : view.items.filter((item) => item.selected).map((item) => item.id);
      const plan = bundlePlan(view, chosen);
      return { ...view, plan, line: slotLine(view, plan), queued: bundleQueue.get(cluster) || null, notes: tree?.notes || [] };
    },
    // INSTALL SELECTED (body.items) or, with body.plan, only the plan and
    // its confirm text (nothing runs).
    async bundleRun(requestOrigin, body = {}) {
      if (!originAllowed(requestOrigin, pageOrigin)) return { error: "nothing was installed", hint: "Open Cloud Spider at the address npm start printed." };
      const cluster = String(body.cluster || "");
      if (!validCluster(cluster)) return { error: "not a cluster name", hint: "" };
      const chosen = (Array.isArray(body.items) ? body.items : []).map(String).filter((id) => BUNDLE_IDS.has(id));
      const status = await this.bundleStatus(cluster, { fresh: !body.plan });
      if (status.error) return { error: status.error, hint: "" };
      const plan = bundlePlan(status, chosen);
      if (body.plan) return { plan, confirm: confirmText(status, plan), line: slotLine(status, plan) };
      const legacyName = upgrade.legacyCluster ? await upgrade.legacyCluster().catch(() => undefined) : undefined;
      if (plan.refusal) return upgrade.refuse ? { ...upgrade.refuse({ module: "eks", action: "add-ons", params: { clusterName: cluster }, error: plan.refusal }), plan } : { error: plan.refusal, plan };
      addons?.forget?.();
      const demo = plan.order.includes("scaling-demo") ? await scalingDemoCheck(cluster) : null;
      const started = upgrade.addonBatch({ cluster, ids: plan.order, legacyName, onDone: () => addons?.forget?.(), ...(demo ? { params: { "scaling-demo": demo.params }, notes: { "scaling-demo": demo.notes } } : {}) });
      return { ...started, plan };
    },
    async stacksOn(cluster) {
      return stacksOn(cluster);
    },
    // A stack bundle (src/stack-bundles.js): body { bundle, cluster, params,
    // plan }. plan: true answers the plan and its one-line approval; without
    // it the bundle runs as one batch (preview, up per step). Refused before
    // pulumi when the cluster or an EKS add-on a step needs is missing.
    async stackBundle(requestOrigin, body = {}) {
      if (!originAllowed(requestOrigin, pageOrigin)) return { error: "nothing ran", hint: "Open Cloud Spider at the address npm start printed." };
      const bundle = bundleById(String(body.bundle || ""));
      if (!bundle) return { error: "no such bundle", hint: "" };
      const cluster = String(body.cluster || body.params?.clusterName || "cloudspider-up");
      if (!validCluster(cluster)) return { error: "not a cluster name", hint: "" };
      const params = { ...(body.params || {}), clusterName: cluster };
      const steps = bundleSteps(bundle, params);
      const specs = steps.map((step) => ({ step, spec: UPGRADES.find((item) => item.id === step.module) }));
      // Needs no step meets: the cluster and its EKS add-ons.
      const base = [];
      for (const { step, spec } of specs) for (const need of needsOf(spec, step.params)) if (["eks", "eks-addon"].includes(need.kind) && !base.some((item) => item.kind === need.kind && item.id === need.id)) base.push({ ...need, owner: spec });
      // Steps already there (each as the need a later card would have).
      const asNeeds = specs.slice(0, -1).map(({ step }) => (addonById(step.module) ? { kind: "addon", id: step.module, cluster } : { kind: "card", id: step.module, cluster }));
      const probes = await needProbes([...base, ...asNeeds], cluster, params);
      const baseStates = needStates(base, probes);
      const have = Object.fromEntries(needStates(asNeeds, probes).map((need) => [need.id, need.state === "ok"]));
      const plan = stackBundlePlan(bundle, params, { have, base: baseStates, refusalFor: (need) => `${bundle.title}: ${needRefusal(need.owner, [need], cluster)}` });
      const day = plan.order.reduce((sum, step) => {
        const spec = UPGRADES.find((item) => item.id === step.module);
        return sum + (spec?.cost ? estimate(costFor(spec.cost, step.params)).day : 0);
      }, 0);
      const confirm = bundleConfirm(bundle, plan, cluster, day);
      if (body.plan) return { bundle: bundle.id, title: bundle.title, cluster, plan, confirm, day };
      const no = (error) => (upgrade.refuse ? { ...upgrade.refuse({ module: steps.at(-1)?.module || "", action: "bundle", params, error }), plan } : { error, plan });
      if (plan.refusal) return no(plan.refusal);
      // A DaemonSet step needs a slot on every node (as on its own card).
      const notes = {};
      for (const step of plan.order) {
        const spec = UPGRADES.find((item) => item.id === step.module);
        if (!spec?.daemonSets?.length) continue;
        const snap = await clusterSnapshot(cluster);
        if (!snap || snap.error || !snap.nodes?.length || Array.isArray(snap.scope)) continue;
        for (const ds of spec.daemonSets) {
          const checked = daemonSetCheck(spec.title, ds, daemonSetRoom({ nodes: snap.nodes, pods: snap.pods || [] }, ds), cluster);
          if (checked.refusal) return no(checked.refusal);
          notes[spec.id] = [...(notes[spec.id] || []), ...checked.notes];
        }
      }
      if (plan.order.some((step) => addonById(step.module))) addons?.forget?.();
      const started = upgrade.stackBatch({ cluster, steps: plan.order, notes, title: "bundle", onDone: () => addons?.forget?.() });
      const waitIn = [...new Set(plan.order.flatMap((step) => UPGRADES.find((item) => item.id === step.module)?.namespaces || []))];
      if (started?.running && waitIn.length) watchWaiting(started.stack, cluster, waitIn);
      return { ...started, plan, confirm };
    },
    async upgradeLog(module = "", values = {}) {
      return upgrade?.logFor ? upgrade.logFor(module, values) : null;
    },
    // The EKS card's fields as the stack has them: its config, and for a
    // cluster that is up the live node group (instance type, desired size),
    // which wins. Read-only.
    // NEEDS chips: each need of a card and its state on the cluster.
    async upgradeNeeds(module = "", values = {}) {
      return stackNeeds(String(module), values);
    },
    async upgradeLive(module = "", values = {}) {
      if (!upgrade?.liveParams) return { values: {} };
      const got = await upgrade.liveParams(module, values).catch((error) => ({ error: error?.message || "the stack did not answer" }));
      if (got.error || module !== "eks") return got;
      const cluster = got.outputs?.name || got.values?.clusterName || values.clusterName || "";
      const group = got.outputs?.nodeGroup || "";
      if (!cluster || !group || !eks?.describeNodegroup) return { ...got, source: "stack config" };
      const live = await eks.describeNodegroup(cluster, group).catch(() => null);
      if (!live?.found) return { ...got, source: "stack config" };
      return {
        ...got,
        source: `node group ${group}`,
        nodeGroup: group,
        values: { ...got.values, ...(live.instanceType ? { instanceType: live.instanceType } : {}), ...(live.capacityType ? { capacityType: live.capacityType } : {}), ...(Number.isInteger(live.desired) ? { nodeCount: String(live.desired) } : {}) },
        scaling: { desired: live.desired, min: live.min, max: live.max },
      };
    },
    // UNLOCK on a run that stopped on a stack lock: pulumi cancel for that
    // stack once its name is typed (upgrade.unlock checks both).
    async upgradeUnlock(requestOrigin, body = {}) {
      if (!originAllowed(requestOrigin, pageOrigin)) return { error: "the unlock did not happen", hint: "Open Cloud Spider at the address npm start printed; another page cannot change stacks." };
      if (!upgrade?.unlock) return { error: "upgrades are not set up", hint: "" };
      return upgrade.unlock({ stack: String(body.stack || ""), confirmName: String(body.confirmName || "") });
    },
    async upgradeRun(requestOrigin, body = {}) {
      if (!originAllowed(requestOrigin, pageOrigin)) return { error: "the upgrade did not happen", hint: "Open Cloud Spider at the address npm start printed (http://127.0.0.1:9241); another page cannot run stacks." };
      if (!upgrade?.run) return { error: "upgrades are not set up", hint: "" };
      if (awsOffHere() && !kubeCard(UPGRADES.find((item) => item.id === body.module))) {
        return { error: `${body.module || "this card"} builds AWS resources and the aws module is off (profile ${settings?.modules?.profile || "k8s-only"})`, hint: "Only the observe bundle runs without AWS; set modules.profile: full to use the AWS cards." };
      }
      // Every no is kept with the card's stack (upgrade.refuse) so the card
      // keeps showing it; the answer carries {error, hint} either way.
      const no = (error) => upgrade.refuse
        ? upgrade.refuse({ module: String(body.module || ""), action: String(body.action || ""), params: body.params || {}, error })
        : { error, ...runHint(error) };
      try {
        // An add-on is not raised twice (the demo's metrics-server) or before
        // what it needs (Karpenter before the Pod Identity agent).
        if (addonById(body.module) && body.action === "up" && addons?.view) {
          const view = await addons.view({ fresh: true }).catch(() => null);
          const cluster = body.params?.clusterName || "cloudspider-up";
          // Free pod slots from the shared kube read, when it is this cluster.
          const snap = primary ? await readContext(primary, 30_000).catch(() => null) : null;
          const same = snap && !snap.error && (snap.clusterName === cluster || String(snap.clusterName || "").endsWith(`/${cluster}`));
          const room = same && snap.nodes?.length ? podRoom({ nodes: snap.nodes, pods: snap.pods || [] }) : null;
          const refusal = view ? refuseUp(view.tree, body.module, cluster, room) : "";
          if (refusal) return no(refusal);
        }
        if (addonById(body.module)) addons?.forget?.();
        // A new instance type replaces the node group: only when asked.
        if (body.module === "eks" && body.action === "up" && !body.replaceNodeGroup && this.upgradeLive) {
          // Bounded: a pulumi that hangs must not hang RUN (no answer: no check).
          const live = await Promise.race([
            this.upgradeLive("eks", { clusterName: body.params?.clusterName || "cloudspider-up" }).catch(() => null),
            new Promise((done) => setTimeout(done, LIVE_MS, null).unref?.()),
          ]);
          const change = nodeGroupChange({ instanceType: live?.values?.instanceType, maxPods: live?.values?.maxPods, capacityType: live?.values?.capacityType, nodeGroup: live?.nodeGroup }, body.params || {});
          if (change) return no(change);
        }
        // NEEDS (src/stack-needs.js): a stack on the cluster refuses before
        // pulumi when something it needs is missing there (Shop API without
        // pgcluster, pgcluster without the EBS CSI driver). Add-on cards
        // have refuseUp above; an unknown never refuses.
        if (["up", "preview"].includes(body.action) && body.module !== "eks" && !addonById(body.module) && UPGRADES.find((item) => item.id === body.module)?.needs?.includes("eks")) {
          const checked = await Promise.race([
            stackNeeds(String(body.module), body.params || {}).catch(() => null),
            new Promise((done) => setTimeout(done, NEEDS_MS, null).unref?.()),
          ]);
          if (checked?.refusal) return no(checked.refusal);
        }
        let clusters;
        if (body.module === "eks" && body.action === "up" && eks?.listClusters) {
          const listed = await eks.listClusters();
          if (listed.error) return no(`could not count the clusters before raising one: ${listed.error}`);
          clusters = listed.names;
        }
        const legacyName = body.module === "eks" && upgrade.legacyCluster ? await upgrade.legacyCluster() : undefined;
        // Ordering: a cluster is not taken down under the stacks that run on
        // it (add-ons, pgcluster, shopapi, demo) unless the name is typed
        // with " anyway".
        let params = body.params || {};
        let notes = [];
        if (body.module === "scaling-demo" && ["up", "preview"].includes(body.action)) {
          const demo = await scalingDemoCheck(String(params.clusterName || "cloudspider-up"), params);
          params = demo.params;
          notes = demo.notes;
        }
        // A DaemonSet needs a slot on every node (demo's otel-collector hung
        // Pending on a full t4g.medium, 2026-10-11): refuse naming the node,
        // or say which pod it will preempt. No kube read: no check.
        const dsSpec = UPGRADES.find((item) => item.id === body.module);
        if (dsSpec?.daemonSets?.length && ["up", "preview"].includes(body.action)) {
          const on = String(params.clusterName || "cloudspider-up");
          const snap = await clusterSnapshot(on);
          if (snap && !snap.error && snap.nodes?.length && !Array.isArray(snap.scope)) {
            for (const ds of dsSpec.daemonSets) {
              const checked = daemonSetCheck(dsSpec.title, ds, daemonSetRoom({ nodes: snap.nodes, pods: snap.pods || [] }, ds), on);
              if (checked.refusal) return no(checked.refusal);
              notes = [...notes, ...checked.notes];
            }
          }
        }
        // An EKS add-on this stack made before the EKS stack owned them is
        // never deleted by its take it down (docs/design/stack-dependencies.md).
        if (body.action === "destroy" && HELD_BY[body.module] && eks?.describeAddon) {
          const on = String(params.clusterName || "cloudspider-up");
          const answers = {};
          for (const name of HELD_BY[body.module]) answers[name] = await eks.describeAddon(on, name).catch(() => null);
          const held = destroyRefusal(body.module, on, answers);
          if (held) return no(held);
        }
        if (body.module === "eks" && body.action === "destroy") {
          const typed = String(params.confirmName || "").trim();
          const target = String(params.clusterName || "cloudspider-up");
          if (/\sanyway$/i.test(typed)) params = { ...params, confirmName: typed.replace(/\s+anyway$/i, "") };
          else if (validCluster(target) && [target, target === (legacyName || "cloudspider-up") ? "upgrade" : `eks-${target}`].includes(typed)) {
            const still = await stacksOn(target);
            if (still.length) return no(`${target} still has stacks on it: ${still.join(", ")}. Take them down first (their cards), or type "${target} anyway"`);
          }
        }
        // "with add-ons": after the cluster is DONE, CONNECT, then the bundle.
        const withAddons = body.module === "eks" && body.action === "up" && Array.isArray(body.withAddons) ? body.withAddons.map(String).filter((id) => BUNDLE_IDS.has(id)) : [];
        const cluster = String(body.params?.clusterName || "");
        const started = upgrade.run({
          module: body.module,
          params,
          action: body.action,
          clusters,
          legacyName,
          notes,
          onDone: withAddons.length
            ? (done) => afterCreate(cluster, withAddons, done)
            : autoConnectOn && connector && body.module === "eks" && validCluster(cluster || "cloudspider-up") && ["up", "destroy"].includes(body.action)
              ? (done) => (body.action === "up" ? autoConnectAfter : autoDisconnectAfter)(cluster || "cloudspider-up", done)
              : undefined,
        });
        const waitIn = UPGRADES.find((item) => item.id === body.module)?.namespaces;
        if (waitIn && body.action === "up" && started?.running) watchWaiting(started.stack, String(params.clusterName || "cloudspider-up"), waitIn);
        if (withAddons.length && !started?.error && validCluster(cluster)) bundleQueue.set(cluster, { items: withAddons, stage: "cluster", text: `after the cluster: CONNECT, then ${withAddons.length} add-on${withAddons.length === 1 ? "" : "s"}` });
        return started?.error && !started.hint ? { ...started, ...runHint(started.error) } : started;
      } catch (failure) {
        return no(`the server failed: ${failure?.message || "error"}`);
      }
    },
    // Vaults: projects from YAML files. sample=true reads the sample folder
    // against the sample place, with canned check answers.
    async vaultsView({ sample = false } = {}) {
      const viewer = sample ? vaults?.sample : vaults?.live;
      if (!viewer) return { dir: "", note: "vaults are not set up", vaults: [] };
      try {
        if (sample) return await viewer.view(vaults.samplePlace?.(), { failures: vaults.sampleFailures?.() || [], slo: { metrics: sampleMetrics(vaults.samplePlace?.(), { now: now() }) } });
        const view = await viewer.view(place, { failures: radio.failures(), slo: { ledger, metrics: sloMetrics(), cluster: sloCluster, clusters: sloClusterList() } });
        sloAlbIds = albIdsOf(view);
        keepSlos(view);
        return view;
      } catch (failure) {
        return { dir: "", note: `the vaults did not load: ${failure?.message || "error"}`, vaults: [] };
      }
    },
    async vaultLogs(key, { sample = false } = {}) {
      const viewer = sample ? vaults?.sample : vaults?.live;
      if (!viewer?.logs) return { error: "vaults are not set up" };
      try {
        return await viewer.logs(String(key || ""), sample ? vaults.samplePlace?.() : place, { logs: sample ? vaults.sampleLogs : logs, region: sample ? "eu-north-1" : region });
      } catch (failure) {
        return { error: failure?.message || "the logs did not load" };
      }
    },
    async vaultsTest(requestOrigin, key, { sample = false } = {}) {
      if (!originAllowed(requestOrigin, pageOrigin)) return { error: "the test did not run" };
      const viewer = sample ? vaults?.sample : vaults?.live;
      if (!viewer) return { error: "vaults are not set up" };
      try {
        return await viewer.test(String(key || ""), sample ? vaults.samplePlace?.() : place);
      } catch (failure) {
        return { error: failure?.message || "the test did not run" };
      }
    },
    // SLOs in the background (main.js, every 30 s): the vaults are
    // evaluated with no page open, so their checks keep running and their
    // ledgers keep filling; ALBs that an alb SLO needs are read at 1-minute
    // points (CloudWatch's floor for ALB metrics).
    sloLedger() {
      return ledger;
    },
    async watchSlos() {
      const viewer = vaults?.live;
      if (!viewer || !place) return { ...sloWatch, skipped: place ? "vaults are not set up" : "the map has not loaded yet" };
      const evaluate = () => viewer.view(place, { failures: radio.failures(), slo: { ledger, metrics: sloMetrics(), cluster: sloCluster, clusters: sloClusterList() } });
      const fetchAlbs = async () => {
        if (!sloAlbIds.size) return "";
        const got = await sloMetricsCache.get(region, place, { ids: sloAlbIds, specs: sloSpecs(sloPercentiles) }).catch((failure) => ({ error: failure?.message || "the metrics did not load" }));
        return got?.error || "";
      };
      let failed = await fetchAlbs();
      let view = await evaluate();
      const ids = albIdsOf(view);
      const fresh = [...ids].some((id) => !sloAlbIds.has(id));
      sloAlbIds = ids;
      // A newly owned ALB is read now, not a tick later.
      if (fresh) {
        failed = await fetchAlbs();
        view = await evaluate();
      }
      keepSlos(view);
      sloWatch = { at: now(), albs: ids.size, vaults: (view?.vaults || []).filter((v) => v.slos?.length).length, error: failed };
      return sloWatch;
    },
    // Monitoring: CloudWatch metrics for what the map shows, cached 5 min.
    async metricsView({ sample = false, samplePlace } = {}) {
      if (sample) return sampleMetrics(samplePlace || vaults?.samplePlace?.(), { now: now() });
      if (!place) return { region, targets: {}, note: "the map has not loaded yet" };
      try {
        return await metricsCache.get(region, place);
      } catch (failure) {
        return { region, targets: {}, error: failure?.message || "the metrics did not load" };
      }
    },
    async costView() {
      const at = clock();
      if (costCache && at - costCache.at < costTtl) return costCache.bill;
      if (!costFlight) {
        costFlight = readBill(at).finally(() => {
          costFlight = null;
        });
      }
      return costFlight;
    },
    // Cluster view. No context (or the primary one): the region's EKS
    // clusters and, inside, the primary kube context. Another context: its
    // own namespaces only, no AWS read at all.
    async clusterView({ context = "" } = {}) {
      // An unknown name (a context since removed from the config) is the
      // primary one.
      const ctx = contextFor(context) || primary;
      // aws module off (modules.js): the primary context is read like any
      // other, straight from Kubernetes, with no EKS lookup first.
      const view = ctx && (!ctx.primary || path?.off) ? await contextView(ctx) : await this.primaryClusterView();
      return contexts.length > 1 ? { ...view, context: ctx?.name || "", contexts: contextList() } : view;
    },
    // The health watch (kube-health.js): each context read at its own
    // interval (default 60 s) through the shared snapshot cache. main.js
    // calls this on a timer; the radio and the morning take the result.
    async watchKube() {
      const due = contexts.filter((ctx) => now() - (polledAt.get(ctx.name) ?? -Infinity) >= ctx.pollMs);
      await Promise.all(due.map((ctx) => readContext(ctx, KUBE_VIEW_TTL)));
      return this.kubeHealth();
    },
    contextNeedsAws(name = "") {
      if (path?.off) return false;
      const ctx = contextFor(name) || primary;
      return !ctx || ctx.primary;
    },
    kubeHealth() {
      return { radio: [...connectNotes, ...health.radio()].sort((a, b) => b.time - a.time), contexts: contextList() };
    },
    async primaryClusterView() {
      const at = region;
      const failed = (sentence) => ({
        region: at,
        error: sentence,
        diagram: null,
        headline: "",
        note: "",
      });
      if (!path?.clusters) return failed("cluster reads are not set up");
      if (!at) return failed(error || "the region is not read yet");
      const result = await path.clusters(at);
      if (at !== region) return { region, stale: true };
      if (result?.error) {
        const sentence = accountRead(result.error);
        report(sink, { call: "ListClusters", sentence });
        return failed(sentence);
      }
      const diagram = diagramFromClusters(result?.items || []);
      // Inside the cluster (read-only kube context): namespaces to nodes.
      if (kube && diagram.nodes.length) {
        const snap = await readKube(KUBE_VIEW_TTL);
        if (!snap.error) {
          const cluster = (result?.items || []).find((item) => item.name === snap.clusterName) || {};
          return {
            region: at,
            error: "",
            diagram: diagramFromKube(snap, { cluster }),
            slos: clusterSlo.view(snap.clusterName),
            headline: "",
            note: [`inside ${snap.clusterName} via kube context ${kube.context} (read-only)`, ...(snap.notes || [])].join(" · "),
          };
        }
        return {
          region: at,
          error: "",
          diagram,
          headline: "",
          note: snap.unset ? `EKS in this region. To see pods, add the read-only kube context ${kube.context} (docs/RUN-ME.md §7).` : `EKS in this region. Inside the cluster: ${snap.error}`,
        };
      }
      return {
        region: at,
        error: "",
        diagram,
        headline: diagram.nodes.length ? "" : "no cluster in this region",
        note: "EKS in this region. An OpenShift reader fills the same picture.",
      };
    },
    // The map's cluster compound: the same kube diagram the Cluster view
    // draws, from the shared snapshot (30 s). Read-only, viewer role.
    async mapKube() {
      if (!kube) return { clusters: [], unset: true, note: "no kube context: the map shows the cluster without its apps" };
      const snap = await readKube(KUBE_MAP_TTL);
      if (snap.error) return { clusters: [], unset: !!snap.unset, error: snap.error };
      const at = kubeCaches.get(primary.name)?.at || now();
      return { clusters: [{ name: snap.clusterName || sloCluster || "cluster", diagram: diagramFromKube(snap, {}), at }], nextAt: at + KUBE_MAP_TTL };
    },
    // The telemetry screen: node gauges, pressure lamps, top pods, 1 h of
    // history kept in memory (kube-telemetry.js). Read-only kube reads.
    // context: any listed kube context ("" = the primary one). A
    // namespace-scoped context has no nodes to show: `limits` says so.
    async clusterTelemetry({ context = "" } = {}) {
      const pick = screenContext(context);
      if (pick.error) return { error: pick.error };
      const sampler = teleFor(pick.ctx);
      if (!sampler) return { error: "the kube context is not set up", unset: true };
      const facts = scopeFacts(pick.ctx);
      const limits = facts.clusterWide ? [] : [`Node gauges, pressure lamps and the OTel collector need a cluster-wide context: ${facts.context} shows its pods' CPU and memory (metrics-server) in ${facts.namespaces.join(", ")} only.`];
      const got = await sampler.get().catch((failure) => ({ error: failure?.message || "the cluster did not answer" }));
      return got.error ? { ...got, ...facts } : { ...got, ...facts, limits };
    },
    // Cluster add-ons per cluster (Stacks view): Pulumi stacks + in-cluster.
    async addonsView({ sample = false, fresh = false } = {}) {
      if (sample) return sampleAddons();
      if (!addons?.view) return { tree: [], notes: ["add-ons are not set up"] };
      return addons.view({ fresh }).catch((failure) => ({ tree: [], notes: [failure?.message || "the add-ons did not load"] }));
    },
    // OPS screen and radio: policy reports, scaling, events (read-only).
    // context: any listed kube context ("" = the primary one, which also
    // feeds the radio). A namespace-scoped context reads its namespaces only
    // and `limits` names what needs a cluster-wide one.
    async clusterOps({ sample = false, context = "" } = {}) {
      if (sample) return opsView(sampleOps(now()), { now: now() });
      const pick = screenContext(context);
      if (pick.error) return { error: pick.error };
      const client = pick.ctx?.kube;
      if (!client?.ops) return { error: "the kube context is not set up", unset: true };
      const facts = scopeFacts(pick.ctx);
      const limits = facts.clusterWide ? [] : [`Kyverno policy reports, cluster policies, Karpenter node pools and KEDA need a cluster-wide context: ${facts.context} reads only ${facts.namespaces.join(", ")} (events, HPAs, deployments).`];
      const key = facts.context;
      const at = now();
      const cached = opsCaches.get(key);
      if (cached && cached.client === client && at - cached.at < 10_000) return cached.value;
      if (!opsFlights.has(key)) {
        opsFlights.set(key, client.ops()
          .then((ops) => {
            // Pods seen by the last snapshot (no extra read): a readiness
            // warning from a pod that is gone is a rollout's noise.
            const cachedSnap = pick.ctx?.name ? kubeCaches.get(pick.ctx.name) : null;
            const livePods = cachedSnap?.snap?.pods && !cachedSnap.snap.error ? { at: cachedSnap.at, names: new Set(cachedSnap.snap.pods.map((p) => `${p?.metadata?.namespace || ""}/${p?.metadata?.name || ""}`)) } : null;
            const value = { ...opsView(ops, { now: at, livePods }), ...facts, limits };
            if (!value.error) opsCaches.set(key, { at, client, value });
            return value;
          })
          .catch((failure) => ({ error: failure?.message || "the cluster did not answer", ...facts }))
          .finally(() => {
            opsFlights.delete(key);
          }));
      }
      return opsFlights.get(key);
    },
    // One pod's last log lines and events (Cluster view, on click).
    async clusterPod({ ns, name, container, previous = false, tail = 80, context = "" } = {}) {
      const client = contextFor(context)?.kube;
      if (!client) return { error: "the kube context is not set up" };
      return client.podDetail(String(ns || ""), String(name || ""), String(container || ""), { previous: !!previous, tail: Number(tail) || 80 }).catch((failure) => ({ error: failure?.message || "the pod did not answer" }));
    },
    // Deep-inspect (read-only, redacted): kube-inspect.js.
    // K9S window (kube-table.js): tables, describe and YAML from the shared
    // per-context snapshot; events read only while asked for (15 s cache).
    async kubeTable({ context = "", view = "pods", ns = "", filter = "", sample = false } = {}) {
      const got = await k9sRead(context, sample, view === "events");
      if (got.error) return { error: got.error, context: got.ctx?.name || context };
      const clusterWide = got.scope === "*";
      const choice = viewFor(view, { clusterWide });
      if (choice.error) return { error: choice.error, context: got.ctx.name };
      const nsList = clusterWide ? (got.snap.namespaces || []).map((n) => n.metadata?.name).filter(Boolean).sort() : got.scope;
      const pickNs = ns && ns !== "*" && nsList.includes(ns) ? ns : clusterWide || nsList.length > 1 ? "*" : nsList[0] || "*";
      const table = buildTable(choice.view.id, got.snap, { ns: pickNs, now: now(), events: got.events, filter: String(filter || "").slice(0, 80) });
      return {
        context: got.ctx.name,
        label: got.ctx.label || got.ctx.name,
        clusterWide,
        namespaces: nsList,
        ns: pickNs,
        view: choice.view.id,
        title: choice.view.title,
        columns: table.columns,
        total: table.total,
        rows: table.rows.slice(0, 1000).map((r) => ({ id: r.id, ns: r.ns, name: r.name, status: r.status, containers: r.containers, cells: table.columns.map((c) => String(r.cells[c] ?? "")) })),
        at: got.at,
        note: got.eventNote || "",
      };
    },
    async kubeDescribe({ context = "", view = "pods", ns = "", name = "", sample = false } = {}) {
      const got = await k9sRead(context, sample, true);
      if (got.error) return { error: got.error };
      const obj = findObject(String(view), got.snap, String(ns), String(name));
      if (!obj) return { error: `${view} ${ns ? `${ns}/` : ""}${name} is not in the last read` };
      return { text: describe(String(view), obj, { events: got.events, now: now() }), yaml: yamlOf(String(view), obj) };
    },
    async clusterPodInspect({ ns, name, context = "" } = {}) {
      const ctx = contextFor(context);
      if (!ctx?.kube?.podInspect) return { error: "the kube context is not set up" };
      const raw = await ctx.kube.podInspect(String(ns || ""), String(name || "")).catch((failure) => ({ error: failure?.message || "the pod did not answer" }));
      if (raw.error) return { error: raw.error };
      const history = ctx.primary && tele?.podHistory ? tele.podHistory(`${ns}/${name}`) : null;
      return { ...inspectPod(raw.pod, { events: raw.events, chain: raw.chain, usage: raw.usage, history, now: now() }), eventNote: raw.eventNote || "" };
    },
    // netdebug: the PATH graph of the current region (load balancers,
    // listeners, rules, target groups, subnets, SGs, routes), read-only.
    async pathGraph() {
      if (!path || !region) return { error: path ? error || "the region is not read yet" : "path reads are not set up" };
      const result = await readPath(path, region);
      return result.error ? { error: `${result.call}: ${result.error}` } : result.graph;
    },
    async pathView(query = {}) {
      const at = region;
      const failed = (sentence) => ({
        region: at,
        error: sentence,
        loadBalancers: [],
        selected: "",
        diagram: null,
        findings: [],
        headline: "",
        notes: [],
      });
      if (!path) return failed("path reads are not set up");
      if (!at) return failed(error || "the region is not read yet");
      const result = await readPath(path, at);
      if (at !== region) return { region, stale: true };
      if (result.error) {
        const sentence = accountRead(result.error);
        report(sink, { call: result.call, sentence });
        return failed(sentence);
      }
      const shown = pathResult(result.graph, { lb: query.lb || "", host: query.host || "", region: at });
      // Peering paths start at the region's first EKS cluster's nodes.
      const cluster = (place?.fixtures || []).find((item) => item.kind === "eks")?.name || "";
      if (!peers || !cluster) return shown;
      const world = await peers.read(at, cluster).catch((failure) => ({ error: failure?.message || String(failure) }));
      if (at !== region) return { region, stale: true };
      return withPeers(shown, world, query.lb || "");
    },
  };
  return api;

  async function readBill(at) {
    if (!cost?.read) {
      const bill = costFailure("cost reads are not set up");
      report(sink, { call: "GetCostAndUsage", sentence: bill.error });
      return bill;
    }
    try {
      const result = await cost.read();
      if (result?.error) {
        const bill = costFailure(result.error);
        report(sink, { call: "GetCostAndUsage", sentence: bill.error });
        return bill;
      }
      costCache = { at, bill: result };
      return result;
    } catch (error) {
      const bill = costFailure(error);
      report(sink, { call: "GetCostAndUsage", sentence: bill.error });
      return bill;
    }
  }

  async function loadBoot() {
    let listed = await ec2.describeRegions();
    // An SCP can deny ec2:DescribeRegions (seen on cloudspider-up's account)
    // while everything else works: use the configured regions, else the
    // default region, and say so, instead of blanking every view.
    if (listed?.error && /not authorized to perform|UnauthorizedOperation|AccessDenied/i.test(String(listed.error)) && !/ExpiredToken|InvalidClientTokenId|security token|credentials/i.test(String(listed.error))) {
      const fallback = regionsAllow.length ? [...regionsAllow] : [await ec2.defaultRegion()].filter(Boolean);
      if (fallback.length) {
        report(sink, { call: "DescribeRegions", sentence: `${accountRead(listed.error)} Using ${fallback.join(", ")} from ${regionsAllow.length ? "aws.regions" : "the default region"}.` });
        listed = { regions: fallback };
      }
    }
    if (listed?.error) {
      loading = false;
      place = null;
      error = accountRead(listed.error);
      report(sink, { call: "DescribeRegions", sentence: error });
      return;
    }
    regions = listed?.regions || [];
    // aws.regions in cloudspider.yaml narrows the picker; a list that names
    // no enabled region is ignored (and said), not an empty map.
    if (regionsAllow.length) {
      const kept = regions.filter((name) => regionsAllow.includes(name));
      if (kept.length) regions = kept;
      else sink.push(`config: aws.regions (${regionsAllow.join(", ")}) names no enabled region; showing every region`);
    }
    region = pickRegion(regions, await ec2.defaultRegion());
    loading = false;
    await loadPlace(region);
    radioAt = clock();
    await radio.refresh(region);
  }

  async function verb(name, requestOrigin, id) {
    const call = CALL[name];
    if (!isInstanceId(id)) {
      status = report(sink, { call, id, sentence: "it is not an instance id" });
      return { status, wait: false };
    }
    if (!originAllowed(requestOrigin, pageOrigin)) {
      status = report(sink, { call, id, sentence: `the ${name} did not happen` });
      return { status, wait: false };
    }
    const result = await attemptVerb({ ec2, lines: sink, region, id, verb: name });
    status = result.sentence || "";
    if (result.wait) waits.begin({ region, id, verb: name, at: clock() });
    return { status, wait: Boolean(result.wait) };
  }
}
