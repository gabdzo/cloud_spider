// Shared pieces for the add-on programs: the cluster (by name, from config),
// the Kubernetes provider, stack tags, Helm releases, Pod Identity roles and
// the read access Cloud Spider's viewer group needs for each add-on's CRDs.
import { readFileSync } from "node:fs";
import { eksProvider } from "../eks-kube.js";
import { inheritTags, stackTags } from "../tags.js";
import { CLUSTER_NAME, stackName } from "./catalog.js";

export const REGION = "eu-north-1";
export const VIEWERS = "cloudspider-viewers";

export function policyFile(name) {
  return JSON.parse(readFileSync(new URL(`./policies/${name}`, import.meta.url), "utf8"));
}

// Fill ${ClusterName}, ${AWS::Region}… in a vendored policy document.
export function fill(doc, values) {
  return JSON.parse(JSON.stringify(doc).replace(/\$\{([^}]+)\}/g, (whole, key) => {
    if (!(key in values)) throw new Error(`no value for ${whole} in a vendored policy`);
    return values[key];
  }));
}

export function setup({ pulumi, aws, k8s, addon }) {
  const config = new pulumi.Config();
  const clusterName = config.get("clusterName") || "cloudspider-up";
  if (!CLUSTER_NAME.test(clusterName)) throw new Error("clusterName must be a short lowercase name");
  // The stack name says which cluster this is for; config must agree, so a
  // stack never quietly points at another cluster.
  const expected = stackName(addon.id, clusterName);
  if (pulumi.getStack() !== expected) throw new Error(`stack ${pulumi.getStack()} is for another cluster: this config wants ${expected}`);
  inheritTags(pulumi, stackTags(addon.id, { cluster: clusterName, cloudspider: "expendable" }));
  const provider = eksProvider({ pulumi, aws, k8s, clusterName, region: REGION });
  const cluster = aws.eks.getClusterOutput({ name: clusterName });
  return { config, clusterName, provider, k: { provider }, cluster, tags: { cloudspider: "expendable" } };
}

export function helmRelease(k8s, k, addon, values, opts = {}) {
  const oci = addon.chart.startsWith("oci://");
  return new k8s.helm.v3.Release(
    addon.id,
    {
      name: addon.id,
      namespace: addon.namespace,
      createNamespace: addon.namespace !== "kube-system",
      chart: addon.chart,
      version: addon.chartVersion,
      ...(oci ? {} : { repositoryOpts: { repo: addon.repo } }),
      values,
      atomic: true,
      cleanupOnFail: true,
      timeout: 600,
    },
    { ...k, ...opts },
  );
}

// A role that one service account assumes through EKS Pod Identity.
export function podIdentityRole({ pulumi, aws, name, clusterName, namespace, serviceAccount, managed = [], inline = null, tags }) {
  const role = new aws.iam.Role(name, {
    name: `${clusterName}-${name}`.slice(0, 64),
    assumeRolePolicy: JSON.stringify({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Principal: { Service: "pods.eks.amazonaws.com" }, Action: ["sts:AssumeRole", "sts:TagSession"] }],
    }),
    tags,
  });
  managed.forEach((arn, index) => new aws.iam.RolePolicyAttachment(`${name}-${index}`, { role: role.name, policyArn: arn }));
  if (inline) new aws.iam.RolePolicy(name, { role: role.id, policy: pulumi.output(inline).apply((doc) => JSON.stringify(doc)) });
  const association = new aws.eks.PodIdentityAssociation(name, { clusterName, namespace, serviceAccount, roleArn: role.arn, tags });
  return { role, association };
}

// Read-only access for Cloud Spider's viewer group (upgrades/eks maps the
// viewer role to it) to the CRDs this add-on brings.
export function viewerAccess(k8s, k, id, rules, opts = {}) {
  const name = `cloudspider-viewer-${id}`;
  const role = new k8s.rbac.v1.ClusterRole(`viewer-${id}`, {
    metadata: { name },
    rules: rules.map((rule) => ({ ...rule, verbs: ["get", "list", "watch"] })),
  }, { ...k, ...opts });
  new k8s.rbac.v1.ClusterRoleBinding(`viewer-${id}`, {
    metadata: { name },
    roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name },
    subjects: [{ apiGroup: "rbac.authorization.k8s.io", kind: "Group", name: VIEWERS }],
  }, { ...k, dependsOn: [role] });
  return role;
}

export const small = (cpu, memory, limit) => ({ requests: { cpu, memory }, limits: { memory: limit } });
