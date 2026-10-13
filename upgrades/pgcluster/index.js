import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import { eksProvider } from "../eks-kube.js";
import { inheritTags, stackTags } from "../tags.js";
import { readAddon, usesEksAddon } from "../eks-addons.js";
import { ship } from "../netpol.js";
import { assertStackConfig } from "../schema/stacks.js";

// Every config key typed and checked first, before any resource (the STACKS
// card runs the same schema): upgrades/schema/stacks.js.
assertStackConfig(pulumi, "cloudspider-pgcluster");

// PostgreSQL on the EKS cluster from upgrades/eks, run by CloudNativePG.
// Stack: pgcluster. Needs the cluster up first, with its EKS add-ons: the
// Pod Identity agent and the EBS CSI driver come with the EKS stack
// (docs/design/stack-dependencies.md); this stack never creates them and
// stops without them (podIdentityAgent=install made the 409 of 2026-10-11;
// the key is ignored now). Ones it made before that rule it keeps
// (retainOnDelete) until scripts/migrate-eks-addons.mjs hands them over.
//   - a gp3 StorageClass (encrypted, deleted with the claim) whose volumes
//     are tagged project=pgcluster, so the vault claims them on the map
//   - the CloudNativePG operator (Helm chart 0.29.1, operator 1.30.1)
//   - namespace shop with one Cluster, shopdb: 2 instances (instances=1-5)
//     in different zones (required pod anti-affinity on
//     topology.kubernetes.io/zone), 5 Gi each, database app owned by app.
//     CNPG writes the app credentials to the Secret shopdb-app (keys
//     username, password, uri), which upgrades/shopapi reads. CNPG makes the
//     PDBs: the primary's (minAvailable 1; a drain of its node switches over
//     first) and the replicas' (one replica may go at a time).
//   - backups=on (default): continuous backup with the Barman Cloud plugin
//     (CNPG-I, the recommended way since CNPG 1.26; the in-tree
//     barmanObjectStore goes in 1.31): the plugin (Helm chart
//     plugin-barman-cloud, needs cert-manager), an ObjectStore on an S3
//     bucket (SSE-S3, public access blocked, TLS only, lifecycle as a
//     safety net behind barman's retention), WAL archiving from the plugin
//     sidecar, a daily ScheduledBackup (03:00 UTC, one at once on create),
//     AWS credentials through EKS Pod Identity (role for shop/shopdb, the
//     Cluster's service account): no keys anywhere.
//   - monitoring: the instances' metrics port 9187 is open to pods labelled
//     cloudspider.io/scrape=true; podMonitor=on adds a PodMonitor (needs the
//     Prometheus Operator's CRDs).
// Pods: the operator, the CSI controller (2) and node pods, and the database
// pod. A t4g.small node holds 11 pods; with the demo stack too it runs out,
// so pick t4g.medium (17 pods) on the EKS card before raising this.
// Cost on top of EKS: 5 GB gp3 per instance, about $0.42/month each
// (docs/plan-expansion.md); the backup bucket holds a few hundred MB at 7 d
// retention (cents a month). No new node: an instance requests 50m CPU.
// Vault: vaults/templates/pgcluster.yaml selects project=pgcluster.
// Take it down: the database's claims go with its Cluster (the CSI driver
// stays, it is the EKS stack's); Cloud Spider's run then waits for (and if
// needed deletes) the volumes tagged
// project=pgcluster, cluster=<cluster> (src/volume-sweep.js).
const config = new pulumi.Config();
const clusterName = config.get("clusterName") || "cloudspider-up";
const size = config.get("storage") || "5Gi";
if (!/^[1-9][0-9]?Gi$/.test(size)) throw new Error("storage must be like 5Gi (1-99)");
export const instances = Number(config.get("instances") || 2);
if (!Number.isInteger(instances) || instances < 1 || instances > 5) throw new Error("instances must be 1-5 (2 or more for a standby in another zone)");
const backups = (config.get("backups") || "on") === "on";
const retention = config.get("backupRetention") || "7d";
if (!/^[1-9][0-9]?[dw]$/.test(retention)) throw new Error("backupRetention must be like 7d or 2w");
const schedule = config.get("backupSchedule") || "0 0 3 * * *";
if (schedule.trim().split(/\s+/).length !== 6) throw new Error("backupSchedule has six fields (seconds first), like 0 0 3 * * *");
const podMonitor = config.get("podMonitor") === "on";
const cpu = config.get("cpu") || "50m";
if (!/^[1-9][0-9]{0,3}m$/.test(cpu)) throw new Error("cpu must be like 50m");

