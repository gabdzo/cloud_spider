// Every stack's config schema (upgrades/schema/stacks.js): the card and the
// program refuse the same bad config, the program before any resource.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SCHEMAS, validateStack, cidrOk } from "../upgrades/schema/stacks.js";
import { UPGRADES, checkParams } from "../src/upgrade.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

test("every Pulumi program under upgrades/ has a schema and runs it before anything else", () => {
  for (const d of readdirSync(join(root, "upgrades")).filter((x) => existsSync(join(root, "upgrades", x, "Pulumi.yaml")))) {
    const project = /^name:\s*(\S+)/m.exec(readFileSync(join(root, "upgrades", d, "Pulumi.yaml"), "utf8"))[1];
    assert.ok(SCHEMAS[project], `${d} (${project}) has no schema`);
    const src = readFileSync(join(root, "upgrades", d, "index.js"), "utf8");
    assert.ok(/assertStackConfig\(pulumi, "[^"]+"(, \{ strict: true \})?\)|assertEks\(/.test(src), `${d} does not validate its config`);
    const first = src.search(/new (aws|k8s)\.|new pulumi\.Config\(/);
    const check = src.search(/assertStackConfig\(pulumi|assertEks\(/);
    assert.ok(first === -1 || check < first, `${d}: validation comes after a resource or config read`);
  }
});

test("every card parameter is a schema key with the same default", () => {
  for (const card of UPGRADES) {
    const schema = SCHEMAS[card.project];
    assert.ok(schema, `${card.id}: no schema for ${card.project}`);
    for (const p of card.parameters) {
      const field = schema.keys[p.name];
      assert.ok(field, `${card.id}: ${p.name} is not in the ${card.project} schema`);
      if (p.default !== "" && field.default !== undefined) assert.equal(String(p.default), String(field.cardDefault ?? field.default), `${card.id}.${p.name} default`);
    }
  }
});

test("typed errors per stack", () => {
  const bad = (project, input, re) => assert.match(validateStack(project, input).errors.join("; "), re, `${project} ${JSON.stringify(input)}`);
  bad("cloudspider-shopapi", { exposee: "alb" }, /did you mean expose/);
  bad("cloudspider-shopapi", { replicas: "7" }, /replicas must be a whole number from 1 to 6/);
  bad("cloudspider-pgcluster", { storage: "5GB" }, /storage must be like 5Gi/);
  bad("cloudspider-pgcluster", { backupSchedule: "0 3 * * *" }, /six fields/);
  bad("cloudspider-observability", { alertEmail: "nope" }, /alertEmail must be an email address/);
  bad("cloudspider-observe", { context: "cloudspider-viewer" }, /read-only by design/);
  bad("cloudspider-observe", {}, /context must be the kubeconfig context/);
  bad("cloudspider-observe", { context: "x", lokiRetention: "12h" }, /24h or more/);
  bad("cloudspider-observe", { context: "x", nodeCidr: "300.1.1.1/24" }, /not a valid IPv4 CIDR/);
  bad("cloudspider-addons", { zones: "north" }, /comma list of zones/);
  bad("cloudspider-openshift", { instanceType: "t3.micro" }, /instanceType must be/);
  bad("cloudspider-rds", { name: "RDS!" }, /short lowercase name/);
  assert.deepEqual(validateStack("cloudspider-observe", { context: "cloudspider-up-admin" }).errors, []);
  assert.ok(cidrOk("10.43.0.0/16") && !cidrOk("10.43.0.1/16") && cidrOk("10.43.0.1/16", { hostBits: true }) && !cidrOk("10.0.0.0/33"));
});

test("the card refuses what the schema refuses, before any stack is made", () => {
  const shop = UPGRADES.find((s) => s.id === "shopapi");
  assert.match(checkParams(shop, { clusterName: "Bad_Name" }).error, /clusterName/);
  assert.ok(checkParams(shop, {}).values);
});

// The program side under Pulumi mocks: a bad key fails before any resource.
for (const [dir, project, stack, input, re] of [
  ["upgrades/shopapi", "cloudspider-shopapi", "shopapi", { replicas: "9" }, /replicas must be a whole number from 1 to 6/],
  ["upgrades/pgcluster", "cloudspider-pgcluster", "pgcluster", { storage: "5GB" }, /storage must be like 5Gi/],
  ["upgrades/observe", "cloudspider-observe", "observe", { context: "x", lokiStorage: "500Gi" }, /lokiStorage must be like 5Gi/],
  ["upgrades/signal", "cloudspider-signal", "signal", { name: "Nope" }, /short lowercase name/],
]) {
  const skip = existsSync(join(root, dir, "node_modules/@pulumi/pulumi")) ? false : `run npm ci in ${dir}`;
  test(`${dir}: bad config fails before any resource (mocks)`, { skip }, async () => {
    const cfg = Object.fromEntries(Object.entries(input).map(([k, v]) => [`${project}:${k}`, v]));
    const got = await run(process.execPath, ["scripts/pulumi-mock.mjs", dir, project, stack, JSON.stringify(cfg)], { cwd: root, maxBuffer: 16 * 1024 * 1024 }).then((r) => ({ out: r.stdout }), (e) => ({ err: String(e.stdout) + String(e.stderr) }));
    assert.ok(got.err, `accepted: ${got.out?.slice(0, 200)}`);
    assert.match(got.err, re);
    assert.match(got.err, /config is not valid, nothing was created/);
  });
}
