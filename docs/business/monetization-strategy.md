# Cloud Spider monetization strategy

> **Superseded (2026-10-11).** This document is kept for history and has not been edited below this note. The current strategy is [`docs/business/cloud-spider-platform-strategy.md`](cloud-spider-platform-strategy.md), which folds in this file's useful parts (credited as *from #85*) and takes precedence wherever the two differ.

Date: 2026-10-11
Branch: `main`
Mode: startup office hours, pre-product. CEO posture: hold scope. Do not expand this into a hosted product.
Status: recommendation for review. No application code was changed. Do not implement billing until this is approved.

Later the same day, two follow-ups were added at the end of this file, after the review report: which similar products people already pay for, and what would still be an edge if the page moved to a small server and grew a second cloud.

Label key used throughout:

- **Fact** — observed in this repository or on a cited page during this session.
- **Market** — price or positioning copied from a cited public page. Not proof that anyone will buy Cloud Spider.
- **Assumption** — a working belief used so the model can be calculated. Not measured here.
- **Hypothesis** — a claim that needs a person, a payment, or a watched session before it counts.

## Verdict

**VALIDATE FIRST.**

Confidence that Cloud Spider, as it exists, can become a subscription SaaS in the next 90 days: **low (about 2/10)**. The shape of the software fights that model.

Confidence that building accounts, billing, and entitlements now would be the wrong use of engineering time: **high (about 8/10)**.

Confidence that a stranger will pay for the software itself: **unknown**. GitHub shows no demand signal. No interview and no payment exists in the record of this session.

What would move the verdict:

- To **GO**: two people who are not the author pay money for a named thing (a setup, a written path diagnosis, or a license) after they have seen that the public repo is free to clone.
- To **DO NOT MONETIZE**: five operators in the target seat say the AWS console, Cost Explorer, and k9s (or Headlamp) already cover the job, and they would not pay for a setup either.
- To **PIVOT**: those same people ignore the map and light up on one slice only (the broken-edge path, or the labs). Sell that slice. Still do not host their AWS account.

---

## 1. Product discovery

### What the product actually does

**Fact.** Cloud Spider is a local web page for one AWS account. `npm start` listens on `127.0.0.1:9241` only (`src/server.js` `listen`). The README calls it a Pip-Boy page: the map of what runs where, the request path through a load balancer, the inside of an EKS cluster, projects as vaults, the bill, and stacks that can be raised or taken down.

**Fact.** Sample mode draws a fake account and does not call AWS. Real mode uses the machine's AWS credential chain (`AWS_PROFILE` in the README start command) plus a local kube context for Cluster.

**Fact.** The page the server ships includes these surfaces, matched to code and the README:

| Surface | What the operator gets | Writes to AWS or the cluster? |
| --- | --- | --- |
| MAP | VPCs, subnets, machines, EKS drawn as a camp. Morning lines for what hurts, what changed, and what is idle but billed. | Read, plus stop/start only for instances tagged `cloudspider=expendable` |
| PATH | Load balancer, listener, rule, target group, target, node, cluster. Names the first broken or hanging edge. Read-only. | No |
| CLUSTER | EKS or an OpenShift-shaped sample. Topology, telemetry, ops, pod inspect, a k9s-style table. Kube calls are GET-only (`src/kube.js`). | Read |
| VAULTS | Local YAML catalog, Backstage-shaped. Owns resources by tag or id. HTTP checks. Trouble from CloudTrail. Error lines from log groups. | Reads. HTTP checks hit the URLs in the YAML. |
| CAPS | Month-to-date charges, credits kept separate, forecast, service and resource breakdown. Cost Explorer, cached 6 hours on disk. | Read. The AWS account pays Cost Explorer. |
| STACKS | Pulumi and Terraform cards. Run and take down. Add-on installs. | Yes. Can create and destroy infrastructure. |
| LEARN | Three tracks under `labs/`: Kubernetes/EKS rewrites, OpenShift EX280 labs, and a cloud break-fix track that is still "later" inside `src/learn.js`. | Check scripts run only after a static scan. Cloud labs, when used, spend money in the operator's account. |
| ASK | One question to the local Cursor CLI (`agent --mode ask`). The agent does not get `--force`. Proposed actions come back as buttons into the existing stop/start or Stacks flow. | No, unless the operator confirms a later button. |
| RADIO | Last 15 actions and alarms. | Read |

**Fact.** This is one Node process (`package.json` name `cloud-spider`, `"private": true`, Node `>=20`). About 28,000 lines under `src/*.js`, 67 test files matching `test/*.test.js`, measured 2026-10-11. Dependencies are the AWS SDK v3 and `yaml`. No web framework, no database, no auth library.

**Fact.** A second effort lives in the same repo: `docs/cloud-platform/MVP.md` describes a sealed outage loop (`lab up` / `lab validate` / `lab down`) and lists "accounts for other people" and "billing" as explicitly out of the milestone. That CLI is not the product the README tells you to start.

**Fact.** The GitHub repo `gabdzo/cloud_spider` is public, created 2026-10-09, with 0 stars, 0 forks, 0 issues, and `licenseInfo: null` (queried 2026-10-11). There is no `LICENSE` file. `main` was one commit ahead of `origin/main` at assessment time.

### Strongest value proposition

**Fact, then hypothesis.** The thing the code actually concentrates on is one person looking at one account and seeing three sentences at once: what is broken on the request path, what the cluster is doing, and what the bill is doing, without sending credentials to a vendor.

**Hypothesis.** The sharpest sentence is not "a diagram of your AWS." Diagram products already exist. The sharper sentence is: "the first broken edge between the load balancer and the pod, on your machine, next to the month's charges and the stack that created it."

That sentence is still a hypothesis until someone who is not the author uses it during a real broken path.

### Users, payers, economic buyers

**Assumption, not a fact.** Three different people get collapsed in a pitch. They are not the same person here.

| Role | Who, if this stayed honest | Pays? |
| --- | --- | --- |
| User | The person at the laptop with `AWS_PROFILE` and kubectl. Today the only evidenced user is the author. | Not evidenced. |
| Paying customer | Nobody in the repo, the issue list, or this session. | No. |
| Economic buyer | For a one-person tool, the same human. A team tool would need a lead who can expense Hava or Datadog. That buyer wants sharing, SSO, and multi-account. Those are absent. | No budget holder has been named. |

**Hypothesis.** The economic buyer for a hosted cloud map is a platform or FinOps lead. Cloud Spider does not yet do the job that person pays for (shared live diagram, many accounts, access control). The person the software fits is an individual operator. Individuals already have a free status quo. See section 2.

### The problem and how often it happens

**Fact.** The author's own prior decision (2026-10-10) was to put morning sentences on the existing map: health, the bill, and the trail. A second cloud was deferred on 2026-10-09. The tool is built as a daily driver for one AWS place, not as a product tour.

**Hypothesis.** For that one operator, the job shows up on the days something is broken or a stack was left running. That can be daily. Frequency for anyone else is unmeasured.

**Hypothesis requiring validation.** "I open this instead of the console every morning" is the behavior that would make it a habit. "I would open it if someone demoed it" is not.

### Nice-to-have or must-have

**Position.** For a stranger, this is a **nice-to-have** until a watched session shows otherwise.

The status quo is already installed and costs them nothing extra: the AWS console, Cost Explorer in that console, `kubectl`, and a free cluster UI (k9s or Headlamp, see market notes). Cloud Spider replaces a tab pile with one page. That is taste and speed. It is not yet a job they get fired for missing.

It becomes a must-have only if a named operator can point at a bill they caught, or a broken edge they found, that the console did not make obvious, and they kept the page open the next week.

**Evidence that would change this.** One incident write-up from someone else: time-to-cause with the console, time-to-cause with Path, and whether they opened Cloud Spider again without being asked.

---

## 2. Market validation

Research date: 2026-10-11. Prices are what the cited pages showed. They are competitor prices, not a recommended Cloud Spider price.

### Direct and indirect competitors

No competitor found in this pass sells "a localhost Pip-Boy that maps one AWS account, diagnoses one load balancer path, shows EKS, reads the bill, and runs Pulumi." The overlap is by slice.

