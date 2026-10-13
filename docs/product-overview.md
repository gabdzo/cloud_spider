# Cloud Spider: product overview (as of 2026-10-13, main @ #348)

Factual description of what the repository does today, written for an outside review. It is checked against the code (`src/`, `upgrades/`, `scripts/`), `README.md`, `docs/` and the merged PRs #200–#348. It describes, it doesn't sell. Rough edges are listed at the end.

## 1. What it is

- A **local Node.js web app** (`npm start`, serves `http://127.0.0.1:9241`). There is no SaaS, no login and no database. It binds to loopback by default, because it has no auth.
- It draws one AWS account and/or one or more Kubernetes clusters as a game-like map. There are two themes: **pip** (Fallout Pip-Boy: CRT green/amber, pixel sprites, VT323/Share Tech Mono) and **pro** (flat, conventional). Theme tokens live in `src/theme.js`.
- **SAMPLE** mode (a header toggle) draws a whole fake account, cluster, vaults, traffic and bill with no cloud access. It's used for demos and screenshot/overlap tests.
- One developer (Gabriel) built it, largely with AI coding agents, over roughly Oct 9–13 2026 (356 commits on main).

## 2. Modules and profiles

`src/modules.js` holds one registry of modules with dependencies. A profile picks a set, and `modules.enable` / `modules.disable` adjust it. Anything whose dependency is off goes off too, and its API routes return "module off".

| module | needs | surface |
|---|---|---|
| aws | – | AWS SDK clients/credentials |
| map | aws | MAP |
| network | – | SNIFF / Network (path + DEBUG + FROM INSIDE) |
| cost | aws | CAPS (bill) |
| radio | aws | RADIO (CloudTrail activity) |
| stacks | – | STACKS (Pulumi/Terraform cards) |
| vaults | – | VAULTS |
| kubernetes | – | CLUSTER (read-only kube) |
| graph | kubernetes | SERVICES graph |
| timeline | kubernetes | incident review |
| observe | kubernetes, stacks | opt-in in-cluster bundle (live edges, RED, Loki) |
| score | – | SCORE scorecard |
| learn | – | LEARN labs |
| ask | – | ASK (local agent) |

Profiles: **full** (all but observe), **k8s-only** (network, kubernetes, graph, timeline, score, learn, ask; creates no AWS client and needs no AWS credentials), and **aws-only**.

## 3. Views

- **MAP**: VPCs → subnets → instances drawn as a walled "camp", either ARCH or BY TAG, with VPCs you can fold. The EKS cluster is a compound with 1/2/3/AUTO detail levels. Instances tagged `cloudspider=expendable` can be stopped and started (Y/N confirm). The **morning report** above the map lists what hurts, what changed and what's idle but billed, plus LOG ERRORS.
- **SNIFF / Network** (formerly PATH): follows one request through ALB → listener → rule → target group → target → node → EKS and names the first broken or hanging edge. It only reads. The **DEBUG** bar probes a URL you type (GET/HEAD, rate-limited, metadata/link-local addresses refused). **FROM INSIDE** (debug pod) creates a netshoot pod (TTL 300 s) in a chosen namespace with chosen labels, so that NetworkPolicies apply to it. It checks DNS → TCP → endpoints → HTTP hop by hop, explains which NetworkPolicy allowed or blocked the call, and deletes the pod.
- **CLUSTER**: namespaces → ingresses → services → workloads → pods → nodes, with health, restarts and metrics-server CPU/mem. Clicking a pod gives the last 80 log lines, its events and a deep-inspect panel. Sub-views:
  - **SERVICES**: who calls whom, read left to right in STEP columns. Cards show ready pods, endpoints and traffic. Solid lines are live calls measured by Beyla (rps, error %, p95; each failure counted once, over a window of up to 5 min). Dashed lines are links that config/NetworkPolicy allows but where no traffic has been seen (SHOW POSSIBLE LINKS). The side panel shows endpoints, ports and CALLED BY.
  - **TOPOLOGY**: an ownership/structure diagram with its own search.
  - **TELEMETRY**: node gauges, pressure lamps, allocatable vs requested vs used, and the top pods. Data comes from the OTel collector via the kube service proxy, falling back to metrics-server.
  - **K9S**: a keyboard-driven, read-only table modelled on k9s (`:pods :deploy :svc :ing :events :nodes`, logs, describe, redacted YAML). It has no write keys.
  - **LOG ERRORS**: container error lines from Loki (or CloudWatch Logs) with multi-line stack traces folded, fingerprinted and grouped by service, marked NEW or spike vs the previous window. Windows are 1H, 24H and NIGHT.
  - **OPS**: Kyverno policy reports, HPAs, Karpenter NodePools and NodeClaims, KEDA, and events.
