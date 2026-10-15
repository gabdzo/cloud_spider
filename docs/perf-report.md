# Perf work (2026-10-15)

Gabriel's priority: stay lightweight and fast. TypeScript = `// @ts-check` +
JSDoc + `tsc --noEmit` in CI, **no build step, no file converted to .ts, no
runtime dependency**. Baseline: `docs/perf-baseline.md`. Numbers: fake
cluster `acme-stg-7` on the box, and one warm app copy against demo-prod on
Gabriel's Mac (load avg 12–47; short runs).

## Before → after

| Metric | Before | After (this run) | PR |
|---|---|---|---|
| Page load bytes (fake, cold) | 1.78 MB, uncompressed, `no-store` | **534 KB** gzipped + ETag/304 | #412 |
| DIAGNOSE wall time | kube then path graph (sum) | both in parallel (max) | #411 |
| Morning logs (demo-prod) | **22.7 s** serial | graph+pods+Loki together; 1h fallback early for Loki | #414 |
| Kube GETs at cold page load | dups 15–29, peak 30–42 | dups 2–16, **peak 12** | #413 |
| /healthz + timeouts + unhandledRejection | none | added | #415 |
| Type check in CI | none | `npm run typecheck` (`tsc --noEmit`), 6 modules opted in | #416 |

## Merged / open

- #410 baseline (tools + report) — **merged**
- #411 DIAGNOSE parallel path graph
- #412 gzip + ETag/304
- #413 kube in-flight share + concurrency cap
- #414 morning-logs parallel reads
- #415 healthz / timeouts / process handlers
- #416 typecheck (`@ts-check` + JSDoc)

## Left for next run

- DIAGNOSE ~8 s live is mostly the path graph itself (AWS Describe*); cache /
  SWR for it, and skip AWS when the Service has no Ingress.
- Deduplicate page `/api/view` (×4) and `/api/alb-routes` (×4 same id).
- Progressive map paint (stream fixtures).
- Opt more modules into `@ts-check` (config.js, log-report.js need more JSDoc).
- Live before/after of morning-logs and DIAGNOSE once #411+#414 are on the
  demo-prod app copy (Mac is loaded: remeasure after a quiet restart).
