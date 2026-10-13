// Config schemas of every stack besides EKS (upgrades/schema/eks.js). The
// STACKS card (src/upgrade.js checkParams, by project) and each program
// (first statement, before any resource) run the same one. The ranges are the
// ones each program already enforced; the card may offer fewer choices.
// docs/iac-robustness-plan.md item 1.
import { validate, assertValid } from "./core.js";
import { EKS_SCHEMA } from "./eks.js";
import { cidrOk } from "./cidr-core.js";

const SHORT = /^[a-z][a-z0-9-]{1,27}$/;
const SHORT_HINT = "must be a short lowercase name (a-z, 0-9, -; 2-28 chars, starts with a letter)";
const cluster = { type: "name", pattern: SHORT, hint: SHORT_HINT, default: "cloudspider-up", doc: "the EKS cluster it runs on" };
const named = (fallback, doc) => ({ name: { type: "name", pattern: SHORT, hint: SHORT_HINT, default: fallback, doc } });
const onoff = (fallback, doc) => ({ type: "onoff", default: fallback, doc });

export const SCHEMAS = {
  "cloudspider-upgrade": EKS_SCHEMA,
  "cloudspider-signal": { project: "cloudspider-signal", keys: named("cloudspider-signal", "log group name") },
  "cloudspider-barrel": { project: "cloudspider-barrel", keys: { ...named("cloudspider-barrel", "bucket name prefix"), protectData: onoff("on", "protect the data resources (refuses destroy/replace; TAKE IT DOWN unprotects first)") } },
  "cloudspider-camp": { project: "cloudspider-camp", keys: named("cloudspider-camp", "resource name prefix") },
  "cloudspider-rds": { project: "cloudspider-rds", keys: { ...named("cloudspider-rds", "instance name"), protectData: onoff("on", "protect the data resources (refuses destroy/replace; TAKE IT DOWN unprotects first)") } },
  "cloudspider-site": { project: "cloudspider-site", keys: named("cloudspider-site", "resource name prefix") },
  "cloudspider-worker": { project: "cloudspider-worker", keys: named("cloudspider-worker", "resource name prefix") },
  "cloudspider-demo": { project: "cloudspider-demo", keys: { clusterName: cluster } },
  "cloudspider-showcase": {
    project: "cloudspider-showcase",
    keys: {
      clusterName: { ...cluster, default: "demo-prod" },
      domain: { type: "name", pattern: /^([a-z0-9-]+\.)+[a-z]{2,}$/, hint: "must be a DNS name like demo.example.com", default: "showcase.example.com", doc: "host rules on the shared ALB: kuma.<domain>, wiki.<domain>, mealie.<domain>" },
      certificateArn: { type: "name", optional: true, pattern: /^arn:aws:acm:[a-z0-9-]+:\d{12}:certificate\/[0-9a-f-]+$/, hint: "must be an ACM certificate ARN", doc: "HTTPS on both ALBs (HTTP redirects); none: HTTP only" },
      wafAclArn: { type: "name", optional: true, pattern: /^arn:aws:wafv2:[a-z0-9-]+:\d{12}:regional\/webacl\/.+$/, hint: "must be a regional WAFv2 web ACL ARN", doc: "WAF on both ALBs (about $5/month + $1/rule)" },
      storageClass: { type: "name", pattern: /^[a-z0-9-]{1,63}$/, hint: "must be a StorageClass name", default: "showcase-gp3", doc: "PVCs (Kuma, Mealie, Wiki.js DB); showcase-gp3 is made by this stack" },
    },
  },
  "cloudspider-shopapi": {
    project: "cloudspider-shopapi",
    keys: {
      clusterName: cluster,
      dbSecret: { type: "name", pattern: /^[a-z][a-z0-9-]{1,62}$/, hint: "must be a Kubernetes name", default: "shopdb-app", doc: "the CNPG app secret" },
      expose: { type: "enum", choices: ["none", "alb"], default: "none", doc: "none: ClusterIP; alb: internet-facing ALB (needs the lbc add-on)" },
      replicas: { type: "int", min: 1, max: 6, default: 2, doc: "pods, spread over zones" },
    },
  },
  "cloudspider-pgcluster": {
    project: "cloudspider-pgcluster",
    keys: {
      clusterName: cluster,
      storage: { type: "name", pattern: /^[1-9][0-9]?Gi$/, hint: "must be like 5Gi (1-99)", default: "5Gi", doc: "volume per instance" },
      instances: { type: "int", min: 1, max: 5, default: 2, doc: "2+ for a standby in another zone" },
      backups: onoff("on", "WAL + daily backup to S3"),
      backupRetention: { type: "name", pattern: /^[1-9][0-9]?[dw]$/, hint: "must be like 7d or 2w", default: "7d", doc: "backup retention" },
      backupSchedule: { type: "name", pattern: /^\S+(\s+\S+){5}$/, hint: "has six fields (seconds first), like 0 0 3 * * *", default: "0 0 3 * * *", doc: "backup cron, seconds first" },
      podMonitor: onoff("off", "a PodMonitor for Prometheus"),
      protectData: onoff("on", "protect the data resources (refuses destroy/replace; TAKE IT DOWN unprotects first)"),
      cpu: { type: "name", pattern: /^[1-9][0-9]{0,3}m$/, hint: "must be like 50m", default: "50m", doc: "CPU request per instance" },
    },
    // A standby needs a second instance; backups off with one instance is
    // allowed (the card warns) but said here too.
    rules: [],
  },
  "cloudspider-observability": {
    project: "cloudspider-observability",
    keys: {
      clusterName: cluster,
      containerInsights: onoff("off", "CloudWatch Observability add-on"),
      // The card sends on; a hand-run up without the key keeps the program's
      // old default off (changing it would add alarms to a live stack).
      alarms: { ...onoff("off", "ALB 5XX / unhealthy targets / node not ready alarms to SNS (card default on)"), cardDefault: "on" },
      alertEmail: { type: "name", optional: true, pattern: /^[^@\s]+@[^@\s]+\.[^@\s]+$/, hint: "must be an email address", doc: "SNS email subscription" },
      dashboard: onoff("on", "CloudWatch dashboard <cluster>-overview"),
      retentionDays: { type: "int", min: 1, max: 3653, default: 7, doc: "log retention" },
    },
  },
  "cloudspider-openshift": {
    project: "cloudspider-openshift",
    keys: {
      ...named("cloudspider-openshift", "instance name"),
      instanceType: { type: "enum", choices: ["m7i-flex.2xlarge", "m7i.2xlarge", "c5.metal"], default: "m7i-flex.2xlarge", doc: "OpenShift Local host" },
      maxHours: { type: "int", min: 1, max: 12, default: 4, doc: "auto-stop after this many hours" },
      nightlyStop: { type: "name", pattern: /^cron\(.+\)$/, hint: "must be an EventBridge cron(...) expression", default: "cron(0 22 * * ? *)", doc: "nightly stop schedule" },
    },
  },
  "cloudspider-observe": {
    project: "cloudspider-observe",
    keys: {
      context: { type: "name", pattern: /^[A-Za-z0-9._:/@-]{1,253}$/, hint: "must be the kubeconfig context to install into (a write context)", default: "", doc: "kubeconfig context (not cloudspider-viewer)" },
      platform: { type: "enum", choices: ["kubernetes", "openshift"], default: "kubernetes", doc: "openshift adds SCCs" },
      allowPrivileged: { type: "name", optional: true, pattern: /^(true|false|on|off)$/, hint: "must be true or false", doc: "lets Beyla run privileged" },
      profile: { type: "name", optional: true, pattern: /^(crc|standard)$/, hint: "must be crc or standard", doc: "resource profile" },
      kubeStateMetrics: { type: "name", optional: true, pattern: /^(install|skip)$/, hint: "must be install or skip", doc: "skip when the cluster has one" },
      logs: { type: "name", optional: true, pattern: /^(on|off)$/, hint: "must be on or off", doc: "Loki + log agent" },
      lokiStorage: { type: "name", optional: true, pattern: /^[1-9][0-9]?Gi$/, hint: "must be like 5Gi (1-99)", doc: "Loki volume" },
      lokiRetention: { type: "name", optional: true, pattern: /^[1-9][0-9]{0,2}h$/, hint: "must be hours, like 72h", doc: "Loki retention" },
      storageClass: { type: "name", optional: true, pattern: /^[a-z0-9]([-a-z0-9.]{0,61}[a-z0-9])?$/, hint: "is not a valid name", doc: "Loki's storage class" },
      nodeCidr: { type: "name", optional: true, pattern: /^\d{1,3}(\.\d{1,3}){3}\/\d{1,2}$/, hint: "must be a CIDR like 192.168.126.0/24", doc: "node network, for NetworkPolicies" },
      viewerUser: { type: "name", optional: true, pattern: /^[A-Za-z0-9_.:@-]{1,128}$/, hint: "is not a valid user name", doc: "user bound to the viewer role" },
    },
    rules: [
      (v) => (v.context === "cloudspider-viewer" ? "context cloudspider-viewer is read-only by design: name a write context for the install" : ""),
      (v) => (v.lokiRetention && Number(v.lokiRetention.slice(0, -1)) < 24 ? "lokiRetention must be 24h or more (Loki's compactor works in 24h index periods)" : ""),
      (v) => (v.nodeCidr && !cidrOk(v.nodeCidr, { hostBits: true }) ? `nodeCidr ${v.nodeCidr} is not a valid IPv4 CIDR (octets 0-255, prefix 0-32)` : ""),
    ],
  },
  // One project, one stack per add-on: the keys of every add-on.
  "cloudspider-addons": {
    project: "cloudspider-addons",
    keys: {
      clusterName: cluster,
      skipRoomCheck: onoff("off", "skip the free pod slot check (pod-room.js)"),
      defaultDeny: onoff("on", "kyverno: default-deny NetworkPolicy in new namespaces"),
      capacity: { type: "enum", choices: ["spot", "on-demand"], default: "spot", doc: "karpenter: node capacity" },
      maxPods: { type: "enum", choices: ["auto", "32", "58"], default: "32", doc: "karpenter: kubelet maxPods" },
      zones: { type: "name", optional: true, pattern: /^[a-z]{2}-[a-z]+-\d[a-z](,\s*[a-z]{2}-[a-z]+-\d[a-z])*$/, hint: "must be a comma list of zones like eu-north-1a,eu-north-1b", doc: "karpenter: zones (default: all the cluster's)" },
      hpa: onoff("on", "scaling-demo: HPA on demo/web, demo/api"),
      burst: onoff("off", "scaling-demo: load burst"),
      inflate: { type: "int", min: 0, max: 6, default: 0, doc: "scaling-demo: inflate pods" },
      demoApp: { type: "enum", choices: ["absent", "present"], default: "absent", doc: "scaling-demo: set by the card" },
    },
  },
};

export { cidrOk } from "./cidr-core.js";

// Stacks whose programs protect data: TAKE IT DOWN unprotects their state first.
export const DATA_PROJECTS = Object.values(SCHEMAS).filter((s) => s.keys.protectData).map((s) => s.project);

export const schemaFor = (project) => SCHEMAS[project] || null;
export const validateStack = (project, input, options) => (SCHEMAS[project] ? validate(SCHEMAS[project], input, options) : { values: {}, errors: [], warnings: [] });

// The program's first statement: every key typed and cross-checked before any
// resource; a key the schema does not know is a warning (a live stack may
// hold one set by hand), unless strict.
export function assertStackConfig(pulumi, project, { strict = false } = {}) {
  return assertValid(SCHEMAS[project], pulumi.runtime.allConfig(), { prefixed: true, unknown: strict ? "error" : "warn", warn: (w) => pulumi.log.warn(w) });
}
