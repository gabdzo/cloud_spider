# Disaster drill, 2026-10-11

## The setup

- **Cluster.** A fresh test EKS cluster, `cs-drill`: EKS 1.32 with one t4g.medium node, in its own VPC (10.43.0.0/16). Created from the Stacks EKS card with "with add-ons": pod-identity, metrics-server, karpenter, lbc.
  - CONNECT then wrote `cs-drill-viewer` to ~/.kube/config. That came back as "not this cluster's viewer" until #81, and the bundle stopped. After #81, INSTALL SELECTED installed pod-identity → metrics-server → lbc in 166s.
- **App.** pgcluster (CNPG, `shopdb`) and shopapi (PostgREST, 1 replica, readiness `GET /items?limit=1`), both from the Stacks panel.
- **ALB.** An Ingress `shop/shopapi` creates an internet-facing ALB (target-type ip, health check `/items` every 10s, 2/2 thresholds). It answered 200 about 2 minutes after the apply.
- **SLOs.** `vaults/shopdrill.yaml` (vault 166) defines:
  - an HTTP check `items` on `http://<alb>/items` (expect 200, contains "stimpak")
  - `items-availability` (check:items, 99%/24h)
  - `items-latency` (check:items, ≤500 ms, 99%/24h)
  - `alb-availability` (alb, 99%/24h)
  - `alb-latency` (alb, ≤300 ms, 99%/24h)
  - `api-restarts` (kube:restarts:shop/shopapi, 99%/24h)
- **Load.** About 4 req/s of `GET /items` against the ALB from the Mac (`load.log`: epoch, code, seconds).
- **Watcher.** A script played the open page every 30s (`/api/vaults`, `/api/cluster`, `/api/view`, `/api/metrics`) and logged each SLO's flag, SLI, budget and burn (`slo.log`).
- **Server.** The test server ran with `CLOUDSPIDER_KUBE_CONTEXTS='cs-drill-viewer:*;cloudspider-viewer:*'`, so cs-drill was the primary context.

## Baseline (12:43)
- The ALB answered 200 with p50 about 85 ms.
- All five SLOs read "ok": SLI 100%, budget 100%, burn 0×. The vault page showed WITHIN BUDGET and a green check, and the metrics strip read 1242 REQ/h, 0 5XX, 2 ms.
- The map, the cluster view (pods shop/shopapi and shopdb-1) and the vault page all showed the app.

Baseline screenshots: `drill/00-baseline-vault.png`, `00-baseline-cluster.png`, `00-baseline-map.png`, `00-baseline-map-1920.png` on the `spider-shots` branch.

## How to read the timings
- **Check SLOs** read the vault's HTTP check, which Cloud Spider runs about once a minute. A failure shows on the next `/api/vaults` read, usually within 30–90 s.
- **ALB SLOs** read CloudWatch in 5-minute periods, behind a 5-minute cache. A failure shows 5–10 minutes later.
- **The radio and health watch** read the primary kube context every 60 s.
- **SLO ledgers** live in memory. The server was restarted once before (b), which resets them.

## Faults (times in Prague, 2026-10-11)

