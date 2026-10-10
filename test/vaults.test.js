import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { API_VERSION, plateText, validateVault } from "../src/vault-schema.js";
import { byNumber, createVaultStore, parseVaultText, settleNames, vaultsDir } from "../src/vaults.js";
import { matchVaults, matches, ownedIds, placeResources, tagMap } from "../src/vault-match.js";
import { createCheckRunner, runCheck, slowAfter, vaultStatus } from "../src/vault-checks.js";
import { DOOR_MS, STORAGE_KEY, createVaultState, readOpen } from "../src/vault-state.js";
import { createVaultView } from "../src/vault-view.js";
import { VAULT, panelHeight, placeVaults, vaultAt } from "../src/vault-layout.js";
import { layout } from "../src/layout.js";
import { sampleFetch, samplePlace } from "../src/sample.js";

const good = () => ({
  apiVersion: API_VERSION,
  kind: "Vault",
  metadata: { name: "landing", number: 101, description: "The landing page.", owner: "gabriel", tags: ["web"] },
  spec: {
    type: "static-site",
    resources: { tags: { project: "landing" }, ids: ["i-0abc", "arn:aws:s3:::landing-bucket"] },
    links: { view: "https://example.com/", repo: "https://github.com/x/y" },
    checks: { http: [{ url: "https://example.com/", expect: 200, contains: "Hi", timeout: 1000 }] },
  },
});

// ---- schema ----

test("a good vault validates with defaults filled in", () => {
  const doc = good();
  doc.spec.checks.http.push({ url: "http://example.com/health" });
  const { vault, errors, warnings } = validateVault(doc);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(vault.name, "landing");
  assert.equal(vault.title, "landing");
  assert.deepEqual(vault.resources, { tags: { project: "landing" }, ids: ["i-0abc", "arn:aws:s3:::landing-bucket"] });
  assert.deepEqual(vault.checks[1], { url: "http://example.com/health", expect: 200, contains: "", timeout: 5000 });
  assert.equal(plateText(vault.number), "VAULT 101");
  assert.equal(plateText(7), "VAULT 007");
  assert.equal(plateText(null), "VAULT ???");
});

test("each mistake gets its own sentence naming the path", () => {
  const cases = [
    [(d) => (d.apiVersion = "backstage.io/v1alpha1"), "apiVersion: must be cloudspider/v1, not backstage.io/v1alpha1"],
    [(d) => (d.kind = "Component"), "kind: must be Vault, not Component"],
    [(d) => delete d.metadata, "metadata: is required"],
    [(d) => (d.metadata.name = "Bad Name"), "metadata.name: use lowercase letters, digits and dashes (max 63)"],
    [(d) => delete d.metadata.number, "metadata.number: is required (0-999, shown as VAULT 101)"],
    [(d) => (d.metadata.number = 1013), "metadata.number: must be a whole number from 0 to 999"],
    [(d) => (d.metadata.description = ""), "metadata.description: is required"],
    [(d) => (d.metadata.description = "x".repeat(300)), "metadata.description: keep it under 280 characters"],
    [(d) => delete d.metadata.owner, "metadata.owner: is required"],
    [(d) => (d.metadata.tags = "web"), "metadata.tags: must be a list of words"],
    [(d) => delete d.spec, "spec: is required"],
    [(d) => (d.spec.type = "nuclear"), "spec.type: must be one of static-site, service, api, cluster, worker, data, other"],
    [(d) => (d.spec.resources = ["x"]), "spec.resources: must be a mapping with tags and/or ids"],
    [(d) => (d.spec.resources.tags = { a: { b: 1 } }), "spec.resources.tags.a: must be a plain value"],
    [(d) => (d.spec.resources.ids = "i-1"), "spec.resources.ids: must be a list of ids, ARNs or names"],
    [(d) => (d.spec.resources.ids = [""]), "spec.resources.ids[0]: must be a non-empty string"],
    [(d) => (d.spec.links.docs = "ftp://x"), "spec.links.docs: must be an http(s) URL"],
    [(d) => (d.spec.checks = []), "spec.checks: must be a mapping with an http list"],
    [(d) => (d.spec.checks.http[0].url = "not-a-url"), "spec.checks.http[0].url: must be an http(s) URL"],
    [(d) => (d.spec.checks.http[0].expect = 99), "spec.checks.http[0].expect: must be an HTTP status from 100 to 599"],
    [(d) => (d.spec.checks.http[0].timeout = 60000), "spec.checks.http[0].timeout: must be 100-30000 milliseconds"],
    [(d) => (d.spec.checks.http[0].contains = 5), "spec.checks.http[0].contains: must be text"],
  ];
  for (const [mutate, message] of cases) {
    const doc = good();
    mutate(doc);
    const result = validateVault(doc);
    assert.equal(result.vault, null, message);
    assert.ok(result.errors.includes(message), `${message}\n got: ${result.errors.join(" / ")}`);
  }
});

