import { helmRelease, podIdentityRole, policyFile, setup, small } from "./common.js";

// AWS Load Balancer Controller (Helm) with the upstream IAM policy of its
// release (policies/lbc.json, vendored), through Pod Identity. It only acts
// on Ingresses and annotated LoadBalancer Services: the Service mutator
// webhook is off, so plain LoadBalancer Services keep the in-tree behaviour.
export default function lbc({ pulumi, aws, k8s, addon }) {
  const { clusterName, k, cluster, tags } = setup({ pulumi, aws, k8s, addon });
  const policy = new aws.iam.Policy("lbc", { name: `${clusterName}-aws-load-balancer-controller`, policy: JSON.stringify(policyFile("lbc.json")), tags });
  const role = podIdentityRole({ pulumi, aws, name: "lbc", clusterName, namespace: addon.namespace, serviceAccount: "aws-load-balancer-controller", managed: [policy.arn], tags });
  helmRelease(k8s, k, addon, {
    clusterName,
    region: "eu-north-1",
    vpcId: cluster.vpcConfig.vpcId,
    replicaCount: 1,
    serviceAccount: { create: true, name: "aws-load-balancer-controller" },
    resources: small("50m", "96Mi", "256Mi"),
    enableServiceMutatorWebhook: false,
    // Everything it makes carries the stack's tags, so the lbc vault sees it.
    defaultTags: { project: addon.id, cluster: clusterName, "managed-by": "aws-load-balancer-controller", cloudspider: "expendable" },
  }, { dependsOn: [role.association] });
  return { version: addon.appVersion };
}
