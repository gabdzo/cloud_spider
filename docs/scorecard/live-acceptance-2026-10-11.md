# Scorecard live acceptance, 2026-10-11

Run of [acceptance.md](acceptance.md) against a real EKS cluster. The
operator was Grok Bot on Gabriel's Mac, using a separate clone (main
8c059ad, then c8ff85d after the fixes), port 9260, account 550536272523,
eu-north-1. The cluster was `score-demo` (EKS 1.32, one t4g.medium node).
Times are Europe/Prague. Nothing pre-existing was touched: Gabriel's
`cloudspider-up` cluster, the `upgrade` stack and `pod-identity-cloudspider-up`
were all left alone.

Screenshots (1440 wide, pip + pro) are on the `spider-shots` branch under
[`scorecard/live/`](https://github.com/gabdzo/cloud_spider/tree/spider-shots/scorecard/live).

## Result per step

| # | Step | Expected | Actual | |
|---|------|----------|--------|---|
| 1 | EKS PREVIEW (Task 18) | the scanner's 3 creates in the list | 24 creates, including `pulumi:providers:kubernetes::scanner`, ClusterRole `cloudspider-scanner` and its ClusterRoleBinding | PASS |
| 1 | EKS RUN | cluster up | 24 created in 8m58s (19:34–19:43) | PASS |
| 2 | Auto-CONNECT | "connected by itself" | radio: "EKS score-demo connected by itself after its RUN: CONNECTED as score-demo-viewer (current context unchanged)"; current-context stayed `ppf-helm` | PASS |
| 3 | Low score | AT RISK, < 30, FIX per platform failure, production assumed | **0 / AT RISK**, coverage 73%, "no environment set: production assumed"; FIX on K8S-PLT-001…007 and REL-004 (karpenter) | PASS, after bug 1 |
| 4 | FIX metrics-server | plan → preview → approve → up → rescan, about +30 | plan "needs 2 free pod slots, you have 13" → preview ok → up → rescan **30.6 (+30.6)**, PLT-002 PASS | PASS |
| 5 | FIX Kyverno | score rises | 3 pods / 11 free → **61.2 (+30.6)**, AT RISK → **CONDITIONAL** | PASS |
| 5 | FIX cert-manager | score rises | 3 pods / 8 free → **65.3 (+4.1)** | PASS |
| 6 | Already installed | pod-identity from STACKS, FIX says "already on score-demo", no PREVIEW | stack `pod-identity-score-demo` (3 created); FIX plan and preview both refused: "Pod Identity agent is already on score-demo (stack pod-identity-score-demo)", no Pulumi call; rescan PLT-006 PASS → **75.5 CONDITIONAL** | PASS (see bug 2 for the first rescan) |
| 7 | EXPORT MD / HTML / JSON | `cloudspider-scorecard-score-demo-<date>.*`, verdict first, disclaimer, no evidence | all three, `…-2026-10-11.{md,html,json}`; "**CONDITIONAL** · 76/100"; disclaimer present; JSON `evidence` holds read metadata only (key, read, status, time), no values | PASS |
| 7 | AWS ACCOUNT scan | read-only, UNKNOWN for refused reads | INSUFFICIENT EVIDENCE (5 controls assessed, profile needs 8), coverage 72.3%; gate AWS-SEC-010 FAIL (no multi-region CloudTrail); AWS-SEC-013 FAIL (both EKS endpoints public); 0 refused reads | PASS |
| 8 | Evil origin | "nothing was changed" / "the scan did not run" | exactly those texts (HTTP 200, see findings) | PASS |
| 8 | `stacksRun: false` | FIX 403, SCAN works | FIX POST **403** "turned off in cloudspider.yaml (features.stacksRun)"; SCAN 200, 75.5 | PASS |
| 9 | Take it down | add-ons, then EKS; auto-DISCONNECT | add-ons destroyed (pod-identity 5 s, cert-manager 26 s, Kyverno 1m12s, metrics-server 10 s), then EKS 24 deleted in 9m59s; radio: "EKS score-demo is down: score-demo-viewer removed from the kubeconfig and the contexts (current context unchanged)" | PASS |

Score progression: **0 → 30.6 → 61.2 → 65.3 → 75.5**. The first four
match the reference fake exactly. The fifth is the extra Pod Identity step.
The verdict went AT RISK → AT RISK → CONDITIONAL → CONDITIONAL → CONDITIONAL.

Pod room on one t4g.medium (17 pods): 13 free at the start, then 11, then 8
after the three fixes. Each plan reported this correctly.

## Bugs fixed

1. **SCAN refused a context CONNECT had just added**
   ([#145](https://github.com/gabdzo/cloud_spider/pull/145)).
   - **Symptom:** right after auto-CONNECT, SCAN answered "no kube context
     score-demo-viewer" until a restart.
   - **Cause:** `main.js` handed the score API the context list read at
     start.
   - **Fix:** it now uses the app's live list (`app.kubeOf`).
   - **Re-verified live:** DISCONNECT, then SCAN was refused (context gone),
     then CONNECT, then SCAN gave 75.5 with no restart.
2. **One 429 flipped the verdict**
   ([#147](https://github.com/gabdzo/cloud_spider/pull/147)).
   - **Symptom:** the rescan shortly after the Kyverno and cert-manager
     installs got `429` on `GET policyReports`. K8S-SEC-009 went UNKNOWN,
     coverage fell to 66.7% (the profile needs 70%) and the card said
     INSUFFICIENT EVIDENCE with no number. The scan 20 s later was 75.5
     again.
   - **Fix:** the kube client retries a 429 twice (after 0.5 s, then 1.5 s).
     Unit-tested; the transient was not reproducible on demand.

Both fixes passed the full suite on a fresh clone and were squash-merged.

## Findings (not fixed)

- **Refusals answer HTTP 200.** The evil-origin refusals on `/api/score/scan` and
  `/api/score/fix` have the right text but status 200. Other origin
  refusals in the app (e.g. the agent) answer 403.
- **Rounding.** The headline number and the exports round (76/100), while
  the line under it says "overall 75.5 is below 80". Both are right, but they
  read inconsistently.
- **A single scan error can hide the number.** This includes a transient
  read error (now retried, see bug 2). The card has no "one read failed,
  SCAN again" hint.
- **No URL hash opens SCORE.** Screenshots needed a scripted click on the
  SCORE key (`shot.mjs`, CDP). An `#score` hash would make docs and tests
  easier.
- **Activity in the same account during the run.** CloudTrail shows CreateAddon
  (metrics-server, eks-pod-identity-agent) on `cloudspider-up` at 19:35,
  19:36, 19:54 and 19:56. The last two failed with ResourceInUseException.
  These were not this run: its server ran one job at a time, and was busy
  on score-demo each time. Two of them came from a different provider build
  (Pulumi-Aws 0.11). This matches the demo/add-on ownership work merged as
  #150. They are noted only because they appear in the radio during the run.

## Teardown

20:01–20:15. The order was pod-identity, cert-manager, Kyverno and
metrics-server, then EKS `score-demo`, each through `/api/upgrade destroy`
with its confirm name. The auto-DISCONNECT removed `score-demo-viewer` from
the kubeconfig and the contexts file.

After that:

- `pulumi stack rm` on this run's five stacks: `eks-score-demo`, and
  `pod-identity-`, `cert-manager-`, `kyverno-` and `metrics-server-score-demo`.
  All had 0 resources.
- A sweep of eu-north-1 found nothing left from this run. It checked ENIs,
  security groups, EBS volumes, load balancers, IAM roles, log groups,
  launch templates, instances and EKS. Only Gabriel's `cloudspider-up` and
  its add-ons remain, and they were not touched.
- `~/.kube/config` is **byte-identical** (`cmp`) to the backup taken before
  the run, and the current context is still `ppf-helm`.

## Cost

The cluster existed for about 41 minutes (19:34–20:15). That is the EKS
control plane at $0.10/h, one t4g.medium at about $0.04/h, and a 20 GB gp3
root volume. There was no NAT gateway and no load balancer. Estimate:
**about $0.10**. The add-ons and scans cost nothing extra.
