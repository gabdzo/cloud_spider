// Every namespace a Cloud Spider stack creates ships its own NetworkPolicies
// (upgrades/netpol.js), so a from-scratch install works under Kyverno's
// generate-default-deny (ingress + egress closed except DNS).
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { DNS_EGRESS, NAMESPACE_NETPOL, POD_IDENTITY_AGENT, specsFor } from "../upgrades/netpol.js";
import { DEFAULT_DENY_SKIP } from "../upgrades/addons/kyverno-policies.js";
import { ADDONS } from "../upgrades/addons/catalog.js";

const root = new URL("../", import.meta.url).pathname;
const exec = promisify(execFile);
const files = (dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return n === "node_modules" ? [] : statSync(p).isDirectory() ? files(p) : p.endsWith(".js") ? [p] : []; });

// Who creates which namespace. A new Namespace anywhere in upgrades/ fails
// the first test until it is listed here and in NAMESPACE_NETPOL.
const CREATORS = {
  "upgrades/pgcluster/index.js": ["shop", "cnpg-system"],
  "upgrades/demo/index.js": ["demo"],
  "upgrades/observability/index.js": ["amazon-cloudwatch"],
  "upgrades/addons/scaling-demo.js": ["scaling-demo"],
  "upgrades/addons/keda.js": ["keda-demo"],
  // helmRelease: every Helm add-on with its own namespace.
  "upgrades/addons/common.js": ADDONS.filter((a) => a.kind === "helm" && a.namespace !== "kube-system").map((a) => a.namespace),
};

test("every file that creates a Namespace is listed, and ships policies for it", () => {
  const found = files(join(root, "upgrades")).filter((f) => /core\.v1\.Namespace\(/.test(readFileSync(f, "utf8"))).map((f) => f.slice(root.length)).sort();
  assert.deepEqual(found, Object.keys(CREATORS).sort());
  for (const [file, names] of Object.entries(CREATORS)) {
    const text = readFileSync(join(root, file), "utf8");
    assert.match(text, file.endsWith("common.js") ? /netpol\(addon\.namespace, ns\)/ : /\b(ship|netpol)\(/, `${file} ships its namespaces' policies`);
    for (const ns of names) assert.ok(NAMESPACE_NETPOL[ns], `${ns} (${file}) has an entry in NAMESPACE_NETPOL`);
  }
  // Each Helm add-on with its own namespace hands netpol to helmRelease.
  for (const a of ADDONS.filter((x) => x.kind === "helm" && x.namespace !== "kube-system")) {
    assert.match(readFileSync(join(root, `upgrades/addons/${a.id}.js`), "utf8"), /netpol \}\)|netpol, |, netpol \}/, `${a.id} passes netpol to helmRelease`);
  }
});

test("each namespace: DNS egress, 443 where it calls AWS/Kubernetes, Pod Identity agent with it; exemptions only on the skip list", () => {
  for (const [ns, entry] of Object.entries(NAMESPACE_NETPOL)) {
    if (entry.exempt) { assert.ok(DEFAULT_DENY_SKIP.includes(ns), `${ns} exempt but generate-default-deny covers it`); continue; }
    const specs = specsFor(ns);
    assert.deepEqual(specs.find((s) => s.name === "allow-dns-egress").spec.egress, [DNS_EGRESS], ns);
    for (const s of specs) assert.ok(s.spec.policyTypes.length === 1, `${ns}/${s.name} is one direction`);
    const https = specs.find((s) => s.name === "allow-https-egress");
    if (entry.https) assert.deepEqual(https.spec.egress[0].ports, [{ protocol: "TCP", port: 443 }], ns);
    if (entry.podIdentity) assert.ok(https.spec.egress.some((e) => e.to[0].ipBlock?.cidr === POD_IDENTITY_AGENT), ns);
    // Least privilege: nothing allows all ports to everywhere.
    for (const s of specs) for (const e of s.spec.egress || []) assert.ok(e.ports || e.to.every((t) => t.podSelector && !t.namespaceSelector && !t.ipBlock), `${ns}/${s.name} is open to everything`);
  }
  // The flows we know break without them.
  assert.ok(specsFor("shop").find((s) => s.name === "allow-https-egress").spec.podSelector.matchExpressions, "only the database pods go out on 443 in shop");
  assert.deepEqual(specsFor("cert-manager").find((s) => s.name === "allow-cert-manager-webhook").spec.ingress[0].ports, [{ protocol: "TCP", port: 10250 }]);
  assert.deepEqual(specsFor("demo").find((s) => s.name === "allow-kubelet-egress").spec.egress[0].ports, [{ protocol: "TCP", port: 10250 }]);
  assert.deepEqual(specsFor("scaling-demo").find((s) => s.name === "allow-burst-to-demo-web").spec.egress[0].ports, [{ protocol: "TCP", port: 9898 }]);
  assert.throws(() => specsFor("nowhere"), /no NetworkPolicies declared/);
});

