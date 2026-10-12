// pgcluster follows current CNPG practice (2026-10-12): 2 instances in
// different zones, continuous backup through the Barman Cloud plugin (not the
// in-tree barmanObjectStore, removed in CNPG 1.31) to an encrypted, private,
// TLS-only S3 bucket with a lifecycle, credentials from EKS Pod Identity, a
// daily ScheduledBackup. Pulumi mocks only; nothing is applied.
import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { costFor } from "../src/stack-costs.js";
import { UPGRADES } from "../src/upgrade.js";

const run = promisify(execFile);
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skip = existsSync(join(root, "upgrades/pgcluster/node_modules/@pulumi/kubernetes")) ? false : "run npm ci in upgrades/pgcluster";
const mock = (config = {}) => run(process.execPath, ["scripts/pulumi-mock.mjs", "upgrades/pgcluster", "cloudspider-pgcluster", "pgcluster", JSON.stringify({ "cloudspider-pgcluster:clusterName": "cloudspider-up", ...config })], { cwd: root, maxBuffer: 32 << 20 }).then(({ stdout }) => JSON.parse(stdout.slice(stdout.indexOf("[{"))));
const one = (r, type) => r.find((x) => x.type === type)?.inputs;

test("defaults: 2 instances one per zone, plugin WAL archiving, daily backup, bucket locked down, Pod Identity", { skip }, async () => {
  const r = await mock();
  const cluster = one(r, "kubernetes:postgresql.cnpg.io/v1:Cluster").spec;
  assert.equal(cluster.instances, 2);
  assert.deepEqual(cluster.affinity, { enablePodAntiAffinity: true, topologyKey: "topology.kubernetes.io/zone", podAntiAffinityType: "required" });
  assert.equal(cluster.enablePDB, true);
  assert.deepEqual(cluster.plugins, [{ name: "barman-cloud.cloudnative-pg.io", isWALArchiver: true, parameters: { barmanObjectName: "shopdb-s3" } }]);
  assert.equal(cluster.backup?.barmanObjectStore, undefined, "no in-tree barmanObjectStore");
  assert.equal(cluster.resources.requests.cpu, "50m");
  const store = one(r, "kubernetes:barmancloud.cnpg.io/v1:ObjectStore").spec;
  assert.equal(store.retentionPolicy, "7d");
  assert.deepEqual(store.configuration.s3Credentials, { inheritFromIAMRole: true }, "no keys: Pod Identity");
  assert.match(store.configuration.destinationPath, /^s3:\/\/cloudspider-up-shopdb-backups-/);
  const sched = one(r, "kubernetes:postgresql.cnpg.io/v1:ScheduledBackup").spec;
  assert.deepEqual([sched.method, sched.pluginConfiguration.name, sched.cluster.name, sched.immediate, sched.schedule], ["plugin", "barman-cloud.cloudnative-pg.io", "shopdb", true, "0 0 3 * * *"]);
  const pia = one(r, "aws:eks/podIdentityAssociation:PodIdentityAssociation");
  assert.deepEqual([pia.namespace, pia.serviceAccount], ["shop", "shopdb"]);
  assert.equal(one(r, "aws:s3/bucketServerSideEncryptionConfigurationV2:BucketServerSideEncryptionConfigurationV2").rules[0].applyServerSideEncryptionByDefault.sseAlgorithm, "AES256");
  const pab = one(r, "aws:s3/bucketPublicAccessBlock:BucketPublicAccessBlock");
  assert.ok(pab.blockPublicAcls && pab.blockPublicPolicy && pab.ignorePublicAcls && pab.restrictPublicBuckets);
  const life = one(r, "aws:s3/bucketLifecycleConfigurationV2:BucketLifecycleConfigurationV2").rules[0];
  assert.equal(life.abortIncompleteMultipartUpload.daysAfterInitiation, 1);
  assert.ok(life.expiration.days > 7, "the lifecycle never cuts under barman's retention");
  assert.match(one(r, "aws:s3/bucketPolicy:BucketPolicy").policy, /aws:SecureTransport/);
  const policy = JSON.parse(one(r, "aws:iam/rolePolicy:RolePolicy").policy);
  assert.ok(!JSON.stringify(policy).includes('"s3:*"'), "least privilege");
  const plugin = r.find((x) => x.type === "kubernetes:helm.sh/v3:Release" && x.name === "barman-cloud").inputs;
  assert.deepEqual([plugin.chart, plugin.namespace], ["plugin-barman-cloud", "cnpg-system"]);
});

test("backups=off and instances=1 drop the backup pieces (and the card warns)", { skip }, async () => {
  const r = await mock({ "cloudspider-pgcluster:backups": "off", "cloudspider-pgcluster:instances": "1" });
  const cluster = one(r, "kubernetes:postgresql.cnpg.io/v1:Cluster").spec;
  assert.equal(cluster.instances, 1);
  assert.equal(cluster.plugins, undefined);
  for (const t of ["kubernetes:barmancloud.cnpg.io/v1:ObjectStore", "kubernetes:postgresql.cnpg.io/v1:ScheduledBackup", "aws:s3/bucketV2:BucketV2", "aws:eks/podIdentityAssociation:PodIdentityAssociation"]) assert.equal(one(r, t), undefined, t);
});

test("the card: hardened defaults, warnings on the weak choices, storage priced per instance", () => {
  const card = UPGRADES.find((u) => u.id === "pgcluster");
  const p = Object.fromEntries(card.parameters.map((x) => [x.name, x]));
  assert.equal(p.instances.default, "2");
  assert.equal(p.instances.warn, "1");
  assert.equal(p.backups.default, "on");
  assert.equal(p.backups.warn, "off");
  const lines = costFor(card.cost, { instances: "2", backups: "on" });
  assert.deepEqual(lines.find((l) => l.price === "ebs-gp3-gb"), { price: "ebs-gp3-gb", qty: 10 });
  assert.ok(lines.some((l) => l.price === "s3-gb"));
  assert.ok(!costFor(card.cost, { instances: "1", backups: "off" }).some((l) => l.price === "s3-gb"));
});
