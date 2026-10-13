import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { homedir, hostname as osHostname } from "node:os";
import { judgeLock, lockRefusal, parseLocks, pendingOps, processNameOf, staleNote } from "./pulumi-locks.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { costFor, estimate } from "./stack-costs.js";
import { ADDONS, DIR as ADDON_DIR, PROJECT as ADDON_PROJECT } from "../upgrades/addons/catalog.js";
import { LEGACY_CLUSTER, cardName, confirmMatches, confirmMismatch, confirmNames, errorHead, failureText, historyFact, maskKubeconfig, rerunCommand, resourceFact, runHint, stackFor, tooManyClusters } from "./upgrade-rules.js";
import { volumeSweepStep } from "./volume-sweep.js";
import { createRunLog } from "./run-log.js";
import { stackAuditEntry } from "./stack-audit.js";
import { validateEks } from "../upgrades/schema/eks.js";
import { DATA_PROJECTS, validateStack } from "../upgrades/schema/stacks.js";


export function childEnvFor(env) {
  return {
    ...env,
    AWS_PROFILE: env.AWS_PROFILE || "default",
    AWS_REGION: "eu-north-1",
    PULUMI_CONFIG_PASSPHRASE: env.PULUMI_CONFIG_PASSPHRASE || "",
  };
}

export { LEGACY_CLUSTER, failureText, stackFor, tooManyClusters } from "./upgrade-rules.js";
export { errorHead, rerunCommand, runHint } from "./upgrade-rules.js";
export { campFixtures, cardName, confirmMatches, confirmMismatch, confirmNames, confirmPrompt, historyFact, pulumiMissing, pulumiWarning, resourceFact, upgradeSpiderLine, watchLine } from "./upgrade-rules.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

// Nodes in the EKS card's node group, unless cloudspider.yaml says otherwise
// (stacks.eks.maxNodes). upgrades/eks refuses more than EKS_HARD_MAX_NODES.
export const EKS_MAX_NODES = 3;

// The card list with the EKS node cap of this server (a copy: UPGRADES itself
// keeps the default).
export function withEksMaxNodes(list, max = EKS_MAX_NODES) {
  if (max === EKS_MAX_NODES) return list;
  return list.map((spec) =>
    spec.id === "eks" ? { ...spec, parameters: spec.parameters.map((p) => (p.name === "nodeCount" ? { ...p, max } : p)) } : spec,
  );
}

const ADDON_PARAMETERS = {
  // New namespaces start closed (Kyverno generate; existing ones untouched).
  kyverno: [
    { name: "defaultDeny", type: "string", default: "on", choices: ["on", "off"], labels: { on: "on · new namespaces get a default-deny NetworkPolicy (DNS egress allowed)", off: "off · new namespaces are open (SCORE FAILs K8S-SEC-010)" }, warn: "off" },
  ],
  karpenter: [
    { name: "capacity", type: "string", default: "spot", choices: ["spot", "on-demand"] },
    // kubelet maxPods on its nodes (only with the EKS stack's prefix delegation).
    { name: "maxPods", type: "string", default: "32", choices: ["32", "58", "auto"] },
  ],
  "scaling-demo": [
    { name: "hpa", type: "string", default: "on", choices: ["on", "off"] },
    { name: "burst", type: "string", default: "off", choices: ["off", "on"] },
    { name: "inflate", type: "number", default: 0, min: 0, max: 6 },
    // Set by Cloud Spider from what it sees on the cluster (not a field on
    // the card): the HPAs go on demo/web and demo/api only when present.
    { name: "demoApp", type: "string", default: "absent", choices: ["absent", "present"], auto: true },
  ],
};

