# SCALE DOWN / SCALE UP an EKS cluster

Stop paying for nodes while keeping the cluster: control plane, every
Kubernetes object, PersistentVolumes (EBS) and their data, load balancers and
the Pulumi state stay. Code: `src/eks-scale.js`.

**Scale down** (in this order):
1. saves the current sizes (`.cloudspider/eks-scale/<cluster>.json`);
2. optional (`workloads`): scales Deployments/StatefulSets outside system
   namespaces to 0 (replicas saved);
3. sets every Karpenter NodePool's limits to `cpu 0, memory 0` (adds no node);
4. deletes Karpenter's NodeClaims (Karpenter drains and terminates them);
5. sets each managed node group to min 0 / desired 0 (max stays; EKS needs
   max >= 1). EKS drains the nodes, honouring PDBs for up to 15 minutes.

**Scale up** restores the saved node group sizes, NodePool limits and replicas,
then forgets the record.

**Still billed while scaled down:** the EKS control plane (~$73/mo), load
balancers (ALB ~$17.50/mo + LCUs + its public IPv4s), kept EBS volumes, NAT
gateways if any, unattached Elastic IPs, and CloudWatch logs (controlPlaneLogs).
The app behind an ALB is down (no healthy targets).

**Pulumi:** the node group size comes from the EKS card's `nodeCount`, Karpenter's
limits from the add-ons stack. A RUN of either stack while scaled down puts
those back (scales up). Scale up from here, or RUN the card.

**Dry run first, always:**
- API: `GET /api/eks/scale?cluster=<name>&context=<write ctx>&mode=down[&workloads=1]`
  returns the steps, cost now/after and what keeps billing; `POST` with
  `{cluster, context, mode, workloads, confirm: "<cluster name>"}` runs it
  (same-origin page only; context must be in `kube.writeContexts`;
  `features.stacksRun: false` turns it off; each run goes to the audit log).
- CLI: `node scripts/cloudspider.mjs scale down --cluster <name> --context <ctx> [--workloads]`
  prints the dry run; add `--yes --confirm <name>` to run it.
- UI: `src/eks-scale-view.js` renders the SCALE DOWN / SCALE UP buttons and the
  confirm dialog (typed cluster name, cost before/after). Mounting it on the
  EKS card is left to the STACKS panel redesign.