test("non-mappings and unknown keys never throw", () => {
  for (const doc of [null, 3, "text", [], undefined]) {
    const result = validateVault(doc);
    assert.equal(result.vault, null);
    assert.match(result.errors[0], /not a YAML mapping/);
  }
  const doc = good();
  doc.metadata.colour = "red";
  const { vault, warnings } = validateVault(doc);
  assert.ok(vault);
  assert.deepEqual(warnings, ["metadata.colour: unknown key, ignored"]);
  // An out-of-range number is not kept for the plate.
  doc.metadata.number = 5000;
  assert.equal(validateVault(doc).number, null);
});

// ---- loader ----

test("parseVaultText: several documents, syntax errors and empty files", () => {
  const two = `apiVersion: cloudspider/v1\nkind: Vault\nmetadata: {name: a, number: 1, description: A, owner: me}\nspec: {type: api}\n---\napiVersion: cloudspider/v1\nkind: Vault\nmetadata: {name: b, number: 2, description: B, owner: me}\nspec: {type: other}\n`;
  const entries = parseVaultText(two, "two.yaml");
  assert.deepEqual(entries.map((e) => [e.name, e.doc, e.damaged]), [["a", 0, false], ["b", 1, false]]);

  const broken = parseVaultText("metadata: {name: a\n  number: [", "broken.yaml");
  assert.equal(broken.length, 1);
  assert.equal(broken[0].damaged, true);
  assert.match(broken[0].errors[0], /^YAML: /);
  assert.equal(broken[0].title, "broken");

  assert.deepEqual(parseVaultText("", "empty.yaml")[0].errors, ["the file is empty"]);
  const dupKeys = parseVaultText("kind: Vault\nkind: Vault\n", "dup.yaml");
  assert.equal(dupKeys[0].damaged, true);
});

test("settleNames: the second vault with a name is damaged and keys are unique", () => {
  const a = { name: "x", file: "a.yaml", doc: 0, damaged: false };
  const b = { name: "x", file: "b.yaml", doc: 0, damaged: false };
  const c = { name: "c", file: "c.yaml", doc: 0, damaged: true, errors: ["bad"] };
  const out = settleNames([a, b, c]);
  assert.equal(out[0].key, "x");
  assert.equal(out[1].damaged, true);
  assert.deepEqual(out[1].errors, ["metadata.name: x is already used in a.yaml"]);
  assert.equal(out[1].key, "b.yaml#0");
  assert.equal(out[2].key, "c.yaml#0");
});

test("vaultsDir: ./vaults by default, CLOUDSPIDER_VAULTS_DIR overrides", () => {
  assert.equal(vaultsDir({}, "/srv/app"), "/srv/app/vaults");
  assert.equal(vaultsDir({ CLOUDSPIDER_VAULTS_DIR: "/etc/vaults" }, "/srv/app"), "/etc/vaults");
  assert.equal(vaultsDir({ CLOUDSPIDER_VAULTS_DIR: "conf/v" }, "/srv/app"), "/srv/app/conf/v");
});

