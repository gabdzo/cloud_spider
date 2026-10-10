import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";
import { createStackReader, globMatch, stackHandles, stackOutputs } from "../src/vault-stacks.js";
import { resolveOutputs, createVaultView } from "../src/vault-view.js";
import { matchVaults, matches, placeResources } from "../src/vault-match.js";
import { validateVault, API_VERSION } from "../src/vault-schema.js";
import { createCheckRunner } from "../src/vault-checks.js";

const STATE = {
  deployment: {
    resources: [
      { type: "pulumi:pulumi:Stack", urn: "urn:pulumi:camp::p::pulumi:pulumi:Stack::p-camp", outputs: { pageUrl: "https://abc.lambda-url.eu-north-1.on.aws/", secretName: "s3cr3t", count: 3 } },
      { type: "pulumi:providers:aws", urn: "urn:prov", outputs: { region: "eu-north-1" } },
      { type: "aws:lambda/function:Function", urn: "urn:fn", outputs: { id: "camp-page", arn: "arn:aws:lambda:eu-north-1:1:function:camp-page", name: "camp-page" } },
      { type: "aws:ec2/vpc:Vpc", urn: "urn:vpc", outputs: { id: "vpc-0abc" } },
    ],
  },
};

function fakeRun(answers, calls) {
  return (cmd, args) => {
    calls.push(args.join(" "));
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    const answer = answers(args);
    setImmediate(() => {
      if (answer.out) child.stdout.emit("data", answer.out);
      if (answer.err) child.stderr.emit("data", answer.err);
      child.emit("close", answer.code || 0);
    });
    return child;
  };
}

test("stack handles and outputs: ids, ARNs, names, URNs; string outputs, no secrets", () => {
  const handles = stackHandles(STATE.deployment.resources);
  for (const h of ["urn:fn", "camp-page", "arn:aws:lambda:eu-north-1:1:function:camp-page", "vpc-0abc"]) assert.ok(handles.has(h), h);
  assert.ok(!handles.has("urn:prov"));
  assert.ok(![...handles].some((h) => h.includes("Stack::")));
  assert.deepEqual(stackOutputs(STATE.deployment.resources), { pageUrl: "https://abc.lambda-url.eu-north-1.on.aws/" });
  assert.ok(globMatch("eks-*", "eks-two") && globMatch("*", "upgrade") && !globMatch("eks-*", "upgrade") && globMatch("camp", "camp"));
});

test("the stack reader: stack export only (read-only), cached 60s, a glob lists stacks first", async () => {
  const calls = [];
  let now = 0;
  const run = fakeRun((args) => {
    if (args[1] === "ls") return { out: JSON.stringify([{ name: "upgrade" }, { name: "eks-two" }, { name: "other" }]) };
    if (args.includes("eks-two")) return { err: "error: no stack named 'eks-two' found", code: 255 };
    return { out: JSON.stringify(STATE) };
  }, calls);
  const reader = createStackReader({ run, cwd: "/repo", env: {}, clock: () => now, exists: () => true });
  const one = await reader.read({ dir: "upgrades/camp", name: "camp" });
  assert.equal(one.count, 2);
  assert.equal(one.outputs.pageUrl, "https://abc.lambda-url.eu-north-1.on.aws/");
  await reader.read({ dir: "upgrades/camp", name: "camp" });
  assert.equal(calls.length, 1, "cached");
  now = 61_000;
  await reader.read({ dir: "upgrades/camp", name: "camp" });
  assert.equal(calls.length, 2, "stale after 60s");
  const many = await reader.read({ dir: "upgrades/eks", name: "*" });
  assert.deepEqual(many.stacks.map((s) => [s.name, Boolean(s.missing)]), [["upgrade", false], ["eks-two", true], ["other", false]]);
  assert.equal(many.error, "");
  for (const call of calls) assert.match(call, /^stack (export --stack \S+|ls --json)$/, "only read-only pulumi commands");
  const none = await createStackReader({ run, exists: () => false }).read({ dir: "nowhere", name: "x" });
  assert.match(none.error, /no Pulumi.yaml in nowhere/);
});