| # | Fault | Start | Real outage at the ALB | First Cloud Spider signal | Detect | ALB SLO | Recover | Back to 200 |
|---|---|---|---|---|---|---|---|---|
| a | `scale shopapi 1→0` | 12:45:05 | 12:45:10–12:55:28, all 503 | check `items` 503, items-* SLOs **spent**, burn 16.7× FAST, BUDGET SPENT lamp, radio "k8s-shop-shopapi… is down", map trouble line | **~90 s** (12:46:36) | alb-availability spent at 12:54:53 (**9 m 48 s**) | scale 0→1 at 12:55:22 | **6 s** |
| b1 | 5xx: CNPG fenced (`cnpg.io/fencedInstances=["*"]`) | 12:58:07 | 12:58:55–13:04, all 503 | check 503, radio "shop/shopapi: not ready (deployment 0/1 ready)" | **~45 s** (12:58:50) | dropped at 13:03:16 (**~5 m**) | unfence 13:03:48 | **16 s** |
| b2 | bad image `postgrest:v0.0.0-nope` (RollingUpdate) | 13:04:40 | **none**; the old pod kept serving | radio "image pull failing (ImagePullBackOff)", health lamp **fail**, pod inspect `ImagePullBackOff` | **18 s** (13:04:58) | not affected (correct) | rollout undo 13:15:57 | n/a |
| c | latency: CPU limit 3m (Recreate) | 13:16:06 (3m at 13:18:34) | 13:20–13:29: all 200, p95 430–476 ms, p99 841 ms; the switch itself gave 503s and 5 s timeouts | items-latency counted one slow check; checks run once a minute, so a 200 at 180–250 ms stays under the 500 ms threshold | weak | **NOT detected**: ALB TargetResponseTime is an average, 0.143 s for the period, under 300 ms | resources restored 13:30:05 | 7 s |
| d | CrashLoop: `args: [--no-such-flag]` (Recreate) | 13:30:37 | 13:30:40–13:34:16, all 503 | radio "CrashLoopBackOff (2 restarts)" and deployment not ready; api-restarts SLO **spent** at 13:32:14; pod inspect `StartError` exit 128, 5 restarts | **32 s** radio, 97 s SLO | already spent from (a) | remove args 13:34:08 | **8 s** |
| f | ALB target health: health check path `/nope` | 13:34:42 | **none**: target unhealthy (ResponseCodeMismatch), and an ALB with no healthy target **fails open**, so traffic stayed 200 | morning HURTING "API k8s-shop-shopapi…: i-09a1… (Target.ResponseCodeMismatch) fails its health check; no healthy target left"; CHANGED "Modify target group" (CloudTrail) | **~2 min** (13:36:35) | not affected (correct) | path `/items` 13:37:43 | target healthy 13:38:23 |
| e | node loss: terminate the only node `i-09a1ba8503a1cc113` | 13:38:31 | 13:38:40–13:46:56 (**8 m 16 s**): timeouts, then 503 | radio: cluster-wide "not ready" (coredns, ebs-csi, lbc, metrics-server, cnpg, shopapi), health lamp warn | **~60 s** (13:39:35) | burns further (was spent) | self-healing: managed node group replaced the node in ~75 s (same AZ 1b), then **EBS Multi-Attach** held shopdb-1 for ~6 min until the volume detached from the dead node | 13:46:56 |

Per-minute load (`drill/summary.txt`): baseline p95 83–92 ms. Each outage minute is 0% OK, with the shape described above.

Screenshots, all on `spider-shots` under `drill/`:
- `a-scale0-*` and `a-alb-*`: the vault page shows BUDGET SPENT, burn 64.3× FAST, a red check "expected 200, got 503", the metrics strip "5XX 1144/h" and the radio "is down".
- `a-recovered-vault`
- `b1-fence-*`, `b2-image-*`, `c-latency-*`, `d-crashloop-*`, `f-targethealth-*`
- `z-after-*`, which includes the map at 1920.

## What worked
- **HTTP checks and their SLOs** caught every hard outage within one to two polls. The vault page reads well: the gauge, BUDGET SPENT, burn ×, FAST, the red check with "expected 200, got 503", and the 5XX in the metrics strip.
- **Kube health on the radio** was the fastest and most specific signal for pod faults: ImagePullBackOff in 18 s, CrashLoopBackOff in 32 s, Pending over 5 min, and node loss as a wave of "not ready". Pod inspect showed the cause, with a StartError exit 128 and the restart count.
- **`kube:restarts:shop/shopapi`** caught the crash loop as an SLO.
- **The morning HURTING card** named the unhealthy target and its reason during (f), while the traffic SLOs correctly stayed green. CHANGED picked up the target-group change from CloudTrail.
- **Recovery** was fast once the cause was removed: 6–16 s from fix to 200.

## Bugs and findings

