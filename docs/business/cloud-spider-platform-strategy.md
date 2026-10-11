# Cloud Spider platform strategy

Date: 2026-10-11
Branch: `main`
Status: DRAFT. Written while you were away, so review questions were decided here and marked AUTO. This file does not edit `docs/business/monetization-strategy.md` or `docs/business/scalable-business-options.md`.
No application code was changed. Do not implement until you approve this file and `docs/design/production-readiness-scorecard.md`.

Label key: **Fact** is in the repo or on a cited page this session. **Market** is a competitor price, not demand for Cloud Spider. **Hypothesis** is untested. **AUTO** is a decision taken because you were AFK. Reverse any AUTO line and the recommendation moves with it.

Related:

- Scorecard specification: `docs/design/production-readiness-scorecard.md`
- Implementation plan, not approved to run: `docs/superpowers/plans/2026-10-11-production-readiness-scorecard.md`
- Earlier commercial reads: `docs/business/monetization-strategy.md`, `docs/business/scalable-business-options.md`

## Recommendation

**VALIDATE FIRST.**

The sentence "assess, deploy, secure, observe, and operate from one platform" describes Port, Datadog, Grafana Cloud, Pulumi Cloud, Komodor, and Fairwinds at once. Copying that catalog does not create a business. Those companies already charge for it, and Cloud Spider has no second user.

The defensible slice is narrower. **Fact.** The page already draws one AWS account, walks one load balancer to the cluster, reads a kube cluster with GET-only calls, separates credits on the bill, and can preview or run a small set of Pulumi stacks on this machine. **Hypothesis.** A team will pay, later, for a scorecard that turns those reads into evidence-backed findings and refuses to print a green score when it could not see the account. Nobody has paid for that yet.

**AUTO.** First product is a local production-readiness scorecard for one AWS account and one EKS cluster, using reads the process already makes, plus a few read-only checks. OpenShift rules are specified, not built, until a cluster is connected. Pulumi packs are not installed by the scorecard. A hosted control plane is not in the first 90 days.

**Position.** Subscriptions are not assumed. Competitors charging by the seat or the node proves those buyers exist for *their* product. It does not prove a seat for this page. The experiment is still one spoken price before new code, aimed at the scorecard report rather than an afternoon of help.

Evidence that would change this to **GO**: one named platform engineer pays for a year of the local scorecard report (history on their machine, or a shared copy they asked for). Evidence that would change this to **PIVOT**: they ignore the score and only want the path sentence. Evidence that would change this to **DO NOT BUILD**: they say AWS Well-Architected Tool plus Polaris already covers it and will not pay.

## 1. What already exists

**Fact.** Local Node page, `npm start`, listens on `127.0.0.1:9241` (`src/server.js`). One AWS account via the machine credential chain. Sample mode does not call AWS.

| Already implemented | Where | Reuse for a scorecard |
| --- | --- | --- |
| Map of VPCs, subnets, instances, load balancers, EKS | `src/aws.js` `describeDiagram` | Public exposure, single-AZ, target health, as evidence |
| Path: LB, listener, rule, target group, target, node, cluster, first broken sentence | `src/path-diagnose.js` `diagnose`, `headline` | Reliability findings. Stops at the cluster. Does not open Service or Pod |
| Cluster GET-only: namespaces, nodes, pods, services, workloads, ingresses, HPAs, events, metrics, Kyverno policy reports | `src/kube.js` `PATHS` | Pod security, probes, requests, HPA. No Secrets. No write |
| Kyverno baseline in Audit mode: privileged, hostPath, requests, latest tag, plus demo policies | `upgrades/addons/kyverno-policies.js` | Policy findings only if Kyverno is installed. Absence is NOT_ASSESSED, not PASS |
| Bill with credits separated from charges | `src/cost.js` | A FinOps signal, not a FinOps product |
| Pulumi cards: camp, site, worker, shopapi, rds, pgcluster, barrel, signal, eks, openshift, demo, add-ons | `src/upgrade.js`, `upgrades/` | Deploy path for stacks you already own. Typed name before destroy |
| Add-on catalog with detect rules: pod-identity, metrics-server, Kyverno, Karpenter, KEDA, cert-manager, LBC | `upgrades/addons/catalog.js` | "Is this installed?" Not "install everything" |
| Terraform state read | `src/app.js` `terraformState` | Read-only. Not a drift engine |
| OpenShift-shaped sample and an OpenShift Pulumi stack | README, `upgrades/openshift` | A drawing and a lab stack. Not an OpenShift production assessor |
| Take down | typed name match | Stays on the laptop. Never a scorecard action |