test("a vault bound to a stack owns the stack's resources, VPCs and subnets included", () => {
  const place = {
    vpcs: [{ id: "vpc-0abc", tags: [] }],
    subnets: [{ id: "subnet-1", vpcId: "vpc-0abc", tags: [{ Key: "project", Value: "cloudspider" }] }],
    instances: [],
    fixtures: [{ id: "urn:fn", kind: "function", name: "camp-page", tags: {} }],
  };
  assert.deepEqual(placeResources(place).map((r) => r.kind), ["function", "vpc", "subnet"]);
  const vaults = [
    { key: "camp", resources: { tags: { project: "camp" }, ids: [], handles: new Set(["urn:fn", "vpc-0abc"]) } },
    { key: "cloudspider", resources: { tags: { project: "cloudspider" }, ids: [] } },
  ];
  const owned = matchVaults(vaults, place);
  assert.deepEqual(owned.get("camp"), ["urn:fn", "vpc-0abc"]);
  assert.deepEqual(owned.get("cloudspider"), ["subnet-1"]);
  assert.equal(matches({ handles: new Set() }, { id: "x", tags: {} }), false);
});

test("{output: name} links and checks: resolved from the stack, waiting until exported", () => {
  const entry = { links: { view: { output: "pageUrl" }, repo: "https://github.com/x" }, checks: [{ url: { output: "pageUrl" }, expect: 200 }, { url: "https://a.test/", expect: 200 }] };
  const later = resolveOutputs(entry, { pageUrl: "https://abc.on.aws/" });
  assert.deepEqual(later.links, { view: "https://abc.on.aws/", repo: "https://github.com/x" });
  assert.deepEqual(later.checks.map((c) => c.url), ["https://abc.on.aws/", "https://a.test/"]);
  assert.deepEqual(later.waiting, []);
  const now = resolveOutputs(entry, {});
  assert.deepEqual(now.links, { repo: "https://github.com/x" });
  assert.deepEqual(now.checks.map((c) => c.url), ["https://a.test/"]);
  assert.deepEqual(now.waiting, ["pageUrl"]);
  assert.deepEqual(resolveOutputs(entry, { pageUrl: "javascript:alert(1)" }).links, { repo: "https://github.com/x" }, "only http(s) outputs");
});

test("schema: {output: name} needs spec.stack", () => {
  const doc = (stack) => ({
    apiVersion: API_VERSION,
    kind: "Vault",
    metadata: { name: "camp", number: 1, description: "D", owner: "me" },
    spec: { type: "api", ...(stack ? { stack: { dir: "upgrades/camp", name: "camp" } } : {}), links: { view: { output: "pageUrl" } }, checks: { http: [{ url: { output: "pageUrl" } }] } },
  });
  const ok = validateVault(doc(true));
  assert.deepEqual(ok.errors, []);
  assert.deepEqual(ok.vault.spec?.links?.view ?? ok.vault.links?.view, { output: "pageUrl" });
  const bad = validateVault(doc(false));
  assert.ok(bad.errors.some((e) => /spec\.links\.view: \{output: pageUrl\} needs spec\.stack/.test(e)));
  assert.ok(bad.errors.some((e) => /spec\.checks\.http\[0\]\.url: \{output: pageUrl\} needs spec\.stack/.test(e)));
  const weird = doc(true);
  weird.spec.links.view = { output: "a b" };
  assert.ok(validateVault(weird).errors.some((e) => /spec\.links\.view: must be an http\(s\) URL/.test(e)));
});

test("the vault view binds stacks: owned, STACK info, VIEW from the output", async () => {
  const entry = {
    key: "camp", name: "camp", number: 140, title: "Camp", description: "D", owner: "me", type: "api", tags: [], file: "camp.yaml", damaged: false, errors: [], warnings: [],
    resources: { tags: { project: "camp" }, ids: [] }, links: { view: { output: "pageUrl" } }, checks: [{ url: { output: "pageUrl" }, expect: 200, timeout: 5000 }], stack: { dir: "upgrades/camp", name: "camp" },
  };
  const store = { async load() { return { dir: "v", note: "", vaults: [entry] }; } };
  const stacks = { async read() { return { stacks: [{ name: "camp" }], handles: new Set(["urn:fn"]), outputs: { pageUrl: "https://abc.on.aws/" }, count: 6, error: "" }; } };
  const view = createVaultView({ store, checker: createCheckRunner({ fetch: async () => new Response("cloudspider camp", { status: 200 }) }), stacks });
  const body = await view.view({ instances: [], fixtures: [{ id: "urn:fn", kind: "function", name: "camp-page" }] });
  const camp = body.vaults[0];
  assert.deepEqual(camp.owned, ["urn:fn"]);
  assert.equal(camp.links.view, "https://abc.on.aws/");
  assert.deepEqual(camp.stackInfo, { stacks: ["camp"], resources: 6, error: "", waiting: [] });
  assert.equal(camp.checks[0].url, "https://abc.on.aws/");
  assert.ok(!("handles" in camp.selector), "the Set stays on the server");
  JSON.stringify(body);
});