| Slice Cloud Spider already has | Who covers it | How they charge | What they have that this repo does not |
| --- | --- | --- | --- |
| Live AWS map | Cloudcraft, now inside Datadog | **Market.** [cloudcraft.co/pricing](https://www.cloudcraft.co/pricing) and [cloudcraft.co](https://www.cloudcraft.co/) say Cloudcraft is free with any Datadog subscription. A third-party comparison still lists an older Pro at $49/month or $480/year ([FinancesOnline](https://comparisons.financesonline.com/cloudcraft-vs-vcommander)). Treat the $49 figure as historical, not the current offer. | Multi-account, Azure/GCP, team editing, export. "Free" still sits on a Datadog relationship. Datadog's own price was not re-quoted here. |
| Live AWS map | Hava | **Market.** [hava.io/pricing](https://www.hava.io/pricing): Professional $59/month, 3 sources, 1 user; Teams $249/month, 10 sources, unlimited users; extra source $15/month. The [AWS Marketplace listing](https://aws.amazon.com/marketplace/pp/prodview-swycbotnjyum2) says Professional is 5 sources at $59 and Team is 10 sources at $249. The source-count mismatch is theirs. Both pages were live this session. | Scheduled sync, version history, multi-cloud, a shared account. |
| Live AWS map | Lucidscale | **Market.** [AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-th43yik3k7eua) lists Lucidscale Team at $449 per 12 months, minimum 1 license. A [Lucid community post](https://community.lucid.co/product-questions-3/welcome-to-lucidscale-legacy-experience-13864) says the current product is a Cloud Accelerator add-on on Lucid Enterprise, which is a sales conversation. A [2026 pricing writeup](https://checkthat.ai/brands/lucid/pricing) says Lucid does not publish a current Lucidscale list price. | Collaboration, Azure/GCP, procurement. |
| Cluster UI | k9s, Headlamp | **Market.** Comparison pages describe both as free and open source ([kubeglass](https://kubeglass.com/docs/compare/), [Nuphos](https://nuphos.ai/blog/best-kubernetes-gui)). Their license files were not opened in this session. | k9s is the thing Cluster's table is openly styled after. Headlamp is a local or in-cluster web UI with no account. |
| Cluster UI | Lens | **Market.** [lenshq.io/pricing](https://www.lenshq.io/pricing): Personal is free. Plus is $25 per user per month. Organizations over $10 million in annual revenue or funding must use a paid plan, with a 30-day evaluation exception. A second Lens URL lists Pro at $25 and Enterprise at $50 per user per month. | EKS discovery, AI, CVE reports, SSO on the paid org plans. |
| The bill | AWS Cost Explorer | **Market.** The console view is part of the account. The API is $0.01 per request on the primary billing view ([AWS pricing](https://aws.amazon.com/aws-cost-management/aws-cost-explorer/pricing/)). Each paginated page is another request. | Official, complete, no second tool. |
| The bill | Vantage | **Market.** [vantage.sh/pricing](https://www.vantage.sh/pricing): Pro $30/month up to $7,500 tracked spend, 5 users; Business $200/month up to $20,000, 10 users. Starter lists $2,500 of tracked spend and 3 users. This session's excerpt did not print `$0` on Starter. Secondary pages call Starter free. Do not treat "free" as verified from the excerpt. | Many providers, budgets, team seats, savings-plan automation. |
| The bill, Kubernetes | Kubecost (IBM) | **Market.** [FinOpsCost, read against IBM store figures dated 1 Oct 2026](https://finopscost.com/tools/kubecost): Foundations free up to 250 cores and 15-day retention. Enterprise self-hosted $63.60 per core per year with a 250-core minimum ($15,900/year at that floor). | Allocation by namespace and workload. Cloud Spider shows the AWS bill, not pod-level showback. |
| Pre-deploy cost | Infracost | Mentioned only as a different job (estimate before apply). A dollar price was not taken from infracost.io in this session, so none is quoted. | Pull-request cost diffs. Cloud Spider reads the live bill after the fact. |
| Project catalog | Backstage | Not priced here. It is a free framework teams host themselves. Cloud Spider's vault YAML is explicitly "like a Backstage catalog-info.yaml" (README). | A portal other people in the company can open. |
| Hands-on labs | KodeKloud | **Market, partial.** [kodekloud.com/pricing](https://kodekloud.com/pricing) sells Standard, Pro, AI, and Business subscriptions with hosted labs and playgrounds. The static page fetched this session did not include dollar amounts. A secondary catalog ([Zoftware, last updated 18 Nov 2025](https://zoftwarehub.com/products/kodekloud/pricing)) claims about $15 / $30 / $46 per month billed annually. Those dollars are **not** confirmed against the official page. | They host the cluster. Cloud Spider's labs run on a cluster the learner already has. |
| Status quo | AWS console + kubectl + Cost Explorer | $0 of extra software. The account's own AWS bill remains. | Ugly, scattered, and already trusted. This is the real competitor. |

### Gaps and differentiation

**Fact.** Differentiation that is real in the code:

- Credentials stay on the operator's machine. Nothing in `src/` implements a vendor account or an upload of keys.
- Path is a diagnosis with a sentence, not only a picture (`src/path-diagnose.js`).
- The bill separates credits and refunds from charges so a promotional credit does not zero the headline (`src/cost.js`).
- Take-down of stacks is gated by typing the name. That behavior is a recorded product decision, not a billing feature.
- Sample mode is a full demo with no account.
- One process draws map, path, cluster, vaults, bill, and stacks together.

**Fact.** Differentiation buyers of Hava and Lucidscale pay for, which this repo does not have: more than one AWS account, users other than the OS user, a shareable link, SSO, audit history of who saw the diagram, Azure or GCP (explicitly deferred).

**Position.** The taste (pixel camp, one font, one page) is a real difference and a weak reason to pay. People pay Hava $59 to put a diagram in front of a team. They do not pay $59 to enjoy a font.

### Demand evidence

**Fact.** Observable demand for this repository on 2026-10-11:

- Public for two days (created 2026-10-09).
- 0 stars, 0 forks, 0 issues.
- Not an npm package (`private: true`).
- No analytics, signup, or payment code.
- No customer name in the README. The stacks, regions, and vault files describe the author's lab account.

**This is not a demand study.** Absence of stars is not proof of absence of need. It is proof that nobody has gathered around this repo yet. Interest is not demand. A star would still not be demand.

### Why someone would choose it and pay

**Hypothesis, ranked by how little new software it needs.**

1. They will not pay for the map. The console and, inside a Datadog shop, Cloudcraft already draw one.
2. They might pay an operator (the author) to point Path at their broken load balancer and sit there until the sentence is right. That is a service. The software is the instrument.
3. They might pay once for a packaged app if cloning Node, the AWS CLI, kubectl, and Pulumi is the part they refuse. The source is already public, so a payment has to buy packaging, updates, or time. It cannot buy exclusivity.
4. They will not pay a monthly seat until the page is shared with a second person who does not have the laptop. That feature does not exist.

### Why the business fails

1. **The status quo is free and already open.** If "nothing" were the alternative, the pain might be too small to notice. Here the alternative is the console. Switching costs are habit, not money.
2. **The payer and the user split, and the product only serves the user.** Team budgets buy Hava, Vantage, and Lens. This build has no second user.
3. **The valuable code is already public, with no license.** You cannot retroactively charge for a clone. You also cannot honestly call it open source until a license exists. Both the sponsor model and the paid-license model are blocked on that legal choice. This is not legal advice. It is the state of the files.
4. **The dangerous buttons are the product.** Stop, start, Pulumi up, and take-down are the part that feels like control. They are also the part a hosted multi-tenant service must not run on behalf of strangers without a security program this repo does not have.
5. **Install friction.** Node 20, an AWS profile, kubectl for Cluster, Pulumi for Stacks, and a Cursor CLI for ASK. Every extra binary loses the person who would have paid $29 to avoid setup.
6. **Labs are a second product with a stronger incumbent and a trademark edge.** EX280 is a Red Hat exam name. The labs in `labs/ex280/` are original exercises (setup, verify, answers kept in `answer/`). Selling them as exam prep still needs a trademark pass before any checkout. KodeKloud sells the hosted sandbox, which these labs do not include.
7. **One maintained account is the test suite.** Pricing, support, and abuse handling have no second tenant to learn from.

---

## 3. Monetization options

Fit means "how much of the current process you can keep." It does not mean "how large the market story is."

### A. Free / open source + GitHub Sponsors or Patreon

| | |
| --- | --- |
| Target customer | A person who already clones the repo and wants the author to keep going. |
| What they pay for | Goodwill and continued work. Not a feature. |
| Pricing hypothesis | **Hypothesis.** $5 or $20 a month tiers. Not tested. |
| Revenue potential | **Market process, not a forecast.** GitHub Sponsors charges no fee on sponsorships from personal accounts, so the sponsored developer receives the payment. Organization sponsorships are charged up to 6% (3% card processing + 3% GitHub service). [GitHub docs](https://docs.github.com/en/sponsors/sponsoring-open-source-contributors/about-sponsorships-fees-and-taxes). Patreon fees were **not** looked up this session. |
| Limitations | 0 stars. Sponsors follow an audience. There isn't one. A missing LICENSE means "open source" is not yet true. |
| Implementation complexity | **Low, after a license decision.** A funding file and a tier list. No app changes. |
| Ongoing cost | The author's time. Payouts and tax forms. |
| Acquisition | Hard. The audience has to exist first. |
| Risks | Choosing a license is a one-way door if the later plan was "charge for the same bits." Sponsors do not fund a company. |
| Fit | High as a side channel once the license is chosen. Low as the business. |

### B. Freemium SaaS, monthly or yearly

| | |
| --- | --- |
| Target customer | A team that will paste an AWS role into a website. |
| What they pay for | A hosted page, more accounts, more history, seats. |
| Pricing hypothesis | **Do not use one yet.** Nearby list prices are Hava $59/month per small account and Vantage Pro $30/month. Copying those numbers onto this codebase would be fiction. |
| Revenue potential | The arithmetic in section 4 shows a subscription only works with hundreds of installs. Those installs are not evidenced. |
| Limitations | The server refuses every interface except loopback. Mutations check that the browser origin is that same loopback (`src/origin.js`). Hosting is not a config flag. |
| Implementation complexity | **High.** This is a different trust model: accounts, a place to keep customer cloud credentials, isolation, billing, and a decision about whether strangers may press Take down. That is a new product. It violates the "no major rewrite" constraint. |
| Ongoing cost | Support, credential incidents, AWS API behavior changes, on-call. The VM is the cheap part and is not priced here on purpose. |
| Acquisition | Hard. You would be selling against Datadog's bundled Cloudcraft and against Hava, without their team features. |
| Risks | A leaked customer role, or a Pulumi destroy aimed at the wrong account, ends the company. The current safety (expendable tag, typed stack name) is local-operator safety, not tenant safety. |
| Fit | **Poor.** Worst match to the code and to the minimum-engineering goal. |

### C. Open core, paid premium features

| | |
| --- | --- |
| Target customer | The same operator, later a second seat on their team. |
| What they pay for | Only features that are **not already in the public tree.** The map, path, cluster, bill, and stacks are already on GitHub. |
| Pricing hypothesis | **Hypothesis.** A later add-on, not a gate on today's page. Example to test, not to build: a read-only second AWS account on the morning lines, $15/month or a $99 one-time key. Both numbers are unvalidated. |
| Revenue potential | Capped by distribution. Open core without an audience is a license file nobody downloads. |
| Limitations | You cannot put today's best screens behind a paywall without forking trust with the people you would need as sponsors. |
| Implementation complexity | **Medium for a real entitlement check, low if the "premium" is a separate private repo of future work.** |
| Ongoing cost | Two lines of code to maintain. Premium buyers expect replies. |
| Acquisition | Same as A, plus a reason the free clone is not enough. |
| Risks | Gating the morning report or Path would tax the only habit worth having. |
| Fit | Medium later. Poor as the first move, because the core is already published. |

### D. Usage-based pricing

| | |
| --- | --- |
| Target customer | Someone whose value scales with a meter: API calls, nodes, cloud spend. |
| What they pay for | In other products, cores (Kubecost) or tracked spend (Vantage). |
| Pricing hypothesis | There is no honest meter. A "diagnosis" counter would bill the person for clicking. Cost Explorer is already $0.01 a request to AWS, and this app caches the bill for 6 hours specifically to avoid repeat charges (`COST_TTL` in `src/cost.js`). |
| Revenue potential | Low, and it would punish the behavior you want (opening the page). |
| Implementation complexity | Medium (a meter, a quota, a bill) for a price the user would resent. |
| Ongoing cost | Disputes. "You charged me for a refresh." |
| Acquisition | Hard to explain. |
| Risks | The meter and the value are unrelated. |
| Fit | **Poor.** |

### E. One-time licenses

| | |
| --- | --- |
| Target customer | An individual who wants a packaged local app and will not `git clone`. |
| What they pay for | An installer, signed updates, and a human who answers one email. Not exclusive code. |
| Pricing hypothesis | **Hypothesis to test, not a list price.** $79 once, sitting under one month of Hava ($59) times two, because this is one user and one account and the source is public. If they will not pay $79 once, they will not pay $29 a month. |
| Revenue potential | A one-time fee does not recur. 30 sales at $79 is $2,370 gross before fees. That is a good weekend, not a company. See section 4. |
| Implementation complexity | **Low if the license is a Polar (or similar) checkout and the app keeps working when the key is absent.** **High if you try to make the public JavaScript refuse to run without a key.** It will be patched. |
| Ongoing cost | **Market.** [Polar Starter](https://polar.sh/docs/merchant-of-record/fees): 5% + 50¢ per transaction, no monthly fee. International cards add 1.5%. **Market.** [Stripe standard](https://stripe.com/pricing): 2.9% + 30¢ per successful domestic card charge, no monthly fee. Refunds do not return the original processing fee. |
| Acquisition | Medium-hard. You need a page and a place operators already look (a blog post that shows a real broken path, not an ad). |
| Risks | The GitHub tree is the pirated copy of your own product, legally ambiguous until licensed, practically one clone away. |
| Fit | **Best software-shaped option that does not rewrite the app.** Still second to selling time, until someone pays. |

### F. B2B / team / enterprise seats

| | |
| --- | --- |
| Target customer | A platform team with more than one AWS account and someone who can sign a $249/month tool. |
| What they pay for | Seats, SSO, a shared picture, an invoice. Lens and Hava are the price anchors ($25/user/month, $249/month for a small team plan). |
| Pricing hypothesis | Do not publish one. You would be quoting a product you have not built. |
| Revenue potential | This is where diagram and FinOps money actually sits. It is also the longest build. |
| Implementation complexity | **High.** Organizations, roles, and data isolation. None of that exists. Section 5. |
| Ongoing cost | Security questionnaires, support, a status page. |
| Acquisition | Enterprise sales. Wrong motion for a localhost app with 0 stars. |
| Risks | Building seats because the market has seats, while the only user is one laptop. |
| Fit | **Poor today.** The right model only after a team asks to share one page and offers to pay. That ask has not happened. |

### G. Paid hosting, support, consulting, or a managed setup

| | |
| --- | --- |
| Target customer | One operator, or a three-person team, who will pay for the author's hands on their account for a day. |
| What they pay for | Installation against their profile, vaults written for their tags, one Path walked until the sentence matches reality, and a list of what not to press. |
| Pricing hypothesis | **Hypothesis.** A fixed setup fee in the range of a day of specialist time. Do not print a number on a website until one person accepts or refuses a specific quote in a conversation. A public price before a conversation invents willingness to pay. |
| Revenue potential | Capped by hours. Two paid days in a quarter is a useful test and a bad business plan. |
| Implementation complexity | **None in the app.** An invoice and a calendar. |
| Ongoing cost | The work itself. Liability if you press Take down in their account. Prefer to sit with them while they press it. |
| Acquisition | Easier than SaaS for the first two, because the buyer is a person you can email. Hard to scale past the author's calendar. |
| Risks | You become a freelancer with a themed console. That can be the right business. It is not a SaaS. |
| Fit | **Best first money.** It uses the product as it stands. |

---

## 4. Revenue modeling

Every figure in this section is an **assumption** unless it cites a fee page. Nothing here is a forecast of demand.

### Shared assumptions

| Id | Assumption |
| --- | --- |
| A1 | Known free users from distribution evidence: **0** (0 stars, 0 forks, private package, no telemetry). True external installs may be higher and are unmeasured. |
| A2 | Conversion rates below are invented so the arithmetic is visible. They are not a funnel. |
| A3 | Test prices: setup fee $750 once; local license $79 once; counterfactual subscription $29/month. None have been offered to a buyer. |
| A4 | No churn has been observed. The subscription counterfactual uses 10% monthly logo churn as a stress number, not a measured rate. |
| A5 | Seller-side hosting for the local app: **$0/month.** The buyer's AWS account pays Cost Explorer at $0.01 per API request. The app caches that bill for 6 hours. |
| A6 | Founder labor is excluded from "gross margin before labor" and then called out. A high margin before labor can still be a bad use of a week. |
| A7 | Card fees, if a checkout existed: Stripe 2.9% + $0.30 domestic. Polar Starter 5% + $0.50. GitHub Sponsors personal accounts: 0% platform fee. |
| A8 | No support headcount, no ads, no refund reserve beyond the note that Stripe keeps the processing fee on a refund. |

### Scenarios (12 months, illustrative)

| | Conservative | Base | Optimistic |
| --- | --- | --- | --- |
| Story | Nobody outside the author runs it. You build no billing. | Two people pay for a setup. No subscription. | A small license experiment works. Still no SaaS. |
| Free users (assumed) | 0 | 40 clones, unmeasured, not a list | 400 clones |
| Paid conversion | 0% | 2 of 40 pay for time, not for a gated feature | 30 of 400 buy a $79 key (7.5%). This rate is deliberately high so the ceiling is visible. |
| Paying customers | 0 | 2 | 30 |
| What they bought | — | Setup, once | License, once |
| ARPU | — | $750 once | $79 once |
| MRR | $0 | $0. A setup is not monthly. | $0. A license is not monthly. |
| ARR (only if you falsely annualize one-time cash) | $0 | Do not call $1,500 ARR. | Do not call $2,370 ARR. |
| Cash in, 12 months | $0 | $1,500 | $2,370 |
| Infra | $0 | $0 | $0 |
| Payment fees | $0 | Stripe on two $750 charges: 2 × ($21.75 + $0.30) = **$44.10** | Stripe on thirty $79 charges: 30 × ($2.29 + $0.30) = **$77.70** |
| Support and maintenance | The author already maintains the repo for themselves. | **Assumption.** 6 hours per setup, 12 hours. If that hour is worth more to the author than about $120 after fees, the base case loses on time. | License email support easily eats the $2,292 net. |
| Cash after Stripe, before labor | $0 | $1,455.90 | $2,292.30 |
| Gross margin before labor | n/a | 97% | 97% |
| Gross margin after a week of support | n/a | Can be negative. Not calculated as a salary. | Likely negative. |

### Subscription counterfactual (not recommended)

**Assumption.** $29/month, Stripe, 10% monthly churn, no annual plan.

- About **35** paying customers produce roughly $1,000 MRR before fees (35 × $29 = $1,015).
- Stripe on $29 is about $1.14, so net is about $27.86. Thirty-five customers net about **$975 MRR**.
- At 5% conversion you would need about **700** free installs to reach 35 payers. There is no evidence of 700 installs. Getting them is the whole business, and it is not a billing project.
- At 10% monthly churn, a stable 35 requires replacing about 3 to 4 customers every month, forever.
- Break-even against **cash hosting** is immediate because hosting is $0 in the local model. Break-even against **the engineering to become a real subscription product** is the wrong target: that engineering (section 5) is large, and the counterfactual does not pay a quarter of specialized build time back inside year one under the base case.

### Break-even that matters

The local tool is already at cash break-even because it has no vendor costs. The decision is whether the next month of building **creates** costs (a SaaS, support obligations, a paywall on a public repo) faster than a buyer appears.

**Position.** Do not spend engineering to reach break-even. Spend conversations to see if break-even on a setup fee is even available.

---

## 5. Technical monetization readiness

| Requirement | Already in the repo | Missing |
| --- | --- | --- |
| Authentication and accounts | Loopback bind. Mutating routes require the browser origin to be that same local origin (`src/origin.js`). | No users, passwords, sessions, SSO, or magic links. |
| Organizations and multi-tenancy | One OS user. One process. Vault YAML on local disk. | No org, no membership, no second tenant. |
| Subscription billing | None. | No Stripe, no customer id, no invoices. |
| Feature flags and entitlements | Sample mode is a header switch, not a plan. | No flag service, no paid/free split. |
| Usage limits and metering | Cost Explorer results cached 6 hours to limit **AWS** charges to the operator. Cluster polls on a timer. | No per-customer meter. |
| Payment webhooks | None. | No endpoint, no signature check, no idempotency store. |
| Subscription lifecycle | None. | No trial, dunning, cancel, or grace period. |
| Abuse prevention | Origin check, expendable-tag gate for stop/start, typed name for take-down, ASK forced into read-only mode, learn-check refuses scripts that look like writes. | No rate limit for a public host, because it is not a public host. Those local gates are not a WAF. |
| Monitoring and cost controls | Failures print to stdout with the call name. Cost cache on disk under `.cloudspider/`. | No metrics vendor, no alert, no budget alarm (a $10 budget alert is still a deferred TODO). |
| Data isolation and security | Credentials never leave the machine via an account system, because there is no account system. Kube inspect redacts secret-shaped keys. Reports strip secret-shaped fields. | A hosted deployment would mix tenants in one process unless rewritten. Local files (cost cache, run logs, `.learn/progress.json`, vaults) are not isolated. |
| License enforcement | None. `package.json` is private. GitHub license is null. | A key check in public JavaScript is theater. |

**Fact.** The smallest change that matches the recommended model (sell a setup, not a seat) is **zero application code**.

**Fact.** The smallest change that matches a one-time license, if validation ever says to build it: a checkout outside the app, and the app unchanged. Entitlement inside `src/server.js` is optional and weak while the source is public.

**Fact.** A SaaS billing build is not a webhook plus a flag. It starts by reversing `server.listen(port, "127.0.0.1")` and the origin rule, then inventing a place to store someone else's AWS role. That is the rewrite this review refuses.

---

## 6. Go to market

### Ideal customer profile

**Hypothesis, specific enough to email, not yet a named human.**

An engineer who is the only person on an AWS account that runs one EKS cluster and at least one load balancer, who already uses Pulumi or Terraform, and who personally feels the bill. Title is closer to "the person who gets paged" than to "VP of Platform." They get promoted for fewer surprises, not for buying tools. They get in trouble when a test cluster is still up on Monday or when a path is red and the console shows five healthy checks.

If you cannot name one of these people by the end of week two, the ICP is still a costume.

### Positioning

**Position.** "A local page for one AWS account: the broken edge, the cluster, and the bill, on your machine."

Do not say "Datadog alternative," "Cloudcraft killer," or "AI SRE." The ASK tab is a local Cursor session with a snapshot. It is not a productized model.

### Landing page messaging

Only after the validation conversations. If you write it earlier, use this and no more:

- Headline: See the first broken edge, the cluster, and this month's charges on one local page.
- Subhead: Runs on your laptop. Uses your AWS profile. Does not take a copy of your keys.
- Proof: a screenshot of Sample mode, plus one real path sentence with account identifiers removed.
- Primary action: "Watch a 3-minute sample" or "Tell me the broken path you have this week." Not "Start free trial."
- Price: omit it. There is nothing to buy yet.

### Free vs paid feature matrix

**Recommendation.** No paid column in the application during the 90 days.

| Capability | Now | Paid later, only if someone asks |
| --- | --- | --- |
| Map, Path, Cluster, Vaults, CAPS, Sample | Free, already public | Stays free |
| Stacks run / take down | Free, local, dangerous on purpose | Stays local. Do not host it. |
| LEARN labs | Free in the repo | Do not sell EX280 by name until a trademark check. |
| Second AWS account on the morning lines | Does not exist | The only premium worth sketching |
| Hosted team login | Does not exist | Out of this strategy |

### Launch channels

Do not buy ads. Do not post a "show HN" that asks for stars and calls them traction.

Channels that match a local tool:

- One written teardown of a broken listener, with the sentence Path produced, published where operators already read.
- The Sample mode GIF, so a reader can judge the page without an AWS account.
- Direct messages to five operators. Not a waitlist.

### First 10 paying customers

**There is no first-10 software plan that the evidence supports.** Replace it with a first-10 conversation plan. A paying customer counts only if money moves.

For each person: they run Sample mode alone while you stay quiet. Then they connect their own account only if they ask. You write down the first place they get stuck. You ask what they would open tomorrow if this page did not exist. You offer a paid setup only if they describe a job they are already doing badly. If they say "cool UI," you do not pitch.

Stop at 10 conversations even if zero pay. The zeros are the result.

### First 100 paying customers

**Do not plan this.** One hundred payers at $79 once is $7,900 gross, and you do not have a channel that has produced one payer. Revisit only after the first two payments and a written note of why they paid.

### Experiments before any billing code

1. **Disappearance test.** Ask one operator who has used the page for a real account: "If this vanished tomorrow, what would you open instead, and what would take longer?" Upset plus a specific workaround is evidence. A compliment is not.
2. **Status-quo timing.** On the next real broken path, record minutes in the console versus minutes in Path. One incident. If Path is not faster, the wedge is false.
3. **Price refusal.** Offer one specific setup quote to one person. Acceptance or a clear no is the data. Silence is not a yes.
4. **Clone test.** Tell them the repo is public. If they still want to pay, write down what they think they are buying (time, packaging, or guilt). That sentence chooses between model G and model E.
5. **Second-person test.** Ask if anyone else on their team would open the page. If the answer is no, do not design seats.

---

## 7. Final recommendation

### 1. Commercial viability

Cloud Spider is a finished-feeling **local instrument** for one AWS operator. It is not a finished **business**.

Viability as a hosted subscription, on this code, in this quarter: **poor**. Evidence: loopback-only server, no tenants, public source, free incumbents, zero distribution.

Viability as a small services offer that uses the instrument: **possible and unproven**.

Evidence gaps: no watched stranger, no price offered, no payment, no license, KodeKloud dollar prices not confirmed on the official page, Cloudcraft's old $49 price is not the current official offer.

### 2. Ranked models

| Rank | Model | Why this rank |
| --- | --- | --- |
| 1 | **G. Paid setup / sitting-with-you support** | First money with no new architecture. Ceiling is hours. |
| 2 | **E. One-time local license** | Matches a local app. Only after the clone test shows people still pay. Weak enforcement. |
| 3 | **A. Sponsors** | Honest once a license exists. Not a business at 0 stars. |
| 4 | **C. Open core** | Only for features not already published. Do not gate Path or the bill. |
| 5 | **F. Team seats** | Real market, wrong product. Wait for a team to ask. |
| 6 | **D. Usage-based** | No meter that tracks value. |
| 7 | **B. Freemium SaaS subscription** | Fights the security model. Largest build. Least evidence. |

Subscriptions are a reasonable model for Hava and Vantage because they host shared state. They are a bad default here.

### 3. Recommended pricing structure

**None in the product.**

If a conversation reaches a quote, quote a **one-time setup**. Do not quote a monthly seat. Do not discount a SaaS plan that does not exist.

If the clone test later supports a license, test **$79 once** for a packaged build, with the public learning repo remaining free. Kill the license if the first five qualified people refuse.

### 4. Smallest monetizable feature set

**No new feature.** The smallest thing someone can pay for this week is an hour of the author's attention on their existing page.

The smallest later software wedge, if the path-timing experiment wins, is a saved diagnosis they can hand to a teammate. That is a document or a redacted export, not an account system.

### 5. Engineering effort

| Path | Effort | When |
| --- | --- | --- |
| Do nothing in the app. Run the five experiments. | Hours of conversation. **0 product code.** | Now |
| Add `LICENSE` after choosing one. | Small, and it is a legal decision first. | After you know whether future paid bits must stay private |
| Polar (or Stripe) checkout for a setup invoice, outside the repo | Small, and only after someone asks to pay | After experiment 3 |
| License key inside the app | Small to write, useless while `src/` is public | Not in the 90 days |
| Accounts, orgs, Stripe Billing, webhooks, entitlements, hosted AWS roles | Large. Treat as a new product. | Not recommended |

### 6. Unit economics

Before labor, a local sale is almost all margin: Stripe takes 2.9% + $0.30, hosting is $0, Cost Explorer is the buyer's AWS line.

After labor, two setups can lose money if they consume days of fixes.

A subscription at $29 needs on the order of 35 paying customers for about $1,000 MRR before fees, which implies a free population you do not have. Churn at an assumed 10% per month makes that population a treadmill.

These are scenario arithmetic under section 4, not expected revenue.

### 7. Top five business risks

1. Free status quo (console, Cost Explorer, k9s/Headlamp) is good enough.
2. No named buyer and no distribution (0 stars, two-day-old public repo).
3. Public source and no license, so you cannot charge for the bits you already gave away, and you cannot yet call the gift open source.
4. Take-down and stop/start make a hosted or casually shared service dangerous.
5. A team-seat roadmap copies Hava's price page and skips the evidence that a second person wants the page.

### 8. 30 / 60 / 90 days

**Superseded for this pass by WTP-EXP B (2026-10-11).** The test that counts is one spoken setup price to one named person, with the public repo disclosed, and a recorded pay, refuse, or silence. The five Sample-mode watches, experiments 1, 2, and 5, and the $79 license decision are out of this pass. The paragraphs below are the earlier proposal, kept so the cut is visible.

**Days 1–30.** No billing code. No landing-page price. Pick five operators who match the ICP and are not you. Watch each one use Sample mode without helping. Write the stuck point and the "what would you open tomorrow" answer. Keep the second cloud deferred.

**Days 31–60.** If at least two people described a real job, offer one of them a paid setup with a specific number, spoken, not posted. If both laugh, stop selling. If one pays, do the work in their account with them pressing the dangerous buttons. Write down what they thought they bought.

**Days 61–90.** Only if money moved: decide between repeating the setup (model G) or a $79 packaged license (model E). Still no hosted multi-tenant app. If no money moved, leave the repo as a personal instrument, add a license so the legal status is clear, and do not build Stripe.

### 9. Recommendation

**VALIDATE FIRST.**

Do not monetize the current build with a subscription. Do not pivot the code. Do not treat a polished personal console as proof of a company. The next fact that matters is a person who is not the author, using the page on a real broken path, and either paying or telling you the console was enough.

---

## Premises to confirm or reject

1. The product to judge is the local Cloud Spider page, not the unbuilt cloud-platform lab service. Agree or disagree?
2. A hosted multi-tenant SaaS is out of scope for this strategy because it is a different trust model, not a feature. Agree or disagree?
3. The first acceptable payment is a one-time setup or a one-time license, and only after a conversation. A monthly seat is not the default. Agree or disagree?
4. Today's map, Path, Cluster, bill, and stacks stay free in the public repo if the repo stays public. Agree or disagree?

## Assignment

Watch one specific person use Sample mode without helping. Then ask them what they would open tomorrow if the page disappeared, and whether a broken load balancer in their account would make them want you sitting next to them. Write their words down. That note is the next revision of this document.

---

## CEO review ledger

Review depth: strategy-only. Base branch: `main`. Platform: GitHub.
Design input: `docs/business/monetization-strategy.md` and `~/.gstack/projects/cloud_spider/gabdzo-main-design-20261011-monetization.md`.
Explicit mode requested: HOLD SCOPE. Provenance: the invoking message named HOLD SCOPE, so no mode question was asked. Handoff: `Mode: HOLD SCOPE; approved decisions: WTP-EXP: B...` Product code changes in this plan: 0.
Prior learning applied: `cloudspider-loopback-single-account` (confidence 9/10, 2026-10-11).

| ID | Owner | Contract and evidence | Current | Proposed | Status | Exact approval and scope |
| --- | --- | --- | --- | --- | --- | --- |
| WTP-EXP | Founder | What counts as the willingness-to-pay test. Evidence: §6 experiments 1–5 and §7.8 30/60/90. No payment has occurred. | Ninety-day sequence: five Sample-mode watches, then a quote only if two people describe a job, then a $79 license decision | One spoken setup price to one named person, public repo disclosed, record pay, refuse, or silence. No other experiment in this pass. Zero product code. Map, Path, Cluster, bill, and stacks stay free. | approved | User selected B on D1 (WTP-EXP), 2026-10-11. Scope: one spoken setup price, one named person, public repo disclosed, outcome is pay or refuse or silence. Experiments 1, 2, and 5, the five Sample-mode watches, and the $79 license are out of this pass. Subscription offer (option C) declined. |

Approval readiness: PASS. The only ledger row is WTP-EXP, approved by the user's B answer on D1. Accepted work is that conversation and the same-day outcome line. Deferred and declined work is outside accepted scope.

## currentDecision (WTP-EXP)

Commitment comparison:

```text
Commitment | Source | Current | A | B | C
WTP test | strategy §6–§7.8, unresolved | five experiments over 90 days | keep that sequence | one spoken price | a subscription offer
Product code | user: do not write implementation code | 0 files | 0 files | 0 files | new hosted product, out of hold scope
Price | §4 assumption A3, not offered | $750 setup hypothesis, $79 license hypothesis, $29 counterfactual | same, spoken later | one number spoken once, not published | monthly seat, no evidence
What stays free | §6 matrix | map, path, cluster, bill, stacks | unchanged | unchanged | would gate the page
Recurring revenue | §7 rank 7 | not the default | still not tested | still not tested | claimed, unsupported
```

Question: D1 — WTP-EXP: Which test is allowed to count as willingness to pay?
Project/branch/task: cloud_spider on main, commercial review of docs/business/monetization-strategy.md
ELI10: The strategy tells you to spend a month watching people click Sample mode before anyone is asked for money. Watching teaches you whether the page is confusing. It does not teach you whether anyone will pay. A subscription would pretend the page is a hosted product. The server only listens on your own laptop. Pick the test that is allowed to change the verdict.
Stakes if we pick wrong: A month of notes and still no price, or a monthly offer for software that is already public and free to clone.
Recommendation: B because a refusal at a spoken price is evidence, and a Sample-mode session is not.
Note: options differ in kind, not coverage — no completeness score.
Pros / cons:
A) Keep the 90-day sequence
  ✅ You learn where five operators get stuck before you mention money, which protects you from pitching a page they cannot start.
  ✅ The quote still happens later, and only after two people describe a real job, so you do not invent a buyer.
  ❌ Days 1–30 can end with zero prices offered, so willingness to pay stays unknown.
B) One spoken price, one person (recommended)
  ✅ One named person hears one setup price and the fact that the repo is public, then pays, refuses, or goes silent.
  ✅ Zero product code. The page stays as it is. The only new artifact is their answer.
  ❌ One person is a noisy sample. A yes might be a favor, and a no might be the wrong person.
C) Offer a subscription now
  ✅ A monthly price would tell you if anyone wants the page as a recurring product rather than as an afternoon of help.
  ✅ Hava and Vantage already sell recurring cloud tools, so the question is a real market shape.
  ❌ The offer implies accounts and hosting that this repo does not have, and hold scope forbids building them to find out.
Header: WTP test
A) Keep the 90-day sequence
The document's days 1–30 watch five people use Sample mode before any price. Days 31–60 quote a setup only if two of them describe a job. Days 61–90 may test a $79 license. Effort S (human: ~30 days / CC: 0 code). Risk medium. Reuse: the existing page. Verification: conversation notes, not a payment.
B) One spoken price, one person (recommended)
One named operator hears one setup price, hears that the repo is public, and pays, refuses, or goes silent. Effort S (human: one conversation / CC: 0 code). Risk low. Reuse: the current local page and an invoice outside the app. Verification: money, a no, or silence.
C) Offer a subscription now
Put a monthly seat on the table before anyone has paid for time. Effort XL (human: months / CC: a new hosted product). Risk high. Reuse: almost none. The server listens on 127.0.0.1 and has no accounts. Verification would require a product this review is not allowed to design.
Net: Notes about the page versus one yes-or-no on money, versus a subscription the software cannot deliver.

## 0A–0C (strategy)

**0A.** The pain worth money is a person who wants you sitting with them on their own account. The strategy's 90-day watch measured whether the page is confusing. That is a proxy. Do-nothing for a stranger is the AWS console, Cost Explorer, and kubectl, at $0. WTP-EXP B tests the pain directly: a spoken price, then pay, refuse, or silence.

**0B.** Nothing in the repo bills anyone. `package.json:14` dependencies are AWS SDK clients and `yaml`. The experiment reuses the existing page and an invoice outside the app. Rebuilding the page into a hosted product is worse: `src/server.js:2126` listens on `127.0.0.1`, and Take down is a typed-name destroy.

**0C.**

```text
CURRENT STATE                         THIS PLAN                         12-MONTH IDEAL (hold scope)
Local page, $0 revenue, 0 stars  -->  one yes/no, product unchanged -->  repeated paid sittings, or it stays a personal tool
```

A hosted seat is not the 12-month ideal under this mode.

## 0G HOLD SCOPE

Complexity: 0 product files, 0 new services. The minimum that can falsify "someone will pay" is one conversation. The 90-day sequence, experiments 1, 2, and 5, and the $79 license were deferred by the user's B answer and written to `TODOS.md`. Invariants kept: map, Path, Cluster, bill, and stacks stay free; no billing code; the buyer presses Take down.

## 0I What the founder needs before the sentence

| Hour | What must be true | Effort |
| --- | --- | --- |
| 1 | One named person. "Setup" means you sit with them, they run the page on their machine with their AWS profile, you help them read one path. You do not take their credentials. You do not press Take down. | human: name them / CC: 0 |
| 2–3 | One number you would do that sitting for. Say it once. Do not add "or whatever is fair." Coffee, a favor, or "I'll owe you" counts as refuse, not pay. Pay means money moves. | human: one sentence / CC: 0 |
| 4–5 | If they ask for a team login, a hidden source, a second price, or for you to press Take down: decline. One number. Seven days of no reply is silence. | human: the reply / CC: 0 |
| 6+ | The same day, append one line here: who, the number, pay / refuse / silence, and their sentence. If the line is missing, the experiment did not happen and the verdict stays VALIDATE FIRST. | human: one line / CC: 0 |

No product feasibility blocker. The dollar amount is chosen in the conversation. It is not a second plan decision.

## Review sections (strategy-only)

Prior learning applied: `cloudspider-loopback-single-account` (confidence 9/10, 2026-10-11). A second learning, `typed-name-before-destroy` (confidence 10/10, 2026-10-09), is why the sitting does not include you pressing Take down.

### Commercial answers

| Question | Answer | Evidence |
| --- | --- | --- |
| Would customers pay? | Unknown. Nobody has been asked. | No invoice, 0 stars [measured: `gh repo view` 2026-10-11], repo created 2026-10-09 |
| Painful enough? | Not shown for a stranger. The console is the status quo at $0. Your own daily use is not demand. | Strategy §1 and §2. The B test is the measurement |
| Defensible advantage? | Real, not a moat. Local credentials, the path sentence, and credit-aware bill are taste and a security choice. k9s and the console are free. Public source with `licenseInfo: null` cannot be gated. | `src/server.js:2126`, GitHub license null |
| Recurring revenue? | Not from this pass. A sitting is cash once. A seat needs shared hosted state this repo does not have. | `package.json:14` has no billing client |
| Pricing realistic? | $750, $79, and $29 are labeled assumptions, not offers. Hava at $59/month is a team diagram product [re-measure before gate]. Do not publish those numbers. Say one number you will actually do the work for. | Strategy §4 assumption A3 |
| Acquire without ads? | Only if you can name the person. One conversation is the whole channel. If you cannot name them, there is no experiment. | WTP-EXP B |
| What stays free? | Map, Path, Cluster, vaults, bill, stacks, labs, Sample mode. The public repo stays public. | User B scope |
| What is worth paying for? | One sitting of your time. Not a feature flag. | 0I hour 1 |
| SaaS vs sponsorships? | Both are weak first tests. Sponsors need an audience this repo does not have (0 stars; GitHub's own sponsor fee is not the blocker). A seat bills for a localhost app anyone can clone. The scarce thing is your time. | Stars measured; `src/server.js:2126` |

Flag, not fixed (`REPO_MODE` collaborative, and it is a legal choice): the public repo has no license (`licenseInfo: null`). You cannot yet call the gift open source, and you cannot sell the bits you already published. EX280 in the labs is a trademark if those labs are sold. Neither is part of this pass.

### 1. Architecture

System diagram for the only new flow:

```text
Founder -- one number + "the repo is public" --> Named person
Named person -- pay | refuse | silence ---------> one line in this doc
pay --> sitting on their machine; they press Take down
refuse or silence --> stop; no SaaS, no license, no ads
```

Dependency: the existing local page. No new service. The strategy's subscription rank stays last. No new approach decision was needed after WTP-EXP.

### 2. Error and rescue

Capability level. Implementation owner must prove the outcome line exists the same day. There is no code path.

| Error | Class | Trigger | Handler | User result | Test |
| --- | --- | --- | --- | --- | --- |
| Silence | upstream | No reply in 7 days | Write "silence". Do not send a second price | Experiment ends | The line says silence |
| Favor | validation | Coffee, "I'll owe you", a compliment | Count as refuse | No invoice | The line says refuse, favor |
| Hosted-team ask | scope | "Can my team log in?" | Decline | They keep the public repo | The line notes the ask. No build |
| Take-down handoff | security | They offer you the keyboard | Refuse the keypress | They type the name, or you skip destroy | You never hold their credentials |
| Haggle | business | "What about half?" | No second number in this conversation | First number stands, or they refuse | One number in the line |
| Never started | process | No person named | Not a result | Verdict unchanged | No line means not run |

No catch-all in code, because there is no code. The failure that looks like success is treating a compliment as payment. Pay means money moved.

### 3. Security

No new endpoint, credential, or hosted role. Threat: you accept their AWS keys or press Take down. Rescue is in the table above. The loopback bind stays. Prior learning `typed-name-before-destroy` applies to their keypress, not yours.

### 4. Data flow and interaction

```text
not started --> number spoken --> pay | refuse | silence --> line written
```

Empty state: no person named, so no result. Stale state: a verbal "sounds good" with no money is refuse. Back button: you do not chase a second price in this pass. Slow reply: 7 days, then silence.

### 5. Quality

No new module. The over-build to avoid is Stripe, accounts, or a license key while `src/` is public. Quality bar for this pass: the outcome line matches the table, including favors counted as refuse.

### 6. Tests

No product test. The regression this replaces: building billing because someone liked the page.

| Path | Expected | Where it is proved |
| --- | --- | --- |
| Happy | Money moves, then the sitting, they press dangerous buttons | Outcome line says pay, then a one-line note of what they thought they bought |
| Refuse | They say no, or they offer a favor | Outcome line says refuse |
| Silence | No reply in 7 days | Outcome line says silence |
| Upstream | They ask for a team login | Declined in the line. No code |

### 7. Performance

No new code path. No scale target. A sitting is one person. Cost Explorer stays their AWS bill.

### 8. Observability

The only signal is the outcome line in this file. If it is missing, the experiment is invisible and the verdict must not move. No metrics vendor. No dashboard.

### 9. Deployment

Nothing ships. Rollback is: do not send an invoice, do not post a price, do not start a second conversation in this pass. Partial "deploy" risk is quoting the number in a public README. The approved scope is spoken, not published.

### 10. Long-term

Reversibility: 4/5. You can stop after one sitting. The residue is an expectation you might repeat, not a billing system to unwind. It does not create a billing system to unwind. Future harm to avoid: a seat roadmap copied from Hava before a second person has asked. Six months out, the honest outcomes are repeated sittings or a personal tool.

### 11. Design

SKIPPED (no UI scope). The accepted experiment does not change a screen, a component, or a user-visible state of the page.

## NOT in scope

- Five Sample-mode watches, path-timing notes, the clone-versus-pay test, and the $79 license. Deferred to `TODOS.md` by WTP-EXP B. Reason: they do not test willingness to pay.
- A subscription, accounts, hosted AWS roles, a landing-page price, and ads. Declined with option C, or excluded by the user's hold-scope instruction.
- Choosing a LICENSE. Flagged. Legal, and not required to speak one price.
- Redesigning the page.

## What already exists

- Local page: map, Path, Cluster, vaults, bill, stacks, labs, Sample mode. `npm start` via `package.json:9`. Listens on `127.0.0.1:9241` (`src/server.js:2126`).
- No accounts, billing, or license enforcement (`package.json:14` dependencies; GitHub `licenseInfo: null`).
- Public repo, 0 stars, 0 forks [measured: `gh repo view` 2026-10-11].
- Second cloud already deferred in `TODOS.md` (2026-10-09).

## Dream state delta

This plan moves exactly one step: from "no price has been spoken" to "one person has answered." It does not move toward a SaaS. That is the point of hold scope.

## Error and rescue registry

See section 2. Every row is a conversation failure. RESCUED = the outcome line. TEST = that line. USER SEES = an honest end, or no change if the experiment never starts. No code catch-all.

## Failure modes

| Mode | What you will be tempted to conclude | Required conclusion |
| --- | --- | --- |
| They praise the page and do not pay | "Demand exists" | Refuse. Demand was not paid |
| A friend pays as a favor | "WTP confirmed" | Treat as a favor unless the amount matches the spoken number and is not a token |
| They ghost | "Try ads" | Silence. Stop this pass |
| They pay | "Build seats" | Do the sitting. Do not start a subscription design |
| You never ask | "The strategy is done" | The experiment did not happen |

```text
CODEPATH              | FAILURE MODE              | RESCUED? | TEST? | USER SEES?        | LOGGED?
spoken price          | silence for 7 days        | Y        | Y     | experiment ends   | Y outcome line
spoken price          | favor or compliment       | Y        | Y     | counted as refuse | Y outcome line
spoken price          | ask for a team login      | Y        | Y     | declined, no build| Y outcome line
spoken price          | they hand you the keyboard| Y        | Y     | they type, or skip| Y outcome line
spoken price          | they haggle               | Y        | Y     | one number stands | Y outcome line
spoken price          | you never name a person   | Y        | Y     | verdict unchanged | Y absence of a line
```

0 rows with RESCUED=N, TEST=N, and USER SEES=Silent. Critical gaps: 0. Owner of every Y: the founder, the same day.

## ASCII diagrams

Flow and state are in sections 1 and 4. No new pipeline, dependency graph, or product decision tree. The commercial decision is already approved:

```text
WTP-EXP B (approved) --> speak one price --> record pay | refuse | silence
option C (declined)  --> do not build
90-day sequence      --> TODOS.md
```

Error flow:

```text
silence | favor | haggle | team-login ask | keyboard offer
        --> write the matching word in the outcome line
        --> do not send a second price and do not open a pull request
```

Deployment: nothing ships. There is no binary, flag, or host.

```text
conversation --> outcome line in this file --> stop
```

Rollback:

```text
regretted the ask --> do not invoice, do not post the number, do not chase
```

## Stale-diagram audit

The 30/60/90 calendar in section 7.8 of this file is stale as an operating plan. A supersession banner was added on 2026-10-11. The ranking table (model G first, subscription last) still matches the approved test.

## Implementation Tasks

Synthesized from this review's findings. Each task derives from a specific finding above. No product code.

- [ ] **T1 (P1, human: one conversation / CC: 0)** — founder — Speak one setup price to one named person
  - Surfaced by: WTP-EXP B and section 2 — a Sample-mode note is not a payment
  - Files: `docs/business/monetization-strategy.md` (one outcome line, after the conversation)
  - Verify: the line names the person, the number, and pay, refuse, or silence, using the section 2 definitions. A favor is refuse. Absence of the line means the experiment did not happen.

_No new tasks from sections 1, 3, 4, 5, 6, 7, 8, 9, 10, or 11._ The other findings are constraints on that conversation, not extra work.

## Completion summary

- Depth: strategy-only. Mode: HOLD SCOPE, explicit in the user message.
- Approved: WTP-EXP B. Declined: option C. Deferred to TODOS.md: five watches, experiments 1, 2, and 5, $79 license (4 items).
- Product diff: 0 files.
- Lake score: N/A (D1 options differ in kind, not coverage).
- Outside voice: Codex CLI returned AUTH_FAILED. Outside coverage is unavailable. `codex login` is the fix. No native fallback: this host has no Plan subagent and no TaskOutput tool.
- PLAN_REALITY: phase=ceo rows=7/7 missing=none unverified=0 verdict=complete
- Design doc checked for instructions aimed at the reviewer. None found. It says not to implement billing until you approve, which matches your request.

REALITY: premise-table pass "0 stars, null license, loopback bind, no billing dependency" gh-repo-view package.json:14 src/server.js:2126
REALITY: already-done pass "origin/main has no commit since 2026-10-11 touching the strategy doc; the doc is untracked" docs/business/monetization-strategy.md:1
REALITY: surface-check pass "no new CLI flag or HTTP route in this plan" package.json:9
REALITY: binding-decisions pass "second cloud stays deferred; typed-name destroy stays theirs; this pass does not reintroduce a hosted seat" TODOS.md:3
REALITY: numbers pass "stars 0 forks 0 measured; $750 $79 $29 remain estimated assumptions; Hava $59 is re-measure before gate" docs/business/monetization-strategy.md:455
REALITY: deferred-asks pass "five watches, experiments 1 2 5, and the $79 license are in TODOS.md" TODOS.md:16
REALITY: pr-count pass "no .gstack/ship-policy.json; default one PR; this pass changes no product PR" TODOS.md:16

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 1 | CLEAR | mode: HOLD_SCOPE, 0 critical gaps |
| Outside Review | Codex CLI, automatic after the CEO sections | Independent 2nd opinion | 3 | unavailable | AUTH_FAILED; no completed external review |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | ISSUES OPEN | 12 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 1 | CLEAR | score: 4/10 → 8/10, 6 decisions |
| DX Review | `/plan-devex-review` | Developer experience gaps | 1 | ISSUES OPEN | score: 4/10 → 6/10, TTHW: >10 min cold shell → <2 min |

**OUTSIDE COVERAGE:** provider codex, phase plan-review, completion unavailable. This attempt returned AUTH_FAILED. Two earlier attempts on 2026-10-09 were also unavailable. No completed external review. Native fallback was not run: this host has no Plan subagent and no TaskOutput tool.

**VERDICT:** CEO CLEAR on the one-conversation test. Prior eng review is ISSUES OPEN, so eng review required. This pass writes no product code.

NO UNRESOLVED DECISIONS

## Follow-ups, 2026-10-11

These two notes were written after the review above, because the review was hard to read. They do not change the approved test: one spoken setup price, one named person, pay or refuse or silence. No product code.

### Similar products, and whether someone would pay

People already pay for pieces of this. They pay so a team can share a live picture of several cloud accounts. They do not pay for a nicer page that one person opens on their own laptop. Cloud Spider is that second thing.

Nothing here is a receipt with the author's name on it. It is other companies' price pages, checked 2026-10-11. It shows which job has a buyer. It does not show that a stranger has paid for Cloud Spider. The repo still has 0 stars.

The paid job is: draw what is running, keep the drawing updated, and let other people open it.

| Product | What you pay | The price | What the money buys |
| --- | --- | --- | --- |
| [Hava](https://www.hava.io/pricing) | Yes, companies do | $59/month for one person. Their site says 3 cloud accounts. The [AWS Marketplace listing](https://aws.amazon.com/marketplace/pp/prodview-swycbotnjyum2) says 5 accounts for that same $59. Teams is $249/month for unlimited users and 10 accounts. An extra account is $15/month. | A shared, auto-updating diagram of AWS, Azure, and GCP, plus history of what changed. After the trial, their own free tier is one cloud account. |
| [Cloudcraft](https://www.cloudcraft.co/pricing) | Included with Datadog | $0 on top of whatever you already pay Datadog. Datadog's own bill is a separate, often large, contract. | The same kind of live AWS diagram, inside a monitoring product the company already bought. |
| [Vantage](https://www.vantage.sh/pricing) | Yes, for the bill | Pro is $30/month, up to $7,500 of tracked spend and 5 users. Business is $200/month, up to $20,000 and 10 users. | A cost tool across many providers, with seats and savings-plan automation. AWS Cost Explorer already shows one account's bill. |
| [Lens](https://www.lenshq.io/pricing) | Usually no, for a solo user | Personal is free if the organization is under $10 million in revenue or funding. Plus is $25 per user per month. | A Kubernetes desktop app. The $25 buys EKS discovery, CVE reports, an AI assistant, and support. The cluster screen itself is on the free plan. |

k9s and Headlamp cover the cluster screen for $0. [Former2](https://github.com/iann0036/former2) is free and turns a live AWS account into Terraform or Pulumi. [CloudMapper](https://github.com/duo-labs/cloudmapper) is the older local AWS map: about 6,300 GitHub stars, and its network diagram is no longer maintained. [StackPort](https://stackport.cloud/) is a free local AWS console aimed at emulators.

The category exists. The solo, local, one-account version is the part these companies give away.

Cloud Spider already does five jobs that other tools split apart: the map, the broken load-balancer path, the cluster, the bill, and the stacks. That combination is real. No product was found that sells that exact page.

Each job, on its own, already has a free answer:

- The map: the AWS console, Hava's one-account free tier, or an abandoned tool like CloudMapper.
- The cluster: k9s, Headlamp, or Lens Personal.
- The bill: Cost Explorer.
- The stacks: the Pulumi and Terraform CLIs already in use.

Hava's $59 is the closest paid neighbor, and the buyer is paying for more accounts and a page a teammate can open. Cloud Spider has one AWS account, one operating-system user, and a server that only listens on `127.0.0.1`. That is the shape of Hava's free tier, with a different look and a path sentence Hava does not write.

For the software, the public evidence says a solo operator will not pay. The products with a checkout sell sharing, extra accounts, or a company rule that says the organization is too big for the free plan. Cloud Spider has none of those. The source is already public, so a download cannot be the thing they buy.

For the author's time, the price pages cannot answer. There is no list price for "sit with me and read this one broken load balancer." That is a favor, a consulting hour, or a no. The test remains: name one person, say one number, and write down whether money moved.

A paid seat becomes a real product when a second person needs the same page without the author's laptop. That feature is not in the repo.

### What would be an edge if this is hosted, with more than one cloud

Multi-cloud and a small server do not create the edge. They are how Hava already charges $59 a month. The edge is one sentence: the request dies at this hop, and here is why. A second person can open that sentence without the author's laptop, and without the server ever joining their network.

`docs/cloud-platform/MVP.md` is a different product. It is a sealed outage exercise, and it leaves out other clouds, EKS, accounts, and a web app. This note is about the Cloud Spider page, and about a later hosted version.

A live map of AWS, Azure, and GCP is the product Hava, Cloudcraft, and Lucidscale already sell. Hosting that map on a small EKS cluster is the cheap part. The expensive part is every customer asking how that server is allowed to see their private load balancers and private clusters.

Public cloud APIs are the easy half. A cross-account role, an Azure service principal, or a GCP service account can list machines, load balancers, and the bill from anywhere. Hava works that way. The server does not need to sit inside their VPC for the map or the bill.

The hard half is the part Cloud Spider is actually good at. A private EKS, GKE, or AKS API, and the nodes behind an internal load balancer, do not accept a connection from a small server run for other people. Peering, PrivateLink, or a VPN into every customer network turns the product into their network vendor.

Take down, stop, and start stay on their side. A hosted button that destroys their stack is the feature that makes a company say no.

Keep Path as a diagnosis, not a picture. Hava draws the security groups. Cloud Spider names the first broken hop: load balancer, listener, rule, target, node, pod. That sentence is the thing their tools do not write. Multi-cloud only helps when one request crosses two clouds and the sentence still names the hop that failed. A second cloud logo on the map does not.

Host the page. Do not host a path into their networks.

1. They run a small read-only collector inside each account or cluster. It uses their credentials. It opens no inbound port.
2. The collector dials out with a redacted snapshot: the broken hop, the cluster health, the bill headline. It does not send keys.
3. The small server only stores those snapshots and shows them to the people they invite.

Multi-cloud then means one more collector, the same outbound call. It does not mean the EKS cluster is peered to every VPC they own. The second person opening the page is the part a team will pay for. The collector is how the sentence arrives without holding their credentials.

One more cloud, after the AWS sentence is something a second person asks to see. `TODOS.md` already says the same thing: copy the region switch once, for one provider, not a matrix of every cloud. Azure and GCP load balancers are different objects. A generic diagram of all three is Hava's roadmap. A sentence that follows one request across two of them is the edge.

The page can stay on the laptop until someone who is not at the keyboard needs the same sentence. Until that person exists, a server and a second cloud are a copy of a product that already has a checkout.

