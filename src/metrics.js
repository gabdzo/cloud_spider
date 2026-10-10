// Monitoring: one batched CloudWatch GetMetricData call for the resources
// the map already shows (EC2 instances, ALBs, Lambda functions). EKS nodes
// are EC2 instances, so they get the EC2 metrics for free; pods come from
// metrics-server in the Cluster view. No Container Insights, no flow logs,
// no ALB access logs: only the free-tier-ish vended metrics.
//
// The page asks /api/metrics about every 5 minutes while it is visible; the
// cache answers anything sooner, so a busy page costs one call per 5 minutes.

export const METRICS_TTL = 5 * 60_000;
export const PERIOD = 300; // seconds per point
export const WINDOW = 3 * 60 * 60_000; // 3 hours = 36 points
export const MAX_QUERIES = 500; // GetMetricData's limit per call

// What we ask for, per kind. stat is the CloudWatch statistic.
export const METRIC_SPECS = {
  ec2: [
    { name: "CPUUtilization", label: "CPU", stat: "Average", unit: "%" },
    { name: "StatusCheckFailed", label: "CHECKS", stat: "Maximum", unit: "fail" },
  ],
  alb: [
    { name: "RequestCount", label: "REQ", stat: "Sum", unit: "/5m" },
    { name: "HTTPCode_ELB_5XX_Count", label: "ELB 5XX", stat: "Sum", unit: "/5m" },
    { name: "HTTPCode_Target_5XX_Count", label: "TGT 5XX", stat: "Sum", unit: "/5m" },
    { name: "TargetResponseTime", label: "LATENCY", stat: "Average", unit: "s" },
  ],
  lambda: [
    { name: "Invocations", label: "INV", stat: "Sum", unit: "/5m" },
    { name: "Errors", label: "ERR", stat: "Sum", unit: "/5m" },
    { name: "Throttles", label: "THROTTLE", stat: "Sum", unit: "/5m" },
    { name: "Duration", label: "DURATION", stat: "Average", unit: "ms" },
  ],
};

const NAMESPACE = { ec2: "AWS/EC2", alb: "AWS/ApplicationELB", lambda: "AWS/Lambda" };

// arn:aws:elasticloadbalancing:r:a:loadbalancer/app/name/hash -> app/name/hash
export function albDimension(arn) {
  const match = /:loadbalancer\/(app\/[^/]+\/[^/]+)$/.exec(String(arn || ""));
  return match ? match[1] : "";
}

// arn:aws:lambda:r:a:function:name[:qualifier] -> name
export function lambdaName(item) {
  const match = /:function:([^:]+)/.exec(String(item?.arn || item?.id || ""));
  if (match) return match[1];
  return /^[A-Za-z0-9_-]{1,64}$/.test(String(item?.name || "")) ? item.name : "";
}

// The resources on the map that have vended metrics.
export function metricTargets(place) {
  const targets = [];
  for (const item of place?.instances || []) {
    if (item.state !== "running" || !/^i-[0-9a-z]+$/.test(String(item.id || ""))) continue;
    targets.push({ id: item.id, kind: "ec2", name: item.name || item.id, dims: [{ Name: "InstanceId", Value: item.id }] });
  }
  for (const item of place?.fixtures || []) {
    if (item.kind === "alb") {
      const value = albDimension(item.id);
      if (value) targets.push({ id: item.id, kind: "alb", name: item.name || value, dims: [{ Name: "LoadBalancer", Value: value }] });
    } else if (item.kind === "function") {
      const value = lambdaName(item);
      if (value) targets.push({ id: item.id, kind: "lambda", name: value, dims: [{ Name: "FunctionName", Value: value }] });
    }
  }
  return targets;
}

// MetricDataQueries plus an index from query id back to (target, spec).
export function metricQueries(targets) {
  const queries = [];
  const index = new Map();
  targets.forEach((target, t) => {
    METRIC_SPECS[target.kind].forEach((spec, s) => {
      if (queries.length >= MAX_QUERIES) return;
      const id = `m${t}_${s}`;
      index.set(id, { target, spec });
      queries.push({
        Id: id,
        ReturnData: true,
        MetricStat: {
          Metric: { Namespace: NAMESPACE[target.kind], MetricName: spec.name, Dimensions: target.dims },
          Period: PERIOD,
          Stat: spec.stat,
        },
      });
    });
  });
  return { queries, index };
}

function round(value) {
  if (!Number.isFinite(value)) return 0;
  if (Math.abs(value) >= 100) return Math.round(value);
  if (Math.abs(value) >= 1) return Math.round(value * 10) / 10;
  return Math.round(value * 1000) / 1000;
}

