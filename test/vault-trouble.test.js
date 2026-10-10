import assert from "node:assert/strict";
import test from "node:test";
import { trailNames } from "../src/aws.js";
import { createRadio } from "../src/radio.js";
import { ERROR_PATTERN, createLogCache, readErrorLines, vaultHandles, vaultLogGroups, vaultTrouble } from "../src/vault-trouble.js";
import { createVaultView } from "../src/vault-view.js";
import { createVaultStore } from "../src/vaults.js";
import { createCheckRunner } from "../src/vault-checks.js";
import { sampleFailures, sampleFetch, sampleLogs, samplePlace, sampleStacks } from "../src/sample.js";
import { campFixtures } from "../src/upgrade-rules.js";
import { closedText } from "../src/vault-draw.js";
import { stackLogGroups } from "../src/vault-stacks.js";

const raw = (body) => ({ CloudTrailEvent: JSON.stringify(body) });

test("a failed CloudTrail call keeps the names it asked for (nothing was made, so no resource)", () => {
  assert.deepEqual(trailNames(raw({ errorCode: "InvalidParameterValueException", requestParameters: { functionName: "cloudspider-camp-page", role: "arn:aws:iam::1:role/x", memorySize: 128 } })), ["cloudspider-camp-page"]);
  assert.deepEqual(trailNames(raw({ errorCode: "AccessDenied", requestParameters: { roleArn: "arn:aws:iam::1:role/camp-role", bucketName: "b" } })), ["camp-role", "b"]);
  assert.deepEqual(trailNames(raw({ requestParameters: { functionName: "ok" } })), [], "only failures");
  assert.deepEqual(trailNames({}), []);
});

test("the radio keeps failed calls raw, newest first", async () => {
  const radio = createRadio({
    lookup: async () => ({ events: [
      { name: "CreateFunction20150331", time: 1, error: "role cannot be assumed", names: ["camp-page"], resources: [] },
      { name: "RunInstances", time: 3, error: "", resources: ["i-1"] },
      { name: "PutItem", time: 2, error: "AccessDenied", resources: ["camp-table"] },
    ] }),
  });
  await radio.refresh("eu-north-1");
  assert.deepEqual(radio.failures().map((e) => e.name), ["PutItem", "CreateFunction20150331"]);
  radio.clear();
  assert.deepEqual(radio.failures(), []);
});

test("vault trouble: failures on the vault's names, ARNs or ids; others are ignored", () => {
  const entry = { resources: { ids: ["cloudspider-camp-page"], handles: new Set(["urn:x", "arn:aws:dynamodb:eu-north-1:1:table/cloudspider-camp-table"]) } };
  const handles = vaultHandles(entry, ["urn:fn"], new Map([["urn:fn", { name: "cloudspider-camp-fn", arn: "arn:fn" }]]));
  for (const h of ["cloudspider-camp-page", "urn:x", "urn:fn", "cloudspider-camp-fn", "arn:fn"]) assert.ok(handles.has(h), h);
  const failures = [
    { name: "UpdateFunctionConfiguration", time: 9, error: "role cannot be assumed", names: ["cloudspider-camp-page"], resources: [] },
    { name: "PutItem", time: 8, error: "AccessDenied", resources: ["cloudspider-camp-table"], names: [] },
    { name: "RunInstances", time: 7, error: "Unsupported", resources: ["i-other"], names: [] },
  ];
  assert.deepEqual(vaultTrouble(handles, failures), [
    { time: 9, call: "UpdateFunctionConfiguration", issue: "role cannot be assumed", resource: "cloudspider-camp-page" },
    { time: 8, call: "PutItem", issue: "AccessDenied", resource: "cloudspider-camp-table" },
  ]);
  assert.deepEqual(vaultTrouble(new Set(), failures), []);
});