inheritTags(pulumi, stackTags("pgcluster", { cluster: clusterName }));
const tags = { cloudspider: "expendable" };

const CHART_VERSION = "0.29.1";
// Barman Cloud plugin 0.15.1 (chart 0.8.1, 2026-09-30), for CNPG 1.30.
const PLUGIN_CHART_VERSION = "0.8.1";
export const PLUGIN = "barman-cloud.cloudnative-pg.io";
const OBJECT_STORE = "shopdb-s3";
const NAMESPACE = "shop";
const CLUSTER = "shopdb";

const provider = eksProvider({ pulumi, aws, k8s, clusterName });
const k = { provider };

await usesEksAddon({ pulumi, aws, clusterName, addonName: "eks-pod-identity-agent", self: "pgcluster", name: "pod-identity", tags });
// The EBS CSI driver this stack made before the rule keeps its role.
const oldCsi = (await readAddon(aws.eks.getAddon, clusterName, "aws-ebs-csi-driver")).project === "pgcluster";
let csiExtra = {};
if (oldCsi) {
  const csiRole = new aws.iam.Role("ebs-csi", {
    name: `${clusterName}-ebs-csi`,
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Principal: { Service: "pods.eks.amazonaws.com" }, Action: ["sts:AssumeRole", "sts:TagSession"] }],
    }),
    tags,
  });
  new aws.iam.RolePolicyAttachment("ebs-csi", {
    role: csiRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AmazonEBSCSIDriverPolicy",
  });
  csiExtra = { podIdentityAssociations: [{ roleArn: csiRole.arn, serviceAccount: "ebs-csi-controller-sa" }] };
}
await usesEksAddon({ pulumi, aws, clusterName, addonName: "aws-ebs-csi-driver", self: "pgcluster", name: "ebs-csi", tags, extra: csiExtra });

const storageClass = new k8s.storage.v1.StorageClass(
  "gp3",
  {
    metadata: { name: "cloudspider-gp3" },
    provisioner: "ebs.csi.aws.com",
    volumeBindingMode: "WaitForFirstConsumer",
    reclaimPolicy: "Delete",
    allowVolumeExpansion: true,
    parameters: {
      type: "gp3",
      encrypted: "true",
      // EBS CSI tags every volume it makes: the vault and the map find them.
      tagSpecification_1: "project=pgcluster",
      tagSpecification_2: "managed-by=pulumi",
      tagSpecification_3: "cloudspider=expendable",
      tagSpecification_4: `cluster=${clusterName}`,
    },
  },
  k,
);

const operatorNs = new k8s.core.v1.Namespace("cnpg-system", { metadata: { name: "cnpg-system" } }, k);
const operator = new k8s.helm.v3.Release(
  "cnpg",
  {
    name: "cnpg",
    namespace: operatorNs.metadata.name,
    chart: "cloudnative-pg",
    version: CHART_VERSION,
    repositoryOpts: { repo: "https://cloudnative-pg.github.io/charts" },
    values: {
      resources: { requests: { cpu: "50m", memory: "128Mi" }, limits: { memory: "256Mi" } },
      monitoring: { podMonitorEnabled: false },
    },
    atomic: true,
    timeout: 600,
  },
  k,
);

