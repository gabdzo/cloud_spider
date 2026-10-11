# Stack dependencies and ownership (2026-10-11)

Why this exists: on 2026-10-11 four stacks failed on Gabriel's cloudspider-up
for one reason: a stack assumed something another stack makes, or made
something another stack had already made. This page lists every stack under
`upgrades/`, what it makes, what it shares and what it needs, and the
ownership rule that ends the 409s.

## The rule

1. **The EKS stack owns the cluster-level EKS managed add-ons**:
   `eks-pod-identity-agent`, `metrics-server`, `aws-ebs-csi-driver`.
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
5. vpc-cni, CoreDNS and kube-proxy are EKS's self-managed defaults (made by
   EKS at cluster creation, not managed add-ons); no stack touches them.

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
- Bundles, one plan and one approval, in dependency order:
  - **Shop API bundle**: pgcluster (CNPG operator is inside it) → shopapi
    (+ lbc first when expose=alb).
  - **Demo bundle**: demo → scaling-demo.
- pod-identity and metrics-server rows say INCLUDED WITH EKS; the scorecard's
  FIX for their controls reruns the EKS stack with its current settings.
