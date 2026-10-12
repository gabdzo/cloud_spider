// Demo polish (2026-10-12 06:06): the ALB → cluster wire has room, the
// PUBLIC tab clears the IGW label, a stack's own resources stop reading
// "OWNS 0", old failures before a stack's last run are not TROUBLE, and a
// vault can follow one resource of a shared stack (the Pod Identity agent in
// the EKS stack).
import assert from "node:assert/strict";
import test from "node:test";
import { placeArchVpc, WIRE_GAP, BADGE_ROOM } from "../src/arch-layout.js";
import { vaultSummary } from "../src/vault-page.js";
import { autoVaults, createVaultView } from "../src/vault-view.js";
import { validateVault } from "../src/vault-schema.js";

function place(withAlb = true) {
  const subnets = [{ id: "subnet-a", vpcId: "vpc-1", zone: "eu-north-1a", cidr: "10.43.1.0/24", public: true }, { id: "subnet-b", vpcId: "vpc-1", zone: "eu-north-1b", cidr: "10.43.2.0/24", public: true }];
  const eks = { id: "arn:eks:cloudspider-up", kind: "eks", name: "cloudspider-up", vpcId: "vpc-1", subnetIds: ["subnet-a", "subnet-b"] };
  const alb = { id: "arn:alb:shop", kind: "alb", name: "k8s-shop-shopapi", vpcId: "vpc-1", public: true, scheme: "internet-facing", cluster: "cloudspider-up", ingress: "shop/shopapi", subnetIds: ["subnet-a", "subnet-b"], zones: ["eu-north-1a", "eu-north-1b"], targetCount: 2, healthyCount: 2 };
  const fixtures = withAlb ? [alb, eks] : [eks];
  return { vpc: { id: "vpc-1", cidr: "10.43.0.0/16", name: "cloudspider-up" }, place: { subnets, fixtures, links: [] }, fixtures };
}

test("a public ALB and the cluster it fronts sit a wire apart, below the gate label", () => {
  const { vpc, place: p, fixtures } = place();
  const out = placeArchVpc(vpc, { place: p, x: 24, y: 24, rowLimit: 1600, routes: new Map(), instances: [], fixtures, gate: "igw" });
  const alb = out.fixtures.find((f) => f.kind === "alb");
  const eks = out.fixtures.find((f) => f.kind === "eks");
  assert.ok(alb && eks, "both cards placed");
  assert.equal(alb.y, eks.y, "one row");
  assert.ok(eks.x - (alb.x + alb.w) >= WIRE_GAP, `gap ${eks.x - (alb.x + alb.w)}`);
  assert.ok(alb.y - 9 >= 24 + 36, "the PUBLIC tab is below the gate label (y + 34)");
  const plain = place(false);
  const out2 = placeArchVpc(plain.vpc, { place: plain.place, x: 24, y: 24, rowLimit: 1600, routes: new Map(), instances: [], fixtures: plain.fixtures, gate: "igw" });
  assert.equal(out2.fixtures.find((f) => f.kind === "eks").y, alb.y - BADGE_ROOM, "no badge, no extra room");
  assert.ok(out.edges.some((e) => e.from === alb.id && e.to === eks.id), "ALB → cluster wire");
});

test("a vault whose stack resources are not on the map says its stack size, not OWNS 0", () => {
  const base = { key: "demo", name: "demo", type: "service", owner: "gabriel", stack: { dir: "upgrades/demo", name: "demo" }, checks: [], owned: [], trouble: [] };
  assert.ok(!vaultSummary({ ...base, stackInfo: { stacks: ["demo"], resources: 29 } }).lines.join(" ").includes("OWNS 0"));
  assert.ok(vaultSummary({ ...base, stack: null, stackInfo: null }).lines.join(" ").includes("OWNS 0"));
  assert.ok(vaultSummary({ ...base, owned: ["x"], stackInfo: { stacks: ["demo"], resources: 29 } }).lines.join(" ").includes("OWNS 1"));
});

test("failed calls from before the stack's last run are not TROUBLE; later ones are", async () => {
  const entry = { key: "demo", name: "demo", number: 115, type: "service", resources: { tags: { project: "demo" }, ids: [] }, links: {}, checks: [], stack: { dir: "upgrades/demo", name: "demo" } };
  const store = { load: async () => ({ vaults: [entry], dir: "vaults" }) };
  const updated = Date.parse("2026-10-12T05:00:00+02:00");
  const stacks = { read: async () => ({ stacks: [{ name: "demo", resources: [] }], handles: new Set(["/cloudspider/eks/cloudspider-up/demo"]), outputs: {}, count: 29, updated }) };
  const view = createVaultView({ store, checker: { peek: () => [] }, stacks });
  const fail = (time) => ({ time, name: "CreateLogGroup", error: "ResourceAlreadyExists", resources: ["/cloudspider/eks/cloudspider-up/demo"] });
  const old = await view.view({}, { failures: [fail(updated - 60_000)] });
  assert.deepEqual(old.vaults[0].trouble, []);
  const fresh = await view.view({}, { failures: [fail(updated + 60_000)] });
  assert.equal(fresh.vaults[0].trouble.length, 1);
});

test("pod-identity follows the add-on in the EKS stack (stack.resource)", async () => {
  const doc = { apiVersion: "cloudspider/v1", kind: "Vault", metadata: { name: "pod-identity", number: 200, title: "Pod Identity agent", description: "agent", owner: "gabriel" }, spec: { type: "cluster", resources: { tags: { project: "pod-identity" } }, stack: { dir: "upgrades/eks", name: "*", resource: "eks-pod-identity-agent" } } };
  const checked = validateVault(doc);
  assert.deepEqual(checked.errors || [], []);
  const entry = checked.entry || checked.vault || checked;
  const stack = entry.stack || entry.spec?.stack;
  assert.equal(stack.resource, "eks-pod-identity-agent");
  const seen = [];
  const stacks = { read: async (spec) => { seen.push(spec); return { stacks: [{ name: "upgrade" }], count: spec.resource ? 1 : 0 }; } };
  const auto = await autoVaults([], [{ name: "pod-identity", stack }], stacks);
  assert.equal(auto.length, 1);
  assert.equal(seen[0].resource, "eks-pod-identity-agent");
});