**Fact.** Not in the repo: accounts, billing, scheduled scans, score history, Security Hub, GuardDuty, IAM policy analysis, CIS bundles, SLOs, burn rates, PDF export, a second cloud, a hosted dashboard.

**Fact.** `docs/cloud-platform/MVP.md` is a different product (a sealed outage lab). It leaves out other people's accounts, billing, GCP, Azure, and a generic engine. It is not this scorecard.

**Prior learning applied:** `alb-targets-are-ips` (10/10, 2026-10-10). `typed-name-before-destroy` (10/10, 2026-10-10). `path-stops-at-cluster` (9/10, 2026-10-11). `cloudspider-loopback-single-account` (9/10, 2026-10-11).

## 2. The vision, challenged

The eight jobs in the brief are eight products.

| Job | Who already sells it | What Cloud Spider would be doing |
| --- | --- | --- |
| Discover AWS and clusters | AWS console, Hava, Cloudcraft | A local map you already have |
| Security and readiness score | AWS Well-Architected Tool, Security Hub, Kubescape, Polaris, Fairwinds | The proposed scorecard |
| Deploy platform components | Pulumi Cloud, Helm, OpenShift OperatorHub | Stacks you already run for this lab |
| Observe and SLO | Datadog, Grafana Cloud, the OpenShift monitoring stack | A viewer, or a duplicate stack if you install Prometheus beside a stack they already run |
| Drift | Pulumi Cloud Pro (drift remediation is a paid edition feature) | Not built |
| Incidents across LB and pods | Datadog, Komodor, the console | Path starts this and stops at the cluster |
| Track improvement | Fairwinds Insights, Security Hub | Needs history. Not built |

**Position.** An integrated control layer is a real wish and a weak wedge. The buyer who wants all eight already has a budget line with Datadog or an internal platform team. The buyer who might try Cloud Spider is one platform engineer who can run a local scan this week and get a report they can hand to someone else without pretending a checklist is proof the service stays up.

**AUTO premises, disagree by editing this list:**

1. The paying problem, if it exists, is "I cannot show, with evidence, what is unsafe or fragile on this account and this cluster, and I will not call it ready when the scan could not see." Agree until a named person says otherwise.
2. Doing nothing costs them the console plus Polaris or Kubescape, which are free. The pain is the join across the load balancer and the cluster, plus a score that does not hide a critical behind a pile of low findings.
3. Multi-cloud, a hosted control plane, and a library of platform packs are long-term ideas. They are not required to learn if anyone pays.
4. Essential security findings stay visible without a license. Paywalls hide history, a second seat, and scheduled scans. They do not hide a public security group.

## 3. Competitors and prices

Checked 2026-10-11. Prices are **Market**. The $100/node Fairwinds figure is a secondary write-up, not the vendor's page.