- **Incident review** (bottom bar): a timeline of Kubernetes Events, restarts and rollouts. It uses Loki when the bundle is installed (72 h) and the API server otherwise (about 1 h).
- **SCORE**: a production-readiness scorecard. It runs collectors (AWS: CloudTrail, EKS, ELBv2, network, RDS, peering, observability; kube: RBAC, workloads, policy, network, nodes, protection, metrics) and evaluators over a control catalog, with profiles per environment. A missing permission becomes UNKNOWN and is never PASS. Results include evidence and fix hints, plus history.
- **VAULTS**: "projects" defined as YAML files (similar to a Backstage catalog-info). A vault selects resources by tag, id or Pulumi stack, runs HTTP checks and SLOs, and shows TROUBLE (failed CloudTrail calls on its resources) and ERROR LINES. Since #327/#328 each vault has a health chip (UP OK / UP · n ISSUES / DOWN / UNKNOWN), a version chip (LATEST / OUTDATED / owned by another stack), a location line, and a HOW IT CONNECTS diagram (EDGE → SERVICE → WORKLOAD → CONFIG → DATA).
- **STACKS**: Pulumi (and some Terraform) cards in a docked panel, grouped by category (CLUSTERS, NETWORK & EDGE, COMPUTE & APPS, DATA, OBSERVABILITY, DEMO APPS). Each card shows DEPLOYED · n / NOT DEPLOYED and RESOURCES CREATED by type, read from `pulumi stack export`. The actions are PREVIEW, RUN (`up`) and TAKE IT DOWN, plus SCALE DOWN / SCALE UP on the EKS card. Stacks under `upgrades/`: eks, addons, observe, observability, demo, shopapi, rds, pgcluster, barrel, camp, signal, site, worker, openshift.
- **LEARN**: a lab shelf (OpenShift EX280, the same labs for k8s, and cloud-platform scenarios) with tasks, hints and check scripts. Checks run only against lab-looking contexts (kind/k3d/minikube/crc…) and only after a static scan finds no writes.
- **ASK**: sends a question to the local Cursor agent CLI in read-only `--mode ask`, with the current view as context (capped at 16k chars). Proposed actions become buttons that lead into the normal confirm flows. One question at a time, with a 3-minute timeout.
- **RADIO**: the last 15 actions and alarms (CloudTrail). **CAPS**: the Cost Explorer bill for the month to date, its pace and the top services (cached at least 60 min, since each read is billed).
- **Quick-find** (`/`): searches map targets, or works as a global GO TO across tabs.

## 4. Data sources

- **AWS SDK v3**: EC2, ELBv2, EKS, RDS, Lambda, S3 via tagging, CloudTrail, CloudWatch + Logs, Cost Explorer, X-Ray, Route 53, ACM, CloudFront, ECR, Backup, STS. The AWS CLI is used for scaling.
- **Kubernetes API**: GETs only, to a fixed list of paths (`src/kube.js`), through a read-only context (`cloudspider-viewer`: AmazonEKSViewPolicy without Secrets, plus nodes/metrics and `services/proxy` on the collector only). Multiple contexts are supported, each with a namespace allowlist.
- **Pulumi state**: `pulumi stack export` (cached 60 s) for vault ownership, the STACKS resource lists and versions. Git history is used for "latest version".
- **Observe bundle** (`upgrades/observe`, opt-in, installed by Pulumi): Grafana **Beyla** (eBPF DaemonSet that sees HTTP/gRPC/SQL with no app changes; needs privileged pods, and an SCC on OpenShift), an **OTel** agent and collector, kube-state-metrics, and **Loki** (logs and Events). Profiles are `crc` (small) and `standard`, and node agents get a PriorityClass. The app reads collector metrics through the kube service proxy (gzip, keeping the last good read when one is slow).
- **Local files**: `vaults/*.yaml`, and `.cloudspider/` (bill cache, SLO history, run logs, `audit.jsonl`).

## 5. Write actions and their safety

