# Decision log

Format for every durable decision: decision, evidence, assumptions, confidence, what would invalidate it, next experiment.

## 2026-10-06 — Validate, do not build a company yet

**Decision.** Treat the commercial platform as unvalidated. Build a personal AWS lab loop. Do not build a SaaS product, a second cloud, or a certification business.

**Evidence.**

- Paid hands-on labs exist at low individual prices and at enterprise contracts. SadServers Business is $245/month. Instruqt is cited near $15 per environment-hour at the published minimum. Sources and caveats are in [COMPETITORS.md](COMPETITORS.md).
- Live broken-infrastructure interviews are already a product category: SadServers, Kompanion, EasyEnv, Parium, TrueAbility.
- AWS SOA-C03 and SAA-C03 are knowledge exams. SOA-C02's labs were removed on 29 September 2025. CKA is performance-based and ships with killer.sh.
- AI interview policy is split by company and by round (Sonar, Convex, Applied Intuition, and reported Google and Cisco restrictions). That supports live follow-up as a hypothesis. It is not demand.
- No buyer has been interviewed yet. The repo had no prior research.

**Assumptions.**

- You do not already hold SOA-C03 or SAA-C03.
- Your reachable buyers are engineering managers and consultancies you can email, including in Czechia and Slovakia. Reachable is not the same as a market.
- One sandbox account is enough isolation until a second human receives credentials.
- Dollar prices from secondary articles (KodeKloud, HackerRank, Karat, Instruqt) may be stale. Primary pages were used where they rendered.

**Confidence.** Medium on the competitive map. Low on willingness to pay. High on "do not build the platform this month."

**What would invalidate this.**

- Five or more upcoming conversations where the pain shows up unprompted, three people willing to try a lab, and one willing to use it for real or pay. That moves the verdict to a manual pilot, still not to a product build. Gate text is in [VALIDATION_PLAN.md](VALIDATION_PLAN.md).
- A discovery that EasyEnv or SadServers already covers every buyer you can reach, and they are happy. That kills the company track earlier than the 30-day gate.

**Next experiment.** Ten discovery notes this week. Sandbox account with MFA and a budget. Lab 1 only after both exist.

## 2026-10-06 — Customer Zero architecture is one sandbox account (superseded by "Organizations now", same day)

**Decision.** Dedicated account, `eu-central-1`, permission boundary, budgets, no Organizations, no account pool.

**Evidence.** You are the only user. Shared-account isolation is the wrong boundary for strangers, and there are no strangers yet. Skillable documents the operational cost of shared subscriptions.

**Assumptions.** A budget action can attach a deny policy, and you will test it. Instance-type and region denies are expressible in a permission boundary. Both get corrected when the account exists if AWS rejects the policy.

**Confidence.** High for a solo sandbox. Low as a design for paying customers.

**What would invalidate this.** A second person needs credentials, or a security reviewer refuses any credential you issue. Response is a separate account or bring-your-own-account, chosen then, not designed now.

**Next experiment.** Create the account. Apply nothing until the budget alarm is confirmed.

## 2026-10-06 — First certificate is SOA-C03, not a tour of every vendor

**Decision.** CloudOps Associate, then CKA on local Kubernetes. Azure, GCP, and OpenShift wait.

**Evidence.** SOA-C03 domains match the labs. The exam will not grade those labs. SAA-C03 is more famous and less operational. killer.sh removes the commercial reason to build CKA content.

**Assumptions.** You want operations skill more than the Solutions Architect brand. Conversations may overturn that if hiring managers only recognize SAA.

**Confidence.** Medium.

**What would invalidate this.** You already hold the cert, or discovery shows SAA is the credential your network hires for and CloudOps is invisible.

**Next experiment.** None until milestone 1 is done. The exam date waits until you can explain the labs.

## 2026-10-06 — Milestone 1 is the sealed outage loop

Design: [milestone 1 spec](docs/superpowers/specs/2026-10-06-sealed-outage-loop-design.md).

