# TODOS

## Deferred from CEO review (2026-10-09)

- Second cloud provider. One more provider, not every cloud. Copy the AWS region switch once the AWS place feels right. Not in the first slice. See `~/.gstack/projects/cloud_spider/ceo-plans/2026-10-09-cloud-spider.md`.

## Deferred from eng review of the Pulumi test stack (2026-10-09)

- Account budget alert at $10/month, emailed to you.
  - Why: a forgotten test stack costs about $5/month. The simplified account's spend limit goes away if advanced features are ever activated.
  - Pros: catches a forgotten `pulumi destroy` or a mistake before the bill does.
  - Cons: unprobed. AWS Budgets may be denied by SCP `p-1fsyi3oa` or by simplified mode. Probe it first.
  - Context: kept out of `infra/` because a budget covers the whole account, not the stack. Start with `aws budgets create-budget` in us-east-1 (Budgets is global).
  - Depends on: nothing. Most useful once the Pulumi test stack exists.

## Deferred from CEO review of monetization (2026-10-11)

Cut from this pass by WTP-EXP B. Postponed, not rejected. Do not build billing to answer them.

### Five Sample-mode watches

**What:** Watch five operators use Sample mode before any price.
**Why:** A watched click shows where the page is confusing. It does not show that anyone will pay.
**Context:** Deferred by WTP-EXP B on 2026-10-11. The operating test is one spoken setup price. Start here only after that outcome line exists and you still want usability notes. See experiments in `docs/business/monetization-strategy.md`.
**Effort:** S (human) / S (CC)
**Priority:** P3
**Depends on:** the spoken-price outcome line.

### Path timing and clone-versus-pay

**What:** Time a broken load balancer against the console, and ask whether someone would pay for a build they can clone.
**Why:** Those notes measure usability and license enforcement, not willingness to pay.
**Context:** Experiments 1, 2, and 5 in the strategy doc. Deferred with the five watches.
**Effort:** S (human) / S (CC)
**Priority:** P3
**Depends on:** the spoken-price outcome line.

### $79 license decision

**What:** Decide whether to sell a one-time packaged build at the assumed $79.
**Why:** No price has been offered yet. $79 is an assumption in section 4, not a tested price.
**Context:** Old days 61–90. Revisit only if the spoken setup price is paid.
**Effort:** S (human) / S (CC)
**Priority:** P3
**Depends on:** a recorded pay on the setup price.

## Deferred from the platform strategy (2026-10-11)

Cut from the platform vision by SCOPE REDUCTION. Postponed, not rejected. Do not build these to finish the local scorecard. See `docs/business/cloud-spider-platform-strategy.md`.

- Hosted control plane, second login, and outbound snapshot. Only after someone pays and asks a second person to open the report.
- OpenShift production scoring. Spec only, until a ClusterVersion GET succeeds on a connected cluster.
- Pulumi platform packs (Kyverno install, Prometheus, Grafana, Loki, Tempo, Argo CD, SLO burn rules). Detect existing add-ons. Do not install from a scorecard. Do not add a second monitoring stack beside OpenShift.
- Security Hub, GuardDuty, IAM least privilege, drift repair, PDF export, fleet dashboard, multi-cloud.
- Take down or any write API triggered by a finding.

## Later picture ideas (2026-10-10)

- Small pixel-art fires on broken diagram nodes, broken path threads, and a broken load balancer or cluster drawn in its VPC. Built. The campfire sprite sits on top of the existing broken color.
- The map reads as an architecture diagram of this region. A settlement stays a VPC. A plot stays a subnet, labeled with its name, CIDR, and public or private. An availability zone is the column. A gate on the wall is the internet gateway, or NAT when there is no internet gateway. An instance keeps its name. A load balancer and an EKS cluster that live in that VPC are drawn inside it, and Path and Cluster still exist. The bill and the trail sit together in the top-right corner. Account-wide things with no place, such as IAM, stay off the map. A security group is still the sentence on a Path node, not a note drawn on the link.
