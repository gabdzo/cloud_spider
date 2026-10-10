import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import { eksProvider } from "../eks-kube.js";
import { inheritTags, stackTags } from "../tags.js";

// PostgreSQL on the EKS cluster from upgrades/eks, run by CloudNativePG.
// Stack: pgcluster. Needs the cluster up first.
//   - the EBS CSI driver add-on, its role through EKS Pod Identity, and the
//     Pod Identity agent add-on (podIdentityAgent=install; set it to
//     "present" when the demo stack already installed it)
//   - a gp3 StorageClass (encrypted, deleted with the claim) whose volumes
//     are tagged project=pgcluster, so the vault claims them on the map
//   - the CloudNativePG operator (Helm chart 0.29.1, operator 1.30.1)
//   - namespace shop with one Cluster, shopdb: 1 instance, 5 Gi, database
//     app owned by app. CNPG writes the app credentials to the Secret
//     shopdb-app (keys username, password, uri), which upgrades/shopapi reads.
// Pods: the operator, the CSI controller (2) and node pods, and the database
// pod. A t4g.small node holds 11 pods; with the demo stack too it runs out,
// so pick t4g.medium (17 pods) on the EKS card before raising this.
// Cost on top of EKS: 5 GB gp3, about $0.42/month (docs/plan-expansion.md).
// Vault: vaults/templates/pgcluster.yaml selects project=pgcluster.
const config = new pulumi.Config();
const clusterName = config.get("clusterName") || "cloudspider-up";
const podIdentityAgent = config.get("podIdentityAgent") || "install";
const size = config.get("storage") || "5Gi";
if (!["install", "present"].includes(podIdentityAgent)) throw new Error("podIdentityAgent must be install or present");
if (!/^[1-9][0-9]?Gi$/.test(size)) throw new Error("storage must be like 5Gi (1-99)");

inheritTags(pulumi, stackTags("pgcluster", { cluster: clusterName }));
const tags = { cloudspider: "expendable" };

const CHART_VERSION = "0.29.1";
const NAMESPACE = "shop";
const CLUSTER = "shopdb";

const provider = eksProvider({ pulumi, aws, k8s, clusterName });
const k = { provider };

const agent = podIdentityAgent === "install"
  ? [new aws.eks.Addon("pod-identity", { clusterName, addonName: "eks-pod-identity-agent", resolveConflictsOnCreate: "OVERWRITE", tags })]
  : [];

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
const csi = new aws.eks.Addon(
  "ebs-csi",
  {
    clusterName,
    addonName: "aws-ebs-csi-driver",
    resolveConflictsOnCreate: "OVERWRITE",
    podIdentityAssociations: [{ roleArn: csiRole.arn, serviceAccount: "ebs-csi-controller-sa" }],
    tags,
  },
  { dependsOn: agent },
);

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
  { ...k, dependsOn: [csi] },
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

const db = new k8s.apiextensions.CustomResource(
  "shopdb",
  {
    apiVersion: "postgresql.cnpg.io/v1",
    kind: "Cluster",
    metadata: { name: CLUSTER, namespace: NAMESPACE, labels: { "app.kubernetes.io/part-of": "cloudspider-shop" } },
    spec: {
      instances: 1,
      storage: { size, storageClass: "cloudspider-gp3" },
      bootstrap: {
        initdb: {
          database: "app",
          owner: "app",
          // PostgREST's anonymous role for upgrades/shopapi; the app owner
          // cannot create roles, so the superuser does it once at init.
          postInitSQL: ["create role web_anon nologin", "grant web_anon to app"],
        },
      },
      resources: { requests: { cpu: "100m", memory: "256Mi" }, limits: { memory: "512Mi" } },
      postgresql: { parameters: { shared_buffers: "64MB", max_connections: "40" } },
      enableSuperuserAccess: false,
    },
  },
  { ...k, dependsOn: [operator, ns, storageClass] },
);

export const namespace = NAMESPACE;
export const cluster = db.metadata.name;
export const appSecretName = `${CLUSTER}-app`;
export const service = `${CLUSTER}-rw.${NAMESPACE}.svc`;