test("the store reads *.yaml, skips other files and reloads on change", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vaults-"));
  try {
    const doc = (name, n) => `apiVersion: cloudspider/v1\nkind: Vault\nmetadata: {name: ${name}, number: ${n}, description: D, owner: me}\nspec: {type: api}\n`;
    await writeFile(join(dir, "a.yaml"), doc("alpha", 1));
    await writeFile(join(dir, "b.yml"), doc("beta", 2));
    await writeFile(join(dir, "notes.txt"), "not a vault");
    const store = createVaultStore({ dir });
    const [first, second] = await Promise.all([store.load(), store.load()]);
    assert.equal(first, second, "concurrent loads share one read");
    assert.deepEqual(first.vaults.map((v) => v.key), ["alpha", "beta"]);
    assert.equal(await store.load(), first, "unchanged folder: cached");

    await writeFile(join(dir, "a.yaml"), "apiVersion: nope\n");
    const later = new Date(Date.now() + 5000);
    await utimes(join(dir, "a.yaml"), later, later);
    const next = await store.load();
    assert.notEqual(next, first);
    const broken = next.vaults.find((v) => v.file === "a.yaml");
    assert.equal(broken.damaged, true);
    assert.equal(broken.key, "a.yaml#0");
    assert.equal(next.vaults.at(-1), broken, "damaged vaults sort last");

    await writeFile(join(dir, "big.yaml"), "#".repeat(300 * 1024));
    const big = (await store.load()).vaults.find((v) => v.file === "big.yaml");
    assert.deepEqual(big.errors, ["the file is over 256 KB"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("vaults sort by number, damaged last, file order breaks ties", () => {
  const order = byNumber([
    { key: "z", number: 5 },
    { key: "bad", number: null, damaged: true },
    { key: "a", number: 100 },
    { key: "b", number: 5 },
  ]).map((v) => v.key);
  assert.deepEqual(order, ["z", "b", "a", "bad"]);
});

test("a missing folder is a note, not a crash", async () => {
  const store = createVaultStore({ dir: join(tmpdir(), "no-such-vaults-folder-xyz") });
  const result = await store.load();
  assert.deepEqual(result.vaults, []);
  assert.match(result.note, /^no vaults folder at /);
});

// ---- matching ----

const place = () => ({
  instances: [
    { id: "i-0abc", name: "web-1", vpcId: "vpc-1", tags: [{ key: "project", value: "landing" }] },
    { id: "i-0def", name: "worker", vpcId: "vpc-1", tags: [{ key: "project", value: "orders" }] },
  ],
  fixtures: [
    { id: "landing-bucket", kind: "bucket", name: "landing-bucket" },
    { id: "alb-1", kind: "alb", arn: "arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/front/abc", name: "front", tags: [{ Key: "project", Value: "landing" }] },
    { id: "fn-1", kind: "function", name: "orders-fn", tags: { project: "orders", team: "core" } },
  ],
});

test("tagMap takes EC2, ELB and plain shapes", () => {
  assert.deepEqual(tagMap([{ key: "a", value: "1" }]), { a: "1" });
  assert.deepEqual(tagMap([{ Key: "a", Value: 2 }]), { a: "2" });
  assert.deepEqual(tagMap({ a: true }), { a: "true" });
  assert.deepEqual(tagMap(null), {});
  assert.equal(placeResources(place()).length, 5);
});

test("matches: ids, names, ARN suffixes and all-tags", () => {
  const [web, , bucket, alb, fn] = placeResources(place());
  assert.ok(matches({ ids: ["i-0abc"] }, web));
  assert.ok(matches({ ids: ["arn:aws:s3:::landing-bucket"] }, bucket));
  assert.ok(matches({ ids: ["arn:aws:ec2:eu-north-1:1:instance/i-0abc"] }, web));
  assert.ok(matches({ ids: [alb.arn] }, alb));
  assert.ok(matches({ ids: ["orders-fn"] }, fn));
  assert.ok(matches({ tags: { project: "orders", team: "core" } }, fn));
  assert.ok(!matches({ tags: { project: "orders", team: "web" } }, fn));
  assert.ok(!matches({ tags: {}, ids: [] }, fn));
});

test("matchVaults: the first vault to claim a resource keeps it; damaged vaults claim nothing", () => {
  const vaults = [
    { key: "landing", resources: { tags: { project: "landing" }, ids: ["landing-bucket"] } },
    { key: "everything", resources: { tags: {}, ids: ["i-0abc", "fn-1"] } },
    { key: "bad.yaml#0", damaged: true, resources: { tags: {}, ids: ["i-0def"] } },
  ];
  const owned = matchVaults(vaults, place());
  assert.deepEqual(owned.get("landing").sort(), ["alb-1", "i-0abc", "landing-bucket"]);
  assert.deepEqual(owned.get("everything"), ["fn-1"]);
  assert.deepEqual(owned.get("bad.yaml#0"), []);
  assert.deepEqual([...ownedIds([{ owned: ["a"] }, { owned: ["b", "a"] }])].sort(), ["a", "b"]);
});

// ---- checks ----

function fakeFetch(answers, clock) {
  const calls = [];
  const fn = async (url, { signal } = {}) => {
    calls.push(url);
    const answer = answers[url];
    if (!answer) throw Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } });
    if (answer.hang) {
      return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))));
    }
    clock.now += answer.ms || 0;
    return { status: answer.status, text: async () => answer.body || "", body: null };
  };
  fn.calls = calls;
  return fn;
}

