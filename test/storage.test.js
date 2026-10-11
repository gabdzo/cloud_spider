import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkKey, createFileStorage, createStorage } from "../src/storage.js";
import { COST_KEY, createCost } from "../src/cost.js";

async function store() {
  return createFileStorage({ dir: join(await mkdtemp(join(tmpdir(), "cs-store-")), "state") });
}

test("get/put round-trip JSON, a missing or damaged key reads as null", async () => {
  const s = await store();
  assert.equal(await s.get("cost/bill"), null);
  await s.put("cost/bill", { total: "$4.30", rows: [1, 2] });
  assert.deepEqual(await s.get("cost/bill"), { total: "$4.30", rows: [1, 2] });
  await mkdir(join(s.dir, "bad"), { recursive: true });
  await writeFile(join(s.dir, "bad", "one.json"), "{not json");
  assert.equal(await s.get("bad/one"), null);
  // Writes are atomic: no temp file is left behind.
  assert.deepEqual((await readdir(join(s.dir, "cost"))).sort(), ["bill.json"]);
});

test("list returns keys under a prefix, sorted, without history files", async () => {
  const s = await store();
  await s.put("slo/b", 1);
  await s.put("slo/a", 2);
  await s.put("cost/bill", 3);
  await s.append("slo/a", { at: 1 });
  assert.deepEqual(await s.list("slo/"), ["slo/a", "slo/b"]);
  assert.deepEqual(await s.list(), ["cost/bill", "slo/a", "slo/b"]);
  assert.deepEqual(await createFileStorage({ dir: "/no/such/dir" }).list(), []);
});

test("append keeps the last max entries and history reads oldest first", async () => {
  const s = await store();
  for (let i = 1; i <= 5; i += 1) await s.append("runs/eks", { i }, { max: 3 });
  assert.deepEqual(await s.history("runs/eks"), [{ i: 3 }, { i: 4 }, { i: 5 }]);
  assert.deepEqual(await s.history("runs/eks", { limit: 2 }), [{ i: 4 }, { i: 5 }]);
  assert.deepEqual(await s.history("runs/none"), []);
});

test("keys cannot escape the state folder", async () => {
  for (const bad of ["../etc/passwd", "/abs", "a//b", "a/../b", "", "a/./b", "sp ace"]) assert.throws(() => checkKey(bad), /is not a key/, bad);
  assert.equal(checkKey("slo/alb-api_p95.v2"), "slo/alb-api_p95.v2");
  const s = await store();
  await assert.rejects(s.put("../x", 1), /is not a key/);
});

test("createStorage picks the file backend and refuses an unbuilt one", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cs-store-"));
  assert.equal(createStorage({ backend: "file", dir }).backend, "file");
  assert.throws(() => createStorage({ backend: "dynamodb", dir }), /not built yet/);
});

test("the bill cache lives in storage (cost/bill) and survives a new process", async () => {
  const s = await store();
  let calls = 0;
  const client = {
    async send(command) {
      calls += 1;
      if (command.constructor.name === "GetCostForecastCommand") throw Object.assign(new Error("x"), { name: "DataUnavailableException" });
      return { ResultsByTime: [{ Groups: [{ Keys: ["Amazon Elastic Load Balancing", "Usage"], Metrics: { UnblendedCost: { Amount: "2.00", Unit: "USD" } } }], Estimated: true }] };
    },
  };
  const now = () => new Date("2026-10-11T08:00:00Z");
  const first = await createCost({ client, storage: s, now }).read();
  const used = calls;
  assert.equal((await s.get(COST_KEY)).total, first.total);
  const again = await createCost({ client, storage: s, now }).read();
  assert.equal(calls, used);
  assert.equal(again.total, "$2.00");
  // Past the TTL it reads again.
  await createCost({ client, storage: s, now: () => new Date("2026-10-11T08:00:00Z"), ttl: 0 }).read();
  assert.ok(calls > used);
});