test("error lines: FilterLogEvents per group, last hour, error pattern; missing groups skipped, sorted, capped", async () => {
  const calls = [];
  const logs = {
    async search(args) {
      calls.push(args);
      if (args.group === "/gone") return { missing: true };
      if (args.group === "/denied") return { error: "AccessDeniedException" };
      return { events: Array.from({ length: 10 }, (_, i) => ({ time: 1000 + i * 2 + (args.group === "/b" ? 1 : 0), message: `${args.group} ERROR ${i}\n  at x` })) };
    },
  };
  const out = await readErrorLines({ logs, region: "eu-north-1", groups: ["/a", "/b", "/gone"], now: 3_600_000 + 5 });
  assert.equal(out.lines.length, 12);
  assert.ok(out.lines.every((l, i, all) => i === 0 || all[i - 1].time <= l.time));
  assert.equal(out.lines.at(-1).text, "/b ERROR 9 at x");
  assert.equal(out.note, "");
  assert.ok(calls.every((c) => c.pattern === ERROR_PATTERN && c.start === 5 && c.region === "eu-north-1"));
  const denied = await readErrorLines({ logs, region: "r", groups: ["/denied"], now: 0 });
  assert.match(denied.note, /cannot read \/denied: AccessDeniedException/);
  assert.match((await readErrorLines({ logs, region: "r", groups: ["/gone"], now: 0 })).note, /no error lines in the last hour/);
  assert.match((await readErrorLines({ logs, region: "r", groups: [], now: 0 })).note, /no log groups/);
  assert.deepEqual(vaultLogGroups(["/cloudspider/test"], ["fn", "fn"]), ["/cloudspider/test", "/aws/lambda/fn"]);
  assert.deepEqual(stackLogGroups([{ type: "aws:cloudwatch/logGroup:LogGroup", outputs: { name: "/x" } }, { type: "aws:lambda/function:Function", outputs: { name: "f" } }, { type: "aws:s3/bucket:Bucket", outputs: { name: "b" } }]), ["/x", "/aws/lambda/f"]);
  let n = 0;
  let now = 0;
  const cache = createLogCache({ clock: () => now });
  await cache.get("k", async () => ++n);
  await cache.get("k", async () => ++n);
  now = 61_000;
  await cache.get("k", async () => ++n);
  assert.equal(n, 2);
});

test("the sample vault view: orders-api has trouble and its function's error lines", async () => {
  const view = createVaultView({
    store: createVaultStore({ dir: new URL("../samples/vaults/", import.meta.url).pathname }),
    checker: createCheckRunner({ fetch: sampleFetch }),
    stacks: sampleStacks(),
  });
  const body = await view.view(samplePlace(), { failures: sampleFailures(10_000_000) });
  const orders = body.vaults.find((v) => v.key === "orders-api");
  assert.deepEqual(orders.trouble.map((t) => t.call), ["UpdateFunctionConfiguration20150331v2", "PutItem"]);
  assert.deepEqual(orders.logGroups, ["/aws/lambda/cloudspider-camp-page"]);
  assert.deepEqual(body.vaults.find((v) => v.key === "landing").trouble, []);
  const logs = await view.logs("orders-api", samplePlace(), { logs: sampleLogs, region: "eu-north-1" });
  assert.equal(logs.lines.length, 2);
  assert.match(logs.lines[1].text, /Task timed out/);
  assert.deepEqual(await view.logs("nope", samplePlace(), { logs: sampleLogs }), { error: "no such vault" });
});

test("camp's function URL is a map piece of its own (kind url, labelled by host)", () => {
  const fixtures = campFixtures([
    { type: "aws:lambda/function:Function", urn: "urn:fn", outputs: { functionName: "cloudspider-camp-page", name: "cloudspider-camp-page" } },
    { type: "aws:lambda/functionUrl:FunctionUrl", urn: "urn:url", dependencies: ["urn:fn"], outputs: { functionUrl: "https://abc123.lambda-url.eu-north-1.on.aws/", functionName: "cloudspider-camp-page" } },
  ], "coarse");
  const url = fixtures.find((f) => f.kind === "url");
  assert.equal(url.name, "abc123.lambda-url.eu-north-1.on.aws");
  assert.equal(url.url, "https://abc123.lambda-url.eu-north-1.on.aws/");
  assert.deepEqual(url.uses, ["urn:fn"]);
});

test("closed door text: trouble, LIVE, pieces on the map", () => {
  assert.equal(closedText({ trouble: [{}, {}], stack: { dir: "upgrades/camp", name: "camp" }, stackInfo: { stacks: ["camp"] }, owned: ["a", "b", "c"] }), "TROUBLE ×2 · 3 ON MAP");
  assert.equal(closedText({ stack: { dir: "upgrades/camp", name: "camp" }, stackInfo: { stacks: ["camp"] }, owned: ["a"] }), "LIVE · CAMP · 1 ON MAP");
  assert.equal(closedText({ owned: [] }), "");
});
