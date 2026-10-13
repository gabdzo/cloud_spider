#!/usr/bin/env node
// Fake `kubectl` and `aws` for the TAKE DOWN CLUSTER end-to-end test: they
// read and write the same fake cluster (FAKE_CLUSTER) the stand-in program's
// resources live in. Every call is appended to s.calls.
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const file = process.env.FAKE_CLUSTER;
const s = JSON.parse(readFileSync(file, "utf8"));
const tool = basename(process.argv[1]).replace(/\.mjs$/, "");
const args = process.argv.slice(2);
s.calls.push(`${tool} ${args.join(" ")}`);
const save = () => writeFileSync(file, JSON.stringify(s, null, 2));
const out = (v) => { save(); process.stdout.write(JSON.stringify(v)); process.exit(0); };
const fail = (m) => { save(); process.stderr.write(m); process.exit(1); };

if (tool === "kubectl") {
  let a = args[0] === "--context" ? args.slice(2) : args;
  if (a[0] === "-n") a = a.slice(2);
  if (args[1] !== "cloudspider-up-admin") fail(`context ${args[1]} is not the test cluster's`);
  const verb = a[0];
  if (verb === "get" && /webhookconfigurations$/.test(a[1])) {
    const kind = a[1].startsWith("validating") ? "validating" : "mutating";
    out({ items: s.webhooks.filter((w) => w.startsWith(kind)).map((w) => ({ metadata: { name: w.split("/")[1], labels: { "webhook.kyverno.io/managed-by": "kyverno" } } })) });
  }
  if (verb === "delete" && /webhookconfigurations$/.test(a[1])) {
    const kind = a[1].startsWith("validating") ? "validating" : "mutating";
    s.webhooks = s.webhooks.filter((w) => w !== `${kind}/${a[2]}`);
    out({});
  }
  if (verb === "get" && a[1] === "ingresses.networking.k8s.io") {
    out({ items: Object.entries(s.finalizers).map(([name, f]) => ({ metadata: { namespace: "shop", name, finalizers: [f] } })) });
  }
  // pgcluster's volumes (s.volumes: { id, pv, pvDeleted, stuck }): a stuck
  // one is held by a pod/attachment until the nodes go.
  if (verb === "get" && a[1] === "pv") {
    out({ items: (s.volumes || []).filter((v) => !v.pvDeleted).map((v) => ({ metadata: { name: v.pv }, spec: { claimRef: { namespace: "shop", name: `${v.pv}-claim` } } })) });
  }
  if (verb === "delete" && a[1] === "clusters.postgresql.cnpg.io") { s.cnpgDeleted = true; out({}); }
  if (verb === "delete" && a[1] === "pvc") {
    for (const v of s.volumes || []) if (!v.stuck) v.pvDeleted = true;
    out({});
  }
  if (verb === "wait" && a[1] === "--for=delete" && a[2]?.startsWith("pv/")) {
    const v = (s.volumes || []).find((x) => `pv/${x.pv}` === a[2]);
    if (v && !v.pvDeleted) fail(`error: timed out waiting for the condition on persistentvolumes/${v.pv}`);
    out({});
  }
  if (verb === "get") fail(`error: the server doesn't have a resource type "${a[1]}"`);
  if (verb === "patch" && a.includes("ingresses.networking.k8s.io")) {
    const name = a[a.indexOf("ingresses.networking.k8s.io") + 1];
    delete s.finalizers[name];
    // No controller ran: the ALB it made stays in AWS.
    s.leftovers.push("arn:aws:elasticloadbalancing:eu-north-1:000000000000:loadbalancer/app/k8s-shop-shopapi/abc");
    out({});
  }
  if (verb === "wait" || verb === "delete") out({});
  fail(`fake kubectl: ${a.join(" ")}`);
}
if (tool === "aws") {
  if (args[0] === "eks" && args[1] === "list-nodegroups") out({ nodegroups: ["nodes-1"] });
  if (args[0] === "eks" && args[1] === "describe-nodegroup") out({ nodegroup: { scalingConfig: { minSize: s.nodes, desiredSize: s.nodes, maxSize: 2 } } });
  if (args[0] === "eks" && args[1] === "update-nodegroup-config") { s.nodes = 1; s.kyvernoRunning = true; out({}); }
  if (args[0] === "eks" && args[1] === "wait") out({});
  if (args[0] === "ec2" && args[1] === "describe-volumes") {
    const want = (args.find((x) => x.startsWith("Name=volume-id,Values=")) || "").split("Values=")[1]?.split(",") || [];
    const nodes = Boolean(s.objects["upgrade:nodegroup"]);
    out({ Volumes: (s.volumes || []).filter((v) => want.includes(v.id) && !v.pvDeleted && (!v.stuck || nodes)).map((v) => ({ VolumeId: v.id, State: v.state || "in-use", Tags: [] })) });
  }
  if (args[0] === "resourcegroupstaggingapi") out({ ResourceTagMappingList: s.leftovers.map((ResourceARN) => ({ ResourceARN })) });
  fail(`fake aws: ${args.join(" ")}`);
}
fail(`unknown tool ${tool}`);