const ns = new k8s.core.v1.Namespace("shop", { metadata: { name: NAMESPACE, labels: { "app.kubernetes.io/part-of": "cloudspider-shop" } } }, k);

// Backups: bucket, role, plugin, object store (backups=on).
let objectStore = null;
let plugin = null;
let bucket = null;
let association = null;
if (backups) {
  const identity = await aws.getCallerIdentity();
  const region = (await aws.getRegion()).name;
  bucket = new aws.s3.BucketV2("backups", { bucket: `${clusterName}-shopdb-backups-${identity.accountId}`, forceDestroy: true, tags });
  new aws.s3.BucketPublicAccessBlock("backups", { bucket: bucket.id, blockPublicAcls: true, blockPublicPolicy: true, ignorePublicAcls: true, restrictPublicBuckets: true });
  new aws.s3.BucketOwnershipControls("backups", { bucket: bucket.id, rule: { objectOwnership: "BucketOwnerEnforced" } });
  new aws.s3.BucketServerSideEncryptionConfigurationV2("backups", { bucket: bucket.id, rules: [{ applyServerSideEncryptionByDefault: { sseAlgorithm: "AES256" }, bucketKeyEnabled: true }] });
  new aws.s3.BucketVersioningV2("backups", { bucket: bucket.id, versioningConfiguration: { status: "Enabled" } });
  // Barman's retention deletes old backups and WAL; the lifecycle is the net
  // under it: deleted versions go after 7 days, anything after 35, and
  // unfinished uploads after a day.
  new aws.s3.BucketLifecycleConfigurationV2("backups", {
    bucket: bucket.id,
    rules: [
      { id: "net-under-barman-retention", status: "Enabled", filter: {}, expiration: { days: 35 }, noncurrentVersionExpiration: { noncurrentDays: 7 }, abortIncompleteMultipartUpload: { daysAfterInitiation: 1 } },
    ],
  });
  new aws.s3.BucketPolicy("backups", {
    bucket: bucket.id,
    policy: bucket.arn.apply((arn) => JSON.stringify({ Version: "2012-10-17", Statement: [{ Sid: "TlsOnly", Effect: "Deny", Principal: "*", Action: "s3:*", Resource: [arn, `${arn}/*`], Condition: { Bool: { "aws:SecureTransport": "false" } } }] })),
  });
  const role = new aws.iam.Role("shopdb-backup", {
    name: `${clusterName}-shopdb-backup`,
    assumeRolePolicy: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "pods.eks.amazonaws.com" }, Action: ["sts:AssumeRole", "sts:TagSession"] }] }),
    tags,
  });
  new aws.iam.RolePolicy("shopdb-backup", {
    role: role.id,
    policy: bucket.arn.apply((arn) => JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        { Effect: "Allow", Action: ["s3:ListBucket", "s3:GetBucketLocation"], Resource: arn },
        { Effect: "Allow", Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource: `${arn}/*` },
      ],
    })),
  });
  // The Cluster's pods run as service account shopdb (CNPG names it after
  // the Cluster); the association must exist before they (re)start.
  association = new aws.eks.PodIdentityAssociation("shopdb-backup", { clusterName, namespace: NAMESPACE, serviceAccount: CLUSTER, roleArn: role.arn, tags });
  plugin = new k8s.helm.v3.Release(
    "barman-cloud",
    {
      name: "barman-cloud",
      namespace: operatorNs.metadata.name,
      chart: "plugin-barman-cloud",
      version: PLUGIN_CHART_VERSION,
      repositoryOpts: { repo: "https://cloudnative-pg.github.io/charts" },
      values: { resources: { requests: { cpu: "10m", memory: "32Mi" }, limits: { memory: "128Mi" } } },
      atomic: true,
      timeout: 600,
    },
    { ...k, dependsOn: [operator] },
  );
  objectStore = new k8s.apiextensions.CustomResource(
    "shopdb-s3",
    {
      apiVersion: "barmancloud.cnpg.io/v1",
      kind: "ObjectStore",
      metadata: { name: OBJECT_STORE, namespace: NAMESPACE },
      spec: {
        retentionPolicy: retention,
        configuration: {
          destinationPath: pulumi.interpolate`s3://${bucket.bucket}/`,
          s3Credentials: { inheritFromIAMRole: true },
          wal: { compression: "gzip", maxParallel: 2 },
          data: { compression: "gzip" },
        },
        instanceSidecarConfiguration: {
          env: [{ name: "AWS_DEFAULT_REGION", value: region }, { name: "AWS_REGION", value: region }],
          resources: { requests: { cpu: "5m", memory: "32Mi" }, limits: { memory: "256Mi" } },
        },
      },
    },
    { ...k, dependsOn: [plugin, ns] },
  );
}