// Every card: what it makes (note), the stack it runs, its parameters, what
// must be up first (needs), and its cost lines (src/stack-costs.js) for the
// card's estimate in eu-north-1. A stack that runs on the EKS cluster
// counts only what it adds (the cluster is the eks card).
export const UPGRADES = [
  {
    id: "eks",
    title: "EKS",
    note: "One small cluster in eu-north-1, about $0.10 an hour for the control plane. Each cluster name is its own stack (eks-<name>; cloudspider-up keeps the stack upgrade). It installs the cluster's EKS add-ons too, free: the VPC CNI (with prefix delegation, so a node is not capped at its ENI IPs: 11 pods on a t4g.small, 17 on a t4g.medium, and with networkPolicy on its node agent enforces NetworkPolicy objects; off, they are ignored), the Pod Identity agent, metrics-server and the EBS CSI driver (about 6 pods on one node; turn one off below). Other stacks use them and never create them. Prefix delegation alone does not raise a managed node's pod cap: maxPods auto keeps the node group as it is, at EKS's ENI limit (11 on a t4g.small, 17 on a t4g.medium); 32 (t4g.small) or 32, 58 or 110 (t4g.medium) REPLACES the node group once, the new group first, so new nodes take that many pods (PREVIEW shows the replace; RUN asks you to confirm it). capacityType SPOT runs the nodes on spot from a pool of similar types (t4g.small, c7g.medium, c6g.medium for a t4g.small; t4g.medium, m7g.medium, m6g.medium for a t4g.medium), about a third of the on-demand price; maxPods auto then means 32 (one number that fits every type in the pool; set 58 or 110 on a t4g.medium for more) and it REPLACES the node group once (new group first). Cheapest layout that survives a zone: nodeCount 2, SPOT, maxPods 110 on a t4g.medium, one node in eu-north-1a and one in 1b (EKS spreads a group over its two subnets).",
    dir: "upgrades/eks",
    // The same schema the program runs first (upgrades/schema/eks.js): the
    // card refuses exactly what pulumi would, before any stack is made.
    check: (v) => validateEks(v).errors.join("; "),
    stack: "upgrade",
    project: "cloudspider-upgrade",
    vault: "eks",
    needs: [],
    cost: [{ price: "eks-cluster" }, { price: "ec2:t4g.small", param: "instanceType", prefix: "ec2:", perNode: true, spot: "capacityType" }, { price: "ebs-gp3-gb", qty: 20, perNode: true }, { price: "public-ipv4", perNode: true }],
    parameters: [
      { name: "clusterName", type: "string", default: "cloudspider-up" },
      { name: "instanceType", type: "string", default: "t4g.small", choices: ["t4g.small", "t4g.medium"] },
      // max: stacks.eks.maxNodes in cloudspider.yaml (createUpgrade eksMaxNodes).
      { name: "nodeCount", type: "number", default: 1, min: 1, max: EKS_MAX_NODES },
      // The cluster-level EKS add-ons this stack owns (upgrades/eks-addons.js
      // EKS_OWNED); docs/design/stack-dependencies.md.
      { name: "vpcCni", type: "string", default: "on", choices: ["on", "off"] },
      { name: "prefixDelegation", type: "string", default: "on", choices: ["on", "off"] },
      // NetworkPolicy enforcement (vpc-cni enableNetworkPolicy); in place.
      { name: "networkPolicy", type: "string", default: "on", choices: ["on", "off"] },
      // kubelet's pod cap per node; a number REPLACES the node group once.
      { name: "maxPods", type: "string", default: "auto", choices: ["auto", "32", "58", "110"] },
      // ON_DEMAND or SPOT (a pool of similar types); a change REPLACES the node group once.
      { name: "capacityType", type: "string", default: "ON_DEMAND", choices: ["ON_DEMAND", "SPOT"] },
      { name: "podIdentityAgent", type: "string", default: "on", choices: ["on", "off"] },
      { name: "metricsServer", type: "string", default: "on", choices: ["on", "off"] },
      { name: "ebsCsiDriver", type: "string", default: "on", choices: ["on", "off"] },
      // The VPC range (upgrades/schema/eks.js vpcCidr); a change replaces the VPC and the cluster.
      { name: "vpcCidr", type: "string", default: "10.43.0.0/16", pattern: /^\d{1,3}(\.\d{1,3}){3}\/1[67]$/ },
      // K8S-OBS-003: api, audit, authenticator to /aws/eks/<cluster>/cluster (in place).
      { name: "controlPlaneLogs", type: "string", default: "off", choices: ["off", "on"], labels: { off: "off · no audit trail (SCORE FAILs K8S-OBS-003)", on: "on · api, audit, authenticator, kept 7 days (~$0.10-0.25/day: $0.50/GB ingested, audit is the noisy one)" }, warn: "off" },
    ],
  },
  {
    id: "signal",
    title: "Signal",
    note: "A log group kept for one day. Its own stack. Almost nothing on the bill.",
    dir: "upgrades/signal",
    stack: "signal",
    project: "cloudspider-signal",
    vault: "signal",
    needs: [],
    cost: [{ usage: "logs" }],
    parameters: [{ name: "name", type: "string", default: "cloudspider-signal" }],
  },
  {
    id: "barrel",
    title: "Barrel",
    note: "An empty bucket in its own stack. The account id is added so the name is unique.",
    dir: "upgrades/barrel",
    stack: "barrel",
    project: "cloudspider-barrel",
    vault: "barrel",
    needs: [],
    cost: [{ usage: "s3-requests" }],
    parameters: [{ name: "name", type: "string", default: "cloudspider-barrel" }],
  },
  {
    id: "camp",
    title: "Camp",
    note: "A private page, a function URL, a table, and one secret. The URL is public and returns the page only. Take it down deletes this stack.",
    dir: "upgrades/camp",
    stack: "camp",
    project: "cloudspider-camp",
    vault: "camp",
    needs: [],
    cost: [{ price: "secret" }, { usage: "lambda" }, { usage: "s3-requests" }],
    parameters: [{ name: "name", type: "string", default: "cloudspider-camp" }],
  },
  {
    id: "rds",
    title: "RDS Postgres",
    note: "PostgreSQL 16 on db.t4g.micro, 20 GB gp3, single-AZ, in its own VPC with private subnets only (no NAT, no public IP). RDS keeps the password in Secrets Manager. No backups, no final snapshot: take it down deletes the data.",
    dir: "upgrades/rds",
    stack: "rds",
    project: "cloudspider-rds",
    vault: "rds",
    needs: [],
    cost: [{ price: "rds:db.t4g.micro:postgres" }, { price: "rds-gp3-gb", qty: 20 }, { price: "secret" }],
    parameters: [{ name: "name", type: "string", default: "cloudspider-rds" }],
  },
  {
    id: "pgcluster",
    title: "Postgres on EKS",
    note: "CloudNativePG on the EKS cluster: the operator and the database shop/shopdb, 2 instances in different zones (a standby takes over) on 5 Gi gp3 volumes each. backups=on: continuous backup with the Barman Cloud plugin to an encrypted S3 bucket (WAL archiving + a daily base backup, 7 days kept), AWS access through EKS Pod Identity. Needs the cluster with its Pod Identity agent and EBS CSI driver (the EKS stack installs both) and cert-manager for the plugin; pick t4g.medium on the EKS card first (a t4g.small runs out of pods).",
    dir: "upgrades/pgcluster",
    stack: "pgcluster",
    project: "cloudspider-pgcluster",
    vault: "pgcluster",
    // Where its pods run: the run pane says what they wait on.
    namespaces: ["shop", "cnpg-system"],
    needs: ["eks"],
    // EKS add-ons it uses (the EKS stack installs them): NEEDS chips + preflight.
    eksAddons: ["eks-pod-identity-agent", "aws-ebs-csi-driver"],
    cost: [{ price: "ebs-gp3-gb", qty: 5, times: "instances" }, { price: "s3-gb", qty: 1, when: { backups: "on" } }, { usage: "s3-requests", when: { backups: "on" } }],
    parameters: [
      { name: "clusterName", type: "string", default: "cloudspider-up" },
      // Hardened by default: a standby in another zone and backups on.
      { name: "instances", type: "string", default: "2", choices: ["1", "2", "3"], labels: { 1: "1 · no standby (SCORE FAILs K8S-CNPG-001)", 2: "2 · primary + standby in another zone", 3: "3 · primary + 2 standbys" }, warn: "1" },
      { name: "backups", type: "string", default: "on", choices: ["on", "off"], labels: { on: "on · WAL + daily backup to S3 (Barman Cloud plugin)", off: "off · no backups (SCORE FAILs K8S-CNPG-003, K8S-REL-007)" }, warn: "off" },
    ],
  },
  {
    id: "shopapi",
    title: "Shop API",
    note: "A sample backend on EKS: a migration Job seeds the shop schema, then PostgREST serves GET /items from shopdb. It needs the Postgres cluster (pgcluster) on the cluster first and never makes namespace shop itself. expose=none (default): no load balancer, kubectl -n shop port-forward svc/shopapi 3000:80. expose=alb: an internet-facing ALB in front (Ingress, target type ip, health check /items), made by the AWS Load Balancer Controller add-on (lbc), which must be up; the URL is the stack output url. Take Shop API down before lbc, or the ALB is left behind.",
    dir: "upgrades/shopapi",
    stack: "shopapi",
    project: "cloudspider-shopapi",
    vault: "shopapi",
    // Where its pods run: the run pane says what they wait on.
    namespaces: ["shop"],
    needs: ["eks", "pgcluster"],
    // expose=alb: the ALB is made by the AWS Load Balancer Controller.
    needsWhen: [{ param: "expose", value: "alb", needs: ["lbc"] }],
    // The ALB and its two public IPv4 addresses (one per subnet), only with expose=alb.
    cost: [{ price: "alb", when: { expose: "alb" } }, { price: "public-ipv4", qty: 2, when: { expose: "alb" } }, { usage: "alb-lcu", when: { expose: "alb" } }],
    parameters: [
      { name: "clusterName", type: "string", default: "cloudspider-up" },
      {
        name: "expose",
        type: "string",
        default: "none",
        choices: ["none", "alb"],
        // What each choice means, said on the card under the field; none
        // warns (a demo usually wants the public ALB).
        labels: { none: "none · private, port-forward only", alb: "alb · PUBLIC ALB ≈ $0.82/day" },
        notes: {
          none: "Nothing is reachable from the internet: no load balancer, no URL. Reach it with kubectl -n shop port-forward svc/shopapi 3000:80, or pick alb (a demo wants alb). Running with none removes an ALB made before.",
          alb: "Public: an internet-facing ALB in every cluster AZ (needs the lbc add-on), URL http://<alb>/items, OPEN on this card and the map. About $0.034/h ($0.82/day) + LCU usage while up.",
        },
        warn: "none",
      },
      // 2: one per zone behind the ALB (NET-K8S-002) and a PDB; 1: cheaper, one zone.
      { name: "replicas", type: "string", default: "2", choices: ["1", "2", "3"] },
    ],
  },
  {
    id: "demo",
    title: "EKS demo app",
    note: "The demo workload on the EKS cluster (docs/RUN-ME.md §8): podinfo web → api, a load generator, and an OpenTelemetry collector sending pod logs to CloudWatch (1 day) and traces to X-Ray. It needs the Pod Identity agent and metrics-server EKS add-ons, which the EKS stack installs; it never creates them. Take it down deletes this stack; the cluster stays.",
    dir: "upgrades/demo",
    stack: "demo",
    project: "cloudspider-demo",
    vault: "demo",
    // Where its pods run: the run pane says what they wait on.
    namespaces: ["demo"],
    needs: ["eks"],
    eksAddons: ["eks-pod-identity-agent", "metrics-server"],
    // One pod per node: the preflight checks every node has a slot.
    daemonSets: [{ namespace: "demo", name: "otel-collector", labels: { app: "otel-collector" } }],
    cost: [{ usage: "logs" }],
    parameters: [{ name: "clusterName", type: "string", default: "cloudspider-up" }],
  },
  {
    id: "observability",
    title: "Observability",
    note: "Observability for the EKS cluster. containerInsights=on: the CloudWatch Observability EKS add-on (CloudWatch agent + Fluent Bit: Container Insights metrics, container logs, dashboards; credentials through EKS Pod Identity), its log groups kept retentionDays (7). About $0.40-1.00/day on a 2-node demo, mostly metrics and log ingestion ($0.50/GB); it also brings the node-not-ready alarm. alarms=on: an SNS topic and a basic alarm set: per ALB of the cluster 5XX (load balancer and target) and unhealthy targets, plus node not ready with Container Insights. $0.10 per alarm per month (about 4-6 here). alertEmail: an email subscription, opt-in (AWS mails a confirm link). dashboard=on: a CloudWatch dashboard <cluster>-overview (ALB traffic, 5XX, p95, target health, alarms; nodes and pods with Container Insights), free within the account's first 3 dashboards, then $3/month. Needs the cluster with its Pod Identity agent.",
    dir: "upgrades/observability",
    stack: "observability",
    project: "cloudspider-observability",
    vault: "observability",
    needs: ["eks"],
    eksAddons: ["eks-pod-identity-agent"],
    cost: [{ usage: "logs", when: { containerInsights: "on" } }, { price: "cw-alarm", qty: 6, when: { alarms: "on" } }, { price: "cw-dashboard", when: { dashboard: "on" } }],
    parameters: [
      { name: "clusterName", type: "string", default: "cloudspider-up" },
      { name: "containerInsights", type: "string", default: "off", choices: ["off", "on"], labels: { off: "off · no metrics history or container logs (SCORE FAILs K8S-OBS-001/002)", on: "on · CloudWatch Observability add-on: node/pod metrics, container logs, node-not-ready alarm (~$0.40-1.00/day on 2 nodes)" }, warn: "off" },
      { name: "alarms", type: "string", default: "on", choices: ["on", "off"], labels: { on: "on · ALB 5XX, unhealthy targets, node not ready → SNS (~$0.02/day)", off: "off · nobody is told (SCORE FAILs K8S-OBS-005)" }, warn: "off" },
      { name: "alertEmail", type: "string", default: "" },
      { name: "dashboard", type: "string", default: "on", choices: ["on", "off"], labels: { on: "on · CloudWatch dashboard <cluster>-overview: ALB, alarms, nodes/pods with Container Insights (first 3 free, then $3/month)", off: "off · no dashboard (SCORE WARNs K8S-OBS-007)" } },
      { name: "retentionDays", type: "string", default: "7", choices: ["1", "7", "14", "30"] },
    ],
  },
  {
    id: "site",
    title: "Static site",
    note: "A private S3 bucket with one page, served over HTTPS by CloudFront through origin access control. A new distribution takes a few minutes to deploy.",
    dir: "upgrades/site",
    stack: "site",
    project: "cloudspider-site",
    vault: "site",
    needs: [],
    cost: [{ usage: "cloudfront" }, { usage: "s3-requests" }],
    parameters: [{ name: "name", type: "string", default: "cloudspider-site" }],
  },
  {
    id: "worker",
    title: "SQS worker",
    note: "A queue, a dead-letter queue and a small Node Lambda that logs each job. A job {\"fail\": true} ends up in the dead-letter queue after 3 tries.",
    dir: "upgrades/worker",
    stack: "worker",
    project: "cloudspider-worker",
    vault: "worker",
    needs: [],
    cost: [{ usage: "sqs" }, { usage: "lambda" }, { usage: "logs" }],
    parameters: [{ name: "name", type: "string", default: "cloudspider-worker" }],
  },
  {
    id: "openshift",
    title: "OpenShift Local",
    note: "One m7i-flex.2xlarge with nested virtualization for OpenShift Local (CRC), for the EX280 labs. No inbound ports: connect with Session Manager. It stops itself maxHours after each boot and every night at 22:00 Prague time; stopped, only the 120 GB disk bills (~$10/mo). You bring the Red Hat pull secret (docs/RUN-ME.md §12). c5.metal is the fallback if CRC refuses nested KVM (~$4.39/h).",
    dir: "upgrades/openshift",
    stack: "openshift",
    project: "cloudspider-openshift",
    vault: "openshift",
    needs: [],
    cost: [{ price: "ec2:m7i-flex.2xlarge" }, { price: "ebs-gp3-gb", qty: 120 }, { price: "public-ipv4" }],
    parameters: [
      { name: "name", type: "string", default: "cloudspider-openshift" },
      { name: "instanceType", type: "string", default: "m7i-flex.2xlarge", choices: ["m7i-flex.2xlarge", "m7i.2xlarge", "c5.metal"] },
      { name: "maxHours", type: "number", default: 4, min: 1, max: 12 },
    ],
  },
  {
    id: "observe",
    title: "Observe bundle",
    note: "Opt-in live observability for any Kubernetes or OpenShift cluster (docs/plan-modules-and-service-graph.md §7.2): Grafana Beyla on every node (eBPF: live HTTP/gRPC calls between pods with rate, errors and p95, no app changes), an OpenTelemetry node agent (container logs, kubelet stats) and gateway (Kubernetes Events, cluster metrics, Prometheus out for Cloud Spider, in memory), kube-state-metrics, and Loki (one binary, a small claim, 72h). Namespace cloudspider-observe with default-deny NetworkPolicies. PRIVILEGED: Beyla runs privileged with hostPID and the log agent mounts /var/log/pods as root; on OpenShift two SecurityContextConstraints are bound to those two ServiceAccounts only. allowPrivileged=off installs a reduced, unprivileged bundle (no Beyla, no container logs). The viewer gets services/proxy get on otel-collector:metrics and loki:http (group cloudspider-viewers, plus viewerUser). context is a write context (not cloudspider-viewer). Resources, profile crc on 1 node: 5 pods, requests ~115m CPU / 384Mi, limits 1.4 CPU / 1.4Gi, plus the Loki claim; standard is ~2-3x per node. No cloud cost. Take it down deletes the namespace (Loki's claim with it), the ClusterRoles and the SCCs.",
    dir: "upgrades/observe",
    stack: "observe",
    project: "cloudspider-observe",
    vault: "observe",
    // No AWS: state in a local file backend (Pulumi.yaml), no AWS tags.
    localState: true,
    needs: [],
    namespaces: ["cloudspider-observe"],
    daemonSets: [{ namespace: "cloudspider-observe", name: "beyla", labels: { "app.kubernetes.io/component": "beyla" } }, { namespace: "cloudspider-observe", name: "otel-agent", labels: { "app.kubernetes.io/component": "agent" } }],
    cost: [],
    parameters: [
      { name: "context", type: "string", default: "", pattern: /^[A-Za-z0-9_.:@/-]{0,200}$/ },
      { name: "platform", type: "string", default: "kubernetes", choices: ["kubernetes", "openshift"], labels: { kubernetes: "plain Kubernetes (Pod Security: namespace labelled privileged)", openshift: "OpenShift / CRC (adds 2 SecurityContextConstraints bound to Beyla and the log agent only)" } },
      { name: "allowPrivileged", type: "string", default: "off", choices: ["off", "on"], labels: { off: "off · reduced bundle: no Beyla (no live edges/RED), no container logs; Events history, cluster metrics, kubelet stats, kube-state-metrics, all unprivileged (~90m CPU / 288Mi on crc)", on: "on · ⚠ PRIVILEGED: Beyla with hostPID (eBPF) and a root log agent (read-only /var/log/pods); on OpenShift 2 SCCs bound to those two ServiceAccounts" }, warn: "on" },
      { name: "viewerUser", type: "string", default: "", pattern: /^[A-Za-z0-9_.:@-]{0,128}$/ },
      { name: "profile", type: "string", default: "crc", choices: ["crc", "standard"], labels: { crc: "crc · tight requests/limits (~115m CPU / 384Mi on 1 node)", standard: "standard · roomier (~2-3x per node)" } },
      { name: "kubeStateMetrics", type: "string", default: "install", choices: ["install", "skip"], labels: { install: "install · the bundle's own", skip: "skip · the cluster already runs one" } },
      { name: "logs", type: "string", default: "on", choices: ["on", "off"], labels: { on: "on · Loki + container logs (morning report LOG ERRORS, Event history)", off: "off · metrics and live edges only" } },
      { name: "lokiStorage", type: "string", default: "5Gi", pattern: /^[1-9][0-9]?Gi$/ },
      { name: "lokiRetention", type: "string", default: "72h", choices: ["24h", "72h", "168h"] },
      { name: "storageClass", type: "string", default: "", pattern: /^([a-z0-9]([-a-z0-9.]{0,61}[a-z0-9])?)?$/ },
      { name: "nodeCidr", type: "string", default: "", pattern: /^(\d{1,3}(\.\d{1,3}){3}\/\d{1,2})?$/ },
    ],
  },
  ...addonCards(),
];

