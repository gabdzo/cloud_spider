# TEAR EVERYTHING DOWN (ordered cluster take-down)

One button on the EKS card and on the STACKS overview (one per cluster). It shows a plan first, asks for the cluster name, and runs in the EKS card's run pane, one step per stack. Every run goes into the audit log (`take down cluster`).

Order (`src/cluster-takedown.js`):
1. If the cluster has 0 nodes (recommended, ticked by default): scale the node group to 1 node so the controllers run. This costs a few cents.
2. Remove Kyverno's admission webhooks. With no Kyverno pod behind them, they refuse every delete.
3. If 0 nodes and you unticked the scale-up: strip controller finalizers outside kube-system.
4. Workloads: shopapi, demo, scaling-demo, pgcluster, observability. The LBC and EBS CSI driver still run, so they delete the ALB and the volumes.
5. Add-ons: keda, cert-manager, karpenter (its NodePools go first, so Karpenter terminates its instances), lbc, external-dns, metrics-server, pod-identity, and kyverno last.
6. The EKS stack.
7. A read-only lookup of anything still tagged for the cluster (ALBs, target groups, EBS, ENIs, SGs, instances). It reports them and deletes nothing.

Resumable: the plan is rebuilt from each stack's state every time, and stacks that are already down are skipped.

Up-only guards never block a destroy. That covers maxPods, "EKS installs these now", free pod slots, and NEEDS. `pulumi destroy` does not run the program. A single card's TAKE IT DOWN only reads which stack it is (clusterName, name, context). Kube writes use only a `kube.writeContexts` entry of that same cluster, never a `*-viewer` one.

Tested end to end in `test/cluster-takedown-e2e.test.js`. It uses the real pulumi CLI with a file backend, a fake cluster with a Kyverno webhook and an Ingress finalizer, and fake kubectl/aws.