1. **CONNECT**: it reported success, then said its own context was "not this cluster's viewer", so the bundle stopped. AWS CLI v2 writes `--role`, not `--role-arn`. Fixed upstream in **#81** (ef13409) and re-tested: CONNECT reads "connected", and the bundle installed 3 add-ons in 166 s.
2. **Fresh-cluster viewer could not list nodes.** Only the demo stack bound `cloudspider-viewers`, so the bundle plan said "not counted (the cluster did not answer)". Fixed in **#82** (24ada30): metrics-server binds nodes and metrics. Verified live: the viewer can now `get nodes` and `top nodes`.
3. **ALB availability SLI missed the ALB's own 503s.** With no healthy target, RequestCount was 0 while HTTPCode_ELB_5XX_Count was 1189 in the same period, so the SLI read 53% instead of about 17%. Fixed in **#83** (917be84). Verified live: 2427/4760.
4. **The ALB latency SLI averages TargetResponseTime per 5 minutes.** (c) ran at p95 about 460 ms and p99 841 ms with 5 s timeouts, and the SLI stayed 100%. Suggestion: use the `p99` (or `p95`) extended statistic for latency SLOs. **Not fixed.**
5. **The ALB SLO takes 5–10 minutes to detect**: 5-minute periods plus a 5-minute cache. It is also only fed while a map page is open (`/api/metrics`); `/api/vaults` alone never loads metrics. Suggestion: refresh metrics for vaults that have ALB SLOs. **Not fixed.**
6. **`kube:*` SLOs only read the primary context**, the first one in cloudspider.contexts.yaml. A CONNECTed cluster's vault shows `nodata` until it is made primary; for the drill, `CLOUDSPIDER_KUBE_CONTEXTS='cs-drill-viewer:*;…'` did that. Also, `CLOUDSPIDER_KUBE_CONTEXT` is silently ignored when the contexts file exists. **Not fixed.**
7. **LBC `defaultTags: {project: lbc}` overrides the Ingress's `alb.ingress.kubernetes.io/tags: project=shopapi`**, so an app's ALB is never "owned" by the app's vault. Worked around with `spec.resources.ids`. Suggestion: drop `project` from defaultTags (keep cluster, managed-by and cloudspider), or document it. **Not fixed.**
8. **Check SLOs with a 24h window and one sample a minute**: a single failed check spends the whole budget ("bud=-999", SPENT). That is correct maths for a few minutes of data, but alarming. The ledger is in memory, so a restart resets it. **Not fixed.**
9. **During (a) the morning HURTING card said "Nothing is hurting: 0 of 0 targets"** while IDLE-BILLED said "k8s-shop… has no target", even though the ALB was serving 503s to live traffic. An ALB with traffic and no targets should count as hurting, not idle. **Not fixed.**
10. **(f) HURTING names the node (`i-09a1…`) for an IP target**, which is really the pod `10.43.2.221`. The map fixture stayed "ok". Minor.
11. **(e) The radio said "Pending over 5 min (PodInitializing)"** but not why: the `FailedAttachVolume` Multi-Attach event. Surfacing the newest Warning event for a stuck pod would help. Also, the managed node group spans two AZs and the PV is zonal. Here the replacement landed in the same AZ; in the other AZ shopdb would have stayed Pending until manual action.
12. **The readiness probe goes to the database** (`/items?limit=1`). A DB outage therefore removes every target, and users get ALB 503s rather than the app's own error. That is a design choice; it is why (b) showed up as "no targets".

## Teardown
See the teardown section of `live-test-2026-10-11.md`.

## Screenshots (spider-shots branch)
- Baseline: [vault](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/00-baseline-vault.png), [cluster](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/00-baseline-cluster.png), [map 1280](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/00-baseline-map.png), [map 1920](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/00-baseline-map-1920.png)
- (a) ALB down, BUDGET SPENT: [vault](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/a-alb-vault.png), [map](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/a-alb-map.png); after recovery: [vault](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/a-recovered-vault.png)
- (b1) DB fenced: [vault](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/b1-fence-vault.png), [cluster](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/b1-fence-cluster.png)
- (b2) ImagePullBackOff: [cluster](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/b2-image-cluster.png), [vault](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/b2-image-vault.png)
- (c) latency: [vault](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/c-latency-vault.png)
- (d) CrashLoopBackOff: [cluster](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/d-crashloop-cluster.png), [vault](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/d-crashloop-vault.png)
- (f) target health: [vault](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/f-targethealth-vault.png), [map](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/f-targethealth-map.png)
- After (e) and all faults: [vault](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/z-after-vault.png), [cluster](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/z-after-cluster.png), [map 1920](https://github.com/gabdzo/cloud_spider/blob/spider-shots/drill/z-after-map-1920.png)
