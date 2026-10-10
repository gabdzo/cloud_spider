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
import { refuseUp, sampleAddons } from "./addons.js";
import { addonById } from "../upgrades/addons/catalog.js";
import { createClusterSlo, createSloLedger } from "./slo.js";
import { campFixtures, watchLine } from "./upgrade-rules.js";
import { sampleTerraformState } from "./terraform.js";
import { createLinkCache } from "./aws-path.js";
import { createMetricsCache, sampleMetrics } from "./metrics.js";
import { idleCandidates, morningReport, nextIdleStreak } from "./layout.js";

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

export function createApp({ ec2, trail, logs, metrics, path, cost, upgrade, terraform, learn, eks, vaults, agent, kube, telemetry, addons, sloLedger, logGroup, pageOrigin, clock, write }) {
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
  // SLOs (slo.js): one in-memory ledger for vaults and the cluster, filled
  // from reads the app makes anyway. No extra AWS or kube calls.
  const ledger = sloLedger || createSloLedger({ clock: now });
  const clusterSlo = createClusterSlo({ ledger, clock: now });
  let sloCluster = null;
  const linkCache = createLinkCache({
    read: (name, balancers) => path.targetLines(name, balancers),
    clock: now,
  });

  const metricsCache = createMetricsCache({
    read: (name, queries, range) => (typeof metrics?.read === "function" ? metrics.read(name, queries, range) : { error: "metrics are not set up" }),
    clock: now,
  });

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
    return morningReport({
      place,
      events: radio.changes(),
      trail: radio.trailState(),
      bill: costCache?.bill || null,
      idleStreak,
    });
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

  return {
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
      const job = upgrade?.status?.() || { running: false, lines: [] };
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
    async upgradeRun(requestOrigin, body = {}) {
      if (!originAllowed(requestOrigin, pageOrigin)) return { error: "the upgrade did not happen" };
      if (!upgrade?.run) return { error: "upgrades are not set up" };
      // An add-on is not raised twice (the demo's metrics-server) or before
      // what it needs (Karpenter before the Pod Identity agent).
      if (addonById(body.module) && body.action === "up" && addons?.view) {
        const view = await addons.view({ fresh: true }).catch(() => null);
        const refusal = view ? refuseUp(view.tree, body.module, body.params?.clusterName || "cloudspider-up") : "";
        if (refusal) return { error: refusal };
      }
      if (addonById(body.module)) addons?.forget?.();
      let clusters;
      if (body.module === "eks" && body.action === "up" && eks?.listClusters) {
        const listed = await eks.listClusters();
        if (listed.error) return { error: listed.error };
        clusters = listed.names;
      }
      const legacyName = body.module === "eks" && upgrade.legacyCluster ? await upgrade.legacyCluster() : undefined;
      return upgrade.run({
        module: body.module,
        params: body.params || {},
        action: body.action,
        clusters,
        legacyName,
      });
    },
    // Vaults: projects from YAML files. sample=true reads the sample folder
    // against the sample place, with canned check answers.
    async vaultsView({ sample = false } = {}) {
      const viewer = sample ? vaults?.sample : vaults?.live;
      if (!viewer) return { dir: "", note: "vaults are not set up", vaults: [] };
      try {
        if (sample) return await viewer.view(vaults.samplePlace?.(), { failures: vaults.sampleFailures?.() || [], slo: { metrics: sampleMetrics(vaults.samplePlace?.(), { now: now() }) } });
        return await viewer.view(place, { failures: radio.failures(), slo: { ledger, metrics: metricsCache.peek(region), cluster: sloCluster } });
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
    async clusterView() {
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
        const snap = await kube.snapshot().catch((failure) => ({ error: failure?.message || "the cluster did not answer" }));
        if (snap.clusterName) sloCluster = snap.clusterName;
        if (!snap.unset && sloCluster) clusterSlo.record(sloCluster, snap);
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
    async clusterPod({ ns, name, container, previous = false, tail = 80 } = {}) {
      if (!kube) return { error: "the kube context is not set up" };
      return kube.podDetail(String(ns || ""), String(name || ""), String(container || ""), { previous: !!previous, tail: Number(tail) || 80 }).catch((failure) => ({ error: failure?.message || "the pod did not answer" }));
    },
    // Deep-inspect (read-only, redacted): kube-inspect.js.
    async clusterPodInspect({ ns, name } = {}) {
      if (!kube?.podInspect) return { error: "the kube context is not set up" };
      const raw = await kube.podInspect(String(ns || ""), String(name || "")).catch((failure) => ({ error: failure?.message || "the pod did not answer" }));
      if (raw.error) return { error: raw.error };
      const history = tele?.podHistory ? tele.podHistory(`${ns}/${name}`) : null;
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
