import { originAllowed } from "./origin.js";
import { isInstanceId } from "./ids.js";
import { report } from "./report.js";
import { pickRegion, readPlace } from "./map.js";
import { attemptVerb } from "./verbs.js";
import { createWaits } from "./waits.js";
import { createRadio } from "./radio.js";
import { readLogs } from "./logs.js";
import { readPath } from "./path-read.js";
import { pathResult } from "./path-view.js";
import { costFailure } from "./cost.js";
import { diagramFromClusters } from "./cluster.js";
import { diagramFromKube } from "./kube-diagram.js";
import { createTelemetry } from "./kube-telemetry.js";
import { inspectPod } from "./kube-inspect.js";
import { opsView, sampleOps } from "./kube-ops.js";
import { detectAddons, refuseUp, sampleAddons } from "./addons.js";
import { BUNDLE_IDS, bundlePlan, bundleView, confirmText, slotLine } from "./addon-bundle.js";
import { podRoom } from "../upgrades/addons/pod-room.js";
import { buildTable, describe, findObject, viewFor, yamlOf } from "./kube-table.js";
import { sampleKubeSnapshot } from "./kube-sample.js";
import { addonById } from "../upgrades/addons/catalog.js";
import { createClusterSlo, createSloLedger } from "./slo.js";
import { campFixtures, runHint, watchLine } from "./upgrade-rules.js";
import { CONNECT_REGION, connectCommand, connectionOf, sameEndpoint, validCluster, viewerAlias } from "./kube-connect.js";
import { sampleTerraformState } from "./terraform.js";
import { createLinkCache } from "./aws-path.js";
import { createMetricsCache, sampleMetrics, SLO_PERIOD, SLO_TTL, SLO_WINDOW, sloSpecs } from "./metrics.js";
import { idleCandidates, morningReport, nextIdleStreak } from "./layout.js";
import { createHealthWatch, morningLine } from "./kube-health.js";
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