// Cluster add-ons (upgrades/addons/catalog.js): one card each, one stack per
// add-on and cluster (<addon>-<cluster>). The Stacks view draws them nested
// under their cluster, not in the main list.
function addonCards() {
  return ADDONS.filter((addon) => addon.offered !== false).map((addon) => ({
    id: addon.id,
    title: addon.title,
    note: addon.note,
    dir: ADDON_DIR,
    stack: addon.id,
    project: ADDON_PROJECT,
    vault: addon.id,
    needs: ["eks", ...addon.needs],
    // Where its pods run (kube-system is shared: not watched).
    namespaces: [addon.namespace, ...(addon.id === "keda" ? ["keda-demo"] : [])].filter((ns) => ns && ns !== "kube-system"),
    cost: addon.cost,
    nodeCost: addon.nodeCost,
    addon: true,
    parameters: [{ name: "clusterName", type: "string", default: "cloudspider-up" }, ...(ADDON_PARAMETERS[addon.id] || [])],
  }));
}

const NAME = /^[a-z][a-z0-9-]{1,27}$/;

export function checkParams(spec, input = {}) {
  const values = {};
  for (const parameter of spec.parameters) {
    const raw = input[parameter.name] == null || input[parameter.name] === "" ? parameter.default : input[parameter.name];
    if (parameter.type === "number") {
      const number = Number(raw);
      if (!Number.isInteger(number) || number < parameter.min || number > parameter.max) {
        return { error: parameter.min === parameter.max ? `${parameter.name} must be ${parameter.min}` : `${parameter.name} must be a whole number from ${parameter.min} to ${parameter.max}` };
      }
      values[parameter.name] = String(number);
      continue;
    }
    const text = String(raw);
    if (parameter.choices && !parameter.choices.includes(text)) {
      return { error: `${parameter.name} must be ${parameter.choices.join(" or ")}` };
    }
    // pattern: a parameter's own rule (kube context names hold "/" and ":").
    if (parameter.pattern && !parameter.pattern.test(text)) {
      return { error: `${parameter.name} is not valid here` };
    }
    if (!parameter.choices && !parameter.pattern && !NAME.test(text)) {
      return { error: `${parameter.name} must be a short lowercase name` };
    }
    values[parameter.name] = text;
  }
  // The stack's own schema (upgrades/schema/stacks.js), the same one its
  // program runs first, then a card's extra rule: said before any stack is made.
  const schema = validateStack(spec.project, values);
  if (schema.errors.length) return { error: schema.errors.join("; ") };
  const problem = spec.check?.(values);
  if (problem) return { error: problem };
  return { values };
}

