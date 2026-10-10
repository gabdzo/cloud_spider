# Overnight plan (2026-10-10, written by Spider, tech lead)

Rule for the night: "always choose recommended". Work happens on the box clone. No AWS from the box: anything that needs AWS ships as code plus exact commands for Gabriel. Every PR gets: npm test on a fresh clone, headless Chrome at 760/1280/1920 with screenshots on `spider-shots`, Pip-Boy styling (theme vars, no raw hex), and a squash-merge when green with no conflicts.

## 0. What is already planned in the repo, and what Gabriel's agent is doing

Plans in `docs/superpowers/plans/` (all 2026-10-10):

| plan | status |
| --- | --- |
| request-path.md (Path view: ALB > listener > rule > TG > target > node > EKS) | done (#3–#6) |
| current-cost.md (CAPS / month-to-date bill) | done (#13, header in #14) |
| cluster-tab.md (Cluster tab, shared scene) | done for EKS control plane + node groups (#13). Kubernetes objects not read yet; that is item 1 below |
| overview.md (one overview; Pip-Boy parked) | done; Pip-Boy later built anyway (#12) |
| map-overview-dx.md (two-minute read of the map) | mostly done (#12–#16); its "click page/function/ALB opens nothing" complaint is still partly open (item 5) |
| sre-overview.md ("morning sentences", local commit 458703e on Gabriel's Mac, not pushed) | **in flight, Gabriel's agent** (item 3) |

`TODOS.md`: $10/month budget alert (open, deferred), pixel fires (done), map-as-architecture (done).

Gabriel's agent right now (MacBook, `~/dev/cloud_spider`, main ahead of origin by 1):
- 458703e "Plan the SRE overview: morning sentences on the map, rewind deferred." Plan only; no code yet. D1 A (no rewind), D2 A (smaller arrangement). **D3 open**: the source for "object biography" (keep the ungrouped CloudTrail events in `createRadio.refresh`).
- Files it says it will edit: `src/layout.js`, `src/app.js`, `src/browser.js`, `src/server.js`, `src/draw.js`, `test/layout.test.js`.
- Uncommitted: `upgrades/eks/Pulumi.upgrade.yaml` clusterName `cloudspider-up` → `dev-eks-eu-north-1`. The plan lists this file under "Out", so it is a stray local edit, not part of the work.
- Old local branches (`small-displays`, `log-plate`, `radio-quiet-reads` worktree) are already in main or stale. No open PRs on GitHub.

How we stay out of its way: we do not build the morning sentences, idle fire, blast radius or biography. Our hunks in its six files stay small and additive. Every PR rebases on whatever it has pushed. When it pushes a PR, we review it and squash-merge it when green, as tech lead.

## Live evidence (read from Gabriel's running page, 22:30)

Read from his running page at 127.0.0.1:9241, plus `pulumi stack ls`. Read-only.
- eu-north-1 has only the default VPC. No instances, no ALB, no EKS cluster.
- Stacks:
  - infra `test`: 0 resources.
  - eks `upgrade`: 0 resources.
  - eks `eks-cloudspider-up`: 0 resources, an empty stack.
  - signal, barrel: no stack.
  - **camp: 14 resources.**
- Camp fixtures arrive (bucket, function, table, secret, all tagged `project: camp`), and vault 140 owns all 4.
- The other 8 vaults own 0. All 9 have no checks, so their light is `none`.
- The radio shows `fail create function20150331: InvalidParameterValueException: The role defined for the function cannot be assumed by Lambda` (the IAM propagation race), then the retry succeeding. The failed event carries no resource name.

So there is no **existing** EKS cluster today. Item 1 starts with bringing one up.

## Findings for items 4–6

**Why vaults show no resources.**
1. The stacks are down. infra/test, eks, signal and barrel have 0 resources, so there is nothing to match. The new `project` tags only exist after a `pulumi up`.
2. The matcher only sees what the map discovers. `placeResources()` reads `place.instances` and `place.fixtures` and nothing else. Fixtures are ALB and EKS (from `describeDiagram`) plus the camp shelf. These are never candidates, whatever their tags:
   - VPCs and subnets;
   - log groups (test-logs, signal);
   - S3 buckets outside camp (barrel, the state bucket);
   - IAM roles;
   - function URLs.
3. `campFixtures()` drops IAM types and keeps only 4 types on the coarse grain. The function URL (`aws:lambda/functionUrl:FunctionUrl`) is never a fixture, and the camp program exports no URL output. That is why camp has no VIEW link and no check.
4. ID matching works for camp (names), alb-test (`cloudspider-api`) and eks (`cloudspider-up`). The cluster name may change (the stray `dev-eks-eu-north-1`), so tags, or better the stack binding below, should be the source.

**Why camp "did not appear on the map" after `pulumi up`.** It did load. Vault 140 owns all four pieces, and `layout.js` moves owned camp pieces off the map into the vault (`movesIn = owned && !vpcId`). With the door closed they are out of sight. Smaller contributors:
- the shelf cache is 30 s;
- the merge only runs in eu-north-1;
- the shelf only refreshes on `/api/view` (not on the 1 s EC2 poll, which rebuilds `place` without camp until the next view);
- a shelf error only shows as `shelfNote`.

The shelf comes from `pulumi stack export --stack camp`, so no Lambda, DynamoDB or Secrets discovery API (and so no pagination problem) is involved.

**How failures can reach a vault.** CloudTrail events already flow through `aws.js` → `radio.js`. They carry `Resources`, but failed calls usually carry none (as in the evidence). The name is in `CloudTrailEvent.requestParameters`: `functionName`, `bucketName`, `tableName`, `roleName`, `name`, `secretId`, `clusterName`. Parse those and match against the vault's owned names/ARNs and its stack's resource names. Then add per-resource metrics and the last error log lines (item 5).

## Recommended design and PR order

### PR 19: this plan + Ask "thinking…" indicator (small, no overlap)
- `docs/plan-overnight.md` (this file).
- Terminal shows `THINKING… 6s` with a dim spinner from ASK until the first text. Dimmed live progress lines:
  - tool calls (`read src/vault-view.js`, `grep vault`);
  - `thinking` deltas, if the CLI emits them (the docs say print mode suppresses them; handle both).
- Files: `src/agent.js`, `src/terminal.js`, server CSS, tests. None of these are in the in-flight plan.

### PR 20: item 6, templates vs living vaults (recommended: folder-based plus a stack binding)
- `vaults/templates/*.yaml` are never drawn; the loader does not recurse into it. `vaults/*.yaml` are living. `example.yaml` moves to `vaults/templates/example.yaml` (the old name rule stays for compatibility).
- Recommended over `metadata.kind`: a folder is visible in git and in Finder, needs no schema bump, and cannot be half-set.
- New optional living field `spec.stack: { dir: upgrades/camp, stack: camp }`, or `stack: camp` resolved through the Stacks list.
  - The door gets a `LIVE · camp` badge with the stack's resource count.
  - `NO STACK` (dim) when the stack is empty or missing.
- The VAULTS sign gets `TEMPLATES (n)`, a list. "New vault from template" copies a command, `npm run vaults:new -- <template> <name>`, into the clipboard and Ask. No server write endpoint (safer).
- `npm run vaults:check` lints both folders.

### PR 21: item 4, vault cleanup + matching that always finds the vault's resources
- **One living vault per Pulumi stack** (recommended):
  - **keep `cloudspider`** (infra/test), merging alb-test, test-machines and test-logs into it. Tags-only change: infra goes back to `project: cloudspider` everywhere, with a `component: alb|machines|logs` tag so the panel can still group them.
  - **keep `eks`**, bound to the cluster stack(s).
  - **keep `camp`**.
  - **move `signal` and `barrel` to `vaults/templates/`** (Stacks-panel demos, not projects).
  - **drop `pulumi-state`** (account plumbing; discovering S3 just for it isn't worth it).
- Stack-bound resources: generalise `campShelf()` to `stackShelf(spec)` (export cached 60 s, `--stack` always passed). A bound vault owns every resource in its stack, whether or not the map draws that kind: log groups, roles, function URL, VPC, subnets. The panel lists them by kind; map-drawn ones still get the line to the map. Tag/id matching stays for things outside Pulumi.
- Add VPCs and subnets to `placeResources()` so tag-only vaults see them too.
- Camp gets a **real page vault**: export `pageUrl = functionUrl.functionUrl` in upgrades/camp. Vault links: VIEW = stack output `pageUrl`, plus an HTTP check (200 + `<title>`), resolved at runtime from `spec.links.view: { output: pageUrl }`, because the URL changes per deploy.
- Gabriel runs:
  - `cd upgrades/camp && pulumi up --stack camp` (adds the output; no resource change);
  - `cd infra && pulumi up --stack test` only when he wants the test camp back.

### PR 22: item 5, camp on the map + per-vault failure details
- Owned pieces stay on the map. A vault highlights its pieces and lists them instead of hiding them; the closed door shows `4 PIECES` and small icons. This is a small change to `layout.js` `movesIn`; rebase on the SRE work there.
- Add a `url` kind (function URL) to the coarse camp grain.
- `aws.js`: keep `errorCode`/`errorMessage` and the named `requestParameters` for failed events (raw events only; the radio line stays grouped). This is the D3 accessor the SRE plan recommends: one shared raw-event list both features read. We add it only if the in-flight agent has not pushed it first.
- New pure `src/vault-trouble.js`: events + metrics + log lines → `{ resourceId: [{ when, what, why }] }` per vault.
- Metrics: one batched `GetMetricData` per 5 min while the page is visible, covering owned resources only. Lambda `Errors`, `Throttles`, `Invocations`, `Duration`; DynamoDB `ThrottledRequests`, `SystemErrors`; ALB `HTTPCode_ELB_5XX_Count`, `UnHealthyHostCount`; EC2 `StatusCheckFailed`.
- Last error lines: `FilterLogEvents` on `/aws/lambda/<fn>` with `?ERROR ?Error ?"Task timed out"`, limit 3, fetched only when the vault is opened, cached 60 s.
- The vault panel gets a `TROUBLE` block per resource (red rows, time, why), and the vault light turns red on any trouble in the last hour.
- IAM Gabriel's profile needs: `cloudwatch:GetMetricData`, `logs:FilterLogEvents` (already used), `cloudtrail:LookupEvents` (already used).

### PR 23: item 1, EKS demo workload + Kubernetes in the Cluster view
**Prerequisite: a cluster.** Recommended name `cloudspider-up` in stack `upgrade`:
```
cd upgrades/eks && git checkout Pulumi.upgrade.yaml      # drop the stray dev-eks-eu-north-1 edit
pulumi stack rm eks-cloudspider-up --yes                  # empty stack, 0 resources
pulumi up --stack upgrade                                 # or Stacks > EKS > run
```
Cost: control plane $0.10/h plus a t4g.small node at about $0.017/h, so about $2.80/day. Take it down after the demo.

**k8s access (recommended):**
- The eks program gets `accessConfig.authenticationMode: API_AND_CONFIG_MAP`. This is an in-place update (no replacement), and the creator keeps admin.
- It also gets an EKS access entry for a `cloudspider-viewer` IAM role with `AmazonEKSViewPolicy` at cluster scope.
- Gabriel runs `aws eks update-kubeconfig --name cloudspider-up --region eu-north-1 --alias cloudspider-viewer --role-arn <viewer role arn>`.
- The server reads the cluster with `@kubernetes/client-node` (official; handles the `aws eks get-token` exec auth) from that context (`CLOUDSPIDER_KUBE_CONTEXT`, default `cloudspider-viewer`). It uses only list/get/watch plus pods/log. RBAC enforces read-only, not just our code.
- Rejected alternatives:
  - a hand-signed STS token (reimplements auth);
  - `kubectl` subprocesses (slow, shell parsing);
  - admin creds with code-only read-only (no real fence).

**Demo program `upgrades/demo`** (Pulumi k8s, project `cloudspider-demo`, stack `demo`, provider built from the eks stack outputs):
- namespace `demo`;
- `web` (podinfo frontend) → `api` (podinfo backend) → `loadgen` (curl loop, 1 rps), each 1 replica with tiny requests;
- Services for web/api, and an Ingress only if the AWS LB controller exists (otherwise none, which costs nothing);
- namespace `otel`: an ADOT Collector DaemonSet with:
  - a `filelog` receiver on `/var/log/pods/*/*/*.log` (logs);
  - an `otlp` receiver (podinfo sends traces);
  - exporters `awscloudwatchlogs` (group `/cloudspider/eks/cloudspider-up/demo`, 1-day retention) and `awsxray` (traces).
- IAM for the collector via EKS Pod Identity (add-on plus association in the program), not the node role.
- Fits a t4g.small: max 11 pods; about 4 system pods + 4 demo pods.
- All images are multi-arch for arm64.

**Cluster view:**
- Columns: control plane → namespaces → nodes → deployments/pods → services/ingresses.
- Status comes from pod phase, restarts and Warning events.
- Click a pod for the last 100 log lines (pods/log, tailLines=100) and its events, on the Pip-Boy plate.
- Sample mode keeps the OpenShift sample.
- Refreshes every 15 s only on the Cluster tab.

**Gabriel runs:**
- `cd upgrades/demo && npm ci && pulumi up --stack demo`
- `aws eks update-kubeconfig …` as above.

### Design only (item 2): infra monitoring proposal (build later)
Prices are approximate eu-north-1 list prices; check the pricing pages before enabling.

| source | what it gives | cost | recommend |
| --- | --- | --- | --- |
| CloudTrail LookupEvents (have) | changes and failed calls | free (management events, 90 days) | **yes** (already in) |
| CloudWatch metrics via GetMetricData: EC2, ALB, Lambda, DynamoDB | health sparklines per building and vault | metrics are free to emit; reads $0.01 per 1,000 metrics requested. 30 metrics every 5 min while the page is open, about 8 h/day ≈ $0.90/month | **yes**, batched, 5-min, visible-only |
| CloudWatch Logs FilterLogEvents | last error lines | ingest ~$0.50/GB, storage ~$0.03/GB-mo; API calls free within limits | **yes**, on vault open only |
| EKS via k8s API + metrics-server | pod CPU/mem, restarts, events | free (metrics-server add-on) | **yes** for the cluster |
| Container Insights (enhanced) | node/pod metrics in CloudWatch | per-observation or per-metric billing, roughly $5–20/month for one node | no (k8s API covers it) |
| ALB access logs → S3 | per-request codes and latency | S3 storage only, pennies; ALB is down now | later, when the ALB is back |
| VPC flow logs | accepted/rejected flows | ~$0.50/GB to CloudWatch, ~$0.25/GB to S3 | no (low value here; on demand only) |
| X-Ray (from the demo collector) | traces web→api | first 100k traces/month free | yes, demo only |

Pip-Boy display:
- a 12-point sparkline under each door plate and building plate (phosphor ramp, red segment where errors > 0);
- a small gauge needle per vault: requests vs errors in the last hour;
- the TROUBLE block lists the rows.

One `GetMetricData` call (up to 500 metrics) per 5 min, cached server-side, paused when the tab is hidden.

### Item 3: his agent's steps (not ours)
SRE overview from 458703e:
1. Three morning sentences (hurting / changed last / idle but billed), with "not checked" when unread.
2. System names inferred from wires (API, camp, cluster).
3. Idle fire on billed objects; blast radius on the action; object biography on the plate.
4. Target `state` kept on map edges (needed by the "hurting" sentence).
5. Raw resource ids beside short labels, so bill rows meet objects.
6. D3 decision (biography source) and the idle-fire guard are still open.

We review and merge its PRs. We do not build these.

## Order and why
19 (plan + thinking) → 20 (templates) → 21 (cleanup + stack-bound matching) → 22 (camp on map + trouble) → 23 (EKS demo + k8s Cluster view).

Templates come before cleanup, because the cleanup moves files into `templates/`. Matching comes before trouble, because trouble needs ownership. EKS comes last: it is the largest and depends on Gabriel bringing a cluster up, but its code and commands can land without AWS. Each PR rebases on the SRE agent's pushes, and its hunks in layout/app/browser/server/draw stay small.
