// The SLO ledger survives a restart: .cloudspider/slo-ledger.json.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSloLedger } from "../src/slo.js";
import { createSloStore } from "../src/slo-store.js";

test("save, restart, load: the counts and the check stamps come back", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cs-slo-store-"));
  const file = join(dir, ".cloudspider", "slo-ledger.json");
  let now = Date.parse("2026-10-11T12:00:00Z");
  const before = createSloLedger({ clock: () => now });
  before.record("vault:shop:items:items", 1, 1, { stamp: 111 });
  before.record("vault:shop:items:items", 0, 1, { stamp: 222 });
  before.put("vault:shop:alb:cw", now - 60_000, 230, 240);
  before.record("kube:cs-drill:api", 1, 1);
  const store = createSloStore({ file, ledger: before });
  assert.deepEqual(await store.save(), { saved: true });
  assert.deepEqual(await store.save(), { saved: false }, "nothing changed, nothing written");
  const text = await readFile(file, "utf8");
  assert.equal(/https?:|token|secret/i.test(text), false, "counts only");

  now += 10 * 60_000; // the restart
  const after = createSloLedger({ clock: () => now });
  const loaded = await createSloStore({ file, ledger: after }).load();
  assert.equal(loaded.keys, 3);
  const items = after.counts("vault:shop:items:items", 86_400_000);
  assert.deepEqual([items.good, items.total], [1, 2]);
  assert.equal(after.record("vault:shop:items:items", 0, 1, { stamp: 222 }), false, "the same check result is not counted again");
  assert.deepEqual([after.counts("vault:shop:alb:cw").good, after.counts("vault:shop:alb:cw").total], [230, 240]);
  assert.equal(after.counts("kube:cs-drill:api").total, 1);
});

test("a missing or broken file starts over and says so; old buckets are dropped", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cs-slo-store-"));
  const file = join(dir, "slo-ledger.json");
  const ledger = createSloLedger({ clock: () => Date.parse("2026-10-11T12:00:00Z"), keepMs: 86_400_000 });
  assert.deepEqual(await createSloStore({ file, ledger }).load(), { keys: 0, note: "no saved SLO history yet" });
  await writeFile(file, "{not json");
  assert.match((await createSloStore({ file, ledger }).load()).note, /not JSON; starting over/);
  const old = Math.floor(Date.parse("2026-10-01T00:00:00Z") / 300_000);
  const fresh = Math.floor(Date.parse("2026-10-11T11:00:00Z") / 300_000);
  await writeFile(file, JSON.stringify({ v: 1, buckets: { k: [[old, 1, 1], [fresh, 2, 3], ["x", 1, 1], [fresh + 1, 5, 2]] } }));
  assert.equal((await createSloStore({ file, ledger }).load()).keys, 1);
  const c = ledger.counts("k", 86_400_000);
  assert.deepEqual([c.good, c.total], [2, 3], "past keepMs and malformed cells are skipped");
});