**Decision.** One scenario, `aws-web-unreachable-001`. The CLI builds a healthy baseline, proves it passes, injects one of several hidden causes with boto3, and proves validation fails. Validation is outcome plus hygiene guards, pass/fail, no score. The agent authors the scenarios and you solve them, under a spoiler-free working agreement.

**Evidence.** A lab you wrote yourself teaches authoring, not diagnosis. Proving the baseline before injecting is the cheapest defence against a checker coupled to the answer.

**Assumptions.** You can stay out of spoiler files. EC2 honours `aws:ResourceTag` conditions for the SG, route, and NACL mutations the solver needs.

**Confidence.** Medium-high.

**What would invalidate this.** You read the spoilers anyway, or tag-scoped solver permissions turn out not to work, in which case the solver policy changes, not the model.

**Next experiment.** Three solves, at least two distinct causes.

## 2026-10-06 — Organizations now, superseding "no Organizations"

**Decision.** An empty management account plus a `labs-sandbox` member account in a `labs` OU. SCPs for region, services, and instance types. IAM Identity Center, no IAM users. A €20 monthly budget, €10 alert, and a €20 budget action that attaches a deny-spend SCP.

**Evidence.** The main threat is self-inflicted cost. A permission boundary on your own admin role is removable by you. An SCP is not removable from inside the member account. Organizations is free. It is also the structure future one-account-per-run B2B needs.

**Assumptions.** The budget action can apply an SCP to an OU, and it fires within hours, not minutes.

**Confidence.** High.

**What would invalidate this.** SCP setup blocks Pulumi in ways the exemptions can't fix.

**Next experiment.** Test-fire the budget action once, and try a denied instance type and a denied region from `LabOperator`.

## 2026-10-06 — Pulumi (Python) instead of Terraform

**Decision.** Pulumi with a local file backend. Python for the CLI, fault injectors, and validators too.

**Evidence.** One language across the whole loop. Terragrunt solves multi-stack DRY that one stack per run doesn't need. OpenTofu is the fallback if HCL is ever wanted.

**Assumptions.** Subprocess calls to the `pulumi` binary are enough without the Automation API.

**Confidence.** Medium. It is partly a learning choice.

**What would invalidate this.** Pulumi state or provider issues cost more time than they teach.

**Next experiment.** The first `lab up` and `lab down` cycle.

## 2026-10-06 — Documentation set is twelve files, not twenty-one (superseded by "Artifact set extended for the 13-phase validation project", same day)

**Decision.** Write only documents that hold a decision. Do not create empty shells for pricing, a financial model, outreach, security, a scenario library, interview logs, a separate vision, or a separate learning roadmap.

**Evidence.** Empty files become fake certainty. Pricing and interviews do not exist yet.

**Assumptions.** Future sessions will read this log before adding a file.

**Confidence.** High.

**What would invalidate this.** A real price quote, a real interview note, or a second human in the AWS account. Then add `PRICING.md`, `CUSTOMER_INTERVIEWS.md`, or `SECURITY.md` respectively, with content.

**Next experiment.** The first conversation creates `CUSTOMER_INTERVIEWS.md`. The list of 15 names creates `OUTREACH.md`.

## 2026-10-07 — Phase 2: the hiring problem is real and too small to build for

**Decision.** Keep the verdict at VALIDATE. Do not add scenarios, a dashboard, or a training product. The next commercial step is conversations, and the offer to test is a single paid or unpaid interview lab, not a subscription.

**Evidence.** [research/phase-2/problem-validation.md](research/phase-2/problem-validation.md).

- Public interview writeups are DIY: about 2 hours, sometimes 30 minutes, sometimes a conversation with no lab.
- Free Kubernetes break-fix repos and local `kind` games exist.
- Ashby: 24.7 interviewer-hours per engineering hire. A lab replaces one afternoon, not the whole loop.
- No survey of DevOps hires per year. Staffing ratios imply roughly one platform hire a year at an 80-engineer company. Labeled an estimate.
- Catchpoint SRE Report 2026, n=418: 17% run production chaos regularly, 34% never. Uptime Labs already sells the simulated version of the drill.
- Usable bad-hire number remains CareerBuilder 2017, $14,900, with the usual caveats. The DOL 30% line stays banned.