| Product | What they charge for | Price seen | Cloud Spider is not this |
| --- | --- | --- | --- |
| [Hava](https://www.hava.io/pricing) | Shared cloud diagrams | $59/month Professional, $249/month Teams | A picture |
| [Komodor](https://komodor.com/platform/pricing-and-plans/) | Kubernetes troubleshooting | Custom on their site. [Marketplace](https://aws.amazon.com/marketplace/pp/prodview-d32vxllvsjbj6) Enterprise $150,000 per 12 months for 1,000 vCPUs, $132 per extra vCPU | An enterprise SRE platform |
| [Port](https://www.port.io/pricing) | Internal developer portal | Free to 15 seats. Basic from $30/seat/month, Standard from $40/seat/month, billed annually | A service catalog |
| [Pulumi Cloud](https://www.pulumi.com/pricing/) | IaC state, policy, drift | Free for one user. Essentials $40/month (40 credits, up to 500 resources). Pro $400/month. Enterprise from $2,000/month | Hosted Pulumi |
| [Fairwinds Insights](https://www.fairwinds.com/insights-pricing) | Kubernetes policy, cost, security | Official page: open-source tools free, Insights custom. A [secondary page](https://stackradar.io/alternatives/fairwinds-insights) says free under 20 nodes and about $100/node/month on a marketplace listing | Do not treat $100 as their list price |
| Polaris, Goldilocks, Nova, Pluto | Kubernetes policy and hygiene | Open source, $0 | The free checker a team already runs |
| Kubescape / [ARMO](https://www.armosec.io/pricing/) | Kubernetes posture | Kubescape is open source. ARMO's page is "contact us" | A CNCF scanner plus a sales contract |
| AWS Well-Architected Tool | Review against the framework | In the console. No second vendor | The official checklist |
| AWS Security Hub | Aggregated security findings | AWS's own product. Unit price not opened this session | Do not invent a per-check price |
| Datadog, Grafana Cloud | Telemetry platforms | Modular host and usage prices. Not re-quoted this session | The system of record for metrics |
| Lens | Local Kubernetes IDE | Personal free under $10M revenue. Plus $25/user/month | The cluster tab |

**Layer 1.** Teams pay for shared state, a second login, and a vendor who stays on the hook when the check breaks. Solo local scanners are free.

**Layer 2.** The 2026 pages still sell seats (Port, Lens), resources or credits (Pulumi), nodes or vCPUs (Komodor, ARMO), and custom enterprise quotes (Fairwinds, ARMO). The open-source checker is the top of the funnel, not the invoice.

**Layer 3.** A 0 to 100 score that can be green while a critical is open is how these products get distrusted. Cloud Spider's edge, if it has one, is the opposite: no overall score without coverage, and a critical gate that the number cannot hide. That is a product choice, not a feature list.

## 4. Who would pay

**Hypothesis, not a person.** The economic buyer is the head of platform or the SRE manager who already gets paged for a 502 and has to explain risk to someone who does not read YAML. The user is the platform engineer who runs the scan. The champion and the payer are often the same person on a small team and two people on a larger one.

**Fact.** No such person is named. GitHub shows no demand. Interest in this brief is not demand.

**Distribution, cheapest first.** One message to one engineer who has an ALB in front of EKS, with a redacted sample finding attached. Then the person they say would have to sign. Not ads. Not AWS Marketplace. Marketplace is a procurement channel for a product that already has a price someone paid.

## 5. Five ways to charge

| | Who pays | Recurs? | Keeps the local page? | Security | Why it loses or wins |
| --- | --- | --- | --- | --- | --- |
| A. Open source plus Pro | A team that outgrows the public tree | Only if Pro is hosted history or a closed module | Yes for the free scan | Paywall inside `src/` is bypassed by a clone | Loses while the checks ship in the public repo |
| B. Paid local app | One engineer, annual updates | Annual, if the build expires | Yes. Best key story | You patch laptops you cannot see | Loses to Polaris and Kubescape at $0 unless the report is the reason |
| C. Self-hosted platform | A company that will not send findings out | Annual contract plus support | No. You ship a server they run | Their admins hold the data. You still own CVEs in the bundle | A services contract. Support is the product |
| D. Local agent plus hosted page | A rotation that needs the same report | Monthly or annual seat or account | The agent is the current process | Outbound snapshots only. No keys, no Take down | The only shape a second person can open. Also the easiest to turn into a worse Hava |
| E. Paid assessments | The same manager, for a report you write | No, unless they buy a retainer | Yes | You see their account. That is a trust event | Founder hours. Valid as the first test. Not a software business |

**AUTO.** Do not pick D as the thing to build. Use E's test (a price, spoken, before code) on B's artifact (a local report). Build D only after someone pays and asks for a second login. A is distribution later, after the checks exist, with the paid part kept out of the public tree. C is a later packaging of the same local engine, not a second product.

**Pricing hypotheses, not offers.**

| Shape | Number to test | Unit | Why |
| --- | --- | --- | --- |
| Pro | €39 per month, or €400 per year | one account and one cluster | Inside the brief's €29–49 band. Near Lens Plus ($25) and under Hava ($59). High enough that a coffee is not a sale |
| Team | €199 per month | up to 5 people, 3 clusters | Inside €149–299. Only after a second person asks to open the report |
| Business | do not quote €499 | fleet | No fleet exists. Quoting it teaches the wrong buyer |

Per user matches Port and Lens and punishes the rotation you want to share the report with. Per cluster matches Fairwinds-style quotes and punishes a test cluster. Per AWS account matches how a platform team budgets the scan. **Hypothesis.** Charge per account per year for the pilot, with a cluster cap, not per user. Change the unit if the first buyer says they buy seats.

**Cost to you before a single customer.** Support time is the real cost. AWS API calls for a local scan are their bill (Cost Explorer is $0.01 per request on the primary view; do not scan it in a loop). A hosted page adds a small VM, auth, snapshot storage, and a breach to explain. AI inference is $0 if you do not add a model. Kyverno, Prometheus, and Grafana are third-party licenses you must read before you ship them inside a paid bundle. Stripe, if you ever invoice, is 2.9% plus $0.30 on a domestic card. None of these costs matter until someone pays. Do not rent the VM first.

## 6. Free and paid

| | Community, free, local | Paid, only after a yes |
| --- | --- | --- |
| Discovery of one account and one cluster | yes | |
| Scorecard with critical findings visible | yes | |
| PASS, FAIL, UNKNOWN, NOT_APPLICABLE, NOT_ASSESSED | yes | |
| INSUFFICIENT_EVIDENCE instead of a fake 90 | yes | |
| Manual scan, Markdown and JSON | yes | |
| Essential security findings | yes, never gated | |
| History and trend | | yes |
| Scheduled scan | | yes |
| Second person, shared report | | yes |
| Stakeholder PDF | | yes |
| Extra accounts or clusters | | yes |
| Pulumi preview of a fix you already ship | local, typed name, their buttons | not a hosted button |

Hiding a public `0.0.0.0/0` security group behind Pro is how the product loses trust. History is the thing that recurs.

## 7. Narrow MVP

**In the first build, after you approve.** One local command or page section. It reads the account and one kube context. It emits a scorecard for profile `aws-production` and `kubernetes-production`. Coverage under the floor prints INSUFFICIENT_EVIDENCE and still lists failures. A critical FAIL sets a gate even if the average looks fine. Export JSON and Markdown. No network listener except the existing loopback page. No new write APIs.

**Checks in v1, only where the data is already in hand or one read-only call away.** Specified in the design doc. Examples: ALB target health from Path, security group world exposure if the describe is already in the diagram, pods missing probes or requests, privileged containers, HPAs present or absent, Kyverno reports when the CRD exists, metrics-server presence. Everything else is NOT_ASSESSED with the permission or API that would assess it.

**Out of v1.** OpenShift production profile (specified, not coded). Security Hub, GuardDuty, IAM Access Analyzer. SLO burn rates. Installing Kyverno, Prometheus, Grafana, Loki, Tempo, Argo CD. Drift repair. Hosted login. PDF. A second cloud. Take down from a finding.

## 8. Thirty, sixty, ninety days

**Days 1–30.** No new code. Run the page on one real account. Write ten findings by hand in the scorecard shape (id, evidence, result, severity). Show them to one engineer. Speak €400 for a year of that report, updated on their machine. Pay, refuse, or silence.

**Days 31–60.** Only if they pay or they ask for the file every week without paying and you still choose to build the free scan. Implement the local scorecard in v1 scope. Rescan the same account. The report must match the hand findings on those ten, or the rules are wrong.

**Days 61–90.** If a second person asks to open it, design the outbound snapshot. Do not build it in the same change as the scorer. If nobody asks, stop. Leave the local scan free. Do not start a Team tier.

## 9. Effort

| Slice | Human | Notes |
| --- | --- | --- |
| Hand scorecard and the price conversation | a few hours | The only work that can kill the idea cheaply |
| Local scorer, AWS plus EKS, JSON and Markdown | about one to two weeks of careful work | Reuse `describeDiagram`, `diagnose`, `PATHS`. New rules, not a new collector |
| OpenShift profile on a real cluster | another week, after a cluster exists | Do not fake it from the sample drawing |
| Hosted snapshot and login | a new service | Not estimated as part of v1. Treat it as a product restart |
| Platform packs | each pack is its own review | The add-on catalog already detects some. Installing a monitoring stack beside OpenShift's is a mistake |

## 10. Risks

1. The checklist becomes the product, and a 90 hides one critical. The scoring rules in the design doc exist to prevent that. They have to be tested.
2. UNKNOWN is coded as pass. That is a ship-blocking bug, specified as forbidden.
3. A paid bundle installs Prometheus next to OpenShift monitoring, or Kyverno in enforce mode, and takes the cluster down. v1 does not install anything.
4. Take down or `pulumi up` moves to a hosted button. Forbidden by the typed-name rule.
5. The public repo has no license. You cannot call the free tier open source until you choose one. Not legal advice.
6. Well-Architected and CIS names on a partial rule set will be read as certification. The report must say which control ids were checked and that this is not an official assessment.
7. You maintain rules forever. AWS and Kubernetes change. That maintenance is the annual fee, if anyone pays it. If they do not, it is a hobby with a score.

## 11. Dependency map

```text
local page (exists)
  describeDiagram, diagnose, kube PATHS, cost, add-on detect
        |
        v
  scorecard rules (new, pure) --> findings + coverage
        |
        v
  JSON / Markdown report (new)
        |
        +-- later, only after a paid ask --> outbound snapshot --> second login
        +-- not in v1 --> Pulumi preview of a fix, still typed-name, still local
```

OpenShift, Security Hub, SLO math, and packs sit beside this arrow. They do not block it.

## 12. Delivery index

| # | Item | Where |
| --- | --- | --- |
| 1 | Commercial viability | Sections 2 to 5. VALIDATE FIRST |
| 2 | Competitor comparison | Section 3 |
| 3 | Target customer | Section 4. Unnamed. Hypothesis |
| 4 | Positioning | One local report that will not score what it could not see, and will not hide a critical |
| 5 | Scorecard architecture | `docs/design/production-readiness-scorecard.md` |
| 6 | Scoring methodology | same |
| 7 | Example AWS scorecard | same |
| 8 | Example Kubernetes scorecard | same |
| 9 | Example OpenShift scorecard | same, marked designed-not-built |
| 10 | Pulumi stack architecture | same, later, detect-first |
| 11 | Security and authorization | same. Loopback, GET-only kube, no secrets, typed destroy |
| 12 | Data collection and storage | same. v1 keeps the report on disk beside the process |
| 13 | Free versus paid | Section 6 |
| 14 | Monetization experiments | Section 8 |
| 15 | Dependency map | Section 11 |
| 16 | MVP | Section 7 |
| 17 | 30/60/90 | Section 8 |
| 18 | Effort | Section 9 |
| 19 | Risks | Section 10 |
| 20 | GO / VALIDATE FIRST / PIVOT | VALIDATE FIRST |

## Workflow after you approve

You asked for this sequence. It is proposed, not started as implementation.

1. You read this file and the scorecard spec. You accept, cut, or reject the AUTO lines.
2. `/plan-eng-review` already has a first pass at the bottom of the spec. A second pass is worth it if you change the check list.
3. `/brainstorming` design is the spec. Do not open a second design unless you reject it.
4. The implementation plan is written and marked not approved. `/writing-plans` output does not authorize coding.
5. Coding starts only after you say the spec and the plan are approved.

## What I noticed

- You asked for one platform that assesses, deploys, secures, observes, and operates. The sentence is the whole market. The repo already walks a load balancer to a cluster and stops.
- You listed € prices as hypotheses and said not to assume a subscription. That matches the earlier decision: one spoken price, one person, before code.
- You asked for OpenShift checks that are not a copy of Kubernetes, and for a score that refuses to pass when it could not see. Those two constraints are the spec.

## The Assignment

Before any scorecard code: pick one engineer who runs an ALB in front of EKS. Write ten findings by hand in the finding shape from the spec, including one case you could not see. Tell them the public repo exists. Ask for €400 for a year of that report on their machine. Record pay, refuse, or silence. That is the same kind of test as WTP-EXP B. It does not revoke it. It names the artifact.

## Review sections (strategy-only, SCOPE REDUCTION)

Accepted work is the local scorecard in section 7, and only after you approve. These rows are capability-level. The implementation owner must prove each "prove" line with a test named in the plan.

### 1. Architecture

**OK.** One pure function over existing readers. Stubs stay NOT_ASSESSED. **WARNING.** A page, a hosted agent, and Pulumi installs are separate products. They are cut.

### 2. Error and rescue

| Failure | User sees | Prove |
| --- | --- | --- |
| AWS call denied | that control is NOT_ASSESSED, scan continues | a 403 fixture |
| Kube path 404 for an optional CRD | NOT_ASSESSED, not PASS | Kyverno report 404 |
| Coverage under 0.60 | INSUFFICIENT_EVIDENCE, failures still listed | the score unit test |
| Critical FAIL under many low PASSes | gate NOT_READY, number does not hide it | the gate unit test |
| No account and no cluster | no score | empty input |

No catch-all that turns an error into a pass.

### 3. Security

**OK** for the cut scope: loopback, GET-only kube, no Secrets, no Take down, no `pulumi up` from the scorer. **WARNING.** A hosted control plane would be a different trust model. Cut.

### 4. Data flow

Facts in, findings out, one local JSON file. No second copy leaves the machine in v1.

### 5. Quality

**WARNING.** Partial citations of Well-Architected can be read as certification. The report must say it is not an official review. That sentence is in the spec.

### 6. Tests

The plan's tests are the rescue proof. No live AWS account in unit tests. Fixtures only.

### 7. Performance

One scan, the reads the page already does. Do not add a Cost Explorer loop. Cost Explorer stays on its existing six-hour cache.

### 8. Observability

v1 has no metrics vendor. The scan file has a timestamp. A failure is a result enum, not a log line the user never sees.

### 9. Deployment

`npm start` unchanged until you approve a route. The plan does not add a route. Distribution of a paid build is deferred. There is no license file. Do not call the free tier open source until you add one.

### 10. Long-term

The remaining scope stays maintainable if rules are YAML and the score function does not know AWS. Rule updates are the only reason an annual fee could exist. If nobody pays, stop adding controls.

### 11. Design

SKIPPED (no UI scope) for the accepted cut. The spec describes a later page. That page is not in the plan.

## NOT in scope

Cut by SCOPE REDUCTION, postponed in `TODOS.md`, not rejected as ideas:

- Hosted control plane and a second login
- OpenShift scoring until ClusterVersion can be read
- Installing Kyverno, Prometheus, Grafana, Loki, Tempo, Argo CD, or a second monitoring stack
- SLO burn rates, drift repair, Security Hub, GuardDuty, IAM analysis
- PDF, fleet dashboard, multi-cloud
- Take down or any write from a finding

## Failure modes

| Mode | What breaks | Mitigation in the spec |
| --- | --- | --- |
| False ready | Critical hidden by low findings | Gate NOT_READY |
| False pass | Missing permission scored as healthy | Result enum |
| False OpenShift | Sample drawing scored as a cluster | ClusterVersion GET required |
| Duplicate stack | Scorecard installs Prometheus on OpenShift | Scorer never installs |
| Trust break | Hosted button can destroy a stack | Typed name stays local, off this feature |

## CEO review (AUTO, SCOPE REDUCTION)

You were AFK. Mode was not asked. The vision touches far more than 15 new files if built whole, so the mode is SCOPE REDUCTION. Application: the platform catalog is specified and then cut down to the local scorecard. Accepted scope is section 7. Deferred work is listed in `TODOS.md` under the 2026-10-11 platform heading.

| ID | Decision | Status |
| --- | --- | --- |
| MODE | SCOPE REDUCTION | AUTO, because the full vision is a multi-product build and you asked for a narrow MVP |
| WEDGE | Local scorecard, one account, one EKS cluster, no installs | AUTO |
| PRICE | Speak €400 per year before code. €39 and €199 stay hypotheses | AUTO |
| HOSTED | Not in 90 days | AUTO |
| OPENSHIFT-BUILD | Spec only | AUTO |
| PACKS | Detect existing add-ons. Do not install from the scorecard | AUTO |

Approval readiness: the AUTO rows are decisions for the draft. Execution approval is not one of them.

```text
CURRENT                         THIS DRAFT                         12-MONTH IDEAL
Local page, no score, $0  -->  local scorecard if someone wants it  -->  shared report only if a second person paid to see it
```

0I, if you later approve the build. Hour 1: which AWS calls already exist, and which findings must stay NOT_ASSESSED. Hour 2: the score math, especially critical gates and coverage. Hour 3: kube GET paths that 403. Hour 4: do not write a fixer. Hour 6: tests that a missing permission is not a pass.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope of the platform vision | 1 | ISSUES OPEN | mode: SCOPE_REDUCTION, 0 critical gaps in the draft, execution withheld |
| Outside Review | not run | You were AFK and Codex auth failed on the previous commercial review | 0 | unavailable | no completed external review |
| Eng Review | first pass in the scorecard spec | Architecture of the scorer | 1 | ISSUES OPEN | see that file |
| Design Review | not run | Scorecard UI is specified, not built | 0 | not run | |
| DX Review | not run | No new install path yet | 0 | not run | |

**OUTSIDE COVERAGE:** provider codex, phase plan-review, not run this pass. Previous commercial review on 2026-10-11 returned AUTH_FAILED. No completed external review.

**VERDICT:** VALIDATE FIRST. Eng review of the spec is required before code, and this pass is not that approval. Execution stays stopped.

**UNRESOLVED DECISIONS:**
- You have not approved this strategy, the AUTO cuts, or the scorecard spec. No application code until you do.
