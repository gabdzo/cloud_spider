# Chaos drill for DIAGNOSE

`scripts/chaos-drill.mjs` breaks one thing at a time on a real cluster, runs
◎ INVESTIGATE through a running Cloud Spider, checks the expected rule fired,
restores, runs VERIFY AGAIN and checks the answer is **resolved**.

```
PORT=9251 CLOUDSPIDER_KUBE_CONTEXT=cloudspider-up-viewer npm start   # a test instance, viewer only
node scripts/chaos-drill.mjs --app http://127.0.0.1:9251 \
  --admin cloudspider-up-admin --viewer cloudspider-up-viewer \
  [--only NET-001,OPS-001] [--shots ./shots --pw /path/to/playwright-core]
```

| Scenario | How it breaks | Expected |
|---|---|---|
| NET-001 | `chaos-drill/net001` scaled to 0 | NET-001 |
| K8S-001 | readiness probe on `/no-such-path`, waits 150 s (rule needs > 120 s) | K8S-001 |
| PENDING | a pod requesting 64 CPUs | an open question naming the Pending pod (not a finding by design) |
| CERT-001 | Certificate with a ClusterIssuer that does not exist | CERT-001 |
| OPS-001 | a test ValidatingWebhookConfiguration (`failurePolicy: Ignore`, `namespaceSelector` = `chaos-drill` only) calling a Service with no pods | OPS-001 |
| NET-002 | `shop/shopapi` readiness on a wrong path, so the ALB targets go unhealthy; restored with `rollout undo` | NET-002 |
| APP-001 | nothing: reads the existing `brother-sandbox/db` errors | APP-001 (verify stays still_failing) |

Safety:
- Writes only through `--admin` with an explicit `--context`; never the current context.
- Everything lives in the `chaos-drill` namespace plus one cluster-scoped test webhook that only
  matches that namespace and fails open. The real cert-manager webhook is never touched.
- The namespace, the webhook and the shopapi change are removed in a `finally`, also on Ctrl-C.
- Results go to `chaos-drill-results.json` in `--out` (or `--shots`). Keep screenshots out of git.

The viewer must be allowed to list admission webhook configurations
(`upgrades/eks/scanner-rbac.js`, shipped in the EKS stack), or OPS-001 reports "forbidden".
