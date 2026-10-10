// A Kubernetes provider for an EKS cluster from upgrades/eks, authenticated
// with `aws eks get-token` (no static credentials, nothing written to disk).
// The program passes its own @pulumi/* modules in (this file sits outside
// each project's node_modules), like tags.js.
export function eksProvider({ pulumi, aws, k8s, clusterName, region = "eu-north-1", name = "eks" }) {
  const cluster = aws.eks.getClusterOutput({ name: clusterName });
  const kubeconfig = pulumi.all([cluster.endpoint, cluster.certificateAuthorities]).apply(([endpoint, cas]) =>
    JSON.stringify({
      apiVersion: "v1",
      kind: "Config",
      clusters: [{ name: clusterName, cluster: { server: endpoint, "certificate-authority-data": cas[0].data } }],
      contexts: [{ name: clusterName, context: { cluster: clusterName, user: clusterName } }],
      "current-context": clusterName,
      users: [{ name: clusterName, user: { exec: { apiVersion: "client.authentication.k8s.io/v1beta1", command: "aws", args: ["--region", region, "eks", "get-token", "--cluster-name", clusterName, "--output", "json"] } } }],
    }),
  );
  return new k8s.Provider(name, { kubeconfig, enableServerSideApply: true });
}