// Results come newest-first; we keep oldest-first points on a fixed 5-min grid
// (missing points are 0 for counts, absent for averages).
export function seriesFrom(results, index, { end, window = WINDOW } = {}) {
  const slots = Math.round(window / (PERIOD * 1000));
  const start = end - slots * PERIOD * 1000;
  const byTarget = new Map();
  for (const result of results || []) {
    const hit = index.get(result.Id);
    if (!hit) continue;
    const counts = hit.spec.stat === "Sum";
    const points = new Array(slots).fill(counts ? 0 : null);
    (result.Timestamps || []).forEach((stamp, i) => {
      const at = new Date(stamp).getTime();
      const slot = Math.floor((at - start) / (PERIOD * 1000));
      if (slot >= 0 && slot < slots) points[slot] = round(Number(result.Values?.[i]));
    });
    const seen = points.filter((p) => p !== null);
    const list = byTarget.get(hit.target.id) || [];
    list.push({
      metric: hit.spec.name,
      label: hit.spec.label,
      unit: hit.spec.unit,
      points,
      last: seen.length ? seen[seen.length - 1] : null,
      peak: seen.length ? Math.max(...seen) : null,
      hour: counts ? round(points.slice(-12).reduce((sum, p) => sum + (p || 0), 0)) : null,
    });
    byTarget.set(hit.target.id, list);
  }
  return byTarget;
}

function pick(series, metric) {
  return series.find((item) => item.metric === metric) || null;
}

// One line for the map and a health flag: ok, hang (worth a look) or broken.
export function summarize(kind, series) {
  if (kind === "ec2") {
    const cpu = pick(series, "CPUUtilization");
    const checks = pick(series, "StatusCheckFailed");
    if (checks?.last > 0) return { headline: "STATUS CHECK FAILED", flag: "broken" };
    if (cpu?.last == null) return { headline: "CPU —", flag: "ok" };
    return { headline: `CPU ${Math.round(cpu.last)}%`, flag: cpu.last >= 90 ? "broken" : cpu.last >= 75 ? "hang" : "ok" };
  }
  if (kind === "alb") {
    const req = pick(series, "RequestCount")?.hour || 0;
    const bad = (pick(series, "HTTPCode_ELB_5XX_Count")?.hour || 0) + (pick(series, "HTTPCode_Target_5XX_Count")?.hour || 0);
    const rate = req ? bad / req : bad ? 1 : 0;
    if (bad) return { headline: `5XX ${bad}/h · ${req} REQ`, flag: rate >= 0.25 ? "broken" : "hang" };
    return { headline: `${req} REQ/h`, flag: "ok" };
  }
  if (kind === "lambda") {
    const inv = pick(series, "Invocations")?.hour || 0;
    const err = pick(series, "Errors")?.hour || 0;
    const thr = pick(series, "Throttles")?.hour || 0;
    const rate = inv ? err / inv : err ? 1 : 0;
    if (err || thr) {
      const words = [err ? `${err} ERR` : "", thr ? `${thr} THR` : "", `${inv} INV`].filter(Boolean).join(" · ");
      return { headline: `${words}/h`, flag: rate >= 0.25 ? "broken" : "hang" };
    }
    return { headline: `${inv} INV/h`, flag: "ok" };
  }
  return { headline: "", flag: "ok" };
}

// Builds the /api/metrics answer from targets and a GetMetricData result.
export function metricsAnswer(targets, index, results, { end, region }) {
  const byTarget = seriesFrom(results, index, { end });
  const out = {};
  for (const target of targets) {
    const series = byTarget.get(target.id) || [];
    out[target.id] = { id: target.id, kind: target.kind, name: target.name, ...summarize(target.kind, series), series };
  }
  return { region, at: end, nextAt: end + METRICS_TTL, targets: out };
}

// Cached reader. read(region, queries, {start, end}) -> {results} | {error}.
export function createMetricsCache({ read, clock = Date.now, ttl = METRICS_TTL }) {
  let cached = null;
  let flight = null;
  return {
    peek(region) {
      return cached && cached.answer.region === region && clock() - cached.at < ttl * 3 ? cached.answer : null;
    },
    async get(region, place, { force = false } = {}) {
      const targets = metricTargets(place);
      const key = `${region}|${targets.map((t) => t.id).join(",")}`;
      const now = clock();
      if (!force && cached && cached.key === key && now - cached.at < ttl) return cached.answer;
      if (flight && flight.key === key) return flight.promise;
      const promise = (async () => {
        if (!targets.length) return { region, at: now, nextAt: now + ttl, targets: {}, note: "nothing on the map has CloudWatch metrics" };
        const { queries, index } = metricQueries(targets);
        const end = Math.floor(now / (PERIOD * 1000)) * PERIOD * 1000;
        const out = await read(region, queries, { start: end - WINDOW, end });
        if (out?.error) return { region, at: now, nextAt: now + 60_000, targets: {}, error: `GetMetricData: ${out.error}` };
        const answer = metricsAnswer(targets, index, out.results, { end, region });
        answer.at = now;
        answer.nextAt = now + ttl;
        answer.queries = queries.length;
        return answer;
      })();
      flight = { key, promise };
      try {
        const answer = await promise;
        if (!answer.error) cached = { key, at: now, answer };
        return answer;
      } finally {
        if (flight?.promise === promise) flight = null;
      }
    },
  };
}

