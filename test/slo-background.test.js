// Drill 2026-10-11 findings 4 and 5: the ALB latency SLO reads p95 (not the
// average) and the SLOs are evaluated by the server with no page open, on
// one-minute CloudWatch points. Fakes only: no AWS.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.js";
import { createVaultStore } from "../src/vaults.js";
import { createVaultView } from "../src/vault-view.js";
import { SLO_PERIOD } from "../src/metrics.js";

const ALB = "arn:aws:elasticloadbalancing:eu-north-1:111122223333:loadbalancer/app/k8s-shop-shopapi/0123456789abcdef";
const VAULT = `apiVersion: cloudspider/v1
kind: Vault
metadata:
  name: shopdrill
  number: 166
  description: the drill's shop
  owner: me
spec:
  type: api
  resources:
    ids: ["${ALB}"]
  slos:
    - { name: alb-availability, sli: availability, source: alb, target: 99%, window: 24h }
    - { name: alb-latency, sli: latency, source: alb, threshold: 300, target: 99%, window: 24h }
    - { name: alb-latency-avg-ok, sli: latency, source: alb, threshold: 500, target: 99%, window: 24h, percentile: p95 }
`;

// Fault (c): from minute `slowFrom` on, p95 ~460 ms and p99 ~840 ms while
// the average stays at 143 ms.
function fakeCloudWatch({ slowFrom = Infinity, deadFrom = Infinity } = {}) {
  const asked = [];
  return {
    asked,
    read(region, queries, { start, end }) {
      asked.push({ region, start, end, periods: [...new Set(queries.map((q) => q.MetricStat.Period))], metrics: queries.map((q) => `${q.MetricStat.Metric.MetricName}:${q.MetricStat.Stat}`) });
      const step = queries[0].MetricStat.Period * 1000;
      const results = queries.map((q) => {
        const Timestamps = [];
        const Values = [];
        for (let at = end - step; at >= start; at -= step) {
          const minute = (at - start) / step;
          const slow = minute >= slowFrom;
          const dead = minute >= deadFrom;
          const name = q.MetricStat.Metric.MetricName;
          const stat = q.MetricStat.Stat;
          let value = 0;
          if (name === "RequestCount") value = dead ? 0 : 240;
          else if (name === "HTTPCode_ELB_5XX_Count") value = dead ? 240 : 0;
          else if (name === "HTTPCode_Target_5XX_Count") value = 0;
          else if (name === "TargetResponseTime") {
            if (dead) continue;
            value = stat === "p95" ? (slow ? 0.46 : 0.09) : stat === "p99" ? (slow ? 0.841 : 0.12) : slow ? 0.143 : 0.085;
          }
          Timestamps.push(new Date(at));
          Values.push(value);
        }
        return { Id: q.Id, Timestamps, Values };
      });
      return { results };
    },
  };
}

async function rig(cw, { time = Date.parse("2026-10-11T11:30:00Z") } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "cs-slo-"));
  await writeFile(join(dir, "shopdrill.yaml"), VAULT);
  let now = time;
  const ec2 = {
    describeRegions: async () => ({ regions: ["eu-north-1"] }),
    defaultRegion: async () => "eu-north-1",
    describeVpcs: async () => ({ items: [{ id: "vpc-1" }] }),
    describeSubnets: async () => ({ items: [] }),
    describeInstances: async () => ({ items: [] }),
    describeDiagram: async () => ({ fixtures: [{ id: ALB, kind: "alb", name: "k8s-shop-shopapi", vpcId: "vpc-1", status: "ok" }] }),
  };
  const app = createApp({
    ec2,
    trail: { lookupEvents: async () => ({ event: null }) },
    logs: { filter: async () => ({ events: [] }) },
    metrics: cw,
    vaults: { live: createVaultView({ store: createVaultStore({ dir }), checker: { peek: () => [] }, clock: () => now }) },
    pageOrigin: "http://127.0.0.1:1",
    clock: () => now,
  });
  await app.boot();
  return { app, tick: (ms) => (now += ms) };
}

const byName = (view) => Object.fromEntries(view.vaults[0].slos.map((slo) => [slo.name, slo]));

test("fault (c): p95 ~460 ms breaks a 300 ms latency SLO the average (143 ms) hid", async () => {
  const cw = fakeCloudWatch({ slowFrom: 170 }); // the last 10 of 180 minutes are slow
  const { app } = await rig(cw);
  const watched = await app.watchSlos();
  assert.equal(watched.albs, 1, "the ALB the vault's alb SLOs need");
  assert.equal(watched.error, "");
  // One-minute points, and only what the SLOs need (each metric costs).
  const ask = cw.asked.at(-1);
  assert.deepEqual(ask.periods, [SLO_PERIOD]);
  assert.deepEqual(ask.metrics, ["RequestCount:Sum", "HTTPCode_ELB_5XX_Count:Sum", "HTTPCode_Target_5XX_Count:Sum", "TargetResponseTime:p95"]);
  const slos = byName(await app.vaultsView());
  const lat = slos["alb-latency"];
  assert.equal(lat.percentile, "p95");
  assert.equal(lat.total, 180, "one point per minute over 3 h");
  assert.equal(lat.total - lat.good, 10, "every slow minute counts");
  assert.ok(lat.burn >= 14.4, `burn ${lat.burn}: 10 of the last 60 minutes over 300 ms is a fast burn`);
  assert.notEqual(lat.flag, "ok");
  assert.match(lat.from, /ALB p95 · CloudWatch 1m/);
  assert.equal(slos["alb-latency-avg-ok"].total - slos["alb-latency-avg-ok"].good, 0, "460 ms is under a 500 ms line");
  assert.equal(slos["alb-availability"].flag, "ok");
});

test("the background watch fills the ledger with no page open, and 1-minute points are not counted twice", async () => {
  const cw = fakeCloudWatch({ deadFrom: 178 }); // the ALB's own 503s, the last 2 minutes
  const { app, tick } = await rig(cw);
  await app.watchSlos();
  await app.watchSlos(); // within the 60 s cache: no second read
  assert.equal(cw.asked.length, 1);
  tick(61_000);
  await app.watchSlos();
  assert.equal(cw.asked.length, 2, "a new minute, a new read");
  const avail = byName(await app.vaultsView())["alb-availability"];
  // 3 h + 1 minute of points, each minute once: the overlap was replaced.
  assert.equal(avail.total, 181 * 240);
  // The fake's dead minutes moved with the window: the re-read replaced the
  // earlier minute (now good), as a late CloudWatch fill would.
  assert.equal(avail.total - avail.good, 2 * 240, "ELB 503s with RequestCount 0 count as bad");
  assert.notEqual(avail.flag, "ok");
});

test("watchSlos says why it did nothing before the map has loaded", async () => {
  const app = createApp({ pageOrigin: "http://127.0.0.1:1", vaults: { live: { view: async () => ({ vaults: [] }) } } });
  const out = await app.watchSlos();
  assert.equal(out.skipped, "the map has not loaded yet");
});