const db = new k8s.apiextensions.CustomResource(
  "shopdb",
  {
    apiVersion: "postgresql.cnpg.io/v1",
    kind: "Cluster",
    metadata: { name: CLUSTER, namespace: NAMESPACE, labels: { "app.kubernetes.io/part-of": "cloudspider-shop" } },
    spec: {
      instances,
      storage: { size, storageClass: "cloudspider-gp3" },
      // One instance per zone: the standby survives a zone (its EBS volume
      // is zonal, so this is decided once, at creation).
      affinity: { enablePodAntiAffinity: true, topologyKey: "topology.kubernetes.io/zone", podAntiAffinityType: "required" },
      enablePDB: true,
      ...(backups ? { plugins: [{ name: PLUGIN, isWALArchiver: true, parameters: { barmanObjectName: OBJECT_STORE } }] } : {}),
      bootstrap: {
        initdb: {
          database: "app",
          owner: "app",
          // PostgREST's anonymous role for upgrades/shopapi; the app owner
          // cannot create roles, so the superuser does it once at init.
          postInitSQL: ["create role web_anon nologin", "grant web_anon to app"],
        },
      },
      resources: { requests: { cpu, memory: "256Mi" }, limits: { memory: "512Mi" } },
      postgresql: { parameters: { shared_buffers: "64MB", max_connections: "40" } },
      enableSuperuserAccess: false,
    },
  },
  { ...k, dependsOn: [operator, ns, storageClass, ...(backups ? [objectStore, association] : [])] },
);

if (backups) {
  new k8s.apiextensions.CustomResource(
    "shopdb-daily",
    {
      apiVersion: "postgresql.cnpg.io/v1",
      kind: "ScheduledBackup",
      metadata: { name: "shopdb-daily", namespace: NAMESPACE },
      spec: { schedule, immediate: true, backupOwnerReference: "self", cluster: { name: CLUSTER }, method: "plugin", pluginConfiguration: { name: PLUGIN } },
    },
    { ...k, dependsOn: [db] },
  );
}
if (podMonitor) {
  new k8s.apiextensions.CustomResource(
    "shopdb-metrics",
    {
      apiVersion: "monitoring.coreos.com/v1",
      kind: "PodMonitor",
      metadata: { name: CLUSTER, namespace: NAMESPACE },
      spec: { selector: { matchLabels: { "cnpg.io/cluster": CLUSTER } }, podMetricsEndpoints: [{ port: "metrics" }] },
    },
    { ...k, dependsOn: [db] },
  );
}