| action | guard |
|---|---|
| stop/start EC2 | only `cloudspider=expendable` tags; Y/N confirm |
| debug pod (FROM INSIDE) | off by default (`network.pod.enabled`); only in contexts listed in `kube.writeContexts`; type the namespace to confirm, and type the context name for "work" contexts (`ppf-*`); unprivileged by default; TTL 300 s; audit log |
| Pulumi PREVIEW / RUN / TAKE IT DOWN | per-stack config schema shared by the card and the program (fail before any resource, did-you-mean on typos, unknown keys refused); read-only EKS preflight (zones, instance types, spot pool); CrossGuard policy pack (`upgrades/policy-pack`: no public/unencrypted RDS, ingress only 80/443, allowed instance types, cost caps); `protect` on data (RDS, pgcluster, buckets), which TAKE IT DOWN lifts only after the stack name is typed; exact-pinned packages; customTimeouts; stale locks cleared and Ctrl-C cancels Pulumi cleanly; every run goes to `audit.jsonl` with secrets redacted |
| EKS SCALE DOWN / UP | dry run with cost before/after, typed-name confirm; saves sizes, can scale workloads to 0, sets Karpenter limits to 0, deletes NodeClaims, sets the node group to 0; SCALE UP restores in reverse; audit log; also a CLI (`scripts/cloudspider.mjs scale`) |
| ASK | never acts; proposals go through the flows above |
| POST endpoints | refuse other origins |

Everything else reads only.

## 6. Install and config

- Requires Node ≥ 22, `npm ci`, `npm start`. The AWS profile is needed only for AWS modules, kubectl/kubeconfig only for cluster views, and the Pulumi CLI only for STACKS and the observe bundle install.
- Config: `cloudspider.yaml` (or `$CLOUDSPIDER_CONFIG`, or `~/.config/cloudspider/config.yaml`). Precedence is defaults < file < env < flags (`--set a.b=c`). A bad key stops the start with file:line, and `/api/config` shows the effective config with sources. `cloudspider.contexts.yaml` holds kube contexts and namespaces (CONNECT writes it).
- Operator-dev path: `docs/quickstart-operator-dev.md` (k8s-only + observe, install the bundle with Pulumi, optional vaults, uninstall, troubleshooting).
- CLI: `scripts/cloudspider.mjs` (validate-vaults, scale, …).

## 7. Target users

- DevOps/SRE running a small AWS account plus EKS who want one local picture of "what runs, what's broken, what costs".
- Operator/platform developers on bare Kubernetes or OpenShift (CRC) who want live service traffic, error logs and in-cluster network debugging without instrumenting their apps (`k8s-only` profile). The first such external user is about to try it.
- Learners (LEARN labs, EX280).

## 8. Tech stack and size

- Plain Node.js ESM. The server and client have no framework: canvas/SVG drawing and hand-written CSS. Runtime deps are the AWS SDK v3 clients and `yaml`; the dev dep is `puppeteer-core` for screenshot/overlap tests.
- IaC: Pulumi JS programs (`upgrades/*`, `infra/`), some Terraform (`terraform/`), JSON schemas (`schemas/`, `upgrades/schema`), a CrossGuard policy pack.
- Size: `src/` + `scripts/` ≈ 54k lines of JS (149 entries in `src/`); `upgrades/` + `infra/` ≈ 5.1k lines of JS; tests ≈ 24k lines in 234 files, ~1,500 `test()` cases with `node --test`, using Pulumi mocks for every stack (3 skipped).
- CI: GitHub Actions `iac` workflow runs `npm test` plus 27 stack configs under Pulumi mocks.

## 9. Known limitations and rough edges

- **Single AWS account/region focus.** Only AWS; a second cloud is deferred. No multi-user mode, no auth: it's a local, loopback-only tool.
- **Heavy footprint for "plug in and go":** a Node app + `npm ci`, plus kubectl, plus Pulumi for the bundle. Live traffic needs the observe bundle (Beyla privileged DaemonSet + collector + Loki, about 0.3+ CPU of requests), which was hard to fit on a small 3-node cluster (scheduling pressure, a PriorityClass was needed). There is no single binary and no kubectl plugin.
- **Beyla limits:** some TLS setups give TCP only; Fargate and tainted nodes aren't covered; it needs privileged pods; cross-service traces through proxies or queues are partial.
- **Scope sprawl:** map, network, cluster, scorecard, vaults, IaC runner, labs, an AI chat and a cost view live in one app. Many views overlap (TOPOLOGY vs SERVICES vs MAP compound; RADIO vs incident review).
- **Demo-grade stacks:** the `upgrades/` stacks were built for Gabriel's own test account. Moving to `@pulumi/aws` 7, components, Helm atomic and a configurable EKS version are still in preview-only review.
- **Accuracy issues fixed recently show the fragility:** error % was double-counted until #314; a 23 MB collector page made SERVICES show "idle" until #309/#311; a SPOT + auto maxPods combination failed inside `pulumi up` until #331/#333.
- **Health in VAULTS** doesn't yet include CloudWatch alarms or Beyla error rates. The new vault UI was verified only on SAMPLE data.
- **Pip theme:** distinctive but dense, and readability and overlap needed many fix rounds (an overlap test suite now guards it).
- **Business:** no pricing or users yet; monetization experiments (spoken setup price, $79 license) are deferred (`TODOS.md`, `docs/business/`).
