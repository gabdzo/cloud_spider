# Cloud Spider: scalable business options

Date: 2026-10-11
Branch: `main`
Status: second commercial assessment. Draft. This file does not replace or edit `docs/business/monetization-strategy.md`.
The approved test there still stands: one spoken price, one named person, pay or refuse or silence, zero product code.
This report asks a different question: if the thing being sold must be software that can charge again next year, which shape is worth testing.

Label key:

- **Fact** — observed in this repository, or on a cited public page, on 2026-10-11.
- **Market** — a competitor price copied from a cited page. Not proof anyone will buy Cloud Spider.
- **Hypothesis** — a price, a buyer, or a cause that has not been tested with a payment.

No application code was changed.

## What this is challenging

**Fact.** The earlier strategy ranks a paid setup (the author's time, sitting with someone) as the first way to get money, and a subscription as the worst fit for the current build. That ranking is about cash this month from the product as it is.

**Position.** That ranking is the right answer for founder hours. It is the wrong answer if the goal is a software business that charges again without another afternoon of the author's time. A setup does not recur. The rest of this file ignores the setup as the business, and keeps it only as a way someone might say yes or no before any new code.

**Fact.** `docs/cloud-platform/MVP.md` is a different product: a sealed outage lab, one scenario, no web app, and it explicitly leaves out other people's accounts, billing, GCP, Azure, and EKS. Nothing in that file is the business under test here. The product under test is the local page in the README: map, Path, Cluster, vaults, bill, stacks.

## Diagnostic record (already in the repo, not a new interview)

These are the office-hours answers the existing files already support. They are uncomfortable because they are thin.

| Question | What the record supports | Label |
| --- | --- | --- |
| Would anyone be upset if it disappeared? | No stranger is on record. GitHub: 0 stars, 0 forks, no license. The author uses it. | Fact |
| What do people do today? | AWS console, Cost Explorer, kubectl, and free cluster UIs (k9s, Headlamp, Lens Personal). | Fact |
| Who is the human? | Not named. The closest role is the person who debugs one load balancer in front of one EKS cluster. | Hypothesis |
| Smallest thing someone might pay for this week? | The path sentence the code already writes. Not a second cloud, not a hosted account system. | Hypothesis |
| Has anyone been watched using it? | No watched stranger is recorded. | Fact |
| More essential in three years? | Only if the sentence still names the broken hop when the request crosses an account boundary. A diagram of more clouds gets less essential, because Hava and Datadog already draw those. | Hypothesis |

**Prior learning applied:** `alb-targets-are-ips` (confidence 10/10, 2026-10-10). Path targets are often IPs, not instance ids. A diagnosis that skips that join is wrong on this account. `typed-name-before-destroy` (confidence 10/10, 2026-10-10). Take down waits for a typed name. That button does not belong on a server other people log into. `cloudspider-loopback-single-account` (confidence 9/10, 2026-10-11). The server listens on `127.0.0.1`.

## What the code already diagnoses

**Fact.** `src/path-diagnose.js` `diagnose()` walks one load balancer in this order: load balancer, listener, rule, target group, target, node, cluster. `headline()` returns the first finding's sentence, or "every edge on this path looks healthy."

**Fact.** Broken sentences already cover concrete cases: no listener, a rule pointing at a missing target group, a target answering outside the matcher, a target refusing the connection, a target not registered, a target not running, an address the load balancer cannot use, an unhealthy target, 502 and 503 counts, a 5xx from the service, a cluster that is not `ACTIVE`, and the first EKS or nodegroup issue.

**Fact.** The walk stops at the cluster. It does not open a Service and a Pod and say which pod is the cause. Cluster (the other tab) can list pods with a read-only kube context. Those two views are not one causal chain.

**Fact.** The walk is read-only. Credentials are the machine's AWS chain plus a local kube context. Nothing in `package.json` is a billing or account system.

**Hypothesis.** The hour an on-call engineer loses is the reconstruction across consoles: load balancer, target group, network, then the pod. The current sentence starts that hour and often ends it at the target. It does not finish it at the pod, and it does not say what to change.

## Diagnosis versus a picture

**Fact.** Companies pay for pictures of infrastructure. Hava Professional is $59/month (the site says 3 sources and 1 user; the AWS Marketplace listing says 5 sources at the same $59). Teams is $249/month. Cloudcraft is included with a Datadog subscription, $0 on top of Datadog. Sources: [hava.io/pricing](https://www.hava.io/pricing), [AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-swycbotnjyum2), [cloudcraft.co/pricing](https://www.cloudcraft.co/pricing). Checked 2026-10-11.

**Fact.** Companies also pay for "why did this break," and they pay more. Komodor's own pricing page is custom (platform fee plus AI tokens). One AWS Marketplace contract is Komodor Enterprise at $150,000 per 12 months with 1,000 vCPUs included, and $132 per additional vCPU per 12 months. Source: [Komodor pricing](https://komodor.com/platform/pricing-and-plans/), [AWS Marketplace](https://aws.amazon.com/marketplace/pp/prodview-d32vxllvsjbj6). That SKU is an enterprise contract, not a starter price.

**Position.** A diagram is the weaker product to copy. Hava already sells it, and the free tier of that category is one account on one machine, which is what Cloud Spider is today. A sentence that names the broken hop from the load balancer into the cluster is the stronger product, because the picture tools do not write it and the Kubernetes tools start on the inside of the cluster. Komodor's marketplace reviews describe crash loops, image pulls, and OOMs. They do not describe "the target group has no healthy pod because the security group dropped the health check."

**What would change this position.** A named on-call engineer says the console plus kubectl already answers in two minutes, and refuses a price. Then the sentence is a nice view, not a product.

## Direction 1: open source, paid Pro features

### Who pays

**Hypothesis.** A platform lead at a company that already cloned the repo and now needs history, more than one account, or a login for a teammate. Not a hobbyist. Hobbyists are who GitHub stars come from, and this repo has none.

### Recurring problem

**Hypothesis.** "The free page is on one laptop, and the person who got paged is not at that laptop." That problem is real in the abstract. It is not evidenced here.

### What they would pay monthly or yearly

**Hypothesis, not a list price.** $29 to $79 per user per month is the band Lens and Hava already occupy for a seat ($25 Lens Plus, $59 Hava Professional). Charging that for a Pro flag on a public repo only works if Pro is something the public repo does not already contain.

**Fact.** Path, the map, Cluster, the bill, and stacks are already in the public tree. A Pro flag on those screens can be deleted by anyone who can read `src/`.

### Differentiated features that already exist

The path sentence. Credit-aware bill. Typed name before destroy. Sample mode. None of these are a Pro feature yet, and the first one is the only one a stranger cannot get from k9s plus the console.

### Absolutely necessary before this is a business

**Fact.** A license file. The public repo has `licenseInfo: null`. You cannot honestly call it open source, and you cannot cleanly separate "free forever" from "paid" until that choice exists. This is not legal advice.

**Hypothesis.** The paid code has to live somewhere the clone does not include: a hosted add-on, or a closed module that is not in this repository. History of path sentences, and a second login, are the only Pro candidates that are not already published.

### Can the local architecture stay

**Fact.** Yes. `npm start` on `127.0.0.1` can remain the free product. Pro would be a second process or a second service. Putting the paywall inside `src/path-diagnose.js` does not survive a public tree.

### Security and maintenance

**Fact.** The free local page keeps the current trust model: keys stay on the machine, Take down stays local.

**Hypothesis.** The maintenance burden is the one that kills open-core hobbies: every AWS API change has to land in the free tree, while the paid tree has no users yet. Support mail becomes the business. That is founder hours again, with a license file.

### Validate before building

Do not add a Pro flag. Publish a one-page note that names the paid thing as "a teammate can open yesterday's path sentence" and put a price on it. Send it to one person who has an ALB in front of EKS. Pay, refuse, or silence. If they say they will pay only if the repo stays public and the feature is in `src/`, this direction is dead.

### Competitors who already get paid

Hava, for the shared picture. Lens Plus, for extras on a local Kubernetes app ($25 per user per month, Personal free under $10 million revenue or funding). Source: [lenshq.io/pricing](https://www.lenshq.io/pricing).

### What would make Cloud Spider better

**Hypothesis.** Pro is the path sentence plus the pod it landed on, shared, with the keys never uploaded. Hava does not write that sentence. Lens does not start at the load balancer.

**Position.** This direction is a poor first recurring business. The thing worth paying for is already public. Open source here is a distribution choice for later, after a paid sentence exists somewhere that is not the public tree.

## Direction 2: commercial local app, annual license

### Who pays

**Hypothesis.** A single platform engineer, or a company that will not run an unsigned clone against production. They pay the vendor so the build keeps working when AWS changes the API.

### Recurring problem

**Fact.** AWS and Kubernetes clients rot. `package.json` already pins a generation of AWS SDK clients. Someone has to bump them.

**Hypothesis.** "I do not want to own this install" is a reason to pay an annual fee. It is a weak reason when k9s and the console are free and already installed.

### What they would pay

**Hypothesis.** $200 to $500 per user per year for a signed local build and updates. The monthly equivalent is about $17 to $42, under Hava's $59 and near Lens Plus at $25 per month. A $79 one-time license, which the earlier strategy floated, is not recurring. Annual, with the build stopping after the year, is the recurring version of that idea.

### Differentiated features that already exist

The whole local page, especially Path. An annual license sells the page as a product you do not compile yourself.

### Absolutely necessary

**Fact.** The source of the paid build cannot be this public tree, or the license is theater. A release channel (a signed binary or a private package), a way to expire it, and a license. Also a decision that Take down stays in the local build and is never the reason for the fee.

### Can the local architecture stay

**Fact.** Yes. This is the only direction that does not add a server. `server.listen` on `127.0.0.1` stays. That is the security property worth keeping.

### Security and maintenance

**Fact.** Keys never leave the laptop. That is the best security story of the three.

**Hypothesis.** You now patch every customer's laptop when the SDK breaks, with no telemetry unless they opt in. You will not know it is broken until they mail you. Annual revenue without a crash report is a support business.

### Validate before building

Put the annual number on a page that offers a build you have not written yet: "Path, on your machine, updates for a year, source of the paid build is not the public learning repo." One person. Do not write a license check first. If they will only pay for a clone of the public repo, they are not a license customer.

### Competitors

Lens proves a local Kubernetes tool can charge, and it charges for EKS discovery, CVE reports, and support, while the IDE is free for small organizations. JetBrains-style annual IDE fees are a different market (daily editor). They are not evidence an AWS console skin can charge.

### What would make it better

**Hypothesis.** The license includes the path sentence and a year of AWS API updates, and the public repo stays a sample. Better than Lens only on the load-balancer hop. Better than Hava only because keys stay local.

**Position.** Possible, and it preserves the architecture. It is a weak recurring business until the install is something a company standardizes. One engineer's annual license does not become a company. It is the right fallback if direction 3's buyer refuses to send any snapshot off the laptop.

## Direction 3: local read-only collector, hosted multi-user page

### Who pays

**Hypothesis.** The on-call owner for a service behind an AWS load balancer on EKS. Title: platform engineer or SRE. What gets them paged: a 502 or a target group with no healthy target. What they pay to avoid: reconstructing that path in three consoles while someone waits. The payer may be their manager, for a seat the whole rotation can open.

A category ("platform teams") is not a customer. The pilot needs one name.

### Recurring problem

**Hypothesis.** The path breaks more than once a year, and the person who can read it is not always the person who got paged. A local page fails that second condition by design. A hosted page of record is what recurs. The collector is how the page gets data without your server joining their VPC.

### What they would pay

**Hypothesis, for a pilot only.** $1,000 per year for one AWS account and one cluster: the path sentence, shared with up to five people on that rotation. About $83 per month. Under Hava Professional ($59/month) on a per-month basis only if you bill the year up front and keep the scope to one account. Over Lens Plus. Far under the Komodor marketplace SKU, which is a different buyer.

**What would change the number.** They counter with a monthly seat, or they say $1,000 is absurd because Datadog is already on the account. Write down their number. Do not negotiate a second price in the same conversation.

### Differentiated features that already exist

`diagnose()` and `headline()`. The bill with credits separated is a side display, not the reason to pay. The map is context for the sentence. Stacks and Take down stay off the hosted page.

### Absolutely necessary (and not before they pay)

1. A collector that is the current local process, or a thin sibling: read-only AWS calls plus the existing read-only kube GETs. It dials out. It opens no inbound port. It does not send access keys.
2. A snapshot that is the headline sentence plus the hop list, redacted (no instance profiles, no env, no secrets).
3. A login for a second person on your small server, and a way to delete the snapshot.
4. The join the code does not have yet: from the unhealthy target to the Service and the Pod. Without that, you are selling a shorter version of the console.

Multi-cloud, a second region matrix, and Take down in the cloud are not necessary for the first paid year.

### Can the local architecture stay

**Fact.** The collector can stay the current program. `src/path-diagnose.js` does not need to move. The hosted page is new and small: it stores snapshots and shows them. It does not call AWS on the customer's behalf.

**Fact.** Moving the whole server off `127.0.0.1` and giving it their role would throw away the security property. That is a different product, and it is the one the earlier strategy correctly refused.

### Security and maintenance

**Fact.** Public AWS APIs (describe load balancers, target health, Cost Explorer) can be called from anywhere with a role. Private EKS APIs and internal load-balancer targets cannot. A collector inside the account is how you see those without peering your EKS cluster to theirs.

**Hypothesis.** The new risks are: a snapshot that contains more than the sentence (account ids in hostnames, a security group id that is sensitive in their shop), a dashboard login that is shared, and a collector that keeps running after they meant to turn it off. Mitigations that have to exist before a second customer: a delete button, a documented list of fields the snapshot may contain, and no write credentials in the collector. Take down stays on the laptop, behind the typed name.

**Hypothesis.** Maintenance is the snapshot schema and the AWS SDK bump in the collector. That is smaller than hosting their kube API. It is still a weekly job once more than one collector is in the field.

### Validate before building

Do not build the dashboard. On one real broken or recently broken load balancer, copy the `headline()` sentence into a message. Offer the $1,000 year for "this sentence, for every load balancer on this account, opened by the rotation, keys stay in your account." Pay, refuse, or silence. Silence for seven days is silence.

If they pay, the first code is the outbound snapshot of a sentence `diagnose()` already produces. The Service and Pod join is the second slice, still before any other cloud.

### Competitors

| They pay for | Who | What Cloud Spider would not copy |
| --- | --- | --- |
| A shared live diagram | Hava, Cloudcraft | The picture as the product |
| Kubernetes troubleshooting inside the cluster | Komodor (custom; marketplace enterprise SKU $150,000 / 1,000 vCPUs / year) | A platform fee sized for a thousand vCPUs |
| A local cluster IDE | Lens, k9s | The cluster tab alone |

### What would make it better

**Hypothesis.** One sentence that starts at the AWS load balancer and ends at the pod, produced by a collector they run, read by the person who got paged. Hava stops at the drawing. Komodor starts inside the cluster. The console makes the human do the join. That join is the only reason to exist next to them.

**Position.** This is the only direction that can be recurring, multi-user, and still keep keys off your server. It is also the easiest to ruin by building the map, the second cloud, and the login before anyone has paid for the sentence.

## Pricing hypotheses (one table)

These are not offers. They are numbers to say out loud in a single conversation, or to throw away if the person laughs.

| Direction | Hypothesis | Recurs? | Why this number |
| --- | --- | --- | --- |
| 1. Open core | Do not price the public tree. Price only an unbuilt shared history: $50 per user per month. | Yes, if the history is hosted | Sits next to Hava's $59 and Lens's $25, and only if the paid part is absent from `src/` |
| 2. Annual local license | $300 per user per year | Yes, if the build stops when the year ends | About $25 per month, Lens Plus's band, for updates rather than a seat |
| 3. Shared path sentence | $1,000 per account per year, up to 5 people | Yes | One account, one cluster, no seat math. High enough that a favor cannot masquerade as a purchase. Low enough that it is not a Komodor contract |

## How a customer would be reached, without ads

**Hypothesis, in order.**

1. One named person who already runs an ALB in front of EKS. A message, not a landing page. This is the same channel as the approved test. The offer is different: a year of the sentence, not an afternoon of help.
2. If they pay, a second person they name on the same rotation. That is the test that it is a team product and not a favor.
3. A single public write-up of one redacted sentence (the hop, the reason, no account id). That is the acquisition page. AWS Marketplace, a second cloud, and ads come after a second team pays. They are not the pilot.

## Minimal paid pilot

**Name.** The path year.

**Who.** One platform engineer or SRE, named, with a load balancer in front of EKS. Not a category.

**Offer, spoken once.** $1,000 for a year. Every load balancer on one account gets the sentence the page already writes. Up to five people on the rotation can open it. The collector runs in their account. Your server stores the sentence, not their keys. Take down is not included. The public repo stays public, so they know they are paying for the shared sentence and the updates, not for a secret binary.

**Before any code.** They pay, refuse, or go silent. A compliment is a refuse. "Send me a link when it exists" is a refuse. Money moved is a pay.

**If they pay, build order.** Outbound snapshot of `headline()` and the hop list. Then the unhealthy target joined to the Service and the Pod. Then a login for the second person. Stop. No second cloud. No Take down on the server. No Pro flags in the public tree.

**If they refuse because keys must not leave the account at all.** Fall back to direction 2's offer in a later conversation, not this one: $300 for a year of the local build. Still no code until that second conversation pays.

**If they refuse because the console is enough.** Stop. Do not build a dashboard to change their mind.

**Architecture preserved.** The local program remains the thing that talks to AWS and kube. The new surface, if it is ever built, is a mailbox for sentences.

## Recommendation

**The recurring-revenue experiment is direction 3's offer, sold before direction 3 is built.**

One named person. $1,000 for the year. The product is the path sentence, shared with the rotation, keys staying in their account. Pay, refuse, or silence.

Direction 1 does not become a business while Path is in the public tree. Direction 2 can recur and keeps the safest architecture, and it loses to free local tools unless a company forbids the clone. Direction 3 is the one a second person can use next year without buying another hour. It stays unbuilt until the $1,000 moves.

**Evidence that would change this.** The named person pays for a local annual license and refuses any snapshot. Then direction 2 is the business. Or they will not pay for the sentence at any number because the console already ends the page. Then there is no software business in this page, and the earlier strategy's "do not monetize the build" stands.

This file does not revoke the approved test in `docs/business/monetization-strategy.md`. It names what the spoken price should be for: a year of the sentence, not an afternoon of help.