// Paints the metric headline onto the map, in place: fixtures get it as
// their caption (and burn when broken), running instances as the line under
// their state. Painting again with a newer answer (or none) undoes the old
// paint first, so a recovered resource goes back to its own status.
export function paintPlace(place, answer) {
  if (!place) return place;
  const targets = answer?.targets || {};
  for (const item of place.fixtures || []) {
    if ("metricBase" in item) {
      item.status = item.metricBase.status;
      item.caption = item.metricBase.caption;
      delete item.metricBase;
      delete item.metricFlag;
    }
    const hit = targets[item.id];
    if (!hit?.headline) continue;
    item.metricBase = { status: item.status, caption: item.caption };
    // The icon already says what it is; the caption carries the numbers.
    item.caption = `${hit.flag === "ok" ? "" : "! "}${hit.headline}`;
    item.metricFlag = hit.flag;
    if (hit.flag === "broken") item.status = "broken";
  }
  for (const item of place.instances || []) {
    if ("metricBase" in item) {
      item.label = item.metricBase.label;
      delete item.metricBase;
      delete item.metricFlag;
    }
    const hit = targets[item.id];
    if (!hit?.headline || item.state !== "running") continue;
    item.metricBase = { label: item.label };
    item.label = `${hit.flag === "ok" ? "" : "! "}${hit.headline}`;
    item.metricFlag = hit.flag;
  }
  return place;
}

// Worth a spider line: anything not ok.
export function metricAlerts(answer) {
  return Object.values(answer?.targets || {})
    .filter((hit) => hit.flag && hit.flag !== "ok")
    .map((hit) => ({ id: hit.id, flag: hit.flag, text: `${hit.name}: ${hit.headline}` }));
}

// A canned answer for Sample mode and the screenshots: a wave for each
// running instance, ALB and function on the map, keyed by the map's own ids.
export function sampleTargets(place) {
  const targets = [];
  for (const item of place?.instances || []) {
    if (item.state === "running") targets.push({ id: item.id, kind: "ec2", name: item.name || item.id, dims: [{ Name: "InstanceId", Value: item.id }] });
  }
  for (const item of place?.fixtures || []) {
    if (item.kind === "alb") targets.push({ id: item.id, kind: "alb", name: item.name || item.id, dims: [{ Name: "LoadBalancer", Value: `app/${item.name}/sample` }] });
    if (item.kind === "function") targets.push({ id: item.id, kind: "lambda", name: item.name || item.id, dims: [{ Name: "FunctionName", Value: item.name || "sample" }] });
  }
  return targets;
}

export function sampleResults(queries, index, end) {
  const slots = WINDOW / (PERIOD * 1000);
  return queries.map((query) => {
    const { spec, target } = index.get(query.Id);
    const seed = Math.abs(hash(target.id)) % 7;
    const hot = /hot|busy|web/.test(String(target.name));
    const Timestamps = [];
    const Values = [];
    for (let i = 0; i < slots; i++) {
      const wave = (Math.sin((i + seed) / 3) + 1) / 2;
      let value = 0;
      if (spec.name === "CPUUtilization") value = hot ? 78 + wave * 8 : 8 + wave * 30;
      else if (spec.name === "RequestCount") value = 40 + Math.round(wave * 60);
      else if (spec.name === "HTTPCode_Target_5XX_Count") value = i < 3 ? 2 : 0;
      else if (spec.name === "TargetResponseTime") value = 0.04 + wave * 0.05;
      else if (spec.name === "Invocations") value = 6 + Math.round(wave * 6);
      else if (spec.name === "Errors") value = i === 1 ? 2 : 0;
      else if (spec.name === "Duration") value = 120 + wave * 80;
      Timestamps.push(new Date(end - (i + 1) * PERIOD * 1000));
      Values.push(value);
    }
    return { Id: query.Id, Timestamps, Values };
  });
}

export function sampleMetrics(place, { now = Date.now(), region = "sample" } = {}) {
  const targets = sampleTargets(place);
  const { queries, index } = metricQueries(targets);
  const end = Math.floor(now / (PERIOD * 1000)) * PERIOD * 1000;
  const answer = metricsAnswer(targets, index, sampleResults(queries, index, end), { end, region });
  return { ...answer, at: now, nextAt: now + METRICS_TTL, queries: queries.length, sample: true };
}

function hash(text) {
  let h = 0;
  for (const ch of String(text)) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return h;
}
