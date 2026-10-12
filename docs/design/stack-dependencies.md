# Stack dependencies and ownership (2026-10-11)

Why this exists: on 2026-10-11 four stacks failed on Gabriel's cloudspider-up
for one reason: a stack assumed something another stack makes, or made
something another stack had already made. This page lists every stack under
`upgrades/`, what it makes, what it shares and what it needs, and the
ownership rule that ends the 409s.

## The rule

1. **The EKS stack owns the cluster-level EKS managed add-ons**:
   `vpc-cni` (since #172, with prefix delegation), `eks-pod-identity-agent`,
   `metrics-server`, `aws-ebs-csi-driver`.
   They are on by default (`podIdentityAgent`, `metricsServer`,
   `ebsCsiDriver` config, `false` turns one off).
2. **No other stack creates them.** A stack that uses one declares it
   (`needs: eks-addon:<name>`), its preflight checks the add-on is on the
   cluster, and it refuses with
   `needs X: RUN the EKS stack for <cluster> (it installs X)`.
3. **One stack per namespace / operator.** A stack that puts things into a
   namespace it does not make (shopapi into `shop`, scaling-demo HPAs into
   `demo`) checks the namespace's owner stack first and refuses or skips.
4. **Existing clusters migrate, never delete.** An add-on another stack made
   earlier is handed to the EKS stack: `pulumi state delete` in the old stack
   (no AWS call), then the EKS stack adopts it with the Pulumi `import`
   option. `scripts/migrate-eks-addons.mjs <cluster>` does it, dry run first.
5. CoreDNS and kube-proxy are EKS's self-managed defaults (made by EKS at
   cluster creation, not managed add-ons); no stack touches them. vpc-cni
   was one too until #172: the EKS stack's next RUN creates the managed
   add-on, which takes over the existing aws-node DaemonSet
   (resolveConflicts OVERWRITE), see "Pod capacity".

## Stacks