const mock = async (dir, project, stack, cfg) => {
  const { stdout } = await exec(process.execPath, ["scripts/pulumi-mock.mjs", dir, project, stack, JSON.stringify(cfg)], { cwd: root, maxBuffer: 32 << 20 });
  const r = JSON.parse(stdout);
  return Array.isArray(r) ? r : r.resources;
};
const rendered = (resources) => {
  const out = {};
  for (const x of resources.filter((r) => r.type === "kubernetes:networking.k8s.io/v1:NetworkPolicy")) (out[x.inputs.metadata.namespace] ||= []).push(x.inputs.metadata.name);
  return out;
};
const ready = (dir) => (existsSync(join(root, dir, "node_modules/@pulumi/pulumi")) ? false : `run npm ci in ${dir}`);

test("rendered: add-on stacks make their namespaces' policies (kyverno exempt)", { skip: ready("upgrades/addons") }, async () => {
  for (const [stack, want] of [["cert-manager", ["cert-manager"]], ["keda", ["keda", "keda-demo"]], ["scaling-demo", ["scaling-demo"]], ["kyverno", []]]) {
    const got = rendered(await mock("upgrades/addons", "cloudspider-addons", `${stack}-cloudspider-up`, { "cloudspider-addons:clusterName": "cloudspider-up" }));
    assert.deepEqual(Object.keys(got).sort(), want.sort(), stack);
    for (const ns of want) assert.deepEqual(got[ns].sort(), specsFor(ns).map((s) => s.name).sort(), `${stack}/${ns}`);
  }
});

test("rendered: pgcluster ships shop + cnpg-system, demo ships demo, observability ships amazon-cloudwatch with Container Insights", { skip: ready("upgrades/pgcluster") || ready("upgrades/demo") || ready("upgrades/observability") }, async () => {
  const pg = rendered(await mock("upgrades/pgcluster", "cloudspider-pgcluster", "pgcluster", { "cloudspider-pgcluster:clusterName": "cloudspider-up" }));
  for (const ns of ["shop", "cnpg-system"]) for (const name of specsFor(ns).map((s) => s.name)) assert.ok(pg[ns].includes(name), `${ns}/${name}`);
  const demo = rendered(await mock("upgrades/demo", "cloudspider-demo", "demo", { "cloudspider-demo:clusterName": "cloudspider-up" }));
  for (const name of specsFor("demo").map((s) => s.name)) assert.ok(demo.demo.includes(name), `demo/${name}`);
  const obs = rendered(await mock("upgrades/observability", "cloudspider-observability", "observability", { "cloudspider-observability:containerInsights": "on", "cloudspider-observability:alarms": "off", "cloudspider-observability:dashboard": "off" }));
  assert.deepEqual(obs["amazon-cloudwatch"].sort(), specsFor("amazon-cloudwatch").map((s) => s.name).sort());
});