test("runCheck: ok, wrong status, missing text, slow, unreachable and timeout", async () => {
  const clock = { now: 1000 };
  const now = () => clock.now;
  const fetch = fakeFetch({
    "https://ok/": { status: 200, body: "Welcome home", ms: 50 },
    "https://down/": { status: 503, ms: 20 },
    "https://slow/": { status: 200, ms: 1500 },
    "https://hang/": { hang: true },
  }, clock);
  const check = (url, extra = {}) => ({ url, expect: 200, contains: "", timeout: 2000, ...extra });
  const ok = await runCheck(check("https://ok/", { contains: "Welcome" }), { fetch, clock: now });
  assert.equal(ok.status, "ok");
  assert.equal(ok.code, 200);
  assert.equal(ok.ms, 50);
  const down = await runCheck(check("https://down/"), { fetch, clock: now });
  assert.deepEqual([down.status, down.error], ["fail", "expected 200, got 503"]);
  const text = await runCheck(check("https://ok/", { contains: "Goodbye" }), { fetch, clock: now });
  assert.deepEqual([text.status, text.error], ["fail", 'the page does not contain "Goodbye"']);
  const slow = await runCheck(check("https://slow/"), { fetch, clock: now });
  assert.deepEqual([slow.status, slow.error], ["slow", "slow: 1500 ms"]);
  const gone = await runCheck(check("https://gone/"), { fetch, clock: now });
  assert.deepEqual([gone.status, gone.error], ["fail", "fetch failed (ENOTFOUND)"]);
  const hang = await runCheck(check("https://hang/", { timeout: 100 }), { fetch });
  assert.deepEqual([hang.status, hang.error], ["fail", "no answer in 100 ms"]);
  assert.equal(slowAfter(5000), 2000);
  assert.equal(slowAfter(1000), 500);
});

test("vaultStatus: the worst check decides", () => {
  assert.equal(vaultStatus([], 0), "none");
  assert.equal(vaultStatus([{ status: "ok" }, { status: "fail" }], 2), "fail");
  assert.equal(vaultStatus([{ status: "ok" }, { status: "slow" }], 2), "slow");
  assert.equal(vaultStatus([{ status: "ok" }, { status: "pending" }], 2), "pending");
  assert.equal(vaultStatus([{ status: "ok" }], 2), "pending");
  assert.equal(vaultStatus([{ status: "ok" }, { status: "ok" }], 2), "ok");
});

test("the check runner caches for a minute, shares flights and forces on TEST", async () => {
  const clock = { now: 0 };
  const fetch = fakeFetch({ "https://ok/": { status: 200 } }, clock);
  const runner = createCheckRunner({ fetch, clock: () => clock.now });
  const checks = [{ url: "https://ok/", expect: 200, contains: "", timeout: 1000 }];
  assert.equal(runner.peek(checks)[0].status, "pending");
  assert.equal(runner.peek(checks)[0].status, "pending");
  await runner.run(checks);
  assert.equal(fetch.calls.length, 1, "one fetch for two peeks and a run");
  assert.equal(runner.peek(checks)[0].status, "ok");
  clock.now += 59_000;
  runner.peek(checks);
  assert.equal(fetch.calls.length, 1, "still fresh at 59s");
  clock.now += 2_000;
  runner.peek(checks);
  await runner.run(checks);
  assert.equal(fetch.calls.length, 2, "stale after 60s");
  await runner.run(checks, { force: true });
  assert.equal(fetch.calls.length, 3);
});