const CAMP_MS = 30_000;

// What a card shows of a run: the newest output, at most this many
// characters (an EKS up prints pages; the error that matters comes last).
const SHOW_CHARS = 96 * 1024;

function tailLines(lines, max = SHOW_CHARS) {
  const out = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = String(lines[i]);
    size += line.length + 1;
    if (size > max) {
      out.unshift(`… ${i + 1} earlier lines are in the log file`);
      break;
    }
    out.unshift(line);
  }
  return out;
}

// runsDir: where every run's log goes (.cloudspider/runs). Omitted, runs
// are kept in memory only (the tests).
const ALL_UPGRADES = UPGRADES;

export function createUpgrade({ run: spawnChild = spawn, kill = (pid, signal) => process.kill(pid, signal), hostname = osHostname(), processName = processNameOf, cwd = root, env = process.env, clock = () => Date.now(), runsDir = null, volumes = null, sleep = undefined, sweepLimits = undefined, eksMaxNodes = EKS_MAX_NODES, audit = null, gitSha = "", preflight = null, policyPack = undefined } = {}) {
  const pack = policyPack ?? defaultPolicyPack(cwd);
  // audit.jsonl (src/stack-audit.js): never lets a failed write stop a run.
  const record = (item, phase) => {
    if (!audit) return;
    Promise.resolve().then(() => audit(stackAuditEntry(item, phase, { gitSha }))).catch(() => {});
  };
  // Every child this server spawned that has not exited yet (pulumi and the
  // odd npm/kubectl step), for a clean shutdown (src/shutdown.js). Each runs
  // detached, in its own process group: a terminal Ctrl-C reaches the server
  // only, and the server asks pulumi to cancel.
  const live = new Map();
  let stopping = false;
  // Stacks a run found locked (not provably stale): UNLOCK may remove those.
  const lockedStacks = new Map();
  const lockGuard = {
    judge: (lock) => judgeLock(lock, { hostname, processName, ownPids: new Set(children().map((c) => c.pid)) }),
    locked: (stack, info) => lockedStacks.set(stack, info),
  };
  const run = (cmd, args, opts) => {
    const child = spawnChild(cmd, args, opts);
    if (child && child.pid) {
      const own = (args || []).indexOf("--stack");
      live.set(child, { pid: child.pid, text: [cmd, ...(args || [])].join(" "), stack: own >= 0 ? args[own + 1] : "" });
    }
    return child;
  };
  const exited = (child) => child.exitCode != null || child.signalCode != null || child.done;
  function children() {
    for (const child of live.keys()) if (exited(child)) live.delete(child);
    return [...live.values()].map((item) => ({ ...item, stack: item.stack || jobOfPid(item.pid)?.stack || "" }));
  }
  function jobOfPid(pid) {
    return runningJobs().find((item) => item.childPid === pid) || null;
  }
  const signalOne = (pid, signal) => {
    try {
      kill(pid, signal);
      return true;
    } catch {
      return false;
    }
  };
  // Every UPGRADES below is this server's list (stacks.eks.maxNodes applied).
  const UPGRADES = withEksMaxNodes(ALL_UPGRADES, eksMaxNodes);
  // Runs go on side by side when they touch different stacks. One stack
  // runs one thing at a time (its lock), and a cluster and the stacks on it
  // never overlap (conflictFor). job / notice: the newest of each, for
  // status(); jobs / notices: per stack, for each card.
  let job = null;
  let notice = null;
  const jobs = new Map();
  const notices = new Map();
  const dirGates = new Map();
  let campCache = null;
  let legacyCache = null;
  let runs = 0;
  const outputsCache = new Map();
  const runLog = createRunLog({ dir: runsDir, clock });

  function view(item) {
    const ended = item.endedAt ?? null;
    const failed = Boolean(item.error);
    const state = item.running ? "running" : item.refused ? "refused" : failed ? "failed" : "done";
    return {
      id: item.id,
      running: Boolean(item.running),
      state,
      module: item.module,
      action: item.action,
      stack: item.stack || "",
      error: item.error || "",
      hint: item.hint || "",
      head: failed ? headOf(item) : [],
      command: item.command || "",
      log: item.log || "",
      startedAt: item.startedAt ?? null,
      endedAt: ended,
      elapsedMs: item.startedAt == null ? 0 : (ended ?? clock()) - item.startedAt,
      steps: (item.steps || []).map((step) => ({ text: step.text, status: step.status })),
      lines: tailLines(item.lines || []),
      notes: item.notes || [],
      ...(item.unlock ? { unlock: item.unlock } : {}),
      ...(item.fromDisk ? { fromDisk: true } : {}),
    };
  }

  function status() {
    if (!job && !notice) return { running: false, lines: [] };
    // A refusal newer than the run is what the user just did: it shows
    // first and stays until the next run, never wiped by the next poll.
    if (notice && (!job || notice.at >= job.startedAt)) return { ...view(notice), ...busyFor(notice.stack) };
    return { ...view(job), ...busyFor(job.stack) };
  }

  function save(item) {
    item.logHandle?.save({
      id: item.id,
      module: item.module,
      action: item.action,
      stack: item.stack,
      running: item.running,
      refused: Boolean(item.refused),
      error: item.error || "",
      hint: item.hint || "",
      head: item.error ? headOf(item) : [],
      command: item.command || "",
      startedAt: item.startedAt,
      endedAt: item.endedAt ?? null,
      steps: (item.steps || []).map((step) => ({ text: step.text, status: step.status })),
      notes: item.notes || [],
    });
  }

  // Cloud Spider said no before pulumi ran. Kept like a run (in the card,
  // on disk) so the reason does not vanish with the next poll.
  function refuse({ module = "", action = "", stack = "", params = null, error = "", command = "" } = {}) {
    const at = clock();
    if (!stack && params) {
      const spec = UPGRADES.find((item) => item.id === module);
      const checked = spec ? checkParams(spec, params) : { error: "no spec" };
      if (!checked.error) stack = stackFor(spec, checked.values, legacyCache?.name || LEGACY_CLUSTER);
    }
    runs += 1;
    const { hint } = runHint(error);
    notice = { id: `r${runs}`, refused: true, running: false, module, action, stack, error, hint, command, startedAt: at, endedAt: at, at, steps: [], lines: [`refused: ${error}`], errLines: [] };
    // A refusal on a stack that is running stays out of its card: the card
    // keeps showing the live run (the answer still carries the refusal).
    if (stack && !jobs.get(stack)?.running) notices.set(stack, notice);
    if (module || stack) record(notice, "refused");
    if (stack && runLog) {
      notice.logHandle = runLog.start(stack, { startedAt: at });
      notice.log = notice.logHandle?.rel || "";
      notice.logHandle?.append(`# ${new Date(at).toISOString()} ${action} ${stack}: refused before pulumi ran\n${error}${hint ? `\nhint: ${hint}` : ""}`);
      save(notice);
    }
    return { error, hint, refused: true, stack, state: "refused" };
  }

  // The card's own stack: the run going on it, else its last run from disk.
  async function statusFor(module, values = {}) {
    const spec = UPGRADES.find((item) => item.id === module);
    if (!spec) return status();
    const checked = checkParams(spec, values);
    const legacy = spec.id === "eks" ? await legacyFor() : undefined;
    const stack = stackFor(spec, checked.values || {}, legacy);
    const busy = busyFor(stack);
    const mine = [notices.get(stack), jobs.get(stack)].filter(Boolean).sort((a, b) => b.startedAt - a.startedAt)[0];
    if (mine) return { ...view(mine), ...busy };
    const saved = runLog?.latest(stack);
    if (saved) {
      return {
        ...view({ ...saved, running: false, fromDisk: true, errLines: [], lines: saved.lines, log: saved.log, endedAt: saved.endedAt ?? saved.startedAt }),
        // A run the server never saw end (it was stopped mid-run).
        ...(saved.running ? { state: "failed", error: saved.error || "the server stopped while this ran; the log ends where it stopped", hint: "Restart left the stack as pulumi had it. RUN again: a lock that run left on this computer is removed by itself (the run pane says so), and any half-done resources are listed with the refresh to run." } : {}),
        ...busy,
      };
    }
    return { running: false, lines: [], stack, ...busy };
  }

  async function legacyFor() {
    const spec = UPGRADES.find((item) => item.id === "eks");
    const now = clock();
    if (legacyCache && now - legacyCache.at < CAMP_MS) return legacyCache.name;
    const out = await capture(run, join(cwd, spec.dir), childEnvFor(env), ["stack", "output", "name", "--stack", spec.stack]);
    const name = out.error ? "" : out.text.trim();
    legacyCache = { at: now, name: /^[a-z][a-z0-9-]{1,99}$/.test(name) ? name : LEGACY_CLUSTER };
    return legacyCache.name;
  }

  return {
    list() {
      return UPGRADES.map((spec) => ({
        id: spec.id,
        title: spec.title,
        note: spec.note,
        engine: "pulumi",
        needs: spec.needs || [],
        ...(spec.eksAddons ? { eksAddons: spec.eksAddons } : {}),
        ...(spec.needsWhen ? { needsWhen: spec.needsWhen } : {}),
        stack: spec.stack,
        vault: spec.vault || "",
        cost: estimate(costFor(spec.cost || [], {})),
        costLines: spec.cost || [],
        ...(spec.nodeCost ? { nodeCost: estimate(spec.nodeCost) } : {}),
        ...(spec.addon ? { addon: true } : {}),
        parameters: spec.parameters,
        current: stackConfig(spec, cwd),
      }));
    },
    status,
    children,
    // A line from outside pulumi into a running stack's pane and log (what
    // its pods wait on). false when that stack has no run going.
    say(stack, text) {
      const item = jobs.get(stack);
      if (!item?.running || item.stack !== stack) return false;
      const line = String(text || "").trimEnd();
      if (!line) return true;
      item.lines.push(line);
      if (item.lines.length > KEEP_LINES) item.lines.splice(0, item.lines.length - KEEP_LINES);
      item.logHandle?.append(line);
      return true;
    },
    // Shutdown, step 1: SIGINT to each running child (pulumi cancels, writes
    // its state and releases the stack lock); no further step or run starts.
    stop() {
      stopping = true;
      const items = children();
      for (const item of items) signalOne(item.pid, "SIGINT");
      return items.length;
    },
    // Shutdown, step 2: SIGKILL to each child's process group (pulumi and its
    // provider plugins, which would otherwise be left orphaned); the pid
    // alone if the group is gone.
    force() {
      stopping = true;
      const items = children();
      for (const item of items) if (!signalOne(-item.pid, "SIGKILL")) signalOne(item.pid, "SIGKILL");
      return items.length;
    },
    // UNLOCK on a run's error plate: `pulumi cancel` for a stack a run found
    // locked, once its name is typed. On a DIY backend that deletes the
    // stack's lock files (a pulumi that still runs there keeps running).
    unlock({ stack = "", confirmName = "" } = {}) {
      const name = String(stack || "");
      const held = lockedStacks.get(name);
      if (!held) return { error: `no lock on stack ${name.slice(0, 80) || "(none)"} that Cloud Spider has seen; RUN the stack first`, hint: "UNLOCK is offered on a run that stopped on a lock." };
      if (String(confirmName || "").trim() !== name) return { error: `type ${name} to remove its lock`, hint: "Only when no pulumi is running on that stack anywhere (another terminal, another computer)." };
      const args = ["cancel", "--yes", "--non-interactive", "--stack", name];
      const conflict = conflictFor({ locks: [name], cluster: "", isCluster: false });
      if (conflict) return refuse({ module: held.module, action: "unlock", stack: name, error: conflict });
      return startJob({
        module: held.module,
        action: "unlock",
        stack: name,
        directory: held.dir,
        where: held.where,
        command: `cd ${held.dir} && pulumi ${args.join(" ")}`,
        steps: [{ args, cwd: held.dir, text: `pulumi ${args.join(" ")}`, lockTried: true }],
        onDone: (done) => {
          if (!done?.error) lockedStacks.delete(name);
        },
      });
    },
    // The cluster the old shared stack really holds, read from its state
    // (the `name` output), not from Pulumi.upgrade.yaml, which the old Stacks
    // panel rewrote on every new name.
    async legacyCluster() {
      return legacyFor();
    },
    statusFor,
    refuse,
    async logFor(module, values = {}) {
      const spec = UPGRADES.find((item) => item.id === module);
      if (!spec || !runLog) return null;
      const checked = checkParams(spec, values);
      if (checked.error) return null;
      const stack = stackFor(spec, checked.values, spec.id === "eks" ? await legacyFor() : undefined);
      const saved = runLog.latest(stack, { tail: 0 });
      return saved ? { log: saved.log, text: saved.text } : null;
    },
    // What the card's existing stack holds (read-only): its config values
    // for the card's parameters and its outputs. The EKS card fills its
    // fields from this so RUN never changes the instance type by accident.
    async liveParams(module, values = {}) {
      const spec = UPGRADES.find((item) => item.id === module);
      if (!spec) return { error: "no such upgrade" };
      const checked = checkParams(spec, { ...values, ...(spec.id === "eks" ? { instanceType: "", nodeCount: "" } : {}) });
      if (checked.error) return { error: checked.error };
      const stack = stackFor(spec, checked.values, spec.id === "eks" ? await legacyFor() : undefined);
      // A stack that is running is not read (its run holds it; a second RUN
      // is refused as busy anyway).
      if (jobs.get(stack)?.running) return { stack, values: {}, outputs: {}, busy: true };
      const directory = join(cwd, spec.dir);
      const config = await capture(run, directory, childEnvFor(env), ["config", "--json", "--stack", stack]);
      if (config.error) return { stack, values: {}, outputs: {}, missing: /no stack named|not found|does not exist/i.test(config.error) };
      return { stack, values: configValues(spec, config.text), outputs: await stackOutputs(run, directory, childEnvFor(env), stack) };
    },
    async facts(module, values = {}) {
      const spec = UPGRADES.find((item) => item.id === module);
      if (!spec) return { error: "no such upgrade" };
      const checked = checkParams(spec, values);
      const legacy = spec.id === "eks" ? await this.legacyCluster() : undefined;
      const stack = stackFor(spec, checked.values || {}, legacy);
      const directory = join(cwd, spec.dir);
      const childEnv = {
        ...env,
        AWS_PROFILE: env.AWS_PROFILE || "default",
        AWS_REGION: "eu-north-1",
        PULUMI_CONFIG_PASSPHRASE: env.PULUMI_CONFIG_PASSPHRASE || "",
      };
      return readFacts(run, directory, spec, childEnv, stack, checked.values || {});
    },
    async campShelf() {
      const now = clock();
      if (campCache && now - campCache.at < CAMP_MS) return campCache.value;
      const spec = UPGRADES.find((item) => item.id === "camp");
      const directory = join(cwd, spec.dir);
      const childEnv = {
        ...env,
        AWS_PROFILE: env.AWS_PROFILE || "default",
        AWS_REGION: "eu-north-1",
        PULUMI_CONFIG_PASSPHRASE: env.PULUMI_CONFIG_PASSPHRASE || "",
      };
      const exported = await capture(run, directory, childEnv, ["stack", "export", "--stack", spec.stack]);
      let value;
      if (exported.error) {
        value = /no stack named|stack .+ not found|does not exist/i.test(exported.error)
          ? { resources: [] }
          : { resources: [], error: "the camp shelf did not load" };
      } else {
        try {
          const parsed = JSON.parse(exported.text);
          value = { resources: parsed?.deployment?.resources || [] };
        } catch {
          value = { resources: [], error: "the camp shelf did not load" };
        }
      }
      campCache = { at: now, value };
      return value;
    },
    // notes: [{ text, lines }] shown first in the run log (a preflight's
    // findings), as in-process steps that change nothing.
    run({ module, params, action, clusters, legacyName, onDone, notes = [], maxClusters = Number(env.CLOUDSPIDER_MAX_CLUSTERS) || 2 }) {
      const spec = UPGRADES.find((item) => item.id === module);
      if (!spec) return refuse({ module, action, error: "no such upgrade" });
      const verb = ["destroy", "up", "preview"].includes(action) ? action : "";
      if (!verb) return refuse({ module, action, error: "action must be preview, up or destroy" });
      const checked = checkParams(spec, params);
      if (checked.error) return refuse({ module, action: verb, error: checked.error });
      if (spec.id === "observe" && verb !== "destroy") {
        if (!checked.values.context) return refuse({ module, action: verb, error: "context is required: the kube context of the cluster to install into (a write context; the current context is never used by default)" });
        if (!/^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/.test(checked.values.nodeCidr || "")) return refuse({ module, action: verb, error: "nodeCidr is required: the nodes' address range, e.g. 192.168.126.0/24 on CRC (kubectl get nodes -o wide)" });
      }
      // A local file backend must exist before Pulumi can open it.
      if (spec.localState) mkdirSync(join(env.HOME || homedir(), ".cloudspider", `pulumi-${spec.id}`), { recursive: true });
      const stack = stackFor(spec, checked.values, legacyName);
      const directory = join(cwd, spec.dir);
      const steps = upgradeSteps(spec, stack, verb, checked.values, { policyPack: pack });
      const packNote = verb === "preview" && !pack ? noteSteps([{ text: "policy pack not loaded: run npm ci in upgrades/policy-pack to check this preview against it" }]) : [];
      const command = rerunCommand(directory, steps);
      const no = (error) => refuse({ module: spec.id, action: verb, stack, error, command });
      if (verb === "destroy" && !confirmMatches(confirmNames(spec, checked.values, legacyName), params?.confirmName)) {
        return no(confirmMismatch(spec, checked.values, legacyName));
      }
      if (verb === "up" && tooManyClusters(clusters, cardName(spec, checked.values), maxClusters)) {
        return no(`${clusters.length} clusters are already up (${clusters.join(", ")}); the limit is ${maxClusters}. Take one down or set CLOUDSPIDER_MAX_CLUSTERS.`);
      }
      const cluster = clusterOf(spec, checked.values);
      const conflict = conflictFor({ locks: [stack], cluster, isCluster: spec.id === "eks" });
      if (conflict) return no(conflict);
      return startJob({
        locks: [stack],
        cluster,
        isCluster: spec.id === "eks",
        module: spec.id,
        action: verb,
        stack,
        directory,
        where: spec.dir,
        command,
        onDone,
        steps: [...noteSteps(notes), ...packNote, ...preflightSteps(spec, verb, checked.values), ...steps.map((args) => ({ args, text: `pulumi ${args.join(" ")}` })), ...afterSteps(spec, verb, checked.values)],
      });
    },
    // Any list of steps as one run in a card's pane (CONNECT, an add-on
    // batch): { cmd, args } spawned like pulumi, or { fn } done in-process.
    // locks: the stacks it runs (default: its own); cluster: the cluster it
    // works on. CONNECT, USE IT and DISCONNECT edit the kubeconfig, so they
    // also take the kubeconfig lock (one at a time, whatever the cluster).
    runSteps({ module, action, stack, steps, command = "", directory = cwd, where = "", onDone, locks = null, cluster = "" }) {
      const held = [...new Set([...(locks || [stack]), ...(["connect", "disconnect", "use it"].includes(action) ? [KUBECONFIG_LOCK] : [])])].filter(Boolean);
      const conflict = conflictFor({ locks: held, cluster, isCluster: false });
      if (conflict) return refuse({ module, action, stack, error: conflict, command });
      return startJob({ module, action, stack, directory, where, command, onDone, steps, locks: held, cluster, isCluster: false });
    },
    // INSTALL SELECTED: the add-ons in `ids` (already in order) on one
    // cluster, each preview then up, as one run in the cluster's EKS pane.
    // A step that fails stops the rest.
    // params: { <id>: { name: value } } on top of the defaults; notes:
    // { <id>: [{ text, lines }] } shown before that add-on's steps.
    addonBatch({ cluster, ids, onDone, legacyName, params = {}, notes = {} }) {
      const eksSpec = UPGRADES.find((item) => item.id === "eks");
      const eksChecked = checkParams(eksSpec, { clusterName: cluster });
      if (eksChecked.error) return refuse({ module: "eks", action: "add-ons", error: eksChecked.error });
      const stack = stackFor(eksSpec, eksChecked.values, legacyName);
      const steps = [];
      const byHand = [];
      let installed = false;
      for (const id of ids) {
        const spec = UPGRADES.find((item) => item.id === id && item.addon);
        if (!spec) return refuse({ module: "eks", action: "add-ons", stack, error: `no add-on ${id}` });
        const checked = checkParams(spec, { ...(params[id] || {}), clusterName: cluster });
        if (checked.error) return refuse({ module: "eks", action: "add-ons", stack, error: checked.error });
        const addonStack = stackFor(spec, checked.values);
        steps.push(...noteSteps(notes[id] || [], `${id} · `));
        const dir = join(cwd, spec.dir);
        const preview = upgradeSteps(spec, addonStack, "preview", checked.values).filter((args) => !(args[0] === "install" && installed));
        if (preview.some((args) => args[0] === "install")) installed = true;
        const up = ["up", "--yes", "--non-interactive", "--stack", addonStack];
        for (const args of [...preview, up]) {
          steps.push({ args, cwd: dir, text: `${id} · pulumi ${args.join(" ")}` });
        }
        byHand.push(...preview, up);
      }
      const where = UPGRADES.find((item) => item.id === ids[0])?.dir || "";
      // The batch holds every add-on stack it runs; the cluster's own stack
      // is not held, but the cluster rule keeps an EKS run out meanwhile.
      const locks = ids.map((id) => stackFor(UPGRADES.find((item) => item.id === id), { clusterName: cluster }));
      return this.runSteps({ module: "eks", action: "add-ons", stack, steps, command: rerunCommand(join(cwd, where), byHand), directory: join(cwd, where), where, onDone, locks, cluster });
    },
    // A stack bundle (src/stack-bundles.js) as one run: for each step,
    // preview then up, in order, stopping at the first failure. Shown on the
    // last step's card; holds every stack it runs.
    stackBatch({ cluster, steps: items, onDone, notes = {}, title = "bundle" }) {
      const steps = [];
      const byHand = [];
      const locks = [];
      let last = null;
      for (const item of items) {
        const spec = UPGRADES.find((entry) => entry.id === item.module);
        if (!spec || spec.id === "eks") return refuse({ module: item.module, action: "bundle", error: `no stack ${item.module} for a bundle` });
        const checked = checkParams(spec, { ...(item.params || {}), clusterName: cluster });
        if (checked.error) return refuse({ module: spec.id, action: "bundle", error: checked.error });
        const stack = stackFor(spec, checked.values);
        const dir = join(cwd, spec.dir);
        steps.push(...noteSteps(notes[spec.id] || [], `${spec.id} · `));
        const preview = upgradeSteps(spec, stack, "preview", checked.values);
        const up = ["up", "--yes", "--non-interactive", "--stack", stack];
        for (const args of [...preview, up]) steps.push({ args, cwd: dir, text: `${spec.id} · pulumi ${args.join(" ")}` });
        byHand.push(`cd ${spec.dir}`, ...[...preview, up].map((args) => `pulumi ${args.join(" ")}`));
        locks.push(stack);
        last = { spec, stack };
      }
      if (!last) return refuse({ module: "", action: "bundle", error: "nothing to run" });
      return this.runSteps({ module: last.spec.id, action: title, stack: last.stack, steps, command: byHand.join(" && "), directory: join(cwd, last.spec.dir), where: last.spec.dir, onDone, locks, cluster });
    },
    busy() {
      const first = runningJobs()[0];
      return first ? { stack: first.stack, action: first.action, module: first.module } : null;
    },
    // Every run going now (the Stacks panel can run several at once).
    running() {
      return runningJobs().map((item) => ({ stack: item.stack, action: item.action, module: item.module, cluster: item.cluster || "", locks: [...item.locks] }));
    },
    // What still runs on a cluster: pgcluster, shopapi and demo stacks that
    // are up (they have outputs) with clusterName = cluster. Read-only
    // (pulumi stack output / config get). The add-on stacks come from the
    // add-on tree (app.js).
    async dependentsOf(cluster) {
      const found = [];
      for (const spec of UPGRADES.filter((item) => !item.addon && item.id !== "eks" && item.needs?.includes("eks"))) {
        const out = await this.outputs(spec.id, { clusterName: cluster }, { fresh: true });
        if (out?.error || !Object.keys(out?.outputs || {}).length) continue;
        const got = await capture(run, join(cwd, spec.dir), childEnvFor(env), ["config", "get", `${spec.project}:clusterName`, "--stack", spec.stack]);
        const on = got.error ? LEGACY_CLUSTER : got.text.trim() || LEGACY_CLUSTER;
        if (on === cluster) found.push(spec.stack);
      }
      return found;
    },
    // A stack's outputs (pulumi stack output --json), cached a minute.
    async outputs(module, values = {}, { fresh = false } = {}) {
      const spec = UPGRADES.find((item) => item.id === module);
      if (!spec) return { error: "no such upgrade" };
      const checked = checkParams(spec, values);
      if (checked.error) return { error: checked.error };
      const stack = stackFor(spec, checked.values, spec.id === "eks" ? await legacyFor() : undefined);
      const hit = outputsCache.get(stack);
      if (!fresh && hit && clock() - hit.at < 60_000) return hit.value;
      const out = await capture(run, join(cwd, spec.dir), childEnvFor(env), ["stack", "output", "--json", "--stack", stack]);
      let value;
      if (out.error) value = { stack, error: out.error, missing: /no stack named|not found|does not exist/i.test(out.error) };
      else {
        try {
          value = { stack, outputs: JSON.parse(out.text || "{}") || {} };
        } catch {
          value = { stack, error: "pulumi stack output was not JSON" };
        }
      }
      outputsCache.set(stack, { at: clock(), value });
      return value;
    },
    forgetOutputs(stack) {
      if (stack) outputsCache.delete(stack);
      else outputsCache.clear();
    },
  };

  // In-process steps after a stack's own: pgcluster's take it down waits
  // until its EBS volumes are gone (volume-sweep.js).
  // Read-only account checks before the stack is even selected or created
  // (upgrades/schema/preflight.js): EKS PREVIEW and RUN.
  function preflightSteps(spec, verb, values) {
    if (!preflight || spec.id !== "eks" || verb === "destroy") return [];
    return [{ text: "preflight (read-only): zones, node types offered, VPC count", fn: () => preflight(spec, values) }];
  }

  function afterSteps(spec, verb, values) {
    if (verb !== "destroy" || !volumes || spec.id !== "pgcluster") return [];
    return [volumeSweepStep({ volumes, project: "pgcluster", clusterName: values.clusterName || "cloudspider-up", clock, sleep, limits: sweepLimits })];
  }

  function runningJobs() {
    return [...new Set(jobs.values())].filter((item) => item.running).sort((a, b) => a.startedAt - b.startedAt);
  }

  // Another run going while this stack's card is shown.
  function busyFor(stack) {
    const other = runningJobs().find((item) => item.stack !== stack && !item.locks.includes(stack));
    return other ? { busy: { stack: other.stack, action: other.action } } : {};
  }

  // Why a run cannot start now, or "". Same stack: one at a time. A cluster
  // (its EKS stack) and the stacks on it (add-ons, pgcluster, shopapi,
  // demo): never at the same time, so nothing is raised on a cluster that is
  // being taken down, and a cluster is not taken down under a running up.
  function conflictFor({ locks, cluster, isCluster }) {
    for (const other of runningJobs()) {
      const shared = locks.find((item) => other.locks.includes(item));
      if (shared === KUBECONFIG_LOCK) return `an upgrade is already running on the kubeconfig (${other.action} on stack ${other.stack}); CONNECT and DISCONNECT go one at a time`;
      if (shared) return `an upgrade is already running on stack ${shared} (${other.action}${other.stack === shared ? "" : ` in ${other.stack}`}); one run per stack at a time`;
      if (cluster && other.cluster === cluster && (isCluster || other.isCluster)) {
        return `an upgrade is already running on cluster ${cluster} (${other.action} on stack ${other.stack}); a cluster and the stacks on it run one at a time`;
      }
    }
    return "";
  }

  // pulumi install in one project folder at a time (the add-ons share one).
  function gateDir(dir) {
    const before = dirGates.get(dir) || Promise.resolve();
    let release;
    const mine = new Promise((resolve) => {
      release = resolve;
    });
    const chain = before.then(() => mine);
    dirGates.set(dir, chain);
    return before.then(() => () => {
      release();
      if (dirGates.get(dir) === chain) dirGates.delete(dir);
    });
  }

  function startJob({ module, action, stack, directory, where, command, steps, onDone, locks = [stack], cluster = "", isCluster = false }) {
    if (stopping) return refuse({ module, action, stack, error: "the server is shutting down (Ctrl-C); start Cloud Spider again to run this", command });
    runs += 1;
    const startedAt = clock();
    // The newest event is this run; a refusal on another card stays on that
    // card (notices).
    notice = null;
    notices.delete(stack);
    job = {
      id: `u${runs}`,
      running: true,
      module,
      action,
      stack,
      locks: [...new Set([stack, ...locks])].filter(Boolean),
      cluster,
      isCluster,
      lines: [],
      errLines: [],
      error: "",
      hint: "",
      command,
      startedAt,
      endedAt: null,
      steps: steps.map((step) => ({ ...step, status: "waiting" })),
    };
    if (runLog) {
      job.logHandle = runLog.start(stack, { startedAt });
      job.log = job.logHandle?.rel || "";
      job.logHandle?.append(`# ${new Date(startedAt).toISOString()} ${action} ${stack}${where ? ` in ${where}` : ""}`);
      save(job);
    }
    const mine = job;
    for (const lock of mine.locks) jobs.set(lock, mine);
    record(mine, "start");
    apply(run, directory, job, childEnvFor(env), {
      clock,
      stopping: () => stopping,
      lockGuard: { ...lockGuard, locked: (lockStack, dir) => lockGuard.locked(lockStack, { dir, module, where }) },
      save,
      gate: gateDir,
      done: () => {
        record(mine, "end");
        if (mine.stack) outputsCache.delete(mine.stack);
        if (onDone) Promise.resolve().then(() => onDone(view(mine))).catch(() => {});
      },
    });
    return { ...view(mine), ...busyFor(stack) };
  }
}

