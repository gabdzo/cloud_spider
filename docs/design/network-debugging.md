# Network debugging: design spec

Status: **design only** (nothing here is built yet). Date: 2026-10-11. Owner: Gabriel.
Related: `docs/design/production-readiness-scorecard.md` (result states §6.1, ALB 503 tree §12.2, facts vs inferences §12.3), the PATH view (`src/path-read.js`, `src/path-diagnose.js`, `src/path-view.js`), SLOs (`src/slo.js`), the morning HURTING card (`src/layout.js`), `cloudspider.yaml` (`src/config.js`).

## Contents

1. [Why, and what exists today](#1-why-and-what-exists-today)
2. [User flows](#2-user-flows)
3. [Architecture](#3-architecture)
4. [Check catalogue, by layer](#4-check-catalogue-by-layer)
5. [Our own tools](#5-our-own-tools)
6. [Safety model](#6-safety-model)
7. [Findings report](#7-findings-report)
8. [Network checks as scorecard controls](#8-network-checks-as-scorecard-controls)
9. [UX in PATH (pip and pro themes)](#9-ux-in-path-pip-and-pro-themes)
10. [Configuration (`cloudspider.yaml`)](#10-configuration-cloudspideryaml)
11. [Implementation phases](#11-implementation-phases)
12. [Competitors and what makes ours different](#12-competitors-and-what-makes-ours-different)
13. [Open questions](#13-open-questions)

---

## 1. Why, and what exists today

The PATH view already draws one request's path, **ALB → listener → rule → target group → target → node → cluster**, from read-only AWS calls. It also says in plain sentences why an edge is broken: unhealthy target with its reason code, a security group that does not let the ALB in, or no rule for a host. People debugging production networks do the same walk by hand, every time, with `dig`, `curl -v`, `openssl s_client`, `traceroute`, `kubectl run netshoot` and the AWS console. "And you know the drill."

This feature does the drill for them, end to end, and writes it down:

- **Left of the ALB:** client → DNS (local resolver, public DoH, Route 53) → CloudFront → TLS → HTTP.
- **Right of the target:** Service → EndpointSlice → pod, CoreDNS and NetworkPolicy, optionally probed from **inside** the cluster by a short-lived debug pod.
- **Any internet URL** (e.g. `https://google.com`) for the outside-in part, even when nothing of it is in the account.
- One **findings report** that separates facts from inferences and reuses the scorecard's PASS / FAIL / UNKNOWN / NOT_APPLICABLE / NOT_ASSESSED.

What exists today (verified on `main`, 2026-10-11):

| Piece | Where | Reused for |
|---|---|---|
| ALB graph: LBs, listeners, rules, TGs, target health, subnets, SGs, route tables, ENIs, nodes, clusters | `src/path-read.js`, `src/aws-path.js` | AWS layer of every flow |
| Rule matching for a host/path, health verdicts, SG reachability (ALB SG → target SG/CIDR) | `src/path-diagnose.js` (`routeOn`, `healthVerdict`, `reachable`) | "which rule, which TG, can the ALB reach it" |
| ALB metrics incl. the ALB's own 5xx (PR #83), p95/p99 latency (PR #88) | `src/metrics.js` | 503 walkthrough, SLO tie-in |
| SLO burn, HURTING with 5xx/SLO breaches (PRs #88–#91) | `src/slo.js`, `src/layout.js` | entry points into the walkthrough |
| Kube reads (GET only, viewer role), pod events, service proxy reads | `src/kube.js`, `src/kube-telemetry.js` | cluster static checks, CoreDNS metrics |
| Pending-cause events (PR #91), health watch | `src/kube-health.js` | pod layer facts |
| Copyable commands (`commandRows`, COPY) | `src/browser.js` | "you know the drill" panel |
| Lab-context guard (PR #96) and `learn.context` (PR #98) | `src/learn.js`, `src/config.js` | pattern for the write-context guard |

What does not exist: Route 53, CloudFront behaviours, NACLs, IGW/NAT evaluation, flow logs, any DNS/TLS/HTTP probing, and **any write to a cluster**. Cloud Spider's kube client is GET-only today and that stays the default.

## 2. User flows

### 2.1 Debug a URL end to end

Entry: PATH → `DEBUG` field, type `https://shop.example.com/items` (or paste from a vault check, or `google.com`).

1. **Parse.** Scheme (default https), host, port (default 80/443), path. Refuse anything that is not one host and one port (§6.3).
2. **DNS.**
   - Resolve A/AAAA/CNAME with the system resolver and with two DoH resolvers.
   - Compare the answers (split-horizon, stale cache and geo-DNS show up as differences).
   - Follow the CNAME chain. If a hosted zone in the account owns the name, read the record from Route 53 and ask Route 53 for its own answer (`TestDNSAnswer`).
3. **Classify the target** from the chain and the IPs:
   - `*.cloudfront.net` matched to a distribution alias → **CloudFront**.
   - `*.elb.amazonaws.com` matched to a load balancer DNS name → **ALB/NLB**.
   - An IP inside a VPC CIDR of the account → **ENI** (the PATH graph's `interfaces`).
   - Otherwise → **not in this account** (google.com ends here, after HTTP).
4. **Connect.** TCP connect to each resolved IP (capped at 8, IPv4 and IPv6 separately), with connect time.
5. **TLS.** SNI handshake: protocol, cipher, ALPN, the leaf's SANs against the host, chain to a trusted root, days to expiry for every certificate in the chain, OCSP stapling present or not.
6. **HTTP.** One `GET` (or `HEAD`):
   - Status and the timing split DNS / connect / TLS / TTFB / total.
   - Redirect chain (max 10; loops detected).
   - A few diagnostic response headers (`server`, `via`, `x-cache`, `x-amz-cf-pop`, `x-amzn-trace-id`, `x-amzn-errortype`). The body is never kept.
7. **Hand off into AWS** (when the target is ours):
   - CloudFront: behaviour matched for the path, its origin, origin protocol policy and timeouts, viewer protocol policy, custom error responses.
   - Then the ALB: `routeOn` picks the listener and rule for host/path → TG → target health → SG reachability (existing). New: NACLs and route tables on the subnets in between.
8. **Hand off into Kubernetes** (target is a pod IP or node of a connected cluster): Service → EndpointSlice → pod readiness, events (existing reads plus EndpointSlices).
9. **Report.** Every step is a row with a status; findings on top; COPY the CLI equivalents; export MD/JSON.

Typical results:

- "DNS: system resolver returns 10.0.3.12, public DoH returns 13.48.x.x. **Fact**: a private hosted zone answers inside the VPC. **Inference**: you are on VPN."
- "TLS: certificate for `shop.example.com` expires in 6 days (ACM, not auto-renewing because the validation CNAME is missing)."
- "HTTP 503 with `server: awselb/2.0` and no `x-amzn-trace-id` from the app. **Fact**: the ALB answered itself. → see 2.3."

### 2.2 Debug an in-cluster service

Entry: Cluster view → a Service → `DEBUG NETWORK`, or PATH → DEBUG `svc/shopapi.shop` with a context picker.

1. **Static reads (viewer role, always):**
   - Service: type, ports and targetPort names, selector.
   - EndpointSlices: ready / serving / terminating endpoints.
   - Pods behind them: readiness, restarts, events.
   - NetworkPolicies selecting the pods (ingress) and the chosen source namespace (egress).
   - CoreDNS: Deployment ready, Corefile, `kube-dns` Service endpoints, metrics.
   - kube-proxy and CNI DaemonSets ready.
   - Static verdicts, e.g. "selector matches 0 pods", "targetPort `http` is not a container port name", "a default-deny ingress policy selects these pods and no policy allows namespace `web`".
2. **Live probe (opt-in, §6.1).** `RUN FROM INSIDE` asks for a namespace (the source matters for NetworkPolicy) and shows exactly what will be created. On confirm, Cloud Spider starts a debug pod, and the probe runs a fixed script (§4.3). The checks:
   - Resolve the short name, `name.ns` and the FQDN.
   - Report the pod's `resolv.conf`: nameserver, search domains and `ndots`. Count how many queries one lookup of an external name costs.
   - Connect to the ClusterIP:port and to each ready endpoint IP:targetPort; HTTP GET if the port is HTTP.
   - Run `ip route` and a `tracepath` MTU check to one endpoint.
   - Run `ss -tan` inside the debug pod (its own sockets only).

   The pod writes one JSON document to stdout. Cloud Spider reads it with the pod log GET it already uses, then deletes the pod.
3. **Report.**
   - The static verdicts and the live results side by side. Example: "the policy evaluator says namespace `web` may not reach `shop/shopapi:3000` (**inference** from spec), and the probe's connect timed out after 3 s (**fact**)."
   - When the two disagree, that is itself a finding: the CNI may not enforce NetworkPolicy, e.g. VPC CNI with the network policy agent off.

### 2.3 "Why is my ALB 503?" (guided walkthrough)

Entry points (all exist today and gain a `WHY?` button):

- An SLO burning on an `alb:*` SLI (vault page).
- The morning HURTING card line "ALB … serving 5xx".
- The radio line for an ALB in trouble.
- A red ALB node in PATH.

The walkthrough is the scorecard's §12.2 decision tree, executed one question per screen with evidence attached. It runs from the data already read, with no new calls unless a step needs one:

| Step | Question | Evidence (read-only) | Branches |
|---|---|---|---|
| 1 | Who is answering the 503? | `HTTPCode_ELB_5XX_Count` vs `HTTPCode_Target_5XX_Count` (PR #83), optional live GET of the ALB URL (`server: awselb/2.0`, `x-amzn-errortype`) | ELB → 2; target → 6 |
| 2 | Does the TG have healthy targets? | `DescribeTargetHealth` with reason codes | none registered → 3; all unhealthy → 4 |
| 3 | Does the Service have ready endpoints? | EndpointSlices, Deployment replicas, pods, events (incl. the Pending cause, PR #91) | scaled to 0 / ImagePull / CrashLoop / Pending (with cause) |
| 4 | Why do health checks fail? | Reason (`Target.ResponseCodeMismatch`, `Target.Timeout`, `Target.FailedHealthChecks`), TG health-check path/port/matcher, CloudTrail `ModifyTargetGroup` | path mismatch (drill fault f) → fix; timeout → 5 |
| 5 | Can the ALB reach the target? | SG `reachable()` (exists), **NACL evaluation (new)**, route tables, optional in-cluster probe from the node's namespace | blocked by rule X → finding |
| 6 | The app returns 5xx | Target 5xx metric, pod logs (last error lines, local only), dependency hints (DB fenced, drill fault b1) | app/dependency |
| 7 | Healthy targets, no target 5xx, still 503 | Listener rules: fixed-response 503, forward weights to an empty TG | misroute |

The walkthrough ends with the ranked hypotheses (scorecard §12.3 confidence rules) and a **VERIFY** line, e.g. "TG healthy ≥1, ELB 5XX = 0 for 2 one-minute periods, SLO burn < 1×". It keeps polling the existing background SLO data and ticks VERIFY green by itself.

## 3. Architecture

```
browser (PATH view)                 server (127.0.0.1, origin-checked)
  DEBUG field ──POST /api/netdebug──►  netdebug runner (src/netdebug/)
                                         ├─ local probes      (Node: dns, net, tls, http; spawn tracepath/traceroute/ping if present)
                                         ├─ aws readers       (read-only SDK calls; Reachability Analyzer only if opted in)
                                         ├─ kube readers      (GET via the viewer context)
                                         ├─ debug pod driver  (write context only, §6.1) ─► spider-probe in the pod ─► JSON on stdout ─► pod log GET
                                         ├─ evaluators        (pure: SG/NACL/route/NetworkPolicy/CoreDNS/TLS/redirect logic)
                                         └─ report builder    (checks → findings, facts vs inferences) ─► .cloudspider/netdebug/<id>.json
  ◄── GET /api/netdebug/:id (poll) ────
  ◄── GET /api/netdebug/:id.md|.json ── export
```

Design rules:

- **Pure evaluators, recorded evidence.** Every check is "collect evidence" plus a pure function. Tests replay recorded fixtures (drill faults a–f and fake DNS/TLS servers on loopback), never the live account. This is the same split as the scorecard (§2 approach B).
- **A run is a job.** It has an id, steps with ✓/▶/✗ and a run log under `.cloudspider/runs/netdebug/`, so the existing run pane can show it.
- **No new long-lived processes or agents in the cluster.**

## 4. Check catalogue, by layer

Legend for **From**: **L** = local machine (where Cloud Spider runs), **A** = AWS read-only API, **K** = Kubernetes read (viewer), **P** = debug pod (opt-in). Status rules follow scorecard §6.1: a denied read is **UNKNOWN**, a check that was not attempted (e.g. the pod was not opted in) is **NOT_ASSESSED**, and an irrelevant one (no CloudFront in the path) is **NOT_APPLICABLE**.

### 4.1 From the local machine (L)

| ID | Layer | Check | Proves | Tool |
|---|---|---|---|---|
| L-DNS-01 | DNS | A/AAAA/CNAME via the system resolver; CNAME chain | What *this machine* resolves the name to | Node `dns.lookup` + `dns.Resolver` |
| L-DNS-02 | DNS | Same query via DoH (Cloudflare, Google) | What the public internet sees; split-horizon or stale cache when it differs from L-DNS-01 | `fetch` to DoH JSON endpoints |
| L-DNS-03 | DNS | NXDOMAIN vs SERVFAIL vs NOERROR/NODATA; TTLs | A missing record vs a broken zone (DNSSEC, lame delegation) vs only no AAAA | `dns.Resolver` error codes, DoH `Status` |
| L-DNS-04 | DNS | Authoritative NS of the zone and their answers (`dig +trace`-like) | Delegation is correct; what the authority says, ignoring caches | `dns.Resolver.setServers` per NS |
| L-TCP-01 | Transport | TCP connect per resolved IP, v4 and v6 separately, with time | Something listens on host:port and the path is open; a broken IPv6 path shows as v6 timeouts | `net.connect` |
| L-TLS-01 | TLS | Handshake with SNI: protocol, cipher, ALPN | TLS ≥1.2 is negotiated; h2 is offered | `tls.connect` |
| L-TLS-02 | TLS | Leaf SAN covers the host; chain verifies to a trusted root; intermediates sent | The certificate is valid for this name, and clients without AIA fetching will not fail | `tls.connect` + `getPeerCertificate(true)` |
| L-TLS-03 | TLS | Days to expiry for each certificate in the chain; OCSP stapled | Expiry risk (thresholds 21 / 7 days) | same |
| L-HTTP-01 | HTTP | Status, timing DNS / connect / TLS / TTFB / total | Where the time goes; a slow TTFB with fast connect points at the origin | `http(s).request` socket events |
| L-HTTP-02 | HTTP | Redirect chain (≤10), loops, https upgrade, final URL | Redirects end on https, with no loop or mixed scheme | same, `redirect: manual` |
| L-HTTP-03 | HTTP | Who answered: `server`, `via`, `x-cache`, `x-amz-cf-pop`, `x-amzn-errortype`, `x-amzn-trace-id` | CloudFront vs ALB vs app produced the response (an ALB-made 503 has no app headers) | header allowlist |
| L-NET-01 | Route | Hops to the target (tracepath / traceroute, 3 probes per hop, max 20 hops) | Where packets stop; mtr-lite = run it 3× and show loss per hop | spawn `tracepath` (Linux, no root) or `traceroute` (macOS); NOT_ASSESSED if neither exists |
| L-NET-02 | Route | Path MTU | Black-holed large packets (VPN, tunnels) | `tracepath` |
| L-NET-03 | Reach | ICMP echo (4 probes) | Basic reachability; **ICMP blocked is normal for ALBs and CloudFront**, so a failure is never FAIL on its own, only a fact | spawn `ping` / `ping6` if allowed |
| L-NET-04 | Local | Local route to the target, default gateway, VPN interfaces | "My laptop routes this into the VPN" | `ip route get` / `route -n get` (spawn, read-only) |

### 4.2 AWS read-only APIs (A)

| ID | Layer | Check | Proves | Calls |
|---|---|---|---|---|
| A-R53-01 | DNS | Hosted zone owning the name (public and private), the record (alias / CNAME / weighted / latency / failover) | Which record answers and where it points | `ListHostedZonesByName`, `ListResourceRecordSets` |
| A-R53-02 | DNS | Route 53's own answer for the record | Route 53 answers as expected; isolates resolver issues from zone issues | `TestDNSAnswer` |
| A-R53-03 | DNS | **Dangling record**: alias/CNAME to a CloudFront distribution, ELB, S3 website or EIP that no longer exists | Subdomain-takeover risk (security) and "points at nothing" outages | join records with `elbv2`, CloudFront, S3, EC2 inventories |
| A-R53-04 | DNS | Health checks on failover/weighted records: status and last failure reason | Route 53 itself took an endpoint out | `GetHealthCheckStatus`, `GetHealthCheckLastFailureReason` |
| A-R53-05 | DNS | Private zone ↔ VPC associations; Resolver rules (forward/system) and endpoints for the VPC | Why a name resolves differently inside the VPC (and inside pods) | `ListHostedZonesByVPC`, `route53resolver:ListResolverRules`, `ListResolverRuleAssociations`, `ListResolverEndpoints` |
| A-CF-01 | CDN | Distribution for the alias, enabled, status Deployed | The name is served by this distribution | `ListDistributions` (alias match), `GetDistributionConfig` |
| A-CF-02 | CDN | Behaviour matched for the path; origin; origin protocol policy; origin timeouts; OAC/OAI | Which origin gets the request and how; http-only origin to an https-only ALB = 502 | same (pure path-pattern match) |
| A-CF-03 | CDN | Viewer protocol policy, minimum TLS, certificate (ACM us-east-1) expiry | https enforced, TLS ≥1.2, certificate ok | same, `acm:DescribeCertificate` |
| A-CF-04 | CDN | Custom error responses and WAF web ACL attached | A 403/503 page that is CloudFront's or WAF's, not the origin's | same, `wafv2:GetWebACLForResource` (regional) / distribution `WebACLId` |
| A-ELB-01 | LB | Listener for port/protocol; rule matched for host/path (incl. fixed-response and weighted forwards) | Which TG the request goes to | exists (`routeOn`) |
| A-ELB-02 | LB | Target health + reason code per target, HC config | Targets in service or why not | exists (`healthVerdict`) |
| A-ELB-03 | LB | ALB listener certificate (ACM) expiry and SAN match | Same as L-TLS from the inside, plus "ACM renewal blocked" (validation record missing) | `DescribeListenerCertificates`, `acm:DescribeCertificate` |
| A-ELB-04 | LB | ALB metrics: ELB 5xx vs target 5xx, rejected connections, TLS negotiation errors, p95/p99 | Who fails and since when | exists (`metrics.js`) |
| A-VPC-01 | Network | SG evaluation ALB SG → target SG/CIDR on the target port | The ALB may connect to the target | exists (`reachable`) |
| A-VPC-02 | Network | **NACL evaluation** both directions, incl. return traffic to ephemeral ports 1024–65535, rule order and the final deny | Stateless NACLs do not drop the flow (the classic "SG fine, still timeouts") | `DescribeNetworkAcls` + pure evaluator |
| A-VPC-03 | Network | Route tables: subnet → IGW (public ALB), private subnet → NAT for egress, VPC endpoints for S3/ECR/STS/logs, blackhole routes | Inbound internet reaches public subnets; pods can pull images and call AWS | `DescribeRouteTables` (have), `DescribeInternetGateways`, `DescribeNatGateways`, `DescribeVpcEndpoints` |
| A-VPC-04 | Network | Subnet free IPs (`AvailableIpAddressCount`) for node and pod subnets | VPC CNI IP exhaustion (pods stuck ContainerCreating) | `DescribeSubnets` (have) |
| A-VPC-05 | Network | VPC flow logs enabled; if they go to CloudWatch Logs, REJECT records for the source/destination/port in the last 15 min | A real packet was rejected, by what ENI (a **fact**, unlike A-VPC-01/02 which infer from config) | `DescribeFlowLogs`, `logs:FilterLogEvents` on the flow log group (bounded); Logs Insights only if opted in (billed per GB scanned) |
| A-VPC-06 | Network | **VPC Reachability Analyzer** for source ENI/IGW → destination ENI:port | AWS's own config-level path answer, incl. explanations | `CreateNetworkInsightsPath`, `StartNetworkInsightsAnalysis`, `DescribeNetworkInsightsAnalyses`, then delete the path. **Opt-in, costs USD 0.10 per analysis, and creates (then deletes) resources**, so it goes through the confirm and the audit log (§6) |
| A-EKS-01 | Cluster | Cluster endpoint access (public/private, CIDRs), cluster SG, node SG rules for the pod/target ports | The control plane and the ALB→node/pod path are open | `DescribeCluster` (have), `DescribeSecurityGroups` |

### 4.3 Inside the cluster (K = viewer reads, P = debug pod)

| ID | Layer | Check | Proves | From / tool |
|---|---|---|---|---|
| K-SVC-01 | Service | Selector matches pods; targetPort (number or name) exists on them | The Service can have endpoints at all | K: services, pods |
| K-SVC-02 | Service | EndpointSlices: ready / serving / terminating counts, per zone | Traffic has somewhere to go | K: `discovery.k8s.io/v1 endpointslices` (new read) |
| K-NP-01 | Policy | NetworkPolicies selecting target pods (ingress) and source pods (egress); pure evaluation of "source ns/pod → target port allowed?" incl. DNS egress to kube-dns | **Inference** about policy impact, with the rule that decides it | K: `networking.k8s.io/v1 networkpolicies` + pure evaluator |
| K-NP-02 | Policy | Does the CNI enforce NetworkPolicy? (VPC CNI network policy agent enabled; Calico/Cilium present) | Whether K-NP-01 matters at all | K: DaemonSets / aws-node config |
| K-DNS-01 | CoreDNS | Deployment ready replicas ≥2, PDB present, spread over nodes | DNS survives a node loss (the drill's fault e took everything on one node) | K: deployments, pdbs |
| K-DNS-02 | CoreDNS | Corefile: `forward` targets, `cache`, `loop`, stub domains, `log`/`errors` plugins | Where cluster DNS forwards; suspicious config | K: `kube-system/coredns` ConfigMap (needs a `get` on that one ConfigMap by resourceName) |
| K-DNS-03 | CoreDNS | Metrics: request rate, SERVFAIL/NXDOMAIN rate, forward health-check failures, cache hit ratio, panics | DNS is healthy *now* (a runtime fact) | K: service proxy GET to CoreDNS `:9153/metrics` (same pattern as otel-metrics) |
| K-DNS-04 | CoreDNS | NodeLocal DNSCache present | Explains a nameserver of 169.254.20.10 in pods | K: DaemonSet `node-local-dns` |
| K-NET-01 | kube-proxy / CNI | kube-proxy and aws-node DaemonSets ready on every node; kube-proxy mode (iptables/ipvs) | Service VIPs and pod networking work on every node | K: daemonsets, `kube-proxy-config` ConfigMap |
| P-DNS-01 | DNS | `resolv.conf` in a pod of the source namespace: nameserver, search, `ndots` | Why `api.example.com` costs 5 queries (ndots:5 + 4 search domains) | P: read `/etc/resolv.conf` |
| P-DNS-02 | DNS | Resolve short name, `name.ns`, FQDN and one external name against the pod's nameserver and directly against each CoreDNS pod IP | Which CoreDNS replica fails; search-path surprises | P: spider-probe `dns` (or `dig`/`nslookup` in netshoot) |
| P-TCP-01 | Transport | Connect to ClusterIP:port and to each ready endpoint IP:targetPort | Service VIP vs pod reachability (kube-proxy vs pod problem) | P: spider-probe `tcp` (or `nc -zv`) |
| P-HTTP-01 | HTTP | GET to the Service and to one endpoint, with timing | The app answers from inside | P: spider-probe `http` (or `curl -w`) |
| P-NET-01 | Route | `ip route`, default route, MTU of eth0, `tracepath` to an endpoint on another node | Cross-node path and MTU (overlay/VPN) | P: `ip`, `tracepath` |
| P-NET-02 | Sockets | `ss -tan` of the probe itself (and of the node only in privileged mode) | Connection states; with hostNetwork, conntrack and port exhaustion signs | P: `ss` |
| P-NP-01 | Policy | The same connects from a pod **in the source namespace** with the source labels (optional `--as-labels`) | **Fact** for K-NP-01's inference | P |

**Probe script.** The debug pod never gets a shell from Cloud Spider and there is no `exec`. Its arguments are a fixed command built server-side from validated inputs (names, IPs, ports), for example `spider-probe run --plan <base64 JSON>`. It prints one JSON document and exits.

## 5. Our own tools

- **spider-probe**: a small static binary (Go, about 10 MB, no shell needed) and a distroless image `ghcr.io/<org>/spider-probe@sha256:…`, pinned by digest.
  - Subcommands: `dns`, `tcp`, `http`, `tls`, `route`, `mtu`, `resolvconf`, and `run --plan` to run them together. Output is JSON.
  - Why not just netshoot: netshoot is an excellent toolbox, but it is large (hundreds of MB), shell-oriented (output must be parsed) and has far more tools than needed.
  - spider-probe is small and its output is structured. It needs no capabilities for DNS/TCP/HTTP; it needs `NET_RAW` only for ICMP/traceroute (opt-in).
  - netshoot stays a supported **alternative image** (`network.pod.image`) for people who want a shell themselves; Cloud Spider then only shows the commands to COPY.
- **The local engine** is plain Node (`dns`, `net`, `tls`, `https`, `fetch` for DoH), so nothing new is installed on the user's machine. `tracepath`/`traceroute`/`ping` are used only if they exist, are spawned with an argument array (never a shell), and are reported NOT_ASSESSED if missing.
- **"You know the drill" panel**: every check shows the equivalent command with COPY, so the report doubles as a runbook and users can rerun any step by hand:
  - `dig +trace shop.example.com`
  - `curl -sS -o /dev/null -w '%{time_namelookup} %{time_connect} %{time_appconnect} %{time_starttransfer}\n' https://…`
  - `openssl s_client -connect host:443 -servername host -showcerts`
  - `aws route53 test-dns-answer …`
  - `kubectl -n shop get endpointslices -l kubernetes.io/service-name=shopapi`
  - `kubectl run tmp --rm -it --image=nicolaka/netshoot --restart=Never -- dig shopapi.shop.svc.cluster.local`
  - The panel follows the existing COPY rows of the Stacks cards.

## 6. Safety model

Default posture: **read-only everywhere**. The only writes in the whole feature are the debug pod (cluster) and the Reachability Analyzer path (AWS). Both are opt-in, confirmed, audited and cleaned up.

### 6.1 Debug pod

| Rule | Design |
|---|---|
| Opt-in | `network.pod.enabled: false` by default. The `RUN FROM INSIDE` button is hidden until it is enabled. |
| Write contexts | A pod is only created in a context listed in **`kube.writeContexts`** (default `[]`: every context is write-disabled). The viewer context cannot create pods anyway (its role is get/list/watch); the write context is a **separate** kube context with its own Role (below). |
| ppf-helm and work contexts | `ppf-helm` (and `ppf-*`) are refused unless they are **explicitly** listed in `kube.writeContexts`. When they are, the confirm shows a red WORK CONTEXT banner and requires typing the context name. Same matching code as the LEARN guard (PR #96 / #98). |
| Explicit confirm | The dialog shows: context, namespace, image digest, the full pod spec (YAML, collapsible), TTL, what it will connect to. Typed confirm: the namespace name. |
| Namespaced | Pods go to `network.pod.namespace` (default `cloudspider-debug`) or, to test NetworkPolicy from a source, to a namespace listed in `network.pod.sourceNamespaces`. Nothing cluster-scoped is created. |
| RBAC for the write context | A namespaced Role in each allowed namespace: `create`, `get`, `delete` on `pods`, `get` on `pods/log`. No `pods/exec`, no `pods/ephemeralcontainers`, no secrets, no cluster roles. Shipped as a Pulumi add-on stack (`netdebug-<cluster>`) so it can be previewed and taken down like the others. |
| Pod hardening (default) | `runAsNonRoot`, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, `capabilities.drop: [ALL]`, `seccompProfile: RuntimeDefault`, `automountServiceAccountToken: false`, no hostNetwork/hostPID/hostPath, `restartPolicy: Never`. Passes the Pod Security Standards **restricted** profile. |
| Resources | Requests and limits `cpu: 100m`, `memory: 64Mi`, `ephemeral-storage: 16Mi` (configurable within caps). |
| TTL | `activeDeadlineSeconds` = `network.pod.ttlSeconds` (default 300, max 1800), so the kubelet stops it even if Cloud Spider dies. Cloud Spider deletes the pod as soon as its log is read. |
| Cleanup labels | `app.kubernetes.io/managed-by: cloudspider`, `cloudspider.io/netdebug: "<run id>"`. Annotations `cloudspider.io/expires-at`, `cloudspider.io/requested-by` (local OS user). A sweeper (on start and every 5 min) deletes only pods with these labels whose `expires-at` has passed, in write contexts only. |
| Privileged mode | A separate opt-in (`network.pod.allowPrivileged: false`), a second confirm per run, and a namespace whose PSA level allows it (refused if `enforce: restricted`). It adds `hostNetwork: true` and `NET_RAW`/`NET_ADMIN` for node-level `ss`, conntrack, `ip route` of the node and traceroute. It is never the default and never remembered across runs. |
| Never | exec into user pods, attach ephemeral containers to user pods (a later opt-in mode, §11 N10), write to user resources, read Secrets, keep pod output beyond the report. |

### 6.2 AWS writes

Reachability Analyzer is the only AWS write. It is gated by `network.aws.reachabilityAnalyzer: false` and a per-run confirm that states "USD 0.10 per analysis; creates a network insights path and deletes it afterwards". It is audited, and the path is deleted even if the analysis fails. Everything else in §4.2 is `Describe*`/`List*`/`Get*`/`TestDNSAnswer`/`FilterLogEvents`. A read-only IAM policy for the feature is listed in the RUN-ME when it is built.

### 6.3 URL debugging

- **User-entered targets only.** A URL is probed only when the user typed or pasted it in the DEBUG field, or explicitly pressed DEBUG on a vault check URL or an ALB/CloudFront node. The ASK agent and imported content cannot start a probe; they can prefill the field.
- **One host, one port.** The URL's host and port (default 443/80), plus the ports of redirect targets the server itself returns, which are followed only when they are 80/443 or the same port. There are no port lists, CIDR targets or IP ranges, and no **port scanning** in any form. Resolved IPs per name are capped at 8.
- **Rate limits.** `network.local.rateLimit`: default 6 runs per minute per host, 30 per minute in total, at most 2 runs at once. Each run sends at most 1 HTTP request per resolved IP plus redirects (≤10).
- **Polite requests.** `GET`/`HEAD` only, no body, no cookies, no credentials, no custom headers from the user. User-Agent `CloudSpider-netdebug/<version>`.
- **Refused targets.** Link-local and metadata addresses (`169.254.0.0/16`, `fd00:ec2::254`) are always refused. Loopback and RFC 1918 are refused unless `network.local.allowInternalTargets: true`; a VPN user debugging an internal ALB turns it on.
- **Origin check.** The API is POST-only, origin-checked like every other write-ish endpoint, and listens on 127.0.0.1.

### 6.4 Audit log

`.cloudspider/audit.jsonl` (append-only, local) gets one line per write or opt-in action:

- Fields: time (with zone), OS user, action (`netdebug.pod.create`, `netdebug.pod.delete`, `netdebug.sweep.delete`, `aws.reachability.create/delete`), context/account, namespace, object name, image digest, spec hash, run id and result.
- URL probes are logged with host and port only, never path or query (they can hold tokens).
- The audit log is shown in the report and in OPS.

## 7. Findings report

### 7.1 Structure

```jsonc
{
  "id": "nd-2026-10-11T15-20-04-7f3a",
  "target": { "kind": "url", "input": "https://shop.example.com/items", "host": "shop.example.com", "port": 443 },
  "startedAt": "2026-10-11T15:20:04+02:00", "durationMs": 3120,
  "from": ["local", "aws", "kube"],              // "pod" only when it ran
  "context": { "account": "…2523", "region": "eu-north-1", "kubeContext": "cs-drill-viewer" },
  "summary": { "verdict": "FAIL", "pass": 14, "fail": 2, "unknown": 1, "notAssessed": 4, "notApplicable": 3 },
  "checks": [
    { "id": "L-TLS-03", "layer": "tls", "from": "local", "tool": "tls.connect",
      "status": "FAIL", "kind": "fact", "severity": "high",
      "observed": { "notAfter": "2026-10-17T09:00:00Z", "daysLeft": 6 }, "expected": { "daysLeft": ">= 21" },
      "command": "openssl s_client -connect shop.example.com:443 -servername shop.example.com </dev/null | openssl x509 -noout -enddate",
      "durationMs": 140 },
    { "id": "A-ELB-02", "layer": "lb", "from": "aws", "tool": "DescribeTargetHealth",
      "status": "FAIL", "kind": "fact", "observed": { "healthy": 0, "registered": 0 } },
    { "id": "K-NP-01", "layer": "policy", "from": "kube", "tool": "networkpolicy-evaluator",
      "status": "NOT_APPLICABLE", "reason": "no-policies-select-target" }
  ],
  "findings": [
    { "statement": "shopapi is scaled to 0, so the target group has no targets and the ALB answers 503 itself",
      "kind": "inference", "confidence": "high", "supports": ["A-ELB-02", "K-SVC-02", "L-HTTP-03"], "contradicts": [],
      "next": ["kubectl -n shop scale deploy/shopapi --replicas=2"], "verify": "TG healthy ≥1 and ELB 5XX = 0 for 2 one-minute periods" }
  ],
  "audit": []
}
```

- **Facts vs inferences.** A *check* is a fact: something read or observed, with its source and time. A *finding* is an inference: a statement that explains several checks, with confidence by the scorecard §12.3 rules (HIGH = ≥2 supporting facts from ≥2 layers, none contradicting). Competing findings are all listed and ranked; none is dropped silently.
- **States.** PASS / FAIL / UNKNOWN / NOT_ASSESSED / NOT_APPLICABLE exactly as scorecard §6.1. An empty list is not PASS: no NetworkPolicies makes K-NP-01 NOT_APPLICABLE, and the scorecard control "default deny exists" decides separately. A denied read (403) is UNKNOWN with `reason: denied:<call>`, and the report says which permission to add.
- **Export.** `GET /api/netdebug/<id>.json` (the document above) and `.md`. The Markdown has the summary, the findings, a table of checks grouped by layer, the COPY commands and the audit lines. It is suitable for a ticket.
- **Redaction.** No response bodies, no cookies, no `Authorization`, no URL query strings in the stored report (the path is kept, the query is replaced by `?…`). Kube object names and IPs are kept, since they are the point.
- **Storage.** `.cloudspider/netdebug/<id>.json`, the newest 50 kept (`network.reports.keep`).

## 8. Network checks as scorecard controls

Each continuous check becomes a scorecard control (schema §5.1) with the same evaluator. Debug runs produce evidence records, and the scorecard collectors can run the read-only ones on their cadence. The **pod probes are never run by the scorecard**: they are on-demand only, and a control that would need them is NOT_ASSESSED unless a recent run (≤24 h) left evidence.

| Control | Category | Evidence type | From | Default severity |
|---|---|---|---|---|
| NET-TLS-001 Public endpoints' certificates expire in >21 days (vault URLs, ALB/CloudFront certs) | security | runtime | L-TLS-03, A-ELB-03, A-CF-03 | high (<7 d: critical) |
| NET-TLS-002 TLS ≥1.2 only; CloudFront minimum protocol TLSv1.2_2021 | security | config | A-CF-03, ALB SSL policy | medium |
| NET-HTTP-001 HTTP redirects to HTTPS; viewer protocol policy not `allow-all` | security | config/runtime | L-HTTP-02, A-CF-03 | medium |
| NET-DNS-001 No dangling Route 53 alias/CNAME records | security | config | A-R53-03 | high |
| NET-DNS-002 Failover/weighted records have Route 53 health checks | reliability | config | A-R53-04 | medium |
| NET-DNS-003 CoreDNS ≥2 ready replicas on ≥2 nodes with a PDB | reliability | config | K-DNS-01 | high (prod profile) |
| NET-DNS-004 CoreDNS SERVFAIL rate <1% over 15 min | reliability | runtime | K-DNS-03 | medium |
| NET-VPC-001 VPC flow logs enabled for VPCs with internet-facing load balancers | observability | config | A-VPC-05 | medium |
| NET-VPC-002 NACLs allow return traffic for every SG-allowed ALB→target path | networking | config | A-VPC-02 | high |
| NET-VPC-003 Pod/node subnets have >20% free IPs | reliability | runtime | A-VPC-04 | medium |
| NET-K8S-001 Each application namespace has a default-deny ingress NetworkPolicy, and the CNI enforces it | security | config | K-NP-01, K-NP-02 | medium |
| NET-K8S-002 Every Service selected by an Ingress/TG has ≥1 ready endpoint in ≥2 zones | reliability | runtime | K-SVC-02 | high |

These join the scorecard's `networking` category. Their results feed the same scoring, coverage and gates (§6 of the scorecard); this feature adds no scoring rules of its own.

## 9. UX in PATH (pip and pro themes)

### 9.1 Layout

A DEBUG bar on top of PATH, with the existing diagram extended to the left (client side) and the right (cluster side). Everything is drawn with theme role tokens (`--bg`, `--surface`, `--text`, `--ok`, `--warn`, `--err`, `--info`, `--accent`; `--font-mono` for commands); there are no literal colours, as today.

Mock (pro theme, a 503 run):

```
┌ PATH ─────────────────────────────────────────────────────────────────────────────────────────────┐
│ DEBUG [ https://shop.example.com/items                     ] (LOCAL ✓) (AWS ✓) (IN-CLUSTER ○)  [RUN] │
│ eu-north-1 · cs-drill-viewer · run nd-…7f3a · 3.1 s                          [EXPORT MD] [JSON]   │
├───────────────────────────────────────────────────────────────────────────────────────────────────┤
│  CLIENT ──► DNS ──► CLOUDFRONT ──► ALB ──► LISTENER :443 ──► RULE host=shop… ──► TG shop-api ─✗─► │
│   ✓         ✓ 2 IPs   n/a          ✓ 503   ✓                 ✓                   ✗ 0 targets       │
│                                                                    ┌──────────────────────────────┐│
│  ──► SERVICE shop/shopapi ─✗─► ENDPOINTS 0 ready ──► PODS 0/0       │ FINDINGS                     ││
│       ✓ selector ok              ✗                    ✗ replicas=0  │ ● HIGH  shopapi scaled to 0  ││
│                                                                    │   → TG empty → ALB 503       ││
│  TIMING  dns 12ms │ connect 31ms │ tls 48ms │ ttfb 9ms │ total 102  │   FACTS 4 · contradicts 0    ││
│                                                                    │ ○ LOW   health check path    ││
│  CHECKS   [all] [fail 2] [unknown 1] [not assessed 4]              │   (no supporting fact)       ││
│  ✗ A-ELB-02  TG shop-api: 0 registered targets          DescribeTargetHealth   [COPY]           │
│  ✗ K-SVC-02  shop/shopapi: 0 ready endpoints            EndpointSlices         [COPY]           │
│  ? A-VPC-05  flow logs: not enabled for vpc-0ab…        UNKNOWN → enable       [WHY]            │
│  ✓ L-TLS-03  certificate valid 74 days                   tls.connect            [COPY]           │
│  …                                                                                               │
│  YOU KNOW THE DRILL ▸  dig +trace … · curl -w … · openssl s_client … · kubectl get endpointslices│
└───────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Nodes.** Each node carries a state glyph and a one-line fact, coloured by role: `--ok` PASS, `--err` FAIL, `--warn` UNKNOWN, `--text3` NOT_ASSESSED / NOT_APPLICABLE. Clicking a node filters the check list to that layer. The broken edge uses the existing PATH "broken" edge style.
- **Mode chips.** LOCAL and AWS are on by default. IN-CLUSTER is off (○). Turning it on opens the confirm (§6.1) when the pod is needed; static K-checks run with AWS when a connected context owns the target.
- **Timing strip.** One horizontal bar split DNS/connect/TLS/TTFB, in the same widths as `curl -w`.
- **Findings panel.** Ranked inferences with confidence, the supporting checks as chips, NEXT (COPY) and VERIFY.
- **"You know the drill".** The equivalent commands of the whole run, in order, with one COPY for all.
- **Pip theme.** The same layout in the Pip-Boy screen. The diagram reuses the existing PATH canvas sprites (globe for CLIENT, radio tower for DNS, new CDN sprite for CloudFront), and states use `PIP`/`STATUS` via `theme.js`. Canvas colours come from theme.js (the pro theme's canvas phase brings the role tokens to canvases).
- **Walkthrough mode (2.3).** The same panel, one question per step ("1/7 Who is answering the 503?") with BACK/NEXT, the evidence of that step and the branch taken highlighted on the diagram.

### 9.2 Entry points

- PATH: the DEBUG field and the ALB node's `WHY?`.
- Vault page: `DEBUG` next to each HTTP check, and `WHY?` on an ALB SLO that is burning.
- Morning HURTING: `WHY?` on an ALB 5xx line.
- Cluster view: `DEBUG NETWORK` on a Service.
- Radio: a click on an ALB trouble line opens the walkthrough.

## 10. Configuration (`cloudspider.yaml`)

Proposed keys. `src/config.js` `SCHEMA` is the truth when this is built; that file is currently being changed by another agent, so the keys are added in its own PR (N1). Precedence as today: defaults < file < env < CLI.

```yaml
kube:
  writeContexts: []            # contexts where Cloud Spider may create objects (the debug pod). Empty: none.
                               # ppf-helm / ppf-* only if listed here explicitly (then a WORK CONTEXT confirm)
network:
  enabled: true                # CLOUDSPIDER_FEATURE_NETWORK; the DEBUG bar in PATH
  local:
    timeoutSeconds: 10         # per step
    maxRedirects: 10
    doh: ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"]   # [] disables L-DNS-02
    trace: auto                # auto (use tracepath/traceroute if present) | off
    ping: auto                 # auto | off
    ipv6: auto                 # auto | off
    allowInternalTargets: false # RFC 1918 / loopback targets (VPN users); metadata/link-local always refused
    rateLimit: { perHostPerMinute: 6, perMinute: 30, concurrent: 2 }
  aws:
    route53: true
    cloudfront: true
    flowLogs: { enabled: true, lookbackMinutes: 15, insights: false }   # insights: Logs Insights (billed per GB scanned)
    reachabilityAnalyzer: false   # USD 0.10 per analysis, creates and deletes a path; per-run confirm
  pod:
    enabled: false
    image: "ghcr.io/<org>/spider-probe@sha256:<digest>"   # or a netshoot digest
    namespace: cloudspider-debug
    sourceNamespaces: []       # extra namespaces a probe may run in (NetworkPolicy from a source)
    ttlSeconds: 300            # activeDeadlineSeconds; max 1800
    resources: { cpu: 100m, memory: 64Mi }
    allowPrivileged: false     # hostNetwork + NET_RAW/NET_ADMIN, second confirm per run
  reports:
    keep: 50                   # .cloudspider/netdebug/
```

Env equivalents follow the existing pattern, for example `CLOUDSPIDER_NETWORK_POD=1` and `CLOUDSPIDER_KUBE_WRITE_CONTEXTS=kind-lab,cs-drill-admin`.

## 11. Implementation phases

Small PRs, each tested with fixtures and fakes (no live account in CI), in this order. Effort: S ≤ ½ day, M ≈ 1–2 days, L ≈ 3–5 days.

| # | PR | Scope | Effort | Depends |
|---|---|---|---|---|
| N1 | `netdebug-core` | `src/netdebug/` runner and report schema, local DNS (system + DoH), TCP, TLS (chain, SAN, expiry), HTTP timing and redirects, header allowlist; `POST /api/netdebug`, poll, JSON/MD export; rate limits and target refusals (§6.3); config keys `network.local.*`. Tests: loopback DNS/TLS/HTTP servers with self-signed chains, redirect loops, refused metadata IPs | M | – |
| N2 | `netdebug-path-ui` | DEBUG bar, CLIENT/DNS/CDN nodes on the PATH diagram, timing strip, check list, findings panel, "you know the drill" COPY, pip and pro themes | M | N1 |
| N3 | `netdebug-aws-dns` | Target classification (CloudFront/ALB/ENI), Route 53 zones/records/TestDNSAnswer/health checks/resolver rules, dangling-record check | M | N1 |
| N4 | `netdebug-cloudfront` | Behaviour/origin/viewer policy/TLS/WAF/custom errors; CloudFront → ALB hand-off into the existing `routeOn` | M | N3 |
| N5 | `netdebug-vpc` | NACL evaluator (both directions, ephemeral ports), IGW/NAT/endpoint/blackhole routes, subnet free IPs, flow log REJECT lookup (bounded `FilterLogEvents`) | M | N1 |
| N6 | `netdebug-kube-static` | EndpointSlices read, Service/selector/targetPort checks, NetworkPolicy evaluator, CNI enforcement detection, CoreDNS Deployment/PDB/Corefile/metrics, kube-proxy/aws-node; viewer RBAC additions (endpointslices, networkpolicies, the coredns ConfigMap by name, `services/proxy` for CoreDNS metrics) in the add-on stacks | M | N1 |
| N7 | `alb-503-walkthrough` | Guided flow 2.3 over N1/N5/N6 evidence; `WHY?` entry points from SLO, HURTING, radio, PATH; VERIFY ticking from background SLO data | M | N2, N6 |
| N8 | `spider-probe` | The probe binary and image (separate repo or `tools/spider-probe/`), JSON plan in / JSON out, digest pinned; CI builds multi-arch (arm64 for t4g nodes) | M | – |
| N9 | `netdebug-pod` | `kube.writeContexts` + guard (shared with LEARN's), `netdebug-<cluster>` Pulumi add-on (namespace, Role, RoleBinding for the write identity), create → wait → log GET → delete, TTL/labels/sweeper, audit log, confirm UI | L | N6, N8 |
| N10 | `netdebug-scorecard` | NET-* controls (§8) as YAML + evaluators reading the same evidence; depends on the scorecard core landing | M | scorecard core, N3–N6 |
| N11 | optional, each S | traceroute/mtr-lite and MTU (L-NET-01/02); ICMP; IPv6 split; Reachability Analyzer opt-in (A-VPC-06); privileged pod mode; ephemeral-container mode ("probe from the pod's own network namespace", needs `pods/ephemeralcontainers`, separate opt-in) | S each | N1 / N9 |

Total for N1–N9: about 3–4 weeks of focused work. **N1 + N2 alone** are already useful and commercially demoable ("debug any URL, see where the time and the failure are"). With **N3–N7**, the AWS + Kubernetes cross-layer story is one no single competitor tool covers today.

## 12. Competitors and what makes ours different

| Tool | What it does well | Gap that we fill |
|---|---|---|
| **AWS VPC Reachability Analyzer** (and Network Access Analyzer) | Authoritative config-level path analysis between AWS resources, with explanations | Per-analysis charge (USD 0.10), AWS only, no DNS/TLS/HTTP, no Kubernetes objects, not a live test. We use it as one optional check (A-VPC-06) |
| **CloudWatch Synthetics / Internet Monitor** | Scheduled outside-in canaries; internet-level health | Paid per run/resource, set up per endpoint, no inside view. Our vault checks + SLOs cover the scheduled part; netdebug is on-demand and explains |
| **netshoot** | The de-facto debugging toolbox image | Manual: you need to know the drill, write RBAC, clean up, read raw output. We run the drill, structure the output, enforce safety, and still offer netshoot as the image |
| **kubectl debug** (ephemeral containers) | Probe from inside the target pod's network namespace | Needs `pods/ephemeralcontainers` on production pods and leaves the container in the pod spec. Ours is opt-in phase N11 |
| **Kubeshark** | Real-time L4/L7 traffic capture (eBPF/DaemonSet), great for "what is on the wire" | Privileged agents on every node, heavy for on-demand debugging, cluster only. We stay agentless, unprivileged by default, and cover DNS/CDN/ALB/VPC |
| **Cilium Hubble** | Flow visibility and policy verdicts, when Cilium is the CNI | CNI-specific. EKS with VPC CNI does not have it |
| **Komodor** (and similar K8s troubleshooting SaaS) | Change timeline and K8s troubleshooting playbooks | SaaS, agent in the cluster, Kubernetes-centric. Little AWS edge (Route 53/CloudFront/ALB/NACL) depth. We are local-first, and our credentials and evidence stay on the machine |
| **ThousandEyes / Datadog NPM** | Enterprise outside-in and network performance monitoring | Expensive, agents, not a debugger for one URL in one AWS account |

**What makes ours different:**

1. **One path, every layer**: client → DNS → CloudFront → ALB → TG → Service → pod in one picture, built from read-only data the user already trusts in PATH.
2. **Facts vs inferences**, with the scorecard's honest states. UNKNOWN is never shown as green.
3. **Safe by default**: read-only, local-first, no agents. Writes are an opt-in pod with a TTL and an audit log, never on a work context unless explicitly allowed.
4. **The drill is copyable**: every check has its CLI twin, so it teaches and it is a runbook.
5. **Ties into what is already running**: SLO burn, HURTING, radio, vault checks and the scorecard. A debug run becomes evidence and controls, not a one-off screen.

## 13. Open questions

1. **spider-probe home and language.** A small Go repo with signed multi-arch images, or a Node script on a slim image. Go keeps the image tiny and the output structured; Node keeps one language. Recommended: Go.
2. **Write identity for the pod.** A separate kube context via an EKS access entry (IAM role → namespaced Role) vs a token. Recommended: an access entry + IAM role assumed only for the run, so no long-lived write credential sits in the kubeconfig.
3. **Flow logs at scale.** `FilterLogEvents` over 15 minutes is fine for small accounts. Large ones need Logs Insights (billed) or S3/Athena; keep it opt-in.
4. **Commercial packaging** (see `docs/business/`): local URL debugging free; AWS + cluster depth, the walkthrough and exports in the paid tier.
