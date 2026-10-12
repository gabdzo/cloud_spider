import { helmRelease, setup, small, viewerAccess } from "./common.js";

// cert-manager (Helm, CRDs included) and one self-signed ClusterIssuer.
export default function certManager({ pulumi, aws, k8s, addon }) {
  const { k, netpol } = setup({ pulumi, aws, k8s, addon });
  const release = helmRelease(k8s, k, addon, {
    crds: { enabled: true, keep: false },
    replicaCount: 1,
    resources: small("20m", "64Mi", "192Mi"),
    webhook: { replicaCount: 1, resources: small("10m", "32Mi", "96Mi") },
    cainjector: { replicaCount: 1, resources: small("10m", "64Mi", "192Mi") },
    startupapicheck: { enabled: false },
  }, { netpol });
  new k8s.apiextensions.CustomResource("selfsigned", {
    apiVersion: "cert-manager.io/v1",
    kind: "ClusterIssuer",
    metadata: { name: "cloudspider-selfsigned" },
    spec: { selfSigned: {} },
  }, { ...k, dependsOn: [release] });
  viewerAccess(k8s, k, addon.id, [{ apiGroups: ["cert-manager.io"], resources: ["certificates", "issuers", "clusterissuers"] }], { dependsOn: [release] });
  return { version: addon.appVersion, details: { issuer: "cloudspider-selfsigned" } };
}