// Ingress NetworkPolicy (K8S-SEC-005): deny by default in shop and
// cnpg-system, then one allow per flow. Egress stays open (DNS, S3, the API
// server). Enforced where the CNI enforces it (the EKS card's
// networkPolicy=on); elsewhere these are inert.
//   shop/shopdb (cnpg.io/cluster=shopdb)
//     ← shopapi, shopapi-migrate, other shopdb instances          5432
//     ← the CNPG operator (namespace cnpg-system): status + SQL   8000, 5432
//   shop/shopapi ← the ALB: upgrades/shopapi owns that allow (VPC CIDR, 3000)
//     ← scrapers (pods labelled cloudspider.io/scrape=true, any
//       namespace): the metrics port                               9187
//   cnpg-system/barman-cloud plugin ← the CNPG operator (gRPC, mTLS)  9090
//   Replication between instances is the 5432 rule above; WAL and backups go
//   out to S3 (egress, not filtered here).
//   cnpg-system/operator ← the VPC: the EKS control plane calls the
//     admission webhook on the pod IP from ENIs in the cluster subnets, so
//     the VPC CIDR is the narrowest source that works (no fixed IPs)  9443
// Kubelet probes come from the node and stay allowed.
const vpcCidr = aws.ec2.getVpcOutput({ id: aws.eks.getClusterOutput({ name: clusterName }).vpcConfig.vpcId }).cidrBlock;
const tcp = (...ports) => ports.map((port) => ({ protocol: "TCP", port }));
const nsSel = (name) => ({ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": name } } });
export const SHOP_INGRESS = [
  {
    name: "allow-shopdb",
    namespace: NAMESPACE,
    podSelector: { matchLabels: { "cnpg.io/cluster": CLUSTER } },
    ingress: [
      { from: [{ podSelector: { matchLabels: { app: "shopapi" } } }, { podSelector: { matchLabels: { app: "shopapi-migrate" } } }, { podSelector: { matchLabels: { "cnpg.io/cluster": CLUSTER } } }], ports: tcp(5432) },
      { from: [nsSel("cnpg-system")], ports: tcp(8000, 5432) },
      { from: [{ namespaceSelector: {}, podSelector: { matchLabels: { "cloudspider.io/scrape": "true" } } }], ports: tcp(9187) },
    ],
  },
  { name: "allow-barman-cloud", namespace: "cnpg-system", podSelector: { matchLabels: { "app.kubernetes.io/name": "plugin-barman-cloud" } }, ingress: [{ from: [{ podSelector: { matchLabels: { "app.kubernetes.io/name": "cloudnative-pg" } } }], ports: tcp(9090) }] },
  { name: "allow-cnpg-webhook", namespace: "cnpg-system", podSelector: { matchLabels: { "app.kubernetes.io/name": "cloudnative-pg" } }, ingress: [{ from: "vpc", ports: tcp(9443) }] },
];
const nsOf = { [NAMESPACE]: ns, "cnpg-system": operatorNs };
for (const name of [NAMESPACE, "cnpg-system"]) {
  new k8s.networking.v1.NetworkPolicy(`default-deny-ingress-${name}`, {
    metadata: { name: "default-deny-ingress", namespace: name },
    spec: { podSelector: {}, policyTypes: ["Ingress"] },
  }, { ...k, dependsOn: [nsOf[name], operator] });
}
// Egress and the rest each namespace needs (upgrades/netpol.js): DNS,
// replication, the Kubernetes API and S3, the instances from the operator.
for (const name of [NAMESPACE, "cnpg-system"]) ship({ k8s, pulumi, opts: { ...k, dependsOn: [nsOf[name]] }, namespace: name, vpcCidr });
for (const rule of SHOP_INGRESS) {
  const ingress = rule.ingress.map((item) => (item.from === "vpc" ? vpcCidr.apply((cidr) => ({ from: [{ ipBlock: { cidr } }], ports: item.ports })) : item));
  new k8s.networking.v1.NetworkPolicy(rule.name, {
    metadata: { name: rule.name, namespace: rule.namespace },
    spec: { podSelector: rule.podSelector, policyTypes: ["Ingress"], ingress },
  }, { ...k, dependsOn: [nsOf[rule.namespace]] });
}

export const namespace = NAMESPACE;
export const cluster = db.metadata.name;
export const appSecretName = `${CLUSTER}-app`;
export const service = `${CLUSTER}-rw.${NAMESPACE}.svc`;
export const backupBucket = bucket ? bucket.bucket : "";
export const backupMethod = backups ? `plugin ${PLUGIN} → ObjectStore ${OBJECT_STORE}` : "none";
