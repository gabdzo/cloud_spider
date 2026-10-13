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

**Still billed while scaled down:** the EKS control plane (~$73/mo on a
standard-support version, **~$438/mo on extended support**: see below), load
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

## Kubernetes version and EKS extended support

Scaling to 0 nodes does not cut the control plane bill, and its price depends
on the Kubernetes version (eu-north-1, the same in every region):

| support | control plane | per month |
| --- | --- | --- |
| standard (14 months after the EKS release) | $0.10/h | ~$73 |
| EXTENDED (the next 12 months) | $0.60/h ($0.10 + $0.50 fee) | ~$438 |

On 2026-10-13: 1.32 (extended since 2026-03-23) and 1.33 (since 2026-07-29)
are on extended support, 1.34 is standard until 2026-12-02 (then extended),
1.35 until 2027-03-27. The calendar is `src/eks-versions.js` (from the EKS
docs' release calendar); the EKS card labels every version with it, warns
loudly when the selected or live version is extended, adds the fee to the
card's cost, and SCORE fails AWS-FIN-002 for such a cluster.

**kubernetesVersion auto** (the default) keeps what the live cluster runs, and
uses 1.35 for a new cluster, so a RUN never upgrades by surprise. An explicit
version may be at most one minor above the live one, never below (the card,
the RUN route and the program all refuse otherwise, before any change).

**Upgrading in place, 1.32 -> 1.33 -> 1.34 -> 1.35:** on the EKS card set
kubernetesVersion to 1.33, PREVIEW (the cluster shows as an *update* of
`version`, not a replace; nothing else should change), RUN (about 10-15
minutes, the API stays up). Then 1.34 and 1.35 the same way. The managed node group
keeps its kubelet version (up to 3 minors behind is supported) until it is
next replaced; check add-on compatibility (Karpenter, LBC, Kyverno) before
each step (the ranges: ADDON_K8S in `src/eks-versions.js`; 1.36 is not offered yet: Kyverno 1.19 stops at 1.35). EKS managed add-ons already on the cluster keep their version after a control plane upgrade: update them (EKS console or `aws eks update-addon`). EKS can roll a control plane back one minor within 7 days.
