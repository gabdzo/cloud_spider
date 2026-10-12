# Cloud Spider overnight UI test and fixes, 2026-10-12

Scope: main from `af26cce` (start) to `de3f6f2` (end), tested headless on the box (Chrome via puppeteer-core) from a fresh clone, with `npm ci`, on ports 9301 and up (never 9241). Modes used:

- SAMPLE: `#?sample=1` and `/api/*?sample=1`.
- A fake-live harness: kube snapshot and telemetry fixtures.
- A fake-score harness: the real scorecard API on the test fixtures `fake-kube` and `fake-stacks`. This is the only place where PREVIEW, APPROVE and FIX were clicked.

No AWS or Kubernetes call left the box. **The box has no AWS credentials** (no CLI, no `~/.aws`, no `AWS_*`), so nothing was applied to `cloudspider-up` (see §3).

Every view was screenshotted: MAP, PATH, SNIFF, CLUSTER, VAULTS, STACKS, LEARN, SCORE, CAPS, ASK and settings. Each was taken in both themes (pip, pro) at 760, 1440 and 1920. On every view the sweep also checked console errors, HTTP ≥ 400, clipped text and Escape.

Screenshots are on the `spider-shots` branch under [`overnight-2026-10-12/`](https://github.com/gabdzo/cloud_spider/tree/spider-shots/overnight-2026-10-12):

| folder | contents |
| --- | --- |
| `before/sweep` | main at the start, SAMPLE |
| `before/live` | fake-live: cluster interactions, SCORE scan and fix, panel overlap |
| `before/macfont` | pip with VT323 and Share Tech Mono hidden (Mac widths) |
| `after/sweep` | main at `c68bf7a`, pip and pro at 760/1440/1920 |
| `after/sample-cluster`, `after/live` | SAMPLE Cluster view; fake-live overlap after #183 |

Before/after pairs sit next to each other as `before-*.png` / `after-*.png`.

`npm test` in a fresh clone of `de3f6f2`: **952 tests, 911 pass, 0 fail, 41 skipped**. The skipped tests need the sub-projects' own `node_modules` (`upgrades/`, `upgrades/addons/`); with those installed they pass.

## 1. Bugs found and fixed

Every fix is a small squash-merged PR with a regression test. Each PR was rebased on the latest main and run with `npm test` in a fresh clone before merge.

| # | bug | severity | category | fixed in | evidence |
| --- | --- | --- | --- | --- | --- |
| 1 | Under SAMPLE, SCORE read and scanned the **real** cluster: `GET /api/score`, `POST /api/score/scan`. It showed the live error ("no kubeconfig at …") or the live scorecard, with FIX buttons that install add-ons on the real cluster. | medium | functional / safety | [#187](https://github.com/gabdzo/cloud_spider/pull/187) | [before](https://raw.githubusercontent.com/gabdzo/cloud_spider/spider-shots/overnight-2026-10-12/before/before-sample-score-deeplink.png) · [after](https://raw.githubusercontent.com/gabdzo/cloud_spider/spider-shots/overnight-2026-10-12/after/after-sample-score-deeplink.png) |
| 2 | Writes from another origin were refused with HTTP **200** (refusal body, success status). | medium | security | [#179](https://github.com/gabdzo/cloud_spider/pull/179) | `test/origin-403.test.js` (red on main) |
| 3 | Under SAMPLE, the live read's AWS error stayed on screen and topped the sample. | medium | functional | [#181](https://github.com/gabdzo/cloud_spider/pull/181) | [before](https://raw.githubusercontent.com/gabdzo/cloud_spider/spider-shots/overnight-2026-10-12/before/before-sample-error-1440.png) · [after](https://raw.githubusercontent.com/gabdzo/cloud_spider/spider-shots/overnight-2026-10-12/after/after-sample-error-1440.png) |
| 4 | The SAMPLE Cluster view was the old OpenShift placeholder, not the sample EKS cluster. Lanes, search, K9S, TELEMETRY and OPS showed nothing that matched the map. | medium | functional | [#185](https://github.com/gabdzo/cloud_spider/pull/185) | [after](https://raw.githubusercontent.com/gabdzo/cloud_spider/spider-shots/overnight-2026-10-12/after/after-sample-cluster-ops-1440.png), `after/sample-cluster/` |
| 5 | SCORE had no URL: reload, back and forward lost it. Escape did not close SCORE, nor settings while focus was on the gear. | low | navigation / a11y | [#178](https://github.com/gabdzo/cloud_spider/pull/178) | `test/url-state.test.js` |
| 6 | The scorecard headline said **76** while the reason under it said "overall **75.5** is below 80". Range and export were rounded the same way. | low | content | [#180](https://github.com/gabdzo/cloud_spider/pull/180) | [after](https://raw.githubusercontent.com/gabdzo/cloud_spider/spider-shots/overnight-2026-10-12/after/score-fix-pod-identity.png) |
| 7 | Category tiles were still rounded (platform 76 next to a 75.5 headline). | low | content | [#182](https://github.com/gabdzo/cloud_spider/pull/182) | same |
| 8 | SCORE opened on top of LEARN, STACKS or ASK, so two big panels overlapped. | low | layout | [#183](https://github.com/gabdzo/cloud_spider/pull/183) | [before](https://raw.githubusercontent.com/gabdzo/cloud_spider/spider-shots/overnight-2026-10-12/before/live/overlap-stacks-score.png) · [after](https://raw.githubusercontent.com/gabdzo/cloud_spider/spider-shots/overnight-2026-10-12/after/live/after-overlap-stacks-score.png) |
| 9 | SAMPLE K9S `describe` showed the wrong container state: statuses were not named after their container. | low | functional | [#184](https://github.com/gabdzo/cloud_spider/pull/184) | `test/sample-describe.test.js` |
| 10 | The status line ran two sentences together ("sample, not the account demo/loadgen …"). | cosmetic | content | [#185](https://github.com/gabdzo/cloud_spider/pull/185) | |
| 11 | The settings "from" column broke mid-word ("defaul t", "env PO RT"). | cosmetic | layout | [#186](https://github.com/gabdzo/cloud_spider/pull/186) | [before](https://raw.githubusercontent.com/gabdzo/cloud_spider/spider-shots/overnight-2026-10-12/before/before-settings-pip-1440.png) · [after](https://raw.githubusercontent.com/gabdzo/cloud_spider/spider-shots/overnight-2026-10-12/after/after-settings-pip-1440.png) |

**Feature (Gabriel's 03:21 request): [#177](https://github.com/gabdzo/cloud_spider/pull/177).** The EKS card and stack take `capacityType` ON_DEMAND or SPOT.

- **Spot pools:** SPOT uses a pool of same-memory Graviton types:
  - t4g.medium → t4g / m7g / m6g.medium;
  - t4g.small → t4g.small / c7g / c6g.medium.
- **Node group:** maxPods stays explicit (110) and create-before-delete is kept. A capacityType change is shown as a node-group REPLACE in the preview rules.
- **Card:** the note recommends the cheap HA layout (2 × t4g.medium, SPOT, maxPods 110, 1a + 1b). The $/h and $/day estimate reprices when capacityType changes: 2 spot t4g.medium nodes show **$0.1387/h ≈ $3.33/day** for the whole stack ([card](https://raw.githubusercontent.com/gabdzo/cloud_spider/spider-shots/overnight-2026-10-12/after/after-eks-spot-card.png)).
- **Karpenter:** the NodePool (`upgrades/addons/karpenter.js`) already allows `spot` before `on-demand` and both zones (#176), so it needed no change.

## 2. Left open

| item | severity | why open |
| --- | --- | --- |
| Pro theme: the canvas stays Pip-green, the Stacks panel is translucent, PULUMI badges render as empty boxes. | low | Known. Pro is last priority, and these are not crashes or blockers ([pro sweep](https://github.com/gabdzo/cloud_spider/tree/spider-shots/overnight-2026-10-12/after/sweep)). It needs a design pass, not a patch. |
| At 760 the tally and CAPS LCD text is ellipsized ("2 stopped · 3 running · sample-gate, sam…"), also with Mac font widths. | cosmetic | By design: the full text is in the title and the panel. |
| At 760 the DEBUG input placeholder is truncated. | cosmetic | Minor. |
| The EKS card note is a wall of text. | UX | It needs a layout decision (collapsible "recommended" block?), not a bug fix. |
| The SAMPLE map names the cluster `sample-cluster`; the SAMPLE Cluster view says `cloudspider-up`. | cosmetic | Two separate fixtures. Renaming touches many sample tests. |
| The sample add-ons tree is labelled "LIVE". | cosmetic | Not investigated. |
| DEBUG results do not feed the scorecard. | feature | Not a bug. |
| Kyverno policies → `ValidatingPolicy` migration. | follow-up | Upstream deprecation, not urgent. |
| The debug pod (N8/N9) never ran. | n/a | Needs Gabriel's approval of the target. |
| `K8S-REL-004` remediation opens the EKS card with `nodeCount: 2` only. | suggestion | It could also suggest `capacityType: SPOT`, but that replaces the node group, so it should be Gabriel's call. |

Harness artefacts, not app bugs: `/api/path` 500 in fake-live, OPS "No kube context" in fake-tele, and the minimal fake-tele K9S describe.

**Testing note:** the box sweeps use the box fonts. A pip pass at Mac widths (VT323 and Share Tech Mono rejected through `FONTCONFIG_FILE`, see review-2026-10-11) found only the 760 tally ellipsis above.

## 3. cloudspider-up: spot and multi-zone (not applied)

The teardown was cancelled at 03:21, and nothing was destroyed. The apply needs AWS credentials for 550536272523, which the box does not have, so it was **not** run. The before/after SCAN was not run either. From Gabriel's Mac:

1. `git pull && npm ci` in the repo (and in `upgrades/` if the card asks), then restart the app.
2. STACKS → EKS card: instanceType `t4g.medium`, nodeCount `2`, maxPods `110`, capacityType `SPOT`. SCORE → SCAN first, for the "before" score.
3. PREVIEW. The only allowed change is the node group (+ launch template) create/replace, with create-before-delete. Stop if anything else is deleted or replaced.
4. RUN and confirm. Then RUN the Karpenter add-on card (`karpenter-cloudspider-up`): stop on any delete or replace, and clear only stale locks whose pid is dead.
5. Verify that the nodes are Ready in 1a and 1b with `eks.amazonaws.com/capacityType=SPOT`. Then SCORE → SCAN for the "after" score.

**Estimated daily cost (eu-north-1, list prices, before tax):**

| | before: 1 × on-demand t4g.medium | after: 2 × spot t4g.medium-class |
| --- | --- | --- |
| EKS control plane | $2.40 | $2.40 |
| nodes | $0.83 | ≈ $0.58 (2 × ~35% of on-demand; spot moves) |
| EBS 20 GB gp3 + public IPv4, per node | ≈ $0.18 | ≈ $0.36 |
| **total** | **≈ $3.40/day** | **≈ $3.35/day** (card: $3.33) |

So two zones cost about the same as one on-demand node. There is no NAT gateway. An ALB (Shop API `expose=alb`) would add about $0.58/day.

**Cheap score wins.** On the fixtures the scorecard goes 75.5 → 85.7 → 95.9 → 100 with these steps:

1. Two nodes across zones (K8S-REL-004; NET-K8S-002 also needs 2+ replicas with a zone topologySpreadConstraint).
2. The AWS Load Balancer Controller.
3. Karpenter.
4. KEDA.

The FIX flow in SCORE does each one with PREVIEW → APPROVE ([fixture run](https://github.com/gabdzo/cloud_spider/tree/spider-shots/overnight-2026-10-12/after)).
