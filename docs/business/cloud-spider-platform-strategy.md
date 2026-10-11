# Cloud Spider: platform engineering, SRE and production-readiness strategy

| | |
|---|---|
| Status | **Proposal for Gabriel's decision. Nothing is approved and nothing is being implemented.** |
| Author | Spider (Grok Bot for gabdzo), 2026-10-11 |
| Second opinion | PR #85 by Gabriel's terminal agent. #85 was merged to `main` (c504e67, 14:18 CEST); Gabriel then chose this document as the base, so merging this PR replaces #85's versions of the two shared files. The parts of #85 that add value are folded in and credited inline as *(from #85)*. §15 lists what was adopted and rejected. |
| Method | gstack `/office-hours` (Appendix A) → gstack `/plan-ceo-review` (Appendix B) → Superpowers `brainstorming` and gstack `/plan-eng-review` for the technical design (in `docs/design/production-readiness-scorecard.md`, Appendices A-B there). All run headless: no interactive questions were possible, so each question was answered from the repo and the brief, the assumption is written down, and the recommended option was taken. |
| Base | `main` at #86 (2026-10-11 14:09 CEST). Inputs read: README, `docs/RUN-ME.md`, `docs/review-2026-10-11.md`, `docs/plan-expansion.md`, `docs/plan-overnight.md`, `docs/cloud-platform/{MVP,ARCHITECTURE,DECISION_LOG}.md`, `TODOS.md`, `docs/live-test-2026-10-11.md` and `docs/disaster-drill-2026-10-11.md` (#86), PRs #78-#84, the code under `src/` and `upgrades/`. |
| Earlier business notes | `docs/business/monetization-strategy.md` and `docs/business/scalable-business-options.md` were not on `main` when this document was started. They arrived with PR #85, which was merged to `main` at 14:18 CEST (c504e67) shortly before Gabriel chose this document as the base. **Where they differ from this document, this document supersedes them** (pending Gabriel's approval). Their useful parts are folded in here and cited by permalink ([monetization-strategy.md @570aa3f](https://github.com/gabdzo/cloud_spider/blob/570aa3f/docs/business/monetization-strategy.md), [scalable-business-options.md @570aa3f](https://github.com/gabdzo/cloud_spider/blob/570aa3f/docs/business/scalable-business-options.md)) rather than added as a third, conflicting file. |
| Companion | Technical spec: `docs/design/production-readiness-scorecard.md` (deliverables 5-12, 15). |

> **Labels used in this document.** *Fact (source)* = verified, with link and access date 2026-10-11. *Hypothesis* = an assumption to test, not a finding. *Unverified* = seen in a secondary source or a search snippet and not confirmed on the vendor's own page. No market-size or revenue number in this document is a measurement.

---

## TL;DR

**Recommendation: VALIDATE FIRST** (not GO, not PIVOT yet).

Cloud Spider is an impressive, working local tool built in three days, but there is **no external user and no demand evidence yet**, and the "unified DevOps/SRE/security platform" vision runs straight into well-funded incumbents (Datadog, Wiz, Komodor, Port, Pulumi Cloud) and strong free tools (Prowler, Kubescape, Polaris, kube-bench, AWS Security Hub, the free AWS Well-Architected Tool). A subscription product is not justified by the fact that competitors charge subscriptions.