**Assumptions.** The Reddit and YC posts are not a weird sample. The 1:15 staffing ratio times 20% turnover is in the right order of magnitude. Catchpoint's sample (largest share North America) still describes European teams well enough to not bet the company on game-day frequency.

**Confidence.** Medium that hiring volume will not support a subscription. Low on the exact interview count, because no buyer has spoken. High that more software does not answer this.

**What would invalidate this.** Three reachable buyers who each ran more than one DevOps or SRE interview a month, who can name a VM-level screen that missed an AWS failure, and who will put a candidate in a lab or name a fee.

**Next experiment.** A list of 15 names and 10 notes. Phase 7. Not another research pass.

## 2026-10-06 — Phase 1: no clear product gap; the opening is narrower than assumed

**Decision.** Drop "real AWS account interview" as the differentiator. The commercial hypothesis is now: vendor-built, multi-fault AWS break-fix scenarios for hiring, plus team drills, sold to mid-market EU AWS shops, priced under CloudLabs and above HackerRank's generic library. Services-led first, not self-serve SaaS. Detail in [MARKET_RESEARCH.md](MARKET_RESEARCH.md).

**Evidence.**

- HackerRank already gives each candidate a temporary real AWS or Azure account with automatic scoring. EasyEnv, CloudLabs, TrueAbility and Kompanion also touch real cloud. See [COMPETITORS.md](COMPETITORS.md).
- Every vendor offering custom scenarios builds them as a service. No source shows a buyer wanting to author them.
- The best-reviewed product, SadServers, is VM-only. HackerEarth's multi-VM launch got 6 reactions.
- Uptime Labs wins enterprise logos with simulated drills, so training buyers may not require real infrastructure.
- Free OSS repos and DIY rounds already cover K8s break-fix interviews.
- Public anchors: EasyEnv €79/mo, SadServers $1,470/yr, HDO €40/assessment, HackerRank Starter about $79/mo. The €100–€300/mo band in [BUSINESS_THESIS.md](BUSINESS_THESIS.md) is at or above these.

**Assumptions.**

- Multi-fault AWS incidents carry hiring signal that VM and kind rounds miss.
- Mid-market buyers find CloudLabs too heavy and HackerRank's AWS library too generic.
- A custom scenario build can be priced as a one-off service above the subscription anchors.

**Confidence.** Medium-high that no clear product gap exists. Low that the narrowed opening is real.

**What would invalidate it.**

- Three or more buyers say a VM or kind round is enough, or they already use HackerRank's AWS questions and are satisfied. That kills the AWS angle for hiring.
- Buyers say they want to author scenarios themselves. That reopens self-serve.
- Team-drill buyers say simulated is good enough. That kills the real-infra drill angle.

**Next experiment.** Phase 2 and Phase 7 discovery calls using the nine questions in [MARKET_RESEARCH.md](MARKET_RESEARCH.md#open-questions-only-customers-can-answer). One call with an AI-lab buyer for agent-evaluation environments.

## 2026-10-06 — Artifact set extended for the 13-phase validation project

**Decision.** Supersedes "Documentation set is twelve files". `PRICING.md`, `OUTREACH.md`, `FINANCIAL_MODEL.md` and `MARKET_RESEARCH.md` are now allowed, plus `research/STATUS.md` and raw notes under `research/`. Each file must hold sourced content or explicitly labeled hypotheses. Never an empty shell.

**Evidence.** The 13-phase project needs one artifact per phase. Phase 1 produced sourced market data that did not fit any existing file. Public price anchors now exist for pricing.

**Assumptions.** Labels ([FACT], [ESTIMATE], [HYPOTHESIS]) are enough to stop a hypothesis from reading as certainty. Future sessions read [research/STATUS.md](research/STATUS.md) first.

**Confidence.** Medium.

**What would invalidate it.** A file appears with placeholder sections, or a financial model shows ARR scenarios without labeled assumptions. Delete the file or the section.

**Next experiment.** Write `PRICING.md` in Phase 6 only from the competitor anchors and labeled hypotheses. `FINANCIAL_MODEL.md` waits for Phase 11.
