// Shop (upgrades/pgcluster + upgrades/shopapi): ingress denied by default in
// shop and cnpg-system, every flow the shop needs still allowed (simulated
// over the rendered policies, as test/demo-netpol.test.js does for demo),
// K8S-SEC-005 passes on both namespaces, and Shop API runs 2 replicas spread
// over zones with a PDB (NET-K8S-002). Pulumi mocks only; nothing is applied.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { selectorMatches } from "../src/netdebug/kube-checks.js";
import { cidrContains } from "../src/cidr.js";
import { kubeEvaluators, kubeEvaluatorsMore } from "../src/score/evaluators/kube.js";

const E = { ...kubeEvaluators, ...kubeEvaluatorsMore };
const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skip = ["pgcluster", "shopapi"].every((d) => existsSync(join(root, `upgrades/${d}/node_modules/@pulumi/kubernetes`))) ? false : "run npm ci in upgrades/pgcluster and upgrades/shopapi";
const mock = (dir, project, stack, config = {}) => run(process.execPath, ["scripts/pulumi-mock.mjs", `upgrades/${dir}`, project, stack, JSON.stringify({ [`${project}:clusterName`]: "cloudspider-up", ...config })], { cwd: root, maxBuffer: 32 << 20 }).then(({ stdout }) => JSON.parse(stdout.slice(stdout.indexOf("[{"))));
let both;
const rendered = () => (both ??= Promise.all([mock("pgcluster", "cloudspider-pgcluster", "pgcluster"), mock("shopapi", "cloudspider-shopapi", "shopapi", { "cloudspider-shopapi:expose": "alb" })]).then(([a, b]) => [...a, ...b]));
const NP = "kubernetes:networking.k8s.io/v1:NetworkPolicy";
const policiesOf = (r) => r.filter((x) => x.type === NP).map((x) => x.inputs);

// NetworkPolicy semantics: no selecting policy = allowed; otherwise some rule
// of a selecting policy must match. src: { ns, labels } or { ip }.
function allowed(policies, src, dst, port) {
  const selecting = policies.filter((p) => p.metadata.namespace === dst.ns && selectorMatches(p.spec.podSelector, dst.labels) && (p.spec.policyTypes || ["Ingress"]).includes("Ingress"));
  if (!selecting.length) return true;
  return selecting.some((p) => (p.spec.ingress || []).some((rule) => {
    const portOk = !(rule.ports || []).length || rule.ports.some((x) => x.port === port);
    const fromOk = !(rule.from || []).length || rule.from.some((f) => {
      if (f.ipBlock) return Boolean(src.ip) && cidrContains(f.ipBlock.cidr, `${src.ip}/32`);
      if (src.ip) return false;
      const nsOk = f.namespaceSelector ? selectorMatches(f.namespaceSelector, { "kubernetes.io/metadata.name": src.ns }) : src.ns === p.metadata.namespace;
      return nsOk && (!f.podSelector || selectorMatches(f.podSelector, src.labels));
    });
    return portOk && fromOk;
  }));
}

test("shop + cnpg-system: default deny ingress, every flow the shop needs allowed, little else", { skip }, async () => {
  const np = policiesOf(await rendered());
  const shopapi = { ns: "shop", labels: { app: "shopapi", "app.kubernetes.io/name": "shopapi" } };
  const migrate = { ns: "shop", labels: { app: "shopapi-migrate" } };
  const db = { ns: "shop", labels: { "cnpg.io/cluster": "shopdb", "cnpg.io/podRole": "instance" } };
  const operator = { ns: "cnpg-system", labels: { "app.kubernetes.io/name": "cloudnative-pg" } };
  const alb = { ip: "10.0.1.20" }; // an ALB ENI in a cluster subnet (mock VPC 10.0.0.0/16)
  const controlPlane = { ip: "10.0.2.33" }; // an EKS control-plane ENI
  const need = [
    ["ALB → shopapi:3000", alb, shopapi, 3000],
    ["shopapi → shopdb:5432", shopapi, db, 5432],
    ["migrate Job → shopdb:5432", migrate, db, 5432],
    ["shopdb replica → shopdb:5432", db, db, 5432],
    ["CNPG operator → instance status :8000", operator, db, 8000],
    ["CNPG operator → shopdb:5432", operator, db, 5432],
    ["EKS control plane → CNPG webhook :9443", controlPlane, operator, 9443],
  ];
  for (const [what, src, dst, port] of need) assert.ok(allowed(np, src, dst, port), `${what} must be allowed`);
  const denied = [
    ["the internet → shopapi", { ip: "203.0.113.9" }, shopapi, 3000],
    ["demo/web → shopdb", { ns: "demo", labels: { app: "web" } }, db, 5432],
    ["the VPC → shopdb", alb, db, 5432],
    ["shopapi → CNPG webhook", shopapi, operator, 9443],
    ["the internet → CNPG webhook", { ip: "203.0.113.9" }, operator, 9443],
    ["migrate → shopapi", migrate, shopapi, 3000],
  ];
  for (const [what, src, dst, port] of denied) assert.ok(!allowed(np, src, dst, port), `${what} must be denied`);
});

test("K8S-SEC-005 passes on shop and cnpg-system with the rendered policies", { skip }, async () => {
  const items = policiesOf(await rendered()).map((i) => ({ namespace: i.metadata.namespace, name: i.metadata.name, podSelector: i.spec.podSelector || {}, policyTypes: i.spec.policyTypes || [], ingress: (i.spec.ingress || []).length }));
  const pods = [{ namespace: "shop", name: "shopapi-1", labels: {}, containers: [] }, { namespace: "cnpg-system", name: "cnpg-1", labels: {}, containers: [] }];
  const out = E["default-deny-ingress"]({ data: { "kube-pods": { items: pods }, "kube-networkPolicies": { items } } });
  assert.deepEqual(out.items.map((i) => [i.id, i.pass]).sort(), [["cnpg-system", true], ["shop", true]]);
});

test("Shop API: 2 replicas by default spread over zones, a PDB of 1, a readiness probe; replicas=1 drops the PDB", { skip }, async () => {
  const r = await rendered();
  const dep = r.find((x) => x.type === "kubernetes:apps/v1:Deployment" && x.name === "shopapi").inputs;
  assert.equal(dep.spec.replicas, 2);
  const zone = dep.spec.template.spec.topologySpreadConstraints.find((t) => t.topologyKey === "topology.kubernetes.io/zone");
  assert.deepEqual([zone.maxSkew, zone.whenUnsatisfiable, zone.labelSelector.matchLabels.app], [1, "ScheduleAnyway", "shopapi"]);
  assert.ok(dep.spec.template.spec.containers[0].readinessProbe?.httpGet);
  const pdb = r.find((x) => x.type === "kubernetes:policy/v1:PodDisruptionBudget").inputs;
  assert.deepEqual([pdb.spec.minAvailable, pdb.spec.selector.matchLabels.app], [1, "shopapi"]);
  const one = await mock("shopapi", "cloudspider-shopapi", "shopapi", { "cloudspider-shopapi:replicas": "1" });
  assert.equal(one.find((x) => x.type === "kubernetes:apps/v1:Deployment").inputs.spec.replicas, 1);
  assert.ok(!one.some((x) => x.type === "kubernetes:policy/v1:PodDisruptionBudget"));
  await assert.rejects(mock("shopapi", "cloudspider-shopapi", "shopapi", { "cloudspider-shopapi:replicas": "9" }));
});
