# Perf work: before / after (2026-10-15)

Scope: stay light and fast. Types are `// @ts-check` + JSDoc + `tsc --noEmit`
in CI. There is no build step, no `.ts` file and no new runtime dependency.
The baseline and the tools are in `docs/perf-baseline.md` (`scripts/perf/`).

## Box: fake cluster `acme-stg-7` (12 ns × 4 apps, 80 ms per API call, k8s-only)

| Metric | Before (eb4cdcf) | After (main 40787dd) |
|---|---|---|
| Bytes per cold page load | 1.78 MB (no compression, `no-store`) | **534 KB** |
| HTML page | 338 KB | 59 KB gzipped |
| /api/cluster | 104 KB | 6.7 KB gzipped |
| Reload of an unchanged module | full 200 download | **304, empty body** (ETag) |
| Kube GETs in flight at peak | 30–42 (no cap) | **12** (capped) |
| Duplicate kube GETs in one cold load | 15–29 | 2–16: only sequential repeats are left |
| DIAGNOSE (fake) | 0.17–0.20 s | 0.18–0.23 s: same; the kube side was already parallel |
| Page load / network idle (warm run) | 0.20 s / 0.29 s | 0.36 s / 0.65 s* |
| Main thread (warm run) | script 52 ms, task 309 ms | script 59 ms, task 422 ms* |

\* The after runs were taken while the CI gate (the full test suite) was
running on the same box, so they are noisy. Byte counts and call counts do
not depend on load.

## Live on demo-prod (before only, Gabriel's Mac, load average 12–47)

| Endpoint | Before | What changed |
|---|---|---|
| /api/morning/logs | 22.7 s, serial chain | graph index, pods and both Loki windows read together; the 1h fallback starts early (#414) |
| DIAGNOSE | 8.3 s warm, up to ~35 s cold | the SNIFF path graph overlaps the kube reads (#411) |
| /api/path | 8.8 s | not changed yet |
| /api/addons | 4.2 s | shares in-flight GETs (#413) |

The live after numbers were not taken. The app copies on the Mac still run
the old code, and restarting one on a loaded Mac was not worth the risk.
Measure after the next `git pull` with
`node scripts/perf/page-bench.mjs --url http://127.0.0.1:<port>/ --runs 1`.

## Production basics (#415, #416)

- `GET /healthz` reads neither AWS nor the cluster.
- Server timeouts: headers 20 s, request 120 s, keep-alive 5 s.
- `unhandledRejection` is logged instead of crashing. `uncaughtException`
  is logged, then the normal graceful shutdown runs.
- `npm run typecheck` runs in CI. Six core modules are opted in: kube,
  kube-contexts, graph-build, shutdown, diagnose/collect and diagnose/rules.
  It caught a duplicate `nsEvents` key in kube PATHS, which is now removed
  with no change in behaviour.

## Left

- /api/path (8.8 s) and the AWS path graph: an SWR cache, and skipping AWS
  when a Service has no Ingress.
- Page duplicates: /api/view ×4 and /api/alb-routes per ALB.
- Progressive map paint.
- Opt more modules into `@ts-check` (config.js and log-report.js need JSDoc).
- `test/shutdown.test.js` "force()" fails on the box on main as well. It is
  environment-specific and not caused by this work.