The narrow wedge that could work: **an evidence-backed production-readiness assessment for AWS + EKS (OpenShift second), sold first as a fixed-scope paid engagement by Gabriel, delivered with a local, read-only Cloud Spider scanner that produces an honest scorecard (coverage, unknowns, critical gates) and a remediation plan, with Pulumi packs to fix the gaps.** Recurring revenue is tested second, as a re-assessment retainer or a self-serve local licence (about €400/year per account, *from #85*; a hypothesis to quote in interviews), only after paid pilots prove someone pays for the first assessment.

**Next 30 days:** 10 customer interviews, a one-page offer, and 2-3 paid assessment pilots quoted. No new code for the first 14 days. The ~20-day AI-assisted build of the scorecard MVP starts only after the build gate in §10 (at least 3 qualified interviews or 1 agreed pilot). Kill and pivot criteria are in §11.

---

## Contents

1. [Commercial viability (deliverable 1)](#1-commercial-viability-deliverable-1)
2. [Competitor comparison (deliverable 2)](#2-competitor-comparison-deliverable-2)
3. [Target customer (deliverable 3)](#3-target-customer-deliverable-3)
4. [Positioning (deliverable 4)](#4-positioning-deliverable-4)
5. [Business models A-E](#5-business-models-a-e)
6. [Pricing unit and unit-cost model (hypotheses)](#6-pricing-unit-and-unit-cost-model-hypotheses)
7. [What exists, what is reusable, what is missing, what is long-term](#7-what-exists-what-is-reusable-what-is-missing-what-is-long-term)
8. [MVP definition (deliverable 16) and the smallest recurring-revenue feature set](#8-mvp-definition-deliverable-16-and-the-smallest-recurring-revenue-feature-set)
9. [Free vs paid matrix (deliverable 13)](#9-free-vs-paid-matrix-deliverable-13)
10. [30/60/90-day roadmap (deliverable 17)](#10-306090-day-roadmap-deliverable-17)
11. [Monetization and validation experiments, kill criteria (deliverable 14)](#11-monetization-and-validation-experiments-kill-criteria-deliverable-14)
12. [Effort estimates (deliverable 18)](#12-effort-estimates-deliverable-18)
13. [Major business and technical risks (deliverable 19)](#13-major-business-and-technical-risks-deliverable-19)
14. [Recommendation: GO / VALIDATE FIRST / PIVOT (deliverable 20)](#14-recommendation-go--validate-first--pivot-deliverable-20)
15. [Opposing view](#15-opposing-view)
16. [Proposed Superpowers workflow (gated on approval)](#16-proposed-superpowers-workflow-gated-on-approval)
17. [Open questions for Gabriel](#17-open-questions-for-gabriel)
18. [Sources](#18-sources)
- [Appendix A: gstack /office-hours record](#appendix-a-gstack-office-hours-record)
- [Appendix B: gstack /plan-ceo-review record](#appendix-b-gstack-plan-ceo-review-record)

---

## 1. Commercial viability (deliverable 1)

### 1.1 Honest assessment

| Question | Answer today | Evidence |
|---|---|---|
| Is there a working product? | **Yes, for one user.** Local app with AWS map, ALB path diagnosis, EKS cluster view with telemetry/OPS/K9s-style table, vaults with SLOs and burn lamps, Pulumi stacks and add-ons with preview/run/take-down, cost panel, LEARN labs. ~482 tests. | Code on `main`; PR #84 description ("npm test 482/0") |
| Does it work on a real incident? | **Partly proven.** The 2026-10-11 drill on a test EKS cluster showed SLO/burn detection across 7 faults, and found real bugs (ALB's own 503s missing from `RequestCount`, fixed in #83; SLOs only from the primary context; LBC default tags overriding ingress tags). | PR #83, `src/kube-contexts.js`, `spider-shots:drill/` |
| Is there a user other than Gabriel? | **No.** | No issues/PRs from others; repo started 2026-10-09 |
| Is there demand evidence (payment, LOI, a team using it)? | **None.** | – |
| Is there a distribution channel? | **Gabriel's contracting network** (DevOps/SRE in Czechia, AWS/EKS/OpenShift), LinkedIn, GitHub. No audience measured. | Brief |
| Is the problem real? | **Yes in general**: teams do ask "are we ready for production?" before launches, audits, and after incidents; consultancies sell readiness reviews and the AWS Well-Architected review exists precisely for this. **Not yet shown for Cloud Spider's specific buyers.** | AWS Well-Architected Tool exists and is free ([pricing](https://aws.amazon.com/well-architected-tool/pricing/)) |
| Is it defensible? | **Weakly today.** Check content is a commodity (thousands of open-source checks in Prowler alone, "2,500+ checks" per [prowler.com/pricing](https://prowler.com/pricing)). Defensibility would have to come from (a) cross-layer evidence and correlation (AWS network ↔ load balancer ↔ Kubernetes ↔ SLO), (b) honest coverage-aware scoring, (c) OpenShift + EKS operator know-how baked into packs and controls, (d) Gabriel's services relationship. None of these is a moat on its own. | §2 |

### 1.2 The core tension

The brief's vision ("assess, deploy, secure, observe and operate … from one platform") describes the combined scope of at least five funded categories: CSPM/CNAPP (Wiz, Orca, Prowler), Kubernetes posture (ARMO/Kubescape, Fairwinds), Kubernetes troubleshooting/AI SRE (Komodor, Robusta), observability (Datadog, Grafana, groundcover), and IDP/scorecards (Port, Cortex, OpsLevel, Backstage). A solo contractor cannot out-build them. **A unified platform is a 12-month-plus ideal, not an MVP** (CEO review verdict, Appendix B).

What a solo builder *can* own is a **workflow**, not a category: "tell me honestly whether this AWS+EKS (or OpenShift) setup is ready for production, show the evidence, fix the gaps safely, prove it." That workflow is today done by consultants with spreadsheets, Security Hub exports, kube-bench/Polaris output and screenshots (the status quo, §3.3).

### 1.3 Verdict on viability

- **Services-led (assessment + remediation), tool-assisted: plausible now.** Gabriel already sells DevOps/SRE time; a productised assessment raises his rate per engagement and creates the evidence for a product. Low cost to test.
- **Self-serve subscription (Pro €29-49/month): unproven and economically fragile** for a solo vendor because support time dominates unit cost (§6.3), and free alternatives cover most single-tool needs.
- **Team/Business tier with a hosted control plane: not before** paid pilots ask for shared scorecards and scheduled scans; it brings SOC 2-style expectations, data-handling obligations and on-call duty for a hosted service.

---

## 2. Competitor comparison (deliverable 2)

### 2.1 Pricing and model (public information, accessed 2026-10-11)

| Product | Category | Overlap with Cloud Spider | Deployment | Pricing model and public price | Verification |
|---|---|---|---|---|---|
| **Komodor** | K8s troubleshooting, "agentic operations" | Cluster view, events, drift, remediation playbooks | SaaS + in-cluster agent | Current page: Starter and Enterprise "custom pricing", platform fee + AI tokens ([komodor.com](https://komodor.com/platform/pricing-and-plans/)). AWS Marketplace: Enterprise 12-month $150,000 incl. 1,000 vCPUs, $132 per extra vCPU ([AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-d32vxllvsjbj6)) | Pricing page: via search snippet of the vendor page. Marketplace figure: **unverified** (search snippet, not re-fetched) |
| **Port** | Internal developer portal (catalog, scorecards, actions) | Vaults ≈ catalog entities; scorecards | SaaS | Free up to 15 seats; Basic **$30/seat/month** (annual, ≤50 seats); Standard **$40/seat/month** (≤200 seats); Enterprise platform fee + seats ([port.io/pricing](https://www.port.io/pricing)) | Verified on vendor page |
| **Pulumi Cloud** (incl. Insights discovery and policies) | IaC backend, discovery, policy, drift | Stacks, discovery, compliance packs, drift | SaaS (self-host on Enterprise) | Free (1 user); Essentials **$40/month** incl. 40 credits (≈500 resources), IaC resource $0.1825/month; Pro **$400/month** (drift detection, custom policy packs); Enterprise **$2,000/month** (conformance packs incl. CIS, CIS Kubernetes, NIST, PCI DSS) ([pulumi.com/pricing](https://www.pulumi.com/pricing/)) | Verified on vendor page |
| **Grafana Cloud** | Observability | Telemetry, dashboards, SLOs | SaaS | Pro **$19/month + usage**; Kubernetes Monitoring billed per host-hour and container-hour ([grafana.com/pricing](https://grafana.com/pricing/)) | Via search snippet of vendor page/docs; per-unit rates **unverified** |
| **Datadog** | Observability + security | Telemetry, KSPM, monitors | SaaS + agent | Infrastructure Pro **$15/host/month** (annual), $18 on-demand; CSM now bundled (DevSecOps Pro **$22/host/month** annual) ([datadoghq.com/pricing/list](https://www.datadoghq.com/pricing/list/)) | Via search snippet; bundle detail **unverified** |
| **Kubescape (OSS) / ARMO Platform** | K8s posture + runtime security | K8s security controls, frameworks (NSA, CIS) | OSS CLI/operator; ARMO SaaS | Kubescape free (Apache-2.0, CNCF). ARMO SaaS **$29 per worker node/month** on AWS Marketplace ([listing](https://aws.amazon.com/marketplace/pp/prodview-vudcbfxavxlrg)); ARMO site: tailored pricing ([armosec.io/pricing](https://www.armosec.io/pricing/)) | Marketplace figure via search snippet, **unverified** on page |
| **Polaris (Fairwinds, OSS)** | K8s config validation | Reliability/security checks on workloads | CLI, dashboard, admission | Free, Apache-2.0 ([GitHub](https://github.com/FairwindsOps/polaris)) | Verified via repo listing in search |
| **Fairwinds Insights** | K8s policy, security, cost | Multi-cluster posture | SaaS / self-hosted | Free tier (1 cluster, ≤5 nodes, per GetApp); commercial custom, billed on average nodes/month ([fairwinds.com](https://www.fairwinds.com/insights-pricing)); AWS Marketplace EKS edition lists $1,200 per node for a 12-month contract ([listing](https://aws.amazon.com/marketplace/pp/prodview-4ljk3j5iko7os)) | Node-average billing verified via vendor page snippet; free-tier limits and Marketplace figure **unverified** |
| **AWS Security Hub CSPM** | AWS posture | AWS security controls | AWS-native | Per check per account/region/month: $0.0010 first 100k, $0.0008 next 400k, $0.0005 beyond ([pricing](https://aws.amazon.com/security-hub/cspm/pricing/)) | Via search snippet of AWS page |
| **AWS Well-Architected Tool** | Architecture review questionnaire | Readiness review framing | AWS console | **No additional charge** (custom lenses too) ([pricing](https://aws.amazon.com/well-architected-tool/pricing/)) | Via search snippet of AWS page |
| **Wiz** | CNAPP | AWS + K8s posture, attack paths | SaaS, agentless | AWS Marketplace: about **$24,000/year (Essential)** or **$38,000/year (Advanced)** for 100 workloads ([listing](https://aws.amazon.com/marketplace/pp/prodview-ibgbkrqusncsm)) | **Unverified** (search snippet) |
| **Orca Security** | CNAPP | AWS + K8s posture | SaaS, agentless | AWS Marketplace: about **$7,000/month for up to 100 workloads** ([listing](https://aws.amazon.com/marketplace/pp/prodview-rogbt2k4b63xc)) | **Unverified** (search snippet) |
| **Prowler** | CSPM (OSS + SaaS) | AWS and K8s posture checks, compliance | OSS CLI; Prowler Cloud SaaS | OSS free (Apache-2.0); Prowler Cloud **$99 per cloud account/month** monthly (search results also report $79 annual); private cloud custom ([prowler.com/pricing](https://prowler.com/pricing)) | $99 verified on vendor page; $79 annual **unverified** |
| **Steampipe / Turbot Pipes** | SQL over cloud APIs, compliance mods | Discovery, benchmarks | OSS CLI; Pipes SaaS | Steampipe OSS free; Pipes Developer free; Team **$49/month** incl. 3 users ([Pipes docs](https://turbot.com/pipes/docs/accounts/developer/billing), [AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-b3dfz5hxhcn3a)) | Via search snippet; licence of Steampipe CLI (AGPL vs Apache) **unverified** |
| **kube-bench** | CIS K8s benchmark runner | Control-plane/node CIS checks | OSS job | Free, Apache-2.0 ([GitHub](https://github.com/aquasecurity/kube-bench)) | Via search |
| **Checkov** | IaC scanning | IaC posture (Terraform, K8s, CFN) | OSS CLI | Free, Apache-2.0 (per search results) | **Unverified** licence detail |
| **Cortex** | IDP + scorecards | Production readiness scorecards | SaaS | AWS Marketplace: $39,000 / 12 months for 50 users (≈$65/user/month) ([listing](https://aws.amazon.com/marketplace/pp/prodview-x56oxtx647o3c)) | **Unverified** (search snippet) |
| **OpsLevel** | IDP + scorecards | Service maturity scorecards | SaaS | AWS Marketplace / pricing: about $10,000/year up to 20 users ([opslevel.com/pricing](https://www.opslevel.com/pricing)) | **Unverified** (search snippet) |
| **Spotify Portal / Soundcheck (Backstage)** | Backstage plugins: checks, tracks, Tech Insights | Vault ≈ catalog-info.yaml; scorecards | Self-hosted Backstage | Bundle on AWS Marketplace $100,000 / 12 months, by committed users ([listing](https://aws.amazon.com/marketplace/pp/prodview-vtgmheqo275xc)); OSS Backstage Tech Insights plugins exist | **Unverified** (search snippet) |
| **Hava** *(from #85)* | Cloud diagrams | The AWS map (a picture, not a verdict) | SaaS / self-hosted | Professional **$59/month** (3 sources, 1 user), Teams **$249/month** (10 sources, unlimited users), +$15 per extra source; Enterprise custom ([hava.io/pricing](https://www.hava.io/pricing)) | Verified on vendor page |
| **Lens** *(from #85)* | Local Kubernetes IDE | Cluster tab; proof a local K8s tool can charge | Desktop app | Personal free (organisations over $10M revenue or funding must pay); Plus **$25/month billed annually ($300 up front)** or $30 monthly; Pro/Enterprise for teams ([lenshq.io/pricing](https://www.lenshq.io/pricing)) | Verified on vendor page |
| **Cloudcraft** *(from #85)* | Cloud diagrams | The AWS map | SaaS (Datadog) | Included with a Datadog subscription, per #85 | **Unverified** (not re-checked) |
| **Robusta** | K8s alert enrichment / AI SRE | Incident context for K8s alerts | OSS + SaaS | Quote only (form on [home.robusta.dev/pricing](https://home.robusta.dev/pricing)) | Verified: no public price |
| **groundcover** | eBPF observability (BYOC) | Telemetry, K8s health | BYOC SaaS / on-prem | Free tier; **$50 per host/month** (monthly average of monitored nodes) for on-prem; Enterprise priced by host ([groundcover.com/pricing](https://www.groundcover.com/pricing)) | Verified on vendor page |

### 2.2 Capability comparison (what matters for the wedge)

✓ = core capability, ◐ = partial/adjacent, – = not a focus. Cloud Spider "today" is the current `main`; "MVP" is §8.

| | AWS posture | K8s posture | OpenShift-specific | Cross-layer ALB↔K8s↔SLO | SLO / error budget | Readiness verdict with coverage/unknowns | Deploy fixes (IaC) | Local-first, no data leaves | Price entry |
|---|---|---|---|---|---|---|---|---|---|
| Cloud Spider today | ◐ (inventory, path) | ◐ (health, Kyverno reports) | – (sample + labs only) | ◐ (`path-diagnose.js`) | ✓ (in-memory) | – | ✓ (Pulumi stacks/add-ons) | ✓ | free (no licence file yet) |
| **Cloud Spider MVP** | ✓ (~15 controls) | ✓ (~15) | ◐ (preview, ~8) | ✓ | ✓ (persisted) | **✓ (differentiator)** | ◐ (packs later) | ✓ | services + Community free |
| Prowler | ✓ | ✓ | ◐ | – | – | ◐ (ThreatScore) | ◐ (fixer in SaaS) | ✓ (OSS) | free / $99 per account |
| Kubescape / ARMO | – | ✓ | ◐ | – | – | ◐ (framework score) | – | ✓ (OSS) | free / per node |
| Polaris / Fairwinds | – | ✓ | ◐ | – | – | ◐ (score) | – | ✓ (OSS) | free / custom |
| Security Hub | ✓ | ◐ (EKS controls) | – | – | – | ◐ (security score) | – | AWS | per check |
| Well-Architected Tool | ◐ (questionnaire) | – | – | – | – | ◐ (risk list, self-reported) | – | AWS | free |
| Pulumi Cloud | ◐ (Insights policies) | ◐ (CIS K8s pack, Enterprise) | – | – | – | – | ✓ | – (SaaS) | $40-$2,000/month |
| Komodor | – | ◐ | ◐ | ◐ | – | – | ◐ (playbooks) | – (SaaS) | custom |
| Datadog / Grafana / groundcover | ◐ | ◐ | ◐ | ✓ (with instrumentation) | ✓ | – | – | – / BYOC | per host |
| Port / Cortex / OpsLevel | ◐ (via integrations) | ◐ | – | – | ◐ | ✓ (scorecards, rules you define) | ◐ (actions) | – | per seat |
| Wiz / Orca | ✓ | ✓ | ◐ | – | – | ◐ (risk) | – | – | ~$24k+/year (unverified) |

**Read-out:** nobody in this table sells "honest production-readiness verdict across AWS + EKS/OpenShift with coverage and unknowns, tied to SLO runtime evidence and Pulumi remediation" as one local workflow. That is a real gap, but it is a gap at the **workflow** level, and every element exists elsewhere; the gap could be filled by a consultant combining Prowler + Kubescape + Grafana + a spreadsheet. Cloud Spider's edge is that the combination is automated, explainable and local.

---

## 3. Target customer (deliverable 3)

### 3.1 Segments and economic buyers

| Segment | Pain | Economic buyer | Current workaround | Fit |
|---|---|---|---|---|
| **S1. Scale-ups / SMBs (≈10-200 engineers) on AWS + EKS with 1-3 platform/DevOps people, before a launch, audit, funding round or after an incident** | "Are we production-ready? What will bite us?" No time to assemble evidence | CTO / VP Eng / Head of Platform | Hire a contractor for a review; Security Hub + Trusted Advisor + checklists | **Primary.** Matches Gabriel's network and skills. |
| **S2. Teams running OpenShift (often regulated: finance, public sector, telco) with a small platform team** | Upgrade risk, SCC/RBAC sprawl, operator health, monitoring confusion | Platform lead / IT manager | Red Hat support, Insights Advisor (OCP), consultants | **Secondary, sharp:** fewer tools understand OpenShift specifics; Gabriel's EX280 track helps. Sales cycles slower. |
| **S3. DevOps/SRE consultancies and freelancers** | Repeatable assessments and client reports | Consultancy owner | Own scripts + OSS scanners + slides | **Channel and Pro-licence buyer.** Needs white-label reports. |
| S4. Individual engineers / learners | Learn EKS/OpenShift; homelabs | Self | Labs, tutorials | Community and distribution (LEARN), not revenue. |
| S5. Enterprises | Fleet governance | CISO / platform director | Wiz, Datadog, Port | **Not a target**: procurement, SOC 2, SSO, SLAs. |

### 3.2 The first customer, as specifically as the repo allows

*Hypothesis*: "Petra, Head of Platform at a ~60-engineer Prague/Brno SaaS company on AWS (eu-central-1), one EKS cluster per environment, ALB ingress, RDS, a 2-person platform team, preparing for an enterprise customer's security questionnaire. She gets promoted if the launch and the questionnaire go through without a production incident; she gets blamed if a known gap causes an outage." **This person is invented.** The first assignment (Appendix A) is to replace her with ten real names from Gabriel's network.

### 3.3 Status quo (the real competitor)

A contractor spends several days running Security Hub/Trusted Advisor, Prowler or kube-bench, Polaris, reading Terraform/Pulumi, clicking through the ALB/target groups/Kubernetes, then writes a findings document and a backlog by hand. Evidence is screenshots. Re-assessment after fixes is a repeat of the same manual work. **The time to produce and re-produce that report is the thing to compress.**

---

## 4. Positioning (deliverable 4)

The brief's line, "Assess, deploy, secure, observe, and operate your cloud infrastructure from one platform", is the 12-month ideal. As a **launch** position it is too broad (it invites comparison with Datadog and Wiz) and too vague to be believed from a solo vendor.

**Proposed launch positioning (hypothesis to test in interviews and on the landing page):**

> **Know if your AWS + Kubernetes stack is ready for production, with evidence.**
> Cloud Spider scans your AWS account and EKS or OpenShift clusters read-only, from your own machine, and gives an honest readiness verdict: what passes, what fails, what it could not see, and which critical gaps block launch. Then it helps you fix them safely with previewed Pulumi changes and proves the fix with a rescan.

Positioning statement:

- **For** platform/DevOps leads at 10-200-engineer companies on AWS + EKS (and OpenShift teams),
- **who** must show production readiness before a launch, audit or after an incident,
- **Cloud Spider is** a local, read-only readiness scanner and remediation workflow
- **that** turns AWS, Kubernetes and SLO evidence into a coverage-aware scorecard with critical gates and verified fixes.
- **Unlike** CSPMs (Wiz, Prowler, Security Hub) that list thousands of security checks, or IDPs (Port, Cortex) whose scorecards depend on rules and data you wire up yourself, **Cloud Spider** correlates network, load balancer, Kubernetes and SLO evidence, says what it could not assess instead of passing it, and never needs your credentials in someone else's cloud.

What it is **not**: not a compliance attestation, not an observability backend, not a replacement for Prometheus/Grafana/Pulumi/AWS consoles, not automated root-cause analysis.

The Pip-Boy look: a **distribution asset** (memorable demos, screenshots that get shared, the LEARN shelf) and a **commercial liability** (trademarks, and enterprise stakeholders may not take a game UI seriously). Keep the retro-terminal pixel style; drop trademarked names and ship neutral exported reports (risk R6).

---

## 5. Business models A-E

| | A. Open source + paid Pro features | B. Paid local desktop app | C. Self-hosted enterprise platform | D. Local agent + hosted control plane | E. Paid assessments and remediation services |
|---|---|---|---|---|---|
| Target customer | Engineers and small teams who try the free tool, then need history, profiles and reports | Individual engineers and consultants | Regulated companies (finance, public sector, OpenShift shops) that keep data in-house | Platform teams wanting shared scorecards, schedules and fleet views | S1/S2 buyers before a launch, audit or after an incident |
| Value proposition | Free honest scan; paid continuity (history, schedules, exports, profiles, exceptions) | Polished, signed app with updates | Runs in their environment, SSO, audit log, support contract | Team visibility, trends, alerts, multi-account without sharing credentials | An expert verdict with evidence and a fix plan in days, not weeks |
| Pricing (hypothesis) | Pro €29-49 per user/month or per account (brief's range; untested) | One-time licence + annual updates (untested) | Annual contract; quote only | Team €149-299/month, Business €499-999+/month (brief's ranges; untested) | Fixed fee = estimated days × Gabriel's day rate; optional monthly re-assessment retainer |
| Implementation complexity | Medium: licence keys, feature gating, packaging; the gated code must not live in the public repo (a clone bypasses an in-repo paywall) | Medium: packaging, code signing, auto-update across OSes | **High**: multi-user, RBAC, SSO, HA, upgrades, air-gapped installs | **High**: multi-tenant service, auth, billing, data handling, security programme | **Low**: the MVP scorer + report template |
| Ongoing cost | Catalog maintenance, support | Catalog maintenance, OS packaging, support | Support contracts, CVE patching of the bundle, version matrix | Hosting, on-call, security, compliance expectations (SOC 2 is commonly expected by buyers; not priced here) | Gabriel's hours |
| Customer acquisition | GitHub, content, LEARN labs, word of mouth | Same, weaker (no free funnel unless a free tier exists) | Enterprise sales: long cycles, procurement | Product-led trial + sales | Gabriel's network, LinkedIn, referrals, consultancies |
| Security / trust | **Best**: credentials stay local | Good | Good (their infra) but you ship software into sensitive estates | **Hardest**: you hold their findings (a map of their weaknesses) | Requires temporary read-only access; NDA/DPA; trust is personal |
| Recurring-revenue potential | Medium | Low-medium (upgrade cycles) | High per customer, few customers | **Highest** if it works | Low unless retainers; capped by hours |
| Fit with existing code | **High** (local Node app, local creds) | Medium (no packaging today) | Low (single-user, loopback-only design) | Low today (no tenancy, no auth) | **High**: usable this month |
| Main risks | Free tier cannibalises; competitors' OSS is stronger | Commodity; piracy; small market | Solo vendor cannot carry enterprise support | Large build before demand; breach risk; competes head-on with funded SaaS | Doesn't scale; becomes "a contractor with a themed tool" |
| **Verdict** | **Second step** (after E proves pain) | Fold into A as packaging | **Not now** | **Not before 3+ paid pilots and an explicit team ask** | **First step** |

**Prerequisites before model D gets a second customer** *(from #85's scalable-options read)*: a published list of the fields a snapshot may contain (account IDs in hostnames and security-group IDs can be sensitive), a delete button for the customer's data, a visible off switch for the collector, and no Take down or `pulumi up` on the hosted side (the typed-name destroy stays local).

**Recommended combination: E → A (+ optional D later).** E earns money and evidence now with the code that exists. A turns repeated assessments into a product, *if* customers want to re-run scans themselves. D is earned, not assumed.

### 5.1 Why not a subscription first

Competitors charging subscriptions proves those buyers exist **for those products**. Cloud Spider has no user yet; a subscription needs (a) a recurring job, (b) a reason to come back weekly or monthly, (c) trust in a solo vendor. Readiness is **episodic** (pre-launch, pre-audit, post-incident, quarterly review). The recurring hooks are drift and regression ("did we get worse since last month?"), scheduled re-scans and evidence for audits. Those are hypotheses to test with pilot customers, not assumptions to build on.

---

## 6. Pricing unit and unit-cost model (hypotheses)

### 6.1 Pricing unit comparison

| Unit | Who uses it (fact, §2) | Fits Cloud Spider because | Fails because | Verdict |
|---|---|---|---|---|
| Per user/seat | Port ($30-40), Cortex, OpsLevel, Pulumi (older plans) | Simple; matches local licence | Penalises sharing the report; value is not per person | Avoid for core; maybe for Team UI |
| Per node / vCPU / host | Komodor (vCPU), ARMO, Fairwinds, Datadog, groundcover | Scales with cluster size | Punishes the target (small teams); Karpenter clusters fluctuate; local app can't meter honestly | Avoid |
| **Per cluster / per AWS account (scope)** | Prowler ($99/account/month) | **Matches the unit of assessment and of the scorecard**; easy to understand | Big accounts underpay; test clusters annoy | **Primary candidate** (e.g. "3 scopes included") |
| Per managed resource | Pulumi ($0.18-0.55/resource/month), Security Hub (per check) | Precise | Needs metering + hosted; customers fear bill surprises | Avoid |
| Per team / flat tier | Turbot Pipes Team ($49/3 users), Grafana Pro base | Simple for SMB | Fleet buyers underpay | Good for Pro/Team packaging |
| **Per assessment (project)** | Consultancies; AWS partners' WAF reviews | **Matches episodic need**; easy to buy | Not recurring | **Start here** |

**Hypothesis to test:** *flat tier with included scopes* (accounts + clusters) for software, *fixed-fee per assessment* for services. Ask every interviewee how they would expect to be billed.

### 6.2 Cost structure per customer (what the vendor pays)

| Cost | Local Pro (model A) | Hosted Team (model D) | Assessment (model E) |
|---|---|---|---|
| Infrastructure | ≈0 (scan runs on the customer's machine). Licence server + landing page: small fixed cost | Compute, database, object storage, backups, monitoring, at least two environments. Not estimated: depends on architecture; a minimal AWS footprint is tens of USD/month before any customer | ≈0 |
| Customer cloud API costs | Paid by the customer. Describe/List calls are generally free; CloudWatch `GetMetricData` and Cost Explorer API requests are billed per request (Cost Explorer: $0.01 per request ([AWS](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/))). Keep Cost Explorer on its existing cache | Same, plus egress of summaries (negligible) | Same |
| Storage of evidence | Customer disk (~MBs per scan, §11 of the spec) | Vendor: per-tenant evidence; retention obligations | Customer disk; deliverable report |
| AI inference | 0 if no model is added. If an LLM explanation feature is added, it should be BYO-key so the vendor pays nothing | Vendor pays unless BYO-key | Optional, Gabriel's own tools |
| Support | **Dominant cost.** Unknown hours per customer per month | Higher (uptime, onboarding) | Included in the fee |
| Security maintenance | Control catalog updates for AWS/K8s/OpenShift changes, dependency CVEs, signed releases | Plus vulnerability management of the service, pen tests, incident response | Personal laptop/access hygiene |
| Third-party licences | Dependencies are mostly Apache-2.0/MIT (AWS SDK, Pulumi SDK); fonts under OFL. **Trademarks** (Fallout, Pip-Boy, Vault-Tec) are not licensable for free: R6 | Same | Same |
| Payment processing | Stripe (CZ): 1.5% + CZK 6.50 for standard EEA cards; higher for UK/international cards ([stripe.com/en-cz/pricing](https://stripe.com/en-cz/pricing)) *(via search snippet)*; or Paddle as merchant of record: 5% + $0.50 incl. VAT handling ([paddle.com/pricing](https://www.paddle.com/pricing)) *(via search snippet)* | Same | Bank transfer, invoice |

### 6.3 Unit economics (illustrative, all inputs are hypotheses)

Let **R** = Gabriel's opportunity cost per hour (his contracting rate; not stated in the repo, so it stays a variable). The arithmetic below uses **R = €60/h as a placeholder only**; replace it with the real number.

Fixed monthly cost of keeping a paid product alive (catalog updates, releases, CVEs, landing page): hypothesis **8 h/month** → 8R.

| Tier (hypothesis) | Price/month | Payment fee (Paddle, worst case) | Support per customer (hypothesis) | Contribution per customer | Customers to cover 8R (R = €60 → €480) |
|---|---|---|---|---|---|
| Pro €39 | €39 | ≈ €2.40 | 0.5 h → €30 | ≈ €6.60 | **≈ 73** |
| Pro €39 | €39 | ≈ €2.40 | 0.1 h → €6 | ≈ €30.60 | ≈ 16 |
| Team €199 | €199 | ≈ €10.40 | 1 h → €60 | ≈ €128.60 | ≈ 4 (but a hosted Team tier adds infra and security costs not counted here) |

(Paddle fee: 5% of price + $0.50 ≈ €0.45 at an assumed rate of about 1.1 USD/EUR; the exchange rate is approximate.)

**What the model says:** at Pro prices, **support time per customer decides everything**. Self-serve Pro only works if the product is good enough that most customers never need Gabriel (documentation, permission self-check, clear UNKNOWN reasons). That is why the MVP spends effort on honest coverage messages and the permission self-check (spec §3 and §10.1), and why Pro should be sold after assessments have revealed the common support questions.

**Assessment economics:** an assessment priced at N days × day rate has positive margin by construction; the product's job is to **reduce N** (the scanner does the evidence collection and the report draft) while the price is anchored to the value of a launch going right, not to hours. A hypothesis to test: whether buyers accept a fixed price for a 3-5-day scoped engagement.

### 6.4 Alternative offers to test in interviews *(from #85)*

PR #85 and the earlier monetization notes it cites propose software-first offers. They are weaker as the *first* test (§15), but they are good **second questions** in interviews and good fallbacks if buyers refuse services. All are hypotheses; quote them in conversation, never on the website before someone has accepted or refused a spoken price.

| Offer | Price to say out loud | Unit | Anchor | When to use |
|---|---|---|---|---|
| **Self-serve local licence** ("the scorecard on your machine, catalog updates for a year") | **≈ €400/year** (≈ €33/month) | per AWS account, with a cluster cap (e.g. 3) | Lens Plus $300/year; inside the brief's €29-49/month band | After an assessment pilot ("would you rather run this yourselves?"), or when the buyer refuses to grant Gabriel access |
| Shared path diagnosis ("path year": the broken-hop sentence for every load balancer, opened by the on-call rotation, keys stay in their account) | ≈ $1,000/year | per account, up to 5 people | Between Hava ($59-249/month) and Komodor (enterprise) | Pivot test, if interviewees light up on path diagnosis rather than the score |
| One-time packaged licence | $79 once | per user | earlier monetization note | **Not recommended** (no recurring catalog maintenance funding); recorded so the idea is not lost |

Unit economics of the €400/year licence (same placeholder R = €60/h and 8R fixed as §6.3; annual billing cuts payment fees to ≈ €20.45/year via Paddle, ≈ €1.70/month):

| Support per customer per month (hypothesis) | Contribution per customer per month | Customers to cover €480/month |
|---|---|---|
| 0.1 h (€6) | ≈ €25.60 | ≈ 19 |
| 0.5 h (€30) | ≈ €1.60 | ≈ 300 (not viable) |

Same lesson as §6.3: a self-serve licence only works if the product answers its own support questions.

---

## 7. What exists, what is reusable, what is missing, what is long-term

Grounded in `main` at #84/#86 (files and PRs named). The design spec §1.1 has the module-level reuse table.

### 7.1 Already implemented (fact)

| Capability | Where | State |
|---|---|---|
| AWS inventory map: VPCs, subnets, instances, load balancers, target groups, EKS, cost panel, credits split | `src/aws.js`, `src/aws-arch.js`, `src/cost.js` | Working on a live account (live test, #86) |
| Request-path diagnosis: listener → rule → target group → target → node → cluster, first broken edge | `src/path-diagnose.js` | Working; stops at the cluster boundary (does not open Service/Pod) |
| Kubernetes reads, GET-only: nodes, pods, services, workloads, ingresses, HPAs, events, metrics, Kyverno policy reports | `src/kube.js`, `src/kube-health.js`, `src/kube-ops.js` | Working; multi-context (`src/kube-contexts.js`) but SLOs read the primary context only (drill finding 6) |
| Vaults (service ownership by tags) with SLOs: HTTP checks, ALB availability/latency, kube restarts; burn rate, budget lamps | `src/vaults.js`, `src/slo.js` | Working; ledger **in memory** (reset on restart); ALB latency SLI uses an average (drill finding 4); ALB 503 fix in #83 |
| Morning HURTING / IDLE-BILLED / CHANGED (CloudTrail) cards | `src/server.js`, `src/browser.js` | Working; HURTING missed "ALB with traffic and no targets" (drill finding 9) |
| Pulumi stacks and add-ons: preview/run/take-down with typed-name confirmation; add-on catalog with detect rules and dependency order | `src/upgrade.js`, `upgrades/`, `upgrades/addons/catalog.js` | 17 stacks/add-ons passed the live test after fixes #78-#82; CRDs left behind on uninstall; PVC volume orphan on teardown |
| Kyverno baseline policies (Audit) | `upgrades/addons/kyverno-policies.js` | Working |
| OpenShift | sample drawing in `src/cluster.js`, `upgrades/openshift` (CRC lab host), LEARN labs | **Lab only.** No OpenShift API reads |
| LEARN labs with setup/check | `src/learn*.js`, `learn/` | Working; checks use the current kube context (live-test finding: should pin a context) |
| Cloud-platform outage lab (separate product idea) | `docs/cloud-platform/`, `cloud-platform/` | Smoke test fails on org permissions boundary (expected) |
| Tests | `test/` | ~482 passing (PR #84) |

### 7.2 Reusable for the scorecard

`describeDiagram` (AWS facts), `diagnose` (path facts), kube `PATHS` and health classification, the SLO engine (runtime evidence), the add-on catalog's `detect` rules (ADOPT vs INSTALL), the typed-name destroy guard, the CloudTrail CHANGED reader, sample mode (offline demo data → fixtures).

### 7.3 Missing for a minimal commercial product

- Scorecard core: control catalog, evaluators, scorer, verdicts (spec §5-§6).
- Read-only **scanner identity** separate from the actor credentials, and a permission self-check (spec §10).
- Persistent history and diffs (`~/.cloudspider/`), persisted SLO ledger.
- Exportable neutral report (Markdown/HTML/JSON; PDF via print).
- **LICENSE** file (none in the repo today) and a decision on what is open vs paid.
- Trademark-neutral product naming and UI terms (R6).
- Packaging (today: `git clone` + `npm ci`), versioned releases.
- Customer-facing docs: what is read, what never leaves the machine, required IAM/RBAC.
- Commercial basics: offer page, contract/NDA template, invoice flow (no billing code needed for model E).

### 7.4 Long-term (not MVP)

OpenShift production profile on a real cluster, Pulumi remediation packs with verify, the ALB-503 correlator with confidence, Security Hub / Prowler / Kubescape importers, scheduled scans, fleet views, hosted control plane (opt-in summaries only), SSO/RBAC, multi-cloud.

---

## 8. MVP definition (deliverable 16) and the smallest recurring-revenue feature set

### 8.1 MVP: "readiness assessment kit" (what Gabriel can sell in ~60 days)

Scope is the spec's MVP column (§14-§15 of the design doc):

- **Scopes:** one AWS account (one or more regions) and one or more EKS clusters, read-only, from the user's machine.
- **Scanner identity:** documented read-only IAM policy (SecurityAudit + ViewOnlyAccess with data-plane denies) and kube RBAC (view + read of RBAC/CRDs/webhooks, no Secrets); permission self-check before scanning.
- **~35-40 controls** across AWS (identity, network exposure, encryption, logging, backups, multi-AZ, ALB/target health) and Kubernetes (pod security, probes, requests/limits, PDBs, replicas, HPA, network policy presence, add-on health, version skew).
- **Honest scoring:** PASS/FAIL/UNKNOWN/NOT_ASSESSED/NOT_APPLICABLE; coverage and unknown shares; gates; verdicts with no "READY" label; posture and runtime separate.
- **Runtime evidence** from existing SLOs (persisted), feeding the reliability category.
- **History and diff** between scans; "what changed" view.
- **Report export** (Markdown/HTML/JSON) in neutral styling, with the "not an official assessment / not a compliance attestation" statement.
- **Remediation guidance** per control (text + Pulumi/kubectl snippet), *no automatic apply* in the MVP.

Not in the MVP: OpenShift scoring (preview controls only), Pulumi packs that install things, the correlator, hosted anything, licensing code.

### 8.2 Smallest feature set that could earn recurring revenue

The recurring job is **"prove we did not regress and show progress"**. Minimal set:

1. Scheduled local re-scan (cron/launchd helper) with **diff against the last accepted baseline**.
2. **Exceptions with expiry** (accepted risks that come back when they expire).
3. **Trend report** per scope for the monthly stakeholder update.
4. Profile tuning (production vs dev) and multi-scope (3+ accounts/clusters).

Sold first as a **monthly re-assessment retainer** (Gabriel reviews the diff and the report with the customer), then as a **Pro licence** when customers want to self-serve. Both run locally; neither needs a hosted service.

---

## 9. Free vs paid matrix (deliverable 13)

Principle: **never paywall finding a critical problem.** Security and reliability findings, including critical ones, are free. Paid tiers sell continuity, scale, collaboration and convenience.

| Capability | Community (free, local) | Pro (local licence, hypothesis €29-49/mo) | Team (hypothesis €149-299/mo; hosted or self-hosted sharing) | Business (hypothesis €499-999+/mo) | Services |
|---|---|---|---|---|---|
| Discovery map, path diagnosis, cluster view, SLOs | ✓ | ✓ | ✓ | ✓ | |
| Manual scan, full control catalog, all findings incl. critical | ✓ | ✓ | ✓ | ✓ | |
| Coverage / unknowns / verdict | ✓ | ✓ | ✓ | ✓ | |
| Scopes | 1 account + 1 cluster | 3-5 scopes | 10-20 scopes | fleet | |
| JSON/Markdown export | ✓ | ✓ | ✓ | ✓ | |
| History, diffs, trends | last scan only | ✓ | ✓ | ✓ | |
| Scheduled scans | | ✓ | ✓ | ✓ | |
| Profiles (custom weights/gates), exceptions with expiry | | ✓ | ✓ | ✓ | |
| Branded HTML/PDF report | | ✓ | ✓ | ✓ (white-label) | |
| Pulumi remediation packs with preview + verify | guidance only | ✓ | ✓ | ✓ | |
| OpenShift profile | preview | ✓ | ✓ | ✓ | |
| Shared dashboards, roles, comments | | | ✓ | ✓ | |
| SSO, audit log, fleet views, API | | | | ✓ | |
| Support | community | email (best effort) | priority | contract | |
| Assessment / remediation / retainer | | | | | fixed fee / retainer |

The free tier is meant to be the funnel and the trust signal; it competes with Prowler/Kubescape at their own price (free) on honesty and cross-layer evidence, not on check count.

---

## 10. 30/60/90-day roadmap (deliverable 17)

Each phase ends at a decision gate. "Build" means only after Gabriel approves this strategy and the spec (§16).

| Phase | Business | Product | Gate at the end |
|---|---|---|---|
| **Days 0-14: listen, no new code** | Draft the offer page (§11 E1) without public prices. Book 10 interviews (E2). Pick 1-2 prospects for a **hand-delivered pilot assessment** using today's app + Prowler/kube-bench/Polaris output + a report template (E3). Add a LICENSE decision and drop trademarked names from public material (R6). | None beyond fixing drill findings already on `TODOS.md` if Gabriel wants (persisted SLO ledger, ALB latency percentile). | **Build gate:** ≥3 of the first interviews describe the readiness pain with a budget owner, **or** 1 pilot agreed at a price. Otherwise keep interviewing; do not build. |
| **Days 15-30: build the core** | Finish interviews. Quote 2-3 paid pilots (fixed fee). | Scorecard core: control catalog (AWS + EKS, ~35-40), scorer, verdicts, permission self-check, JSON/Markdown report (spec MVP slices 1-4). | Hand findings from the pilot = scanner findings on the same account (no misses on critical controls). |
| **Days 31-60: pilots** | Deliver 2-3 paid pilots with the tool. Ask each for a reference, a re-scan in 30 days, and what they would pay to do it themselves. | History + diff, persisted SLO evidence, HTML report, exceptions with expiry. OpenShift v0 (preview controls) **only if** an OpenShift prospect exists. First Pulumi pack with preview + verify (e.g. metrics-server or Kyverno audit) **only if** pilots asked for fixes. | ≥2 paid pilots completed; ≥1 asks for a repeat or retainer. |
| **Days 61-90: decide the recurring model** | Offer retainers to pilot customers; test a Pro licence price with 5 qualified users (E5). | Scheduled re-scan, trend report, licence packaging *only* for the chosen model. | GO (scale A/E), stay services-only, or stop (kill criteria §11.2). |

---

## 11. Monetization and validation experiments, kill criteria (deliverable 14)

### 11.1 Experiments

| # | Experiment | How | Success signal | Cost |
|---|---|---|---|---|
| E1 | **Landing page** | One page: positioning (§4), a sample redacted scorecard, "what we read / what never leaves your machine", a "Book a readiness assessment" form and a "Join the Pro waitlist" form. No public price at first; A/B the headline "production-ready with evidence" vs "find what will break before launch". Drive traffic with 3 LinkedIn posts + 1 technical write-up (the drill: "what Cloud Spider caught and missed in 7 faults"). | ≥5 assessment requests or ≥30 waitlist sign-ups from non-friends in 30 days (*hypothesis thresholds*) | ~1-2 days |
| E2 | **10 customer interviews** | S1/S2 people from Gabriel's network (platform leads, CTOs, consultancies). Mom-Test style: last time you prepared for production/audit, what did you do, how long, who paid, what tools; show the sample scorecard last. Ask about the billing unit. | ≥3 of 10 have the pain **and** a budget owner **and** a time-bound trigger (launch/audit) | ~10 h |
| E3 | **Paid assessment pilots** | Fixed-scope (one AWS account + one EKS cluster), fixed fee, 1-2 weeks, read-only access, deliverable = scorecard + remediation plan + 1 re-scan. First one may be hand-assembled. | ≥2 paid in 60 days; ≥1 asks for a repeat | Gabriel's time (paid) |
| E4 | **Disappearance / re-scan test** | 30 days after a pilot, offer the re-scan; ask "would you run this yourselves monthly?" | Retainer or self-serve interest from ≥1 of 3 | low |
| E5 | **Pro price test** | Offer a specific Pro price (€29 vs €49, per account) to 5 qualified waitlist users; disclose that the core is free. | ≥2 of 5 pay | low |
| E6 | **Consultancy channel** | Offer 2 DevOps consultancies a white-label report trial | 1 consultancy uses it on a client | low |
| E8 | **Hand scorecard** *(from #85)* | Before any scorecard code: write 10 findings by hand for one real AWS + EKS setup in the spec's finding shape (control, evidence, result, severity), **including at least one "could not see" (UNKNOWN)**. Show it to one engineer who runs an ALB in front of EKS; quote the assessment and the €400/year licence. Later, the scanner must reproduce the same 10 findings on the same account. | Pay or a specific request to run it again; the scanner matches the hand findings | a few hours |
| E9 | **Status-quo timing** *(from the earlier monetization notes, via #85)* | On the next real broken path or readiness question, time the console/kubectl/OSS-scanner route against Cloud Spider | Cloud Spider is clearly faster; if not, the wedge is false | low |
| E10 | **Clone test** *(same source)* | Tell the buyer the repo is public and free to clone. If they still pay, write down what they think they are buying (time, packaging, updates, expertise) | That sentence picks between services (E) and licence (A) | none |
| E11 | **Second-person test** *(same source)* | Ask whether anyone else on their team would open the report | "No" means: do not design seats or a Team tier | none |
| E7 | **OpenShift probe** | 3 conversations with OpenShift platform teams (EX280 network) | ≥1 wants an OpenShift assessment | low |

**Scoring every conversation** *(from #85)*: money moved = **pay**; a compliment = refuse; "send me a link when it exists" = refuse; no answer within 7 days = silence. Record one of pay/refuse/silence for each quote. Only "pay" counts toward the gates below.

**Distribution note** *(from #85)*: AWS Marketplace is a procurement channel for a product someone has already paid for, not a discovery channel. List there only after paying customers ask for it.

### 11.2 Kill / pivot criteria

- **Stop pursuing the product (keep the tool as a personal/LEARN asset):** after 10 interviews, fewer than 3 show pain + budget owner + trigger; **and** 0 paid pilots in 60 days.
- **Do not build the product** *(trigger from #85)*: interviewees say the AWS Well-Architected Tool plus Polaris/Kubescape (or Security Hub) already cover it and they will not pay for an assessment or a licence.
- **Pivot to services-only:** pilots sell but nobody wants to re-run the scan themselves (E4/E5 fail). Keep Cloud Spider as Gabriel's internal delivery tool.
- **Pivot the wedge:** interviewees ignore the scorecard and light up on one slice (path diagnosis / incident triage, cost hygiene, OpenShift upgrades, or LEARN labs). Sell that slice.
- **Do not build hosted (model D):** unless ≥3 paying customers explicitly ask for shared/team access and accept a hosted data flow.
- **Stop a free-tier strategy:** if the free scan gets no non-friend users in 90 days after a public launch.

---

## 12. Effort estimates (deliverable 18)

From the design spec §15 (estimates, no measured baseline; "AI-assisted" assumes Gabriel directing coding agents as on this repo, where PR numbers went from #1 to #84 in three days on a codebase the agents knew).

| Slice | Human-only (ideal days) | AI-assisted (days) |
|---|---|---|
| **MVP**: scorecard core, AWS + EKS controls (~35-40), scorer/verdicts, permission self-check, history, reports, UI view | ~42 | ~19-22 |
| **Next**: OpenShift profile on a real cluster, 2-3 Pulumi packs with verify, ALB-503 correlator, importers | ~37 | ~18-19 |
| **Later**: scheduled scans, licence packaging, Team sharing, hosted control plane | 40+ (hosted alone is a new product) | not estimated |
| Business tasks in 90 days: offer page, interviews, pilots, report template, contracts | ~10-15 days spread | – |

Note: Gabriel is a working contractor; calendar time is likely 1.5-2× the ideal days (same factor as the spec). The 90-day plan assumes ~50% of working time on Cloud Spider (an assumption to confirm).

---

## 13. Major business and technical risks (deliverable 19)

| # | Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **No demand at a price** (nice tool, nobody pays) | High | Fatal | VALIDATE FIRST; build gate; kill criteria §11.2 |
| R2 | **Free incumbents are "good enough"** (Prowler, Kubescape, Polaris, Security Hub, WA Tool) and funded ones bundle readiness (Datadog, Wiz, Port scorecards) | High | High | Don't compete on check count; compete on cross-layer evidence, honesty, OpenShift know-how, services; import their findings later |
| R3 | **False confidence**: a scorecard that says "fine" before an outage destroys trust and creates liability | Medium | High | No READY verdict; coverage/UNKNOWN shown; gates; "not an attestation" statement; contract liability cap for assessments |
| R4 | **Remediation write-risk**: a pack breaks a production cluster (e.g. duplicate monitoring on OpenShift, Kyverno enforce, CRD deletion) | Medium | High | Packs out of MVP; detect-ADOPT-first; preview + approval; protect CRDs; never replace OpenShift platform components (spec §9) |
| R5 | **Solo maintainer**: catalog maintenance (AWS/K8s/OCP change constantly), support, security patches, bus factor | High | High | Small curated catalog; quarterly catalog releases; services revenue funds maintenance; stop adding controls if nobody pays |
| R6 | **Trademarks**: "Pip-Boy", "Vault-Tec", "Fallout", "Nuka-Cola", "Stimpak", "Rad-Away" are Bethesda/ZeniMax marks used in UI and demo data; "Vault" also collides with HashiCorp Vault in this market | Medium (rises with commercial use) | High (forced rename after launch) | Rename user-facing terms before any public commercial launch; keep the generic retro-terminal style; get a trademark opinion (not legal advice here) |
| R7 | **No LICENSE**: public repo without a licence is "all rights reserved"; unclear for contributors and customers | Certain today | Medium | Choose a licence before marketing (e.g. Apache-2.0 for core, proprietary for Pro modules kept out of the public repo) |
| R8 | **Enterprise trust/procurement**: security questionnaires, DPA, SOC 2 expectations; read access to a customer account is a trust event | High (for D/C) | Medium-High | Stay local-first; read-only role with explicit denies; NDA/DPA templates; avoid hosted until needed |
| R9 | **Credential/blast-radius incident** on Gabriel's machine during an assessment | Low-Medium | High | Short-lived role assumption, separate scanner role, no secrets read, no data-plane reads, evidence redaction, per-customer encrypted workspace |
| R10 | **Scope creep / vision pull**: the "unified platform" vision eats time before validation (3 days → 84 PRs shows how fast scope grows) | High | High | Approval gates; NOT-in-scope list; one wedge |
| R11 | **AWS/K8s API cost and throttling** on large estates | Medium | Low-Medium | Pagination, bounded concurrency, caches, no Cost Explorer loops |
| R12 | **Standards misrepresentation**: citing CIS/Well-Architected/NIST read as certification | Medium | Medium | "Mapped to" language, control IDs listed, explicit disclaimer |
| R13 | **Income risk**: time on Cloud Spider reduces contracting income | Medium | Medium | Services-first wedge earns during validation; time box |

| R14 | **UNKNOWN treated as PASS** in code (a denied read or empty list scored as healthy) *(from #85)* | Medium | High (silent false-ready) | Ship-blocking bug class: result enum, empty-list rule, stub controls, property tests (spec §5.3, §6.1, §16) |
| R15 | **Destructive actions reachable remotely** (Take down / `pulumi up` exposed via a hosted button) *(from #85)* | Low (only if D is built) | High | Typed-name destroy and applies stay local; hosted side is read-only by design (spec §10.5) |
| R16 | **Blind support for a local app**: no telemetry, so a broken AWS SDK or API change is found when a customer emails *(from #85's scalable-options read)* | Medium | Medium | Opt-in anonymous health ping (off by default) or a `doctor` report users can attach; the permission self-check output doubles as a support bundle |

**Top 5:** R1, R2, R3, R5, R6. In #85's words on R5: rule maintenance is the only reason an annual fee can exist; if nobody pays it, stop adding controls.

---

## 14. Recommendation: GO / VALIDATE FIRST / PIVOT (deliverable 20)

**VALIDATE FIRST.**

- **Not GO:** zero users, zero payment, commodity check content, strong free and funded competitors, solo capacity. Building a subscription platform now would be building on a guess.
- **Not PIVOT:** the existing assets (cross-layer AWS ↔ EKS ↔ SLO evidence, honest scoring design, Pulumi deploy path, OpenShift knowledge, a real drill showing detection in 18-97 s for pod faults and 5-10 min for ALB SLOs) are a credible base for a narrow, sellable wedge. There is no evidence yet that another direction is better.
- **The bet:** "production-readiness assessment for AWS + EKS (OpenShift next), with evidence", sold as services first (model E), productised as a local Pro tier (model A) if pilots ask to self-serve. Hosted (D) only on explicit demand.
- **Decision date:** day 60 (paid pilots) and day 90 (recurring model), per §11.2.

---

## 15. Opposing view

**Source.** Gabriel's terminal agent wrote a parallel strategy on branch **`docs/platform-readiness-strategy`** (PR #85, "Record the platform strategy and local scorecard spec", commit 570aa3f, 2026-10-11 14:04 CEST, based on #82). It contains `docs/business/cloud-spider-platform-strategy.md`, `docs/business/monetization-strategy.md`, `docs/business/scalable-business-options.md`, `docs/design/production-readiness-scorecard.md`, `docs/superpowers/plans/2026-10-11-production-readiness-scorecard.md` and a `TODOS.md` section. **#85 was merged to `main` at 14:18 CEST (merge commit c504e67)**; Gabriel then chose this PR (#87) as the base. Merging #87 replaces #85's versions of `docs/business/cloud-spider-platform-strategy.md` and `docs/design/production-readiness-scorecard.md`. #85's other files stay on `main`: `monetization-strategy.md`, `scalable-business-options.md`, the plan and the `TODOS.md` section. This document supersedes them where they differ, and each now carries a "Superseded" note pointing here. Its branch is kept, so the permalinks to 570aa3f stay valid. Credit to #85 for the items marked *(from #85)* throughout both documents.

### Where both documents already agreed

- **VALIDATE FIRST**, because the "one platform" sentence describes several funded categories, competitors' subscriptions are not evidence of demand for Cloud Spider, and there is no second user.
- **Wedge:** a local, read-only production-readiness scorecard for one AWS account plus EKS. OpenShift is specified but not built until a real cluster is connected. No hosted control plane in 90 days, and the scorer installs nothing.
- **Honesty mechanics:** a missing permission never passes. Low coverage gives INSUFFICIENT_EVIDENCE, a critical gate cannot be hidden by the average, and failures are listed even when there is no overall number. Neither document claims certification.
- **Free vs paid:** essential security findings are never paywalled. History, schedules, a second person and reports are the paid hooks.
- **Process:** nothing is implemented until Gabriel approves, and a written plan does not authorise coding.

### Adopted from #85

| What | Where it landed | Why it is better than what #87 had |
|---|---|---|
| **Self-serve local licence at about €400/year** per account with a cluster cap, as an alternative or later offer to quote in interviews. Also the "path year" (~$1,000/account/year) as a pivot offer, and the $79 one-time idea recorded as not recommended | Strategy §6.4, TL;DR, §16 | It gives interviews a concrete software price next to the assessment, anchored on Lens Plus ($300/year) |
| **Hand scorecard** before code: 10 findings by hand including one "could not see", and later the scanner must reproduce them | §11 E8, §10 gate | It is the cheapest test of whether the findings matter, and it becomes an acceptance test for the scanner |
| **Conversation scoring:** compliment = refuse, "send me a link" = refuse, 7 days of no answer = silence, money moved = pay | §11.1 | It stops polite interest from counting as demand |
| Earlier-notes experiments: **status-quo timing, clone test, second-person test** | §11 E9-E11 | They test speed, what people actually pay for, and whether seats are needed |
| **"Do not build" trigger:** Well-Architected Tool plus Polaris/Kubescape is enough and nobody pays | §11.2 | It is a sharper stop rule than #87's numeric thresholds alone |
| AWS Marketplace only after someone has paid | §11.1 | Avoids premature channel work |
| Hosted prerequisites: snapshot field list, delete button, collector off switch, no destructive actions on the hosted side | §5 | These are concrete preconditions for model D |
| Competitors **Hava, Lens, Cloudcraft** (Hava and Lens re-verified on the vendor pages today) | §2.1 | They cover the "picture" and "local K8s tool" price anchors #87 lacked |
| Risks: **UNKNOWN coded as PASS** (ship-blocking), **remote destructive buttons**, **blind support without telemetry**, and "maintenance is the only reason for an annual fee" | §13 R14-R16, R5 note | All three were real gaps in #87's risk table |
| Spec: **stub controls with `blockedBy`** so coverage counts what is not built | Spec §5.3 | Coverage is honest from the first release |
| Spec: **control-count floors** (overall needs at least 8 assessed controls, a category at least 3) on top of the weight coverage | Spec §6.4-§6.5 | Stops one heavy control from faking coverage |
| Spec: **empty-list rule** (empty is never a PASS unless declared; zero LBs make ALB controls N/A) | Spec §6.1 | It closes a subtle false-pass path |
| Spec: **"never show the number without the verdict"**, first-screen order (verdict, coverage, score), and **partial-error / stale (>24 h) states** | Spec §6.5, §13.2 | Clear UX rules that can be tested |
| Spec: **unset environment defaults to the production profile** and says so | Spec §7 | Fails safe |
| Spec: controls **world-open admin ports incl. 10250 (kubelet)**, **LB with listeners and zero healthy targets**, **EKS not ACTIVE**, **path-stops-before-pod (informational)**, **HPA without metrics API**, **Kyverno policy failures**, **public admin Route (OCP)**, **etcd backup never PASS from a viewer** | Spec §5.3 | Cheap, high-signal checks using inputs that already exist (verified in `src/`) |
| Spec: **new kube GET paths (NetworkPolicy, PDB, ResourceQuota…) each as its own reviewable task**. #85's observation that `PATHS` lacks them was verified in `src/kube.js` | Spec §5.3, §16 | Keeps read-scope growth reviewable |
| Spec: **OpenShift detected only by a live `ClusterVersion` GET**, and a sample drawing is never scored | Spec §4.4 | Prevents scoring a drawing |
| Spec: **do not recommend what detect already finds** (no "install Kyverno" when it runs, no metrics stack beside healthy OpenShift monitoring) | Spec §9.4 | It removes a class of bad advice |
| Spec: evidence files mode **0600** | Spec §11.2 | Small hardening |
| Plan: **task order** (pure score maths under TDD first, then AWS facts, Kubernetes facts, report) | §16 step 3 | A sound first slice for `writing-plans` |
| #85's 7 eng-review findings, each checked against the spec | Spec Appendix A | They serve as the outside voice |

### Rejected from #85, and why

| #85 position | Why it was not adopted |
|---|---|
| "Not in the repo: … SLOs, burn rates"; SLO burn rates out of v1; "SLOs are not computed" | **Factually wrong.** `src/slo.js` and the vault SLOs exist on #85's own base (#82). The drill (#86) shows the SLO burn caught every hard outage. Runtime evidence stays in the MVP, together with the fixes it needs: a persisted ledger and percentile latency. |
| The first thing to sell is **€400/year for the local report to one engineer** | Kept as the *alternative* offer (§6.4), not the first test. The buyer of readiness is a platform lead or CTO with a launch at stake. A fixed-fee assessment tests pain, budget and trust at a realistic price, pays for Gabriel's time, and surfaces the support questions the licence would otherwise drown in (§6.3). |
| **No code for 30 days** | Shortened to 14 days plus a build gate (§10). A credible second pilot needs a repeatable scan within weeks. |
| **403 or 404 → NOT_ASSESSED** | A denied read is UNKNOWN ("grant this read"). A CRD 404 means the add-on is absent, which the relevant control evaluates. Folding both into NOT_ASSESSED would hide a missing policy engine and blur the user's next step (spec §6.1). |
| Verdict labels **NOT_READY / READY_WITH_RISK / NO_OPEN_HIGH**; a single coverage floor of 0.60 | Any label containing "READY" will be quoted as approval in a launch meeting. Production keeps a 70 % floor (40 % dev/sandbox). The 8-control floor *was* adopted. |
| Weights 21/8/3/1 | #87's 40/15/5/2 has the same intent (one critical outweighs many lows) and comes with worked examples. Switching would change every example for no gain. |
| Pricing anchored on viewers only (Lens $25, Hava $59) | Both are now in the competitor table, but readiness is priced against posture and IDP tools (Prowler $99/account, Pulumi $40-400, Port $30-40/seat) and per-assessment fees. |
| A third business file (`monetization-strategy.md`) and a separate `scalable-business-options.md` | Not duplicated here. Both are now on `main` via #85, and this document supersedes them where they differ. Both now carry a "Superseded" note pointing here (§17 question 9, resolved). Their $79 one-time licence and $300/user/year ideas are recorded in §6.4 (the €400/year per-account licence supersedes the latter). |
| `TODOS.md` "deferred" section | Left as merged by #85 (it is consistent with this document's NOT in scope list in Appendix B and spec §14 "Later"). |
| No trademark risk | Kept as R6. Bethesda marks in the UI and demo data are a concrete risk for a commercial launch. |

Net: the two strategies differed mainly in emphasis. #85 was more disciplined about not writing code and sharper on experiment hygiene and false-pass edge cases. #87 is more explicit about services-first revenue, runtime evidence and naming risk. This document now carries both.

---

## 16. Proposed Superpowers workflow (gated on approval)

**Nothing below starts until Gabriel explicitly approves (1) this strategy and (2) the MVP scope in the design spec.** Approval of this PR's merge is not approval to implement. 

1. **Decision meeting (Gabriel):** confirm the VALIDATE FIRST wedge, model sequence (E → A, with the €400/year licence as the alternative to test), MVP scope and verdict semantics. (Base already chosen: this PR. #85 is already merged, and merging this PR replaces its two shared files.)
2. **`brainstorming` (done for the design):** `docs/design/production-readiness-scorecard.md` is the approved-pending design. Re-run only for sections Gabriel changes.
3. **`writing-plans`:** reuse #85's task order where it fits this spec (pure score maths first under TDD, then AWS facts, then Kubernetes facts, then the JSON/Markdown report; plan at [`docs/superpowers/plans/2026-10-11-production-readiness-scorecard.md` @570aa3f](https://github.com/gabdzo/cloud_spider/blob/570aa3f/docs/superpowers/plans/2026-10-11-production-readiness-scorecard.md)), and turn the MVP slices (spec §14-§15) into a plan under `docs/superpowers/plans/` with bite-sized tasks, exact files (`src/score/…`), tests first, and a commit per task. One plan for the scorecard core; separate later plans for OpenShift, packs and the correlator.
4. **Plan review:** `/plan-eng-review` on the written plan (complexity gate, test diagram, failure modes); fix before execution.
5. **`subagent-driven-development`:** one fresh subagent per task, spec-compliance review then code-quality review after each task; `test-driven-development` inside each task; no AWS writes by agents (house rule); Gabriel runs any `pulumi up`.
6. **Review / QA / ship:** `requesting-code-review` per PR, `/qa` on the UI view with sample data and a live read-only scan, `verification-before-completion` (tests + a real scan showing UNKNOWN for a denied permission), `finishing-a-development-branch` → PR. Gabriel merges.
7. **Pilot feedback loop:** after each pilot, update controls/weights and record changes in the catalog version (spec §6.9).

---

## 17. Open questions for Gabriel

1. How much of your working time can go to Cloud Spider in the next 90 days, and what is your hourly/day rate (for the unit-cost model, R)?
2. Who are the first 10 interviewees, and do you have 1-2 prospects who would pay for an assessment now?
3. Which wedge first: EKS+AWS only, or do you have an OpenShift prospect that justifies OpenShift in the first 60 days?
4. Are you willing to rename the Fallout/Pip-Boy/Vault terms before any commercial launch?
5. What licence for the public repo (Apache-2.0 core + closed Pro modules, or source-available)?
6. Is a fixed-fee assessment something you can contract as a Czech sole trader (liability cap, NDA/DPA templates)? (Not legal advice; ask your accountant/lawyer.)
7. Do you accept the verdict semantics in §15 (UNKNOWN vs NOT_ASSESSED, no READY label, 70 %/40 % coverage floors plus the 8-control floor adopted from #85)?
8. Should drill findings 4-9 (ALB latency percentile, metrics refresh for vaults, multi-context SLOs, LBC tag override, persisted ledger, HURTING with no targets) be fixed before any pilot? I recommend 4, 6 and the persisted ledger.
9. ~~`monetization-strategy.md` and `scalable-business-options.md` are on `main` via #85: keep them with a "superseded" note, or remove them?~~ **Resolved (2026-10-11):** both are kept, each with a "Superseded" note at the top pointing to this document. Their content is unchanged.

---

## 18. Sources

All accessed 2026-10-11. "Search snippet" means the figure was read from the search engine's extract of that page, not from a direct fetch.

**Competitors and pricing**
- Prowler pricing: https://prowler.com/pricing (fetched)
- Port pricing: https://www.port.io/pricing (fetched)
- Pulumi pricing: https://www.pulumi.com/pricing/ (fetched)
- groundcover pricing: https://www.groundcover.com/pricing (fetched)
- Robusta pricing: https://home.robusta.dev/pricing (fetched; quote only)
- Komodor pricing: https://komodor.com/platform/pricing-and-plans/ (search snippet); AWS Marketplace listing: https://aws.amazon.com/marketplace/pp/prodview-d32vxllvsjbj6 (search snippet, unverified)
- Grafana Cloud pricing: https://grafana.com/pricing/ (search snippet)
- Datadog list pricing: https://www.datadoghq.com/pricing/list/ (search snippet)
- ARMO pricing: https://www.armosec.io/pricing/ (search snippet); AWS Marketplace: https://aws.amazon.com/marketplace/pp/prodview-vudcbfxavxlrg (unverified)
- Polaris: https://github.com/FairwindsOps/polaris
- Fairwinds Insights pricing: https://www.fairwinds.com/insights-pricing (search snippet); AWS Marketplace: https://aws.amazon.com/marketplace/pp/prodview-4ljk3j5iko7os (unverified)
- AWS Security Hub CSPM pricing: https://aws.amazon.com/security-hub/cspm/pricing/ (search snippet)
- AWS Well-Architected Tool pricing: https://aws.amazon.com/well-architected-tool/pricing/ (search snippet)
- AWS Cost Explorer pricing: https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/ (search snippet)
- Wiz AWS Marketplace: https://aws.amazon.com/marketplace/pp/prodview-ibgbkrqusncsm (unverified)
- Orca AWS Marketplace: https://aws.amazon.com/marketplace/pp/prodview-rogbt2k4b63xc (unverified)
- Turbot Pipes billing: https://turbot.com/pipes/docs/accounts/developer/billing ; AWS Marketplace: https://aws.amazon.com/marketplace/pp/prodview-b3dfz5hxhcn3a (search snippet)
- kube-bench: https://github.com/aquasecurity/kube-bench
- Cortex AWS Marketplace: https://aws.amazon.com/marketplace/pp/prodview-x56oxtx647o3c (unverified)
- OpsLevel pricing: https://www.opslevel.com/pricing (unverified)
- Spotify Portal/Soundcheck AWS Marketplace: https://aws.amazon.com/marketplace/pp/prodview-vtgmheqo275xc (unverified)

- Hava pricing: https://www.hava.io/pricing (fetched)
- Lens pricing: https://www.lenshq.io/pricing (fetched)
- Cloudcraft: included with Datadog per PR #85 (not re-checked)

**PR #85 (merged to `main` as c504e67; superseded by this PR for the two shared files; branch kept)**
- Strategy: https://github.com/gabdzo/cloud_spider/blob/570aa3f/docs/business/cloud-spider-platform-strategy.md
- Monetization notes: https://github.com/gabdzo/cloud_spider/blob/570aa3f/docs/business/monetization-strategy.md
- Scalable options: https://github.com/gabdzo/cloud_spider/blob/570aa3f/docs/business/scalable-business-options.md
- Spec: https://github.com/gabdzo/cloud_spider/blob/570aa3f/docs/design/production-readiness-scorecard.md
- Plan (not approved): https://github.com/gabdzo/cloud_spider/blob/570aa3f/docs/superpowers/plans/2026-10-11-production-readiness-scorecard.md

**Payments**
- Stripe CZ pricing: https://stripe.com/en-cz/pricing (search snippet)
- Paddle pricing: https://www.paddle.com/pricing (search snippet)

**Standards** (cited for control mapping in the spec; no compliance or certification is claimed): see the design spec §18 (AWS Well-Architected reliability/security pillars, AWS Security Hub controls reference, CIS Benchmarks (Amazon EKS, Kubernetes), Kubernetes Pod Security Standards, NSA/CISA Kubernetes Hardening Guidance, Google SRE Workbook, OpenShift Container Platform 4.19 documentation).

**Repo evidence:** `docs/live-test-2026-10-11.md`, `docs/disaster-drill-2026-10-11.md` (#86), PRs #78-#84, `spider-shots` branch `drill/` and `livetest/`, PR #85 (terminal agent, merged as c504e67, superseded for the shared files).

---

## Appendix A: gstack /office-hours record

Mode: **Startup** (the brief asks about a business). Headless: the six forcing questions were answered from the repo and brief; each answer is marked by its evidence level.

| Forcing question | Answer | Evidence |
|---|---|---|
| Q1 Demand reality: strongest evidence someone wants this? | **None external.** Gabriel's own use and the drill. "Interest" in the brief is the founder's. | No users, no payments, repo 3 days old |
| Q2 Status quo: what do they do now? | Contractors/platform teams combine Security Hub, Trusted Advisor, Prowler/kube-bench/Polaris, console clicking and a hand-written report; WA Tool questionnaire | §3.3; public tools |
| Q3 Desperate specificity: who exactly? | Hypothesis: Head of Platform at a 10-200-engineer AWS+EKS company before a launch/audit; or an OpenShift platform lead before an upgrade. **Not yet a named person.** | §3.2 |
| Q4 Narrowest wedge: smallest thing someone pays for this week? | A fixed-scope readiness assessment of one AWS account + one EKS cluster, delivered by Gabriel with today's tool and OSS scanners | §8, §11 E3 |
| Q5 Observation: have you watched someone use it without help? | **No.** Only the founder and agents. | – |
| Q6 Future-fit: more or less essential in 3 years? | More: more clusters, more compliance pressure, AI-generated infra needing verification. But incumbents will also bundle readiness; the differentiator must be evidence quality and trust, not checks. | Judgment |

**Premises (agreed headless, recommended option):**
1. The buyable problem is "show me, with evidence, whether we're ready, and what we couldn't check". (Agree, pending interviews.)
2. Readiness is episodic; recurrence must be earned via regression tracking. (Agree.)
3. Local-first is a selling point for trust, and a constraint for team features. (Agree.)
4. Services first is acceptable for a contractor and not a failure of the product vision. (Agree.)

**Alternatives considered:**
- *Minimal:* services-only assessments with existing tools and a template; no new code.
- *Recommended:* assessment + local scorecard MVP (this document).
- *Ideal (12 months+):* local scanners + optional hosted control plane, packs with verify, OpenShift, correlator, fleet views.
- *Lateral:* sell the LEARN labs (EKS/OpenShift training) instead; kept as a pivot option (§11.2).

**The assignment:** before any scorecard code, write the names of 10 people who match S1/S2 and book 5 calls this week. Ask about the last production-readiness or audit push: what they did, how long it took, who paid. Do not show the tool until the end.

---

## Appendix B: gstack /plan-ceo-review record

Mode chosen: **SCOPE REDUCTION** (the full vision touches far more than 15 files and several new services; recommended option taken). Depth: strategy-level.

**Step 0.**
- *Premise challenge:* "One platform to assess, deploy, secure, observe and operate" is not a problem statement; it is a category list. **Reframed** to "evidence-backed production readiness for AWS + EKS/OpenShift".
- *Existing-code leverage:* high; ~70% of the evidence collection exists (§7.2). The scorecard is mostly rules, scoring and reporting over existing readers.
- *Dream state:* `today: local console for one operator` → `this plan: honest readiness kit used in paid assessments` → `12 months: local Pro + optional team sharing, packs with verify, OpenShift profile, used by consultancies`.
- *Alternatives:* (A) build the platform; (B) assessment-led wedge (chosen); (C) services only, no product work; (D) training/LEARN business.

**Critical challenges and verdicts**

| Challenge | Verdict |
|---|---|
| "Competitors charge subscriptions, so we should" | **Rejected.** Subscription must be earned by a recurring job (§5.1). |
| "Unified platform is the differentiator" | **Rejected for launch.** It is the reason to lose to incumbents; keep as 12-month ideal. |
| "Hosted SaaS for teams" | **Deferred** behind ≥3 paid pilots asking for it (security + on-call cost for a solo vendor). |
| "OpenShift in MVP" | **Deferred** to a prospect-driven v0; no real OCP API reads exist yet. |
| "Pulumi packs that install the platform stack" | **Deferred**; write-risk; detect-first; never duplicate OpenShift monitoring. |
| "Score out of 100" | **Accepted with guards**: coverage, UNKNOWN, gates, no READY label, separate runtime. |
| "Pip-Boy theme as brand" | **Challenged**: keep the style, drop the marks (R6). |
| "Free tier includes critical findings" | **Accepted**: trust over paywall. |

**Review sections (strategy-level summary):** architecture OK as a separate `src/score/` core; error/rescue map in spec Appendix A; security: separate scanner identity, no secrets, local-only; data flow: evidence stays local, hosted = opt-in summaries only; tests: fixtures + property tests; observability: scan health and coverage reported; deployment: unchanged until approval; long-term: catalog maintenance is the cost centre.

**Error & rescue (business):** no interviews booked → use LinkedIn + consultancies; pilots stall on access → offer a self-run scan with read-only role and a review call; pilot finds nothing → report coverage and recommend runtime evidence (SLOs), still valuable; customer asks for writes → packs only with preview + their approval.

**NOT in scope:** hosted control plane, multi-cloud, SSO/RBAC, billing code, automatic remediation, compliance claims, enterprise sales.

**What already exists:** §7.1.

**Verdict:** **VALIDATE FIRST, SCOPE REDUCTION accepted.** Approve the strategy for experiments; approve implementation only after the build gate (§10) and Gabriel's explicit sign-off.
