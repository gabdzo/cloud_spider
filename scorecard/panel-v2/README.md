# Score panel v2 (task 31, cloud_spider PR #140)

Fixture data (fake kube + fake stacks + fake AWS, real catalog/engine/scorer/API), both themes, 1280×800 and 1920×1080 (`-1281` = 1280 wide, tall, whole panel).

- `0-empty-*`: no scan yet.
- `1-fresh-low-*`: fresh cluster, scanner can read everything: AT RISK 0/100, Fix next.
- `2-fix-previewed-*`: after three fixes, a fourth (AWS Load Balancer Controller) previewed: stepper on APPROVE.
- `3-after-fixes-*`: after metrics-server, Kyverno, cert-manager, Pod Identity: CONDITIONAL 76 (75.5), "since the last scan" list, EXPORT links.
- `4-aws-account-*`: AWS ACCOUNT view: one public database made private + Multi-AZ between two scans (two FIXED), AWS-SEC-002 gate not assessed → CONDITIONAL.
- `5-refused-reads-*`: no scanner RBAC: two reads refused → UNKNOWN, INSUFFICIENT EVIDENCE, the read-only grant shown.
