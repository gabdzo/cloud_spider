# Hybrid baseline: Atlas (dashboard) + Diagnose (investigations)

Status 2026-10-13. Brief: [docs/diagnose-brief.md](../diagnose-brief.md). This page describes the code as it is, not a target design.

## 1. Current architecture we reuse (confirmed in the code)

- **Node 22 ESM app, no framework.** `src/main.js` wires the modules, `src/server.js` serves the API and the static files, `src/app.js` holds the state, and `src/browser.js` with `*-view.js` draws the UI. Tests use `node --test test/*.test.js`.
- **Kubernetes reads.** `src/kube.js` is a GET-only client over a fixed `PATHS` table. It uses the viewer context, and Secrets are never in `PATHS`. A 403 comes back as `{ forbidden }` and a 404 as `{ missing }`, never as a throw. Each context has its own client, available through `app.kubeOf(name)`.
- **Service endpoints.** `src/svc-endpoints.js` already reads endpoints from EndpointSlices. `src/graph-build.js` (`selects`) matches selectors to pods.
- **SNIFF (formerly PATH).** `src/path-read.js` and `src/aws-path.js` read ALB, listener, rule, target-group and target health through AWS `Describe*` calls. `src/path-diagnose.js` draws the path, and `app.pathGraph()` returns the graph.
- **Observe bundle (optional).** `src/observe/live.js` parses the Beyla service graph from the OTel collector, reading it through the API server's service proxy.
- **Incident review.** `src/graph-view.js` holds the timeline under SERVICES. **DEBUG / FROM INSIDE** (`src/netdebug/`) is the only part that can start a pod, and only through a `kube.writeContexts` context with your approval.
- **Persistence.** JSON files under `storage.path` (`.cloudspider/`), for example `slo-ledger.json`, `netdebug/` and `audit.jsonl`.

## 2. Gaps closed by this slice

| Gap | Now |
|---|---|
| No shared finding/evidence contract | `src/diagnose/contract.js`: schema `1.0`, validation, fingerprints, `finalize` (redaction and size limits) |
| No targeted per-Service investigation | `src/diagnose/collect.js`: at most about 9 + 10 GETs, each with an 8 s timeout, and a 25 s deadline before logs |
| Findings not separated from hypotheses | `src/diagnose/rules.js`: facts become findings (symptoms), and hypotheses and open questions are listed separately |
| No before/after verification | `src/diagnose/investigate.js` `verify()`: same scope, same rules, a freshness check, and counter deltas since the investigation |
| Operator failure modes | `OPS-001` (webhook backend with no endpoints) and `CERT-001` (Certificate not Ready) |
| Offline demo with the live schema | `src/diagnose/sample.js`: the brother-sandbox db story plus the §F fixtures |

## 3. Interfaces

- `POST /api/diagnose/investigate {context, namespace, service | sample}` returns the investigation record. `POST /api/diagnose/verify {investigation_id, sample?, outcome?}` returns `{status, checks, new_findings, after}`. `GET /api/diagnose/investigation?id=` returns a saved record.
- Snapshots are saved in `storage.path/investigations/<id>.json` (the newest 50), after redaction.
- The Diagnose modules import nothing from the views. The views call only the HTTP API.

## 4. Risks and assumptions

- **ALB → Kubernetes mapping.** A target group counts as *verified* for a Service only when an `ip` target equals one of the Service's endpoint or pod IPs. The controller tags (`ingress.k8s.aws/resource`) are ambiguous (`ns/ing-svc:port`), so on their own they stay *unknown*. Instance or NodePort targets also stay *unknown*. In those cases there is no NET-002, only an open question.
- **Credentials.** Diagnose uses the existing viewer context and the existing AWS chain. No new RBAC or IAM is needed. Reading webhook configurations and cert-manager Certificates may be forbidden for some viewer roles; that shows up as `forbidden` coverage, not as healthy.
- **APP-001 window.** The collector's counters are cumulative. The investigation records them as `baseline`, and verify uses the delta since then. A counter that went down (a pod restarted, for example during the fix rollout) is treated as the new window. Fewer than 50 calls gives *inconclusive*.
- **Logs.** Pod logs (the last 200 lines of at most 2 pods) are read only when calls are failing. They are redacted (tokens, keys, passwords, URL credentials, JWTs and private keys) and capped at 2 KB per evidence text and 256 KB per record.

## 5. Postponed on purpose

Prometheus queries (there is no endpoint configured yet; this is reported as `not-configured`), Kyverno PolicyReport import, Loki queries, K8sGPT, Argo or Flux, Hubble, a CLI, and any Rust. Atlas keeps working without Diagnose: none of the existing views depend on it.

## 6. Ownership

- **Atlas** (the dashboard views) displays investigations and their history.
- **Diagnose** (`src/diagnose/*`) gathers evidence, runs the rules and verifies fixes. It uses no DOM and no view state, so a future CLI can import `collect`, `investigation` and `verify` directly and print the same JSON.
