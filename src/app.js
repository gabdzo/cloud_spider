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
import { campFixtures, watchLine } from "./upgrade-rules.js";
import { createLinkCache } from "./aws-path.js";

const CALL = { stop: "StopInstances", start: "StartInstances" };
const ACCOUNT_HINT = "Set AWS_PROFILE=default and AWS_REGION=eu-north-1.";
const COST_TTL = 6 * 60 * 60 * 1000;
const WATCH_MS = 15_000;

function accountRead(error) {
  return `${ACCOUNT_HINT} ${error}`;
}

export function createApp({ ec2, trail, logs, path, cost, upgrade, eks, vaults, logGroup, pageOrigin, clock, write }) {
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
  const radio = createRadio({
    lookup: (next) => trail.lookupEvents(next),
  });

  const now = typeof clock === "function" ? clock : Date.now;
  const linkCache = createLinkCache({
    read: (name, balancers) => path.targetLines(name, balancers),
    clock: now,
  });

  function stampLinks() {
    if (!place) return;
    const cached = linkCache.current(region);
    if (!cached.known) return;
    place.links = cached.edges;
    place.linkNote = cached.error || "";
  }

  const waits = createWaits({
    describe: (gotRegion, id) => ec2.describeInstance(gotRegion, id),
    redraw: (gotRegion) => loadPlace(gotRegion),
  });

  async function loadPlace(next) {
    const mine = ++generation;
    const result = await readPlace(ec2, next);
    if (mine !== generation || next !== region) return;
    if (result.error) {
      place = null;
      error = accountRead(result.error);
      report(sink, { call: "DescribeInstances", sentence: error });
      return;
    }
    error = "";
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
      const own = (place.fixtures || []).filter((item) => !item.camp);
      const extras = campFixtures(shelf?.resources, grain).map((item) => ({ ...item, camp: true }));
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
    async upgradeStatus(module = "", fresh = false) {
      const job = upgrade?.status?.() || { running: false, lines: [] };
      if (!module || !upgrade?.facts) return job;
      if (sawRunning && !job.running) fresh = true;
      sawRunning = Boolean(job.running);
      const at = clock();
      if (!fresh && watchCache && watchCache.module === module && at - watchCache.at < WATCH_MS) {
        return { ...job, watch: watchCache.line };
      }
      const history = await upgrade.facts(module);
      let cluster = null;
      if (module === "eks") {
        try {
          cluster = eks?.describeCluster
            ? await eks.describeCluster(history.name || "cloudspider-up")
            : { error: "the cluster did not answer" };
        } catch (error) {
          cluster = { error: error?.message || "the cluster did not answer" };
        }
      }
      const line = history.error
        ? { status: "fail", text: history.error }
        : watchLine({ cluster, history });
      watchCache = { module, at, line };
      return { ...job, watch: line };
    },
    async upgradeRun(requestOrigin, body = {}) {
      if (!originAllowed(requestOrigin, pageOrigin)) return { error: "the upgrade did not happen" };
      if (!upgrade?.run) return { error: "upgrades are not set up" };
      let clusters;
      if (body.module === "eks" && body.action === "up" && eks?.listClusters) {
        const listed = await eks.listClusters();
        if (listed.error) return { error: listed.error };
        clusters = listed.names;
      }
      return upgrade.run({
        module: body.module,
        params: body.params || {},
        action: body.action,
        clusters,
      });
    },
    // Vaults: projects from YAML files. sample=true reads the sample folder
    // against the sample place, with canned check answers.
    async vaultsView({ sample = false } = {}) {
      const viewer = sample ? vaults?.sample : vaults?.live;
      if (!viewer) return { dir: "", note: "vaults are not set up", vaults: [] };
      try {
        return await viewer.view(sample ? vaults.samplePlace?.() : place);
      } catch (failure) {
        return { dir: "", note: `the vaults did not load: ${failure?.message || "error"}`, vaults: [] };
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
      return {
        region: at,
        error: "",
        diagram,
        headline: diagram.nodes.length ? "" : "no cluster in this region",
        note: "EKS in this region. An OpenShift reader fills the same picture.",
      };
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
