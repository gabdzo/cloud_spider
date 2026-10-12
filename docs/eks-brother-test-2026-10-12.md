# Brother scenario on cloudspider-up EKS — 2026-10-12

Plain-Kubernetes "brother" scenario run on cloudspider-up (EKS 1.32, 2 spot nodes) instead of CRC (CRC was too small).
Instance: fresh clone of main (157c7e8), profile `k8s-only` + `[observe, network]`, private kubeconfig, own port; Gabriel's tree and config untouched.

## Setup on the cluster
- `brother-sandbox`: loadgen → frontend → api → db (db fails ~5–10%: `pool exhausted`).
- `cloudspider-observe` bundle: Beyla ×3 (eBPF), otel-agent ×3, otel-collector, kube-state-metrics, loki-0, with default-deny NetworkPolicies opened for the bundle. All Running.

## Results
| Check | Result |
|---|---|
| SERVICES live Beyla edges + LIVE labels (#270) | **Works.** loadgen→frontend→api→db with `LIVE · Beyla/OTel` labels; api→db red (`2.4/s · 13.7% err`). |
| Live rate flicker | **Fixed in #282.** Rates were taken over a 3–10 s delta between back-to-back reads; collector counters move per export interval → busy edges showed 0/s on every other refresh. Baseline is now the newest scrape ≥30 s old. |
| INCIDENT REVIEW timeline | **Works.** Loki-backed (observe bundle), 1H/6H/24H/72H; ROLLOUT/RESTART/WARN/OK chips; Kyverno PolicyViolations, Karpenter node churn, Loki readiness visible. |
| Morning report (log errors) | **Works** via LOG ERRORS → NIGHT (test config sets night 12:00–13:45): db `ERROR orders-db query failed`, `ConnectionError: pool exhausted`, api `backend call failed`, plus kube-system noise (ebs-csi, metrics-server). LAST 1H/24H from #280. |
| Morning report panel (pod health lines) | **Gap.** `#morning` is `data-module="map"`, so it is hidden in `k8s-only`. LOG ERRORS covers the log part; the pod-health lines are not visible in the brother's profile. Follow-up. |
| Debug pod with Service names | **Works** (write context, `network.pod.enabled` in the test config only). `http://api:9898/` from brother-sandbox: PASS 10/10; `http://db:8080/query`: PASS 10/10; `https://example.com/`: FAIL 2 (egress blocked by default-deny, explained). |
| GROUP BY part-of (SERVICES, TOPOLOGY) | **Works.** TOPOLOGY lanes `brother-demo` and `cloudspider`; SERVICES selector switches grouping. |

## Other findings
- ~19 live edges per read are dropped (counted in `live.dropped`): calls to `<ns>/kubernetes` (API server), node hostnames (kubelet/health probes) and `incoming`. Harmless; could map `<ns>/kubernetes` → `default/kubernetes` later.
- Starting the app without `AWS_REGION=eu-north-1` hits SCP-denied DescribeRegions/ListClusters in eu-central-1 and shows a red banner; set the region for the demo.
- Kyverno flags the bundle (privileged Beyla, hostPath, no readiness probes) — expected; Score shows it under K8S-SEC-001 / K8S-REL-002.

## Screenshots
`/workspace/demo-shots/eks-brother/` (box): services-live-{pip,pro}, services-brother-live-{pip,pro}, services-groupby-partof-{pip,pro}, topology-groupby-partof-{pip,pro}, morning-logs-night-{pip,pro}, score-{pip,pro}, inside-frontend-api, inside-blocked-external, log-errors.