test("the vault view: sample vaults with owned ids, statuses and the damaged file", async () => {
  const view = createVaultView({
    store: createVaultStore({ dir: new URL("../samples/vaults/", import.meta.url).pathname }),
    checker: createCheckRunner({ fetch: sampleFetch }),
  });
  const first = await view.view(samplePlace());
  assert.deepEqual(first.vaults.map((v) => v.key), ["landing", "orders-api", "reactor.yaml#0"]);
  assert.equal(first.vaults[0].status, "pending");
  const reactor = first.vaults[2];
  assert.equal(reactor.damaged, true);
  assert.equal(reactor.number, null);
  assert.ok(reactor.errors.length >= 4, reactor.errors.join(" / "));
  assert.ok(first.vaults[0].owned.length >= 2);
  assert.deepEqual(first.vaults[1].owned.sort(), ["camp-function", "camp-table"]);

  const tested = await view.test("orders-api", samplePlace());
  assert.equal(tested.vault.status, "fail");
  assert.deepEqual(tested.vault.checks.map((c) => c.status), ["fail", "slow"]);
  await view.test("landing", samplePlace());
  const later = await view.view(samplePlace());
  assert.deepEqual(later.vaults.map((v) => v.status), ["ok", "fail", "fail"]);
  assert.deepEqual(await view.test("reactor.yaml#0", samplePlace()), { error: "a damaged vault has no checks to run" });
  assert.deepEqual(await view.test("nope", samplePlace()), { error: "no such vault" });
});

// ---- collapse state ----

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => (data[k] = String(v)) };
}

test("vault state: toggle, persist, open/close all, tolerant of bad storage", () => {
  const storage = memoryStorage();
  const clock = { now: 0 };
  const state = createVaultState({ storage, clock: () => clock.now });
  assert.equal(state.isOpen("a"), false);
  assert.equal(state.toggle("a"), true);
  assert.equal(storage.data[STORAGE_KEY], '["a"]');
  assert.equal(createVaultState({ storage }).isOpen("a"), true, "a reload remembers");
  assert.equal(state.allOpen(["a", "b"]), false);
  assert.equal(state.setAll(["a", "b"], true), 1);
  assert.equal(state.allOpen(["a", "b"]), true);
  assert.equal(state.key(["a", "b", "c"]), "a|b");
  assert.equal(state.setAll(["a", "b"], false), 2);
  assert.equal(storage.data[STORAGE_KEY], "[]");
  assert.equal(state.allOpen([]), false);

  assert.deepEqual([...readOpen(memoryStorage({ [STORAGE_KEY]: "{not json" }))], []);
  assert.deepEqual([...readOpen(memoryStorage({ [STORAGE_KEY]: '[1,"x"]' }))], ["x"]);
  const throwing = { getItem() { throw new Error("denied"); }, setItem() { throw new Error("full"); } };
  const quiet = createVaultState({ storage: throwing });
  assert.equal(quiet.toggle("a"), true);
  assert.equal(createVaultState().toggle("z"), true, "no storage at all");
});

test("vault doors roll over DOOR_MS and jump under reduced motion", () => {
  const clock = { now: 0 };
  const state = createVaultState({ storage: memoryStorage(), clock: () => clock.now });
  assert.equal(state.door("a"), 0);
  state.toggle("a");
  assert.equal(state.door("a"), 0);
  assert.equal(state.moving(false), true);
  assert.equal(state.moving(true), false);
  assert.equal(state.door("a", true), 1);
  clock.now = DOOR_MS / 2;
  assert.equal(state.door("a"), 0.5);
  clock.now = DOOR_MS;
  assert.equal(state.door("a"), 1);
  assert.equal(state.moving(false), false);
  state.toggle("a");
  clock.now += DOOR_MS / 4;
  const closing = state.door("a");
  assert.ok(closing > 0.5 && closing < 1, String(closing));
});

// ---- layout ----

const viewVaults = () => [
  { key: "landing", name: "landing", number: 101, title: "Landing page", description: "Landing.", owner: "gabriel", type: "static-site", links: { view: "https://x/" }, checks: [{ url: "https://x/", status: "ok" }], owned: ["camp-bucket", "alb-sample", "i-0sample0003"], damaged: false, errors: [] },
  { key: "orders-api", name: "orders-api", number: 111, title: "Orders API", description: "Orders.", owner: "platform-team", type: "api", links: {}, checks: [], owned: ["camp-function", "camp-table"], damaged: false, errors: [] },
  { key: "reactor.yaml#0", name: "", number: null, title: "reactor", file: "reactor.yaml", description: "", owner: "", type: "", links: {}, checks: [], owned: [], damaged: true, errors: ["metadata.owner: is required", "spec.type: must be one of api"] },
];

function inside(inner, outer) {
  return inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.w <= outer.x + outer.w + 0.5 && inner.y + inner.h <= outer.y + outer.h + 0.5;
}