export function createApp({ ec2, trail, logs, metrics, path, cost, upgrade, terraform, learn, eks, vaults, agent, kube, kubeContexts, telemetry, addons, sloLedger, logGroup, pageOrigin, clock, write, connector, loadKubeContexts }) {
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
  let opsCache = null;
  let opsFlight = null;
  // The idle-fire guard: per object, how many target reads in a row it
  // looked idle on (layout.js nextIdleStreak).
  let idleStreak = {};
  const radio = createRadio({
    lookup: (next) => trail.lookupEvents(next),
  });

  const now = typeof clock === "function" ? clock : Date.now;
  const tele = telemetry || (kube ? createTelemetry({ kube, clock: now }) : null);
  // SLOs (slo.js): one ledger for vaults and the cluster, filled from reads
  // the app makes anyway (main.js keeps it on disk across restarts).
  const ledger = sloLedger || createSloLedger({ clock: now });
  const clusterSlo = createClusterSlo({ ledger, clock: now });
  let sloCluster = null;
  // One kube snapshot shared by the Cluster view and the map's compound
  // (map-kube.js): one read in flight, reused for maxAge. Each fresh read
  // also feeds the cluster SLOs.
  // Every kube context (kube-contexts.js) keeps its own client and its own
  // snapshot cache; the first is the primary one (`kube`), the only one that
  // feeds the SLOs, the map, TELEMETRY and OPS.
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
      // update-kubeconfig switches the current context; put it back.
      if (current) steps.push({ cmd: "kubectl", args: ["config", "use-context", current], text: `kubectl config use-context ${current}   (update-kubeconfig switched it; put it back)` });
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
    steps.push({ text: `remove ${conn.alias} from cloudspider.contexts.yaml`, fn: () => connector.removeFromList(conn.alias) });
    steps.push({ text: "reload Cloud Spider's kube contexts (no restart)", fn: async () => {
      const got = await reloadContexts();
      probes.delete(conn.alias);
      return got.error ? { error: got.error } : { lines: [`contexts now: ${got.names.join(", ")}`] };
    } });
    return steps;
  }
  async function readContext(ctx, maxAge) {
    const cached = kubeCaches.get(ctx.name);
    if (cached && now() - cached.at < maxAge) return cached.snap;
    if (!kubeFlights.has(ctx.name)) {
      const flight = Promise.resolve()
        .then(() => ctx.kube.snapshot())
        .catch((failure) => ({ error: failure?.message || "the cluster did not answer" }))
        .then((snap) => {
          if (ctx.primary) {
            if (snap.clusterName) sloCluster = snap.clusterName;
            if (!snap.unset && sloCluster) clusterSlo.record(sloCluster, snap);
          }
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
      const snap = sampleKubeSnapshot();
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
      return { context: ctx.name, error: "", diagram: null, headline: "", note: snap.unset ? `kube context ${ctx.name}: ${snap.error} (docs/RUN-ME.md §19)` : `kube context ${ctx.name}: ${snap.error}` };
    }
    return {
      context: ctx.name,
      error: "",
      diagram: diagramFromKube(snap, { cluster: { name: snap.clusterName } }),
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
    async logsFor(id) {
      const result = await readLogs({ logs, logGroup, region, id });
      if (result.note) {
        report(sink, { call: "GetLogEvents", id, sentence: result.note });
      }
      return result;
    },
    upgrades() {
      return upgrade?.list?.() || [];
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
    async connectStatus(cluster = "", { fresh = false } = {}) {
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
      const clusters = await Promise.all((listed.names || []).filter(validCluster).map((name) => this.connectStatus(name)));
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
        return upgrade.runSteps({ module: "eks", action: "use it", stack, steps: adoptSteps(cluster, st.adopt), command: "", where: st.kubeconfig });
      }
      if (action === "connect") {
        if (st.state === "no-cluster" || st.state === "error") return no(st.text, st.hint);
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
      return upgrade.runSteps({ module: "eks", action: "disconnect", stack, steps: disconnectSteps(conn), command: `kubectl config delete-context ${conn.alias}`, where: st.kubeconfig });
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
      const started = upgrade.addonBatch({ cluster, ids: plan.order, legacyName, onDone: () => addons?.forget?.() });
      return { ...started, plan };
    },
    async upgradeLog(module = "", values = {}) {
      return upgrade?.logFor ? upgrade.logFor(module, values) : null;
    },
    async upgradeRun(requestOrigin, body = {}) {
      if (!originAllowed(requestOrigin, pageOrigin)) return { error: "the upgrade did not happen", hint: "Open Cloud Spider at the address npm start printed (http://127.0.0.1:9241); another page cannot run stacks." };
      if (!upgrade?.run) return { error: "upgrades are not set up", hint: "" };
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
        let clusters;
        if (body.module === "eks" && body.action === "up" && eks?.listClusters) {
          const listed = await eks.listClusters();
          if (listed.error) return no(`could not count the clusters before raising one: ${listed.error}`);
          clusters = listed.names;
        }
        const legacyName = body.module === "eks" && upgrade.legacyCluster ? await upgrade.legacyCluster() : undefined;
        // "with add-ons": after the cluster is DONE, CONNECT, then the bundle.
        const withAddons = body.module === "eks" && body.action === "up" && Array.isArray(body.withAddons) ? body.withAddons.map(String).filter((id) => BUNDLE_IDS.has(id)) : [];
        const cluster = String(body.params?.clusterName || "");
        const started = upgrade.run({
          module: body.module,
          params: body.params || {},
          action: body.action,
          clusters,
          legacyName,
          onDone: withAddons.length ? (done) => afterCreate(cluster, withAddons, done) : undefined,
        });
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
        const view = await viewer.view(place, { failures: radio.failures(), slo: { ledger, metrics: sloMetrics(), cluster: sloCluster } });
        sloAlbIds = albIdsOf(view);
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
      const evaluate = () => viewer.view(place, { failures: radio.failures(), slo: { ledger, metrics: sloMetrics(), cluster: sloCluster } });
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
      if (costCache && at - costCache.at < COST_TTL) return costCache.bill;
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
      const view = ctx && !ctx.primary ? await contextView(ctx) : await this.primaryClusterView();
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
      const ctx = contextFor(name) || primary;
      return !ctx || ctx.primary;
    },
    kubeHealth() {
      return { radio: health.radio(), contexts: contextList() };
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
    async clusterTelemetry() {
      if (!tele) return { error: "the kube context is not set up", unset: true };
      return tele.get().catch((failure) => ({ error: failure?.message || "the cluster did not answer" }));
    },
    // Cluster add-ons per cluster (Stacks view): Pulumi stacks + in-cluster.
    async addonsView({ sample = false, fresh = false } = {}) {
      if (sample) return sampleAddons();
      if (!addons?.view) return { tree: [], notes: ["add-ons are not set up"] };
      return addons.view({ fresh }).catch((failure) => ({ tree: [], notes: [failure?.message || "the add-ons did not load"] }));
    },
    // OPS screen and radio: policy reports, scaling, events (read-only).
    async clusterOps({ sample = false } = {}) {
      if (sample) return opsView(sampleOps(now()), { now: now() });
      if (!kube?.ops) return { error: "the kube context is not set up", unset: true };
      const at = now();
      if (opsCache && at - opsCache.at < 10_000) return opsCache.value;
      if (!opsFlight) {
        opsFlight = kube.ops()
          .then((ops) => {
            const value = opsView(ops, { now: at });
            opsCache = { at, value };
            return value;
          })
          .catch((failure) => ({ error: failure?.message || "the cluster did not answer" }))
          .finally(() => {
            opsFlight = null;
          });
      }
      return opsFlight;
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
      return pathResult(result.graph, { lb: query.lb || "", host: query.host || "", region: at });
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
    const listed = await ec2.describeRegions();
    if (listed?.error) {
      loading = false;
      place = null;
      error = accountRead(listed.error);
      report(sink, { call: "DescribeRegions", sentence: error });
      return;
    }
    regions = listed?.regions || [];
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
