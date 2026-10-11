# TELEMETRY / OPS on any kube context (cloud_spider PR #149)

Fixture: a namespace-scoped WORK context (payments, ledger, team-tools) is first (primary); the cluster-wide UP context (cloudspider-up-viewer, ALL NAMESPACES) is second. Before #149 picking UP hid the TOPOLOGY / TELEMETRY / OPS tabs.

- `ops-up-*`, `telemetry-up-*`: UP picked (not primary): full OPS (Kyverno, HPA, Karpenter, events) and node telemetry.
- `ops-work-scoped-*`: WORK: events/HPAs in its namespaces; Kyverno and Karpenter say CLUSTER-WIDE ONLY with a note, instead of "not on this cluster".
- `telemetry-work-scoped-*`: WORK: node names from its pods only, with the note that gauges/pressure/OTel need a cluster-wide context.
