# Cloud Spider: 15–20 minute DevOps demo

Audience: platform / DevOps engineers. Goal: show that one read-only tool
answers "what do we run, is it healthy, is it reachable, is it ready for
production, what does it cost, and how do I change it safely?".

Start the app with `node src/main.js` and open `http://localhost:<port>/#?sample=1`.
In SAMPLE mode everything is canned: no AWS or Kubernetes calls, and RUN is refused.
Switch themes with the gear (⚙): **Pip-Boy** suits the opening, **pro** suits
the readiness and cost parts. Reference screenshots of every step are on the
`spider-shots` branch under `showcase-2026-10-12/`.

## The story (say it once, up front)

> "This is **cloudspider-up**, a prod-like EKS cluster in eu-north-1. Next to it
> are a **shared-services** VPC (the landing page, an old gateway, a worker) and
> a **data** VPC (an analytics Postgres). They are connected by two VPC peerings
> and a Transit Gateway. Something is broken, something is wasting money and
> one link is only half configured. Let's find all three without opening the
> AWS console."

## Click path

| min | Tab | Click | Talking points |
|----|-----|-------|----------------|
| 0–2 | **MAP** (shot 01) | — | The morning report strip shows what is HURTING, what CHANGED overnight and what is IDLE BUT BILLED. Point out the GLOBAL zone (CloudFront) above the region fence, three VPCs, multi-AZ public and private subnets, IGW and NAT. |
| 2–4 | MAP: ALB dock (shot 02) | `▸ 4 ROUTES` on the shop ALB | The PUBLIC/INTERNET badge, the reach lamp (`200 · 39 ms`) and the routes read from the Ingress and PostgREST's OpenAPI. The EKS card reads "exposed: 4 routes via shop/shopapi", so you can see what the internet can actually reach. |
| 4–6 | MAP: scroll down (shot 01b) | — | **Peering.** Each pipe has its own lane, with a pixel bridge and a lamp. `shared-to-prod` is amber and says **HALF · routes one side only**: shared-services has no route back. `prod-to-data` is green. The **core-tgw** hub on the right has three spokes, all routed. Discovery is read-only (`DescribeVpcPeeringConnections`, TGW attachments, `pcx-`/`tgw-` routes) and handles cross-account and cross-region links. |
| 6–8 | **SNIFF** (shot 03) | `Network` | The path from the internet through the ALB, listener, rule, target group, target and node. One target group burns: "k8s-shop-web has no registered targets", with the cause in plain words. DEBUG runs DNS/TCP/TLS/GET from this machine. Show the `web.sample.test` TRY chip. |
| 8–10 | **CLUSTER** (shots 04, 05) | `Cluster`, then `k9s` | Pod lanes per namespace: loadgen is in CrashLoopBackOff. OPS tabs cover Kyverno policy reports, HPA, Karpenter and events. The k9s window is for people who live in a terminal. |
| 10–12 | **VAULTS** (shot 06) | `Vaults` | Apps as vaults. The perks bar shows which add-ons the cluster has unlocked. App vaults carry SLOs: **Orders API burns its error budget** (burn lamp lit), and OPEN/reach lamps show whether each app answers. |
| 12–15 | **SCORE** (shot 07) | `Score`; then switch to the AWS ACCOUNT tab | The real catalog and scorer, run on a scripted story. Cluster: NO KNOWN BLOCKERS at 93.6, a trend that climbs over 5 scans, an observability category, and FIX NEXT cards with HOW TO FIX and OPEN CARD. AWS: **NET-VPC-004 fails on the HALF peering**, and NET-VPC-007 warns that DNS over the data peering is off. These are the new peering controls (symmetric routes, no overlapping CIDRs, no 0.0.0.0/0 via pcx, DNS). |
| 15–16 | **CAPS** (shot 08) | `Cost sample` | Cost by service and per resource with 14-day bars. WORTH A LOOK flags sample-old-gate as idle but billed, shows spot savings on the node group and a stopped volume that still bills. |
| 16–18 | **STACKS** (shots 09, 09b) | `Stacks` → EKS → `PREVIEW` | Bundles, the NEEDS chips, costs per hour. PREVIEW shows the diff: 2 creates, 1 update, and **one BLOCKED replace** (the node group goes to SPOT with maxPods 110). "RUN stops and asks; nothing replaces nodes by surprise." |
| 18–20 | **RADIO / LEARN / ASK** (shots 10–12) | `Activity`, `Learn`, `Ask` | The radio is the activity feed. LEARN has hands-on labs. ASK answers questions about what is on screen. Search (`/`) jumps to any resource. Close with Q&A. |

## Show live vs sample

- **Live (if an account and a read-only role are ready):** MAP and SNIFF. They
  are the fastest reads and the most convincing on a real account.
- **Always use sample for:** SCORE trend, the STACKS PREVIEW (no pulumi
  against real accounts during a demo), CAPS (Cost Explorer can be slow or
  empty), the HALF peering and the burning SLO. Real accounts rarely break on
  cue.
- Say it clearly: "SAMPLE is made-up data in the real shapes. Every panel runs
  the same code as live."

## Fallback if AWS is slow

1. Flip the **SAMPLE** toggle (top right). It is instant and needs no network.
2. If the laptop or network dies, use the screenshots on `spider-shots` at
   `showcase-2026-10-12/` (pip and pro, 1440 and 1920), in the order of the
   table above.
3. If the cost read hangs, close the CAPS dropdown and carry on: it is
   cached and loads in the background.

## Safety notes

- Everything shown is read-only. In SAMPLE, PREVIEW is canned, and RUN and
  TAKE IT DOWN are refused.
- Never demo RUN against a real account.
