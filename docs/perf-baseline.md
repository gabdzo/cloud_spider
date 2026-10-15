# Performance baseline (2026-10-15, main eb4cdcf)

Tools: `scripts/perf/fake-apiserver.mjs` (a fake Kubernetes API, any cluster
name, fixed latency, logs every call) and `scripts/perf/page-bench.mjs`
(headless Chrome page load, requests, main-thread cost; browser closed in
`finally`).

## Box, fake cluster `acme-stg-7` (12 ns × 4 apps, 80 ms per API call), k8s-only

| What | Number |
|---|---|
| Server start → first answer | 1.1 s |
| Page `load` / network idle (cold browser) | 0.21 s / 0.51 s |
| Requests per page load | 116 (93 JS modules, 8 API) |
| Bytes per page load | 1.78 MB, **uncompressed, `cache-control: no-store`**: every reload refetches all of it |
| HTML page (inline CSS) | 338 KB raw, 59 KB gzipped |
| JS modules | 1.34 MB raw, 429 KB gzipped (browser.js 293 KB) |
| /api/cluster | 104 KB raw, 5.8 KB gzipped; 162 ms cold, 5 ms warm |
| Main thread (first load) | script 61 ms, layout 24 ms, style 26 ms, 1 long task 57 ms |
| Kube API calls at start + one page load | 45, of which **14 are duplicates** (deployments ×3, pods ×3, daemonsets ×3, nodes/ns/services/events/… ×2: /api/cluster, addons, score and morning each list them) |
| Kube calls in flight at peak | 29 (no concurrency limit) |
| DIAGNOSE (fake) | 0.17–0.2 s: kube reads are parallel (2 round trips) |

## Live, demo-prod, one warm app copy on Gabriel's Mac (load avg 12–47), full profile

| Endpoint | Time | Size |
|---|---|---|
| /api/morning/logs?window=auto | **22.7 s** | 24 KB |
| /api/path (SNIFF graph) | **8.8 s** | 6 KB |
| POST /api/diagnose/investigate | **8.3 s** | |
| /api/addons | 4.2 s | 3 KB |
| /api/kube/connect (page) | 2.6 s | |
| /api/cost (page) | 2.5 s | |
| /api/cluster | 0.9 s | 102 KB |
| /api/view?grain=coarse | 0.65 s | 15 KB |

Page load against that warm server: `load` 0.45 s, network idle 6.3 s,
132 requests, 1.95 MB, 24 API calls with duplicates: **/api/view ×4,
/api/reach ×2, /api/alb-routes ×4 in parallel for the same ALB**. Main
thread 767 ms task time, 2 long tasks (max 80 ms). The 30–90 s first load
is a cold server: the morning logs (Loki through the API server proxy),
the SNIFF graph and add-ons all start cold at once.

## Where the time goes (biggest first)

1. Morning logs, 22.7 s: Loki through the API server's service proxy.
2. DIAGNOSE: the SNIFF path graph (up to 16 s budget) is read **after**
   all kube reads, so the times add up instead of overlapping. Worst case:
   8 s (observe metrics) + events + 16 s (path graph) ≈ the 35 s seen.
3. Static assets: no compression, no validators, `no-store`: 1.8–2 MB per
   load, 93–116 requests.
4. Duplicate kube list calls between endpoints (14 of 45), no in-flight
   dedupe, no concurrency limit.
5. Duplicate page API calls (/api/view ×4, alb-routes ×4 same id).