| Stack (dir) | Makes | Shared with another stack (before the rule) | Needs |
|---|---|---|---|
| eks (`upgrades/eks`, stack `upgrade` / `eks-<c>`) | VPC, 2 subnets, IGW, cluster, node group, IAM (cluster, node, viewer), access entries, scanner ClusterRole | **after the rule:** the 3 EKS add-ons + the EBS CSI role (pod identity) | nothing |
| demo (`upgrades/demo`) | ns `demo`, podinfo web/api, loadgen, OTel collector + gateway, log group, collector role + pod identity association, viewer RBAC | **eks-pod-identity-agent, metrics-server** (created when absent, #150) | eks, eks-addon:eks-pod-identity-agent, eks-addon:metrics-server |
| pgcluster (`upgrades/pgcluster`) | ns `cnpg-system` + CNPG operator (Helm), ns `shop`, Cluster `shopdb` (Secret `shopdb-app`), StorageClass `cloudspider-gp3`, EBS CSI role | **eks-pod-identity-agent** (podIdentityAgent=install), **aws-ebs-csi-driver** | eks, eks-addon:eks-pod-identity-agent, eks-addon:aws-ebs-csi-driver |
| shopapi (`upgrades/shopapi`) | in ns `shop`: migration Job + ConfigMap, PostgREST Deployment, Service; (expose=alb) Ingress → ALB | writes into pgcluster's ns `shop`, reads its Secret `shopdb-app` | eks, pgcluster; lbc when expose=alb |
| pod-identity (`upgrades/addons`, `pod-identity-<c>`) | the `eks-pod-identity-agent` add-on | **yes**: demo, pgcluster | eks |
| metrics-server (`addons`, `metrics-server-<c>`) | the `metrics-server` add-on, viewer RBAC | **yes**: demo | eks |
| karpenter (`addons`) | Helm chart, node role + access entry, controller role + pod identity association, SQS interruption queue + EventBridge rules, NodePool/EC2NodeClass | — | eks-addon:eks-pod-identity-agent |
| lbc (`addons`) | Helm chart, IAM policy + role + pod identity association | — (ALBs it makes belong to the Ingress's stack) | eks-addon:eks-pod-identity-agent |
| keda (`addons`) | Helm chart, operator role, SQS queue, ns `keda-demo` + jobs worker | — | eks-addon:eks-pod-identity-agent |
| kyverno (`addons`) | Helm chart (ns `kyverno`), 6 Audit policies | — | 3 free pod slots |
| cert-manager (`addons`) | Helm chart (ns `cert-manager`), ClusterIssuer | CRDs with the Kubernetes lab11's own cert-manager (raise one) | — |
| scaling-demo (`addons`) | ns `scaling-demo`, burst + inflate Deployments, HPAs on demo/web+api | HPAs write into the demo stack's ns `demo` | eks-addon:metrics-server; demo for the HPAs |
| external-dns | not built (needs a domain) | — | lbc |
| rds | own VPC, subnets, SG, RDS instance (password in Secrets Manager) | — | — |
| signal, barrel, camp, site, worker, openshift | their own AWS resources only (log group; bucket; Lambda+DDB+secret; S3+CloudFront; SQS+Lambda; EC2 for CRC) | — | — |

Per-cluster names (`<cluster>-…` IAM roles, `<addon>-<cluster>` stacks)
keep two clusters apart; nothing else in the account is shared.

## Failures on 2026-10-11 and their cause

| Failure | Cause | Fix |
|---|---|---|
| demo: 409 `Addon already exists` on eks-pod-identity-agent / metrics-server | the add-on stacks had made them | #150 (use what is there); now: demo never creates them, EKS owns them |
| pgcluster: 409 on eks-pod-identity-agent | `podIdentityAgent=install` by default | pgcluster never creates it; preflight needs it from EKS |
| scaling-demo: `namespaces "demo" not found` (HPAs) | demo app not on the cluster | #152: preflight skips the HPAs without the demo app |
| shopapi: `namespaces "shop" not found` (Service, ConfigMap) | pgcluster not up; nothing checked | preflight refuses (needs pgcluster); the program reads ns `shop` first and stops |

## What the app shows

- Every Stacks card: NEEDS chips, green when present, red when missing,
  click jumps to that card. RUN/PREVIEW refuse before Pulumi when one is red.
  A need that could not be read (no CONNECTed context, no AWS answer) is
  dim and never refuses. How each is read (src/stack-needs.js, read-only):
  - EKS cluster: EKS ListClusters.
  - EKS add-ons (pgcluster: Pod Identity agent + EBS CSI driver; demo: Pod
    Identity agent + metrics-server; Karpenter/LBC/KEDA: Pod Identity agent;
    scaling-demo: metrics-server): EKS DescribeAddon.
  - pgcluster (for Shop API): namespace shop with a pod labelled
    cnpg.io/cluster=shopdb in the kube read, else a pgcluster stack with
    resources on that cluster.
  - Add-ons with cards (lbc): the add-on tree, else the kube read.
- The shopapi program itself reads namespace shop
  (`needs-pgcluster-namespace-shop`) and never creates it, so a run that
  skips the check still stops before the first resource.
- Bundles (src/stack-bundles.js), one plan and one approval, in dependency
  order, on every member's card: PLAN shows the order, what is skipped
  (already on the cluster; never the last step) and the bill, and changes
  nothing; RUN BUNDLE runs preview then up per step, stops at the first
  failure, holds every step's stack lock, and shows on the last step's card.
  Refused before Pulumi when the EKS cluster or one of its add-ons is missing,
  and (Demo) when a full node has no room for the collector.
  - **Shop API bundle**: pgcluster (CNPG operator is inside it) → lbc (only
    when expose=alb) → shopapi with that expose.
  - **Demo bundle**: demo → scaling-demo with demoApp=present, hpa=on.
- pod-identity and metrics-server rows say INCLUDED WITH EKS; the scorecard's
  FIX for their controls reruns the EKS stack with its current settings.

## Shop API on an ALB (expose=alb)

`expose=none` (default) keeps PostgREST cluster-internal. `expose=alb` adds
Ingress `shop/shopapi` in the drill's shape: ingressClassName `alb`,
`scheme: internet-facing`, `target-type: ip` (pod IPs, so prefix-delegated
pods are targets directly), health check `GET /items` every 10 s, 2/2
thresholds, tags `project=shopapi,cluster=<c>,cloudspider=expendable`. The
ALB is made by lbc (NEEDS chip `lbc` only when expose=alb) and belongs to the
shopapi stack: destroy Shop API (or set expose=none) **before** lbc, or the
ALB is orphaned. The stack exports `url`. PATH from the internet: IGW →
public-subnet route 0.0.0.0/0 → ALB (2 AZs) → target group (pod IPs) →
pods; test/shopapi-alb.test.js checks that binding on cloudspider-up's shape
and that removing the IGW route breaks it.

Cost chip: ALB $0.024/h (~$0.58/day, as priced in src/stack-costs.js) + 2 public IPv4 ($0.005/h each,
~$0.24/day) ≈ **$0.82/day** idle, plus LCU usage (pennies at demo traffic).

Recovery of the failed shopapi run: the failed creates never reached state,
so after pgcluster is up, RUN Shop API again (or the bundle): it converges.

## NetworkPolicy enforcement

The VPC CNI ignores NetworkPolicy objects unless its node agent enforces
them. The EKS stack sets `enableNetworkPolicy: "true"` in the vpc-cni add-on's
configurationValues, next to prefix delegation (card `networkPolicy`, default
`on`; vpc-cni v1.14+ ships the agent as the `aws-network-policy-agent`
container of aws-node). Turning it on or off is an in-place add-on update:
aws-node restarts, pods keep their IPs, nothing is replaced. A cluster with no
NetworkPolicy objects behaves as before; once it is on, every policy is
enforced, so a default deny without its allows cuts traffic. The scorecard's
NET-K8S-001 passes when the agent runs with `--enable-network-policy=true`,
and K8S-SEC-005 (default deny per app namespace) only means something then.
Check: `kubectl -n kube-system get ds aws-node -o jsonpath='{.spec.template.spec.containers[*].name}'`.

## Pod capacity

Field finding 2026-10-11 (cloudspider-up): demo RUN hung ~10 min on
DaemonSet pod demo/otel-collector, Pending with "0/2 nodes are available:
1 Too many pods, 1 node(s) didn't satisfy NodeAffinity". With one IP per pod
the VPC CNI caps a t4g.medium at 17 pods and a t4g.small at 11.

- The EKS stack owns **vpc-cni** too (managed add-on, takes over the
  self-managed aws-node with OVERWRITE) with prefix delegation on
  (`ENABLE_PREFIX_DELEGATION=true`, `WARM_PREFIX_TARGET=1`; card
  `prefixDelegation`, default on). It is created before the node group.
- EKS card `maxPods` (default `auto`): `auto` adds nothing, so an existing
  node group is untouched, and its nodes keep EKS's ENI limit (11 on a
  t4g.small, 17 on a t4g.medium) **even with prefix delegation on** (seen
  live on cloudspider-up 2026-10-11: a t4g.medium launched after prefix
  delegation still had 17). The stack's `podsPerNode` output says so.
  `32` (t4g.small) / `32|58|110` (t4g.medium) adds a launch template with an
  AL2023 nodeadm NodeConfig (`kubelet.config.maxPods`) and **replaces the
  node group once** (a new one comes up first; the legacy stack keeps
  Pulumi's auto-name, other clusters get `<cluster>-nodes-mp<N>`). RUN
  refuses that unless the replace is confirmed; PREVIEW shows the replace.
  Only new nodes get the new cap. After the RUN check:
  `kubectl get nodes -o custom-columns=NAME:.metadata.name,PODS:.status.allocatable.pods`.
- Karpenter's EC2NodeClass sets `kubelet.maxPods` (card `maxPods`, default
  32) only when the vpc-cni add-on has prefix delegation on (read at RUN: a
  Karpenter stack run before the EKS stack turned it on has no maxPods, so
  RUN it again); a change drifts the NodeClass, so Karpenter replaces its
  (ephemeral) nodes. Karpenter computes the ENI limit itself otherwise.
- Karpenter's NodePool requires `topology.kubernetes.io/zone` In the AZs of
  the cluster's subnets (config `zones` narrows it). That allows every zone;
  it does not spread nodes (Karpenter picks the cheapest offering). Pods with
  `topologySpreadConstraints` on `topology.kubernetes.io/zone` spread them.
- Prefix delegation needs a free, aligned /28 in the node's subnet. A /24
  fragmented by one-IP-per-pod nodes can have none (`InsufficientCidrBlocks`
  in CloudTrail, pods stuck on "failed to assign an IP address"): replacing
  the old nodes frees their scattered IPs (cloudspider-up 2026-10-11).
- Every DaemonSet of ours runs at `system-node-critical`, so on a full node
  it preempts a lower-priority pod instead of waiting.
- Preflight (demo): a DaemonSet needs 1 free slot on every node. A full node
  with nothing it may preempt refuses RUN/PREVIEW naming the node; a full
  node with ordinary pods is a note in the run log (one is preempted).

## While a run waits

- Deployments and DaemonSets of ours (demo, shopapi, scaling-demo, keda-demo)
  have `customTimeouts` 5m create/update: not ready in 5 minutes fails the
  run (runHint rollout-timeout) instead of pulumi's silent 10-minute wait.
- While a stack with `namespaces` runs (demo, pgcluster, shopapi, add-ons
  outside kube-system), the run pane gets `waiting on <ns>/<pod>: …` lines
  every 20 s from the kube read: not scheduled (the scheduler's message, e.g.
  "Too many pods"), ImagePullBackOff, CrashLoopBackOff. Each line once.

## Our workloads and our Kyverno policies

All of ours carry `app.kubernetes.io/name` on the pod template (selectors
unchanged) and a readiness probe: podinfo /readyz, PostgREST /items, the
collectors' health_check extension (:13133), `/bin/true` for busybox and
aws-cli loops and the psql Job, `/pause -v` for the pause placeholders. The
demo collector's hostPath is a Kyverno PolicyException (kyverno.io/v2, in
namespace kyverno) for DaemonSet demo/otel-collector and its pods only. OPS
counts a Deployment's finding once, not again for its ReplicaSet or Pods.

## Follow-ups

- Kyverno 1.19 warns that `kyverno.io/v1` ClusterPolicy is deprecated; move
  the six Audit policies (upgrades/addons/kyverno-policies.js) to
  `policies.kyverno.io` ValidatingPolicy (CEL). Not done yet.