// The kubeconfig is one file: CONNECT / DISCONNECT / USE IT hold this.
const KUBECONFIG_LOCK = "~kubeconfig";

// The cluster a card works on: EKS itself and every card that needs it.
function clusterOf(spec, values = {}) {
  if (spec.id !== "eks" && !spec.needs?.includes("eks")) return "";
  return values.clusterName || LEGACY_CLUSTER;
}

// One stack per thing: `stack` names the stack (and with it the state file,
// its lock and Pulumi.<stack>.yaml). Every step names it; nothing relies on
// the selected stack.
// A preflight's findings as run-log steps: "$ <text>" then its lines.
function noteSteps(notes = [], prefix = "") {
  return (notes || []).filter((note) => note?.text).map((note) => ({ text: `${prefix}${note.text}`, fn: () => ({ lines: note.lines || [] }) }));
}

// What the stack runs with now: its card parameters as Pulumi.<stack>.yaml
// says (a RUN writes them there with config set). Plain values only; a
// secret is an object and stays out. The card starts from these, so RUN
// with the defaults never quietly undoes a choice (Shop API expose=alb
// back to none would delete its ALB).
export function stackConfig(spec, cwd = root, read = (file) => readFileSync(file, "utf8")) {
  if (!spec?.dir || !spec?.stack || !spec?.project || /[*{]/.test(spec.stack)) return {};
  let doc;
  try {
    doc = parseYaml(read(join(cwd, spec.dir, `Pulumi.${spec.stack}.yaml`)));
  } catch {
    return {};
  }
  const out = {};
  for (const parameter of spec.parameters || []) {
    const value = doc?.config?.[`${spec.project}:${parameter.name}`];
    if (["string", "number", "boolean"].includes(typeof value)) out[parameter.name] = String(value);
  }
  return out;
}

// The CrossGuard pack (upgrades/policy-pack) when its deps are installed:
// PREVIEW reports its findings (mandatory ones fail the preview), RUN does not
// load it (the preview already said). "" when missing: PREVIEW says so.
export function defaultPolicyPack(base = root) {
  const dir = join(base, "upgrades", "policy-pack");
  return existsSync(join(dir, "node_modules", "@pulumi", "policy")) ? dir : "";
}

export function upgradeSteps(spec, stack, verb, values, { policyPack = "" } = {}) {
  const steps = [["stack", "select", stack, "--create", "--non-interactive"]];
  if (verb !== "destroy") {
    steps.push(["install"]);
    if (spec.id === "eks") {
      // A new cluster stack has no committed Pulumi.<stack>.yaml: pin the
      // region and the account like Pulumi.upgrade.yaml does.
      steps.push(["config", "set", "--stack", stack, "--non-interactive", "aws:region", "eu-north-1"]);
      steps.push(["config", "set", "--stack", stack, "--non-interactive", "--path", "aws:allowedAccountIds[0]", "550536272523"]);
    }
    steps.push(
      ...Object.entries(values).map(([key, value]) => [
        "config",
        "set",
        "--stack",
        stack,
        "--non-interactive",
        `${spec.project}:${key}`,
        value,
      ]),
    );
  }
  // A stack that protects its data (protectData, Terraform prevent_destroy):
  // TAKE IT DOWN is the explicit way through, so it unprotects the state
  // first (no cloud call), then destroys. A hand-run destroy stays refused.
  if (verb === "destroy" && DATA_PROJECTS.includes(spec.project)) steps.push(["state", "unprotect", "--all", "--yes", "--non-interactive", "--stack", stack]);
  // preview changes nothing: it shows what up would do.
  steps.push(verb === "preview" ? ["preview", "--non-interactive", "--diff", ...(policyPack ? ["--policy-pack", policyPack] : []), "--stack", stack] : [verb, "--yes", "--non-interactive", "--stack", stack]);
  return steps;
}

// The error lines a plate shows first; a lock refusal leads with who holds
// the lock, then pulumi's own line.
function headOf(item) {
  const head = errorHead(item.error, item.errLines || [], 4);
  return item.unlock && item.error && !head.includes(item.error) ? [item.error, ...head].slice(0, 4) : head;
}

const KEEP_LINES = 400;

function apply(run, directory, job, env, { clock = () => Date.now(), save = () => {}, done = () => {}, gate = null, stopping = () => false, lockGuard = null } = {}) {
  let index = 0;
  const log = (text) => job.logHandle?.append(text);
  const say = (text, err = false) => {
    const line = String(text).trimEnd();
    if (!line) return;
    log(err ? line.replace(/^/gm, "! ") : line);
    job.lines.push(line);
    if (err) job.errLines.push(line);
    if (job.lines.length > KEEP_LINES) job.lines.splice(0, job.lines.length - KEEP_LINES);
  };
  const finish = (error = "") => {
    for (const step of job.steps) {
      step.release?.();
      step.release = null;
    }
    job.running = false;
    job.endedAt = clock();
    if (error) {
      job.error = job.error || error;
      job.hint = job.hint || runHint([job.error, ...job.errLines.slice(-20)].join("\n")).hint;
      log(`# failed after ${Math.round((job.endedAt - job.startedAt) / 1000)} s\n${job.error}${job.hint ? `\nhint: ${job.hint}` : ""}`);
    } else {
      log(`# done in ${Math.round((job.endedAt - job.startedAt) / 1000)} s`);
    }
    save(job);
    done();
  };
  const releaseAll = () => {
    for (const step of job.steps) {
      step.release?.();
      step.release = null;
    }
  };
  // A note on the run pane (and the page's radio): { status, text, command? }.
  const note = (status, text, command = "") => {
    job.notes = [...(job.notes || []), { status, text, ...(command ? { command } : {}) }];
    say(`note: ${text}`);
  };
  const STOPPED = "the server was stopped (Ctrl-C) while this ran: pulumi was asked to cancel and release the stack lock; the steps after this one did not run";
  const next = () => {
    releaseAll();
    if (stopping() && index < job.steps.length) {
      for (const step of job.steps.slice(index)) step.status = "skipped";
      say(STOPPED, true);
      finish(STOPPED);
      return;
    }
    if (index >= job.steps.length) {
      finish();
      return;
    }
    const step = job.steps[index];
    // pulumi install (npm) waits for another install in the same folder.
    if (gate && !step.fn && (step.cmd || "pulumi") === "pulumi" && step.args?.[0] === "install" && !step.gated) {
      step.gated = true;
      gate(step.cwd || directory).then((release) => {
        step.release = release;
        go();
      });
      return;
    }
    go();
  };
  const go = () => {
    const step = job.steps[index];
    index += 1;
    step.status = "running";
    log(`$ ${step.text}`);
    job.lines.push(`$ ${step.text}`);
    save(job);
    // An in-process step (back up a file, edit YAML, reload, probe).
    if (step.fn) {
      Promise.resolve()
        .then(() => step.fn({ say, job }))
        .then((result = {}) => {
          for (const line of result.lines || []) say(line);
          if (result.error) {
            step.status = "failed";
            if (result.hint) job.hint = result.hint;
            say(result.error, true);
            finish(result.error);
            return;
          }
          step.status = result.skipped ? "skipped" : "done";
          next();
        })
        .catch((failure) => {
          step.status = "failed";
          const text = failure?.message || "the step failed";
          say(text, true);
          finish(text);
        });
      return;
    }
    const cmd = step.cmd || "pulumi";
    const args = step.args;
    let child;
    try {
      child = run(cmd, args, {
        cwd: step.cwd || directory,
        env: step.env ? { ...env, ...step.env } : env,
        shell: false,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      step.status = "failed";
      const text = error?.message || `${cmd} did not start`;
      job.lines.push(text);
      job.errLines.push(text);
      finish(text);
      return;
    }
    job.childPid = child?.pid;
    if (!child?.stdout || !child?.stderr || typeof child.on !== "function") {
      step.status = "failed";
      job.lines.push(`${cmd} did not start`);
      finish(`${cmd} did not start`);
      return;
    }
    // Keep the newest lines in memory; all of them go to the log file.
    const take = (into, stream) => (chunk) => {
      const text = maskKubeconfig(String(chunk).trimEnd());
      if (!text) return;
      log(stream === "err" ? text.replace(/^/gm, "! ") : text);
      for (const list of into) {
        list.push(text);
        if (list.length > KEEP_LINES) list.splice(0, list.length - KEEP_LINES);
      }
    };
    const errLines = [];
    let stepText = "";
    const keep = (chunk) => {
      if (stepText.length < 400_000) stepText += String(chunk);
    };
    child.stdout.on("data", (chunk) => {
      keep(chunk);
      take([job.lines], "out")(chunk);
    });
    child.stderr.on("data", (chunk) => {
      keep(chunk);
      take([job.lines, errLines, job.errLines], "err")(chunk);
    });
    let over = false;
    child.on("error", (error) => {
      if (over) return;
      over = true;
      step.status = "failed";
      const text = error?.code === "ENOENT" ? `${cmd} is not on PATH (spawn ${cmd} ENOENT)` : error?.message || `${cmd} did not start`;
      job.lines.push(text);
      job.errLines.push(text);
      finish(text);
    });
    child.on("close", (code) => {
      if (over) return;
      over = true;
      job.childPid = null;
      if (code !== 0 && stopping()) {
        step.status = "failed";
        for (const later of job.steps.slice(index)) later.status = "skipped";
        say(STOPPED, true);
        finish(STOPPED);
        return;
      }
      const own = args.indexOf("--stack");
      const stepStack = own >= 0 ? args[own + 1] : job.stack;
      // Half-done operations from a run that died: pulumi carries on, so say
      // what they were and the refresh that settles them.
      const pending = cmd === "pulumi" && !job.pendingNoted ? pendingOps(stepText) : [];
      if (pending.length) {
        job.pendingNoted = true;
        const dir = step.cwd || directory;
        note("warn", `${pending.length} resource operation(s) were left pending by a run that died: ${pending.slice(0, 6).map((p) => `${p.name} (${p.op})`).join(", ")}${pending.length > 6 ? ", ..." : ""}. Pulumi carried on, but a pending create may exist in AWS without being in the state. Check them, then run the refresh below in a terminal: it asks, for each, to import or drop it (--clear-pending-creates drops them all; delete what exists by hand then).`, `cd ${dir} && pulumi refresh --stack ${stepStack}`);
      }
      const locks = code !== 0 && cmd === "pulumi" && lockGuard ? parseLocks(errLines.join("\n")) : [];
      if (locks.length) {
        const judged = locks.map((lock) => ({ ...lock, ...lockGuard.judge(lock) }));
        if (!step.lockTried && judged.every((lock) => lock.stale)) {
          step.status = "skipped";
          for (const lock of judged) note("warn", staleNote(lock, lock.why));
          const cancel = ["cancel", "--yes", "--non-interactive", "--stack", stepStack];
          job.steps.splice(index, 0, { args: cancel, cwd: step.cwd, text: `pulumi ${cancel.join(" ")}`, status: "waiting", lockTried: true }, { ...step, status: "waiting", lockTried: true });
          save(job);
          next();
          return;
        }
        step.status = "failed";
        job.unlock = { stack: stepStack };
        lockGuard.locked(stepStack, step.cwd || directory);
        if (!step.lockTried) job.error = lockRefusal(stepStack, judged, clock());
        finish(failureText(args, code, job.lines, errLines, stepStack, cmd));
        return;
      }
      if (code !== 0) {
        step.status = "failed";
        // A batch step names its own stack (an add-on in the EKS pane).
        finish(failureText(args, code, job.lines, errLines, stepStack, cmd));
        return;
      }
      step.status = "done";
      next();
    });
  };
  next();
}

export function capture(run, directory, env, args) {
  return new Promise((resolve) => {
    let text = "";
    let errText = "";
    let child;
    try {
      child = run("pulumi", args, {
        cwd: directory,
        env,
        shell: false,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve({ error: error?.message || "pulumi did not start" });
      return;
    }
    if (!child?.stdout || typeof child.on !== "function") {
      resolve({ error: "pulumi did not start" });
      return;
    }
    child.stdout.on("data", (chunk) => {
      text += String(chunk);
    });
    child.stderr?.on("data", (chunk) => {
      errText += String(chunk);
    });
    child.on("error", (error) => resolve({ error: error?.message || "pulumi did not start" }));
    child.on("close", (code) => {
      if (code !== 0) resolve({ error: [`pulumi ${args[0]} exited ${code}`, errText.trim()].filter(Boolean).join("\n") });
      else resolve({ text });
    });
  });
}

// `pulumi config --json` → the card's own parameters (secrets are never
// read: without --show-secrets they come back without a value).
export function configValues(spec, text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return {};
  }
  const out = {};
  for (const parameter of spec.parameters) {
    const entry = data?.[`${spec.project}:${parameter.name}`];
    if (!entry || entry.secret || entry.value == null) continue;
    out[parameter.name] = String(entry.value);
  }
  return out;
}

async function stackOutputs(run, directory, env, stack) {
  const out = await capture(run, directory, env, ["stack", "output", "--json", "--stack", stack]);
  if (out.error) return {};
  try {
    const data = JSON.parse(out.text);
    return { name: typeof data.name === "string" ? data.name : "", nodeGroup: typeof data.nodeGroup === "string" ? data.nodeGroup : "" };
  } catch {
    return {};
  }
}

async function readFacts(run, directory, spec, env, stack = spec.stack, values = {}) {
  const history = await capture(run, directory, env, ["stack", "history", "--json", "--stack", stack]);
  const nameKey = spec.id === "eks" || spec.addon ? "clusterName" : "name";
  if (history.error) {
    if (/no stack named|not found|does not exist/i.test(history.error)) {
      return { kind: "", resources: 0, missing: true, stack, name: "" };
    }
    return { kind: "", resources: 0, error: history.error, stack };
  }
  const listed = await capture(run, directory, env, ["stack", "ls", "--json"]);
  const fact = historyFact(history.text);
  fact.stack = stack;
  fact.resources = listed.error ? 0 : resourceFact(listed.text, stack);
  const config = await capture(run, directory, env, [
    "config",
    "get",
    `${spec.project}:${nameKey}`,
    "--stack",
    stack,
  ]);
  // No config yet: the name typed in the card, not the default cluster's.
  fact.name = config.error ? values[nameKey] || spec.parameters.find((item) => item.name === nameKey)?.default || "" : config.text.trim();
  return fact;
}
