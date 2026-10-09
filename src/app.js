import { originAllowed } from "./origin.js";
import { isInstanceId } from "./ids.js";
import { report } from "./report.js";
import { pickRegion, readPlace } from "./map.js";
import { attemptVerb } from "./verbs.js";
import { createWaits } from "./waits.js";
import { createRadio } from "./radio.js";
import { readLogs } from "./logs.js";

const CALL = { stop: "StopInstances", start: "StartInstances" };

export function createApp({ ec2, trail, logs, logGroup, pageOrigin, clock, write }) {
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

  const radio = createRadio({
    lookup: (next) => trail.lookupEvents(next),
  });

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
      error = result.error;
      report(sink, { call: "DescribeInstances", sentence: result.error });
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
    return {
      region,
      regions,
      place,
      error,
      status,
      radio: radio.line(),
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
  };

  async function loadBoot() {
    const listed = await ec2.describeRegions();
    if (listed?.error) {
      loading = false;
      place = null;
      error = listed.error;
      report(sink, { call: "DescribeRegions", sentence: listed.error });
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
    if (result.sentence) status = result.sentence;
    if (result.wait) waits.begin({ region, id, verb: name, at: clock() });
    return { status, wait: Boolean(result.wait) };
  }
}