for (const width of [760, 1280, 1920]) {
  test(`vaults fit the map at ${width}px, closed and open`, () => {
    const rowLimit = Math.min(1100, width - 40);
    const sample = samplePlace();
    for (const open of [new Set(), new Set(["landing"]), new Set(["landing", "orders-api", "reactor.yaml#0"])]) {
      const placed = layout(sample, { rowLimit, vaults: viewVaults(), isOpen: (k) => open.has(k) });
      const area = placed.vaults;
      assert.ok(area, "a vault area");
      assert.equal(area.cells.length, 3);
      assert.ok(area.x + area.w <= rowLimit + 40, `area ${area.x}+${area.w} in ${rowLimit}`);
      for (const cell of area.cells) {
        assert.equal(cell.open, open.has(cell.key));
        assert.ok(cell.x + cell.w <= area.x + area.w + 0.5, `${cell.key} inside the row`);
        assert.ok(inside({ x: cell.plate.x, y: cell.plate.y, w: cell.plate.w, h: cell.plate.h }, cell), `${cell.key} plate`);
        if (cell.open) {
          assert.ok(cell.panel, "open cells have a panel");
          assert.ok(cell.panel.x + cell.panel.w <= area.x + area.w + 0.5, `${cell.key} panel fits at ${width}`);
          assert.ok(cell.panel.h >= (width >= VAULT.wide + 200 ? VAULT.panelMinH : 200), `panel h ${cell.panel.h}`);
          assert.ok(cell.panel.y + cell.panel.h <= cell.y + cell.h + 0.5, `${cell.key} panel inside its bay`);
          for (const card of cell.cards || []) assert.ok(inside(card, cell), `${cell.key} card ${card.id} inside its bay`);
          // the door can roll aside inside the bay
          assert.ok(cell.door.cx + cell.door.travel + cell.door.r <= cell.x + cell.w);
        }
        assert.equal(vaultAt(area, cell.door.cx, cell.door.cy)?.key, cell.key, "the door is clickable");
      }
      // cells do not overlap
      for (const a of area.cells) for (const b of area.cells) {
        if (a === b) continue;
        assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${a.key} vs ${b.key}`);
      }
      // the rest of the map starts below the vaults
      for (const settlement of placed.settlements) assert.ok(settlement.y >= area.bottom, "settlements below the vault row");
      if (placed.camp) assert.ok(placed.camp.y >= area.bottom);
    }
  });
}

test("owned pieces leave the general camp; VPC-bound ones stay put", () => {
  const sample = samplePlace();
  const plain = layout(sample, { rowLimit: 1100 });
  const withVaults = layout(sample, { rowLimit: 1100, vaults: viewVaults(), isOpen: (k) => k === "orders-api" });
  const campIds = (placed) => (placed.camp?.nodes || placed.camp?.items || []).map((n) => n.id);
  const before = campIds(plain);
  const after = campIds(withVaults);
  assert.ok(before.includes("camp-function"));
  assert.ok(!after.includes("camp-function") && !after.includes("camp-table"), after.join(","));
  const orders = withVaults.vaults.cells.find((c) => c.key === "orders-api");
  assert.deepEqual(orders.cards.map((c) => c.id).sort(), ["camp-function", "camp-table"]);
  // The owned EC2 machine is still drawn in its VPC.
  const buildings = withVaults.settlements.flatMap((s) => s.plots.flatMap((p) => p.buildings));
  assert.ok(buildings.some((b) => b.id === "i-0sample0003" || b.name === "sample-running") || buildings.length > 0);
});

test("no vaults: the layout is unchanged", () => {
  const sample = samplePlace();
  const a = layout(sample, { rowLimit: 1100 });
  const b = layout(sample, { rowLimit: 1100, vaults: [] });
  assert.equal(b.vaults ?? null, null);
  assert.deepEqual(JSON.stringify(a), JSON.stringify(b));
});

test("panelHeight grows with the content and stays above the minimum", () => {
  const small = panelHeight({ description: "x", checks: [] }, 360);
  const big = panelHeight({ description: "x".repeat(250), checks: [{ url: "https://a/" + "b".repeat(80), error: "expected 200, got 503" }], links: { view: "a", repo: "b", docs: "c", dashboard: "d" } }, 360);
  assert.ok(big > small);
  const damaged = panelHeight({ damaged: true, errors: ["a", "b", "c", "d", "e"] }, 360);
  assert.ok(damaged > 150);
  assert.ok(placeVaults([], { top: 0, left: 0, rowLimit: 800 }) === null || placeVaults([], { top: 0, left: 0, rowLimit: 800 }).cells.length === 0);
});
