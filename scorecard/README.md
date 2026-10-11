# Scorecard panel (SCORE key), fixture data

Real catalog, profiles, engine, scorer, history, fix runner and API; the
cluster and Pulumi are the test fakes (test/fixtures/fake-kube.js,
fake-stacks.js). Pip-Boy (`-pip-`) and pro (`-pro-`) themes, 1280x800 and
1920x1080. The panel scrolls; these show its first screen.

- panel/0-empty-*: no scan yet
- panel/1-fresh-low-*: fresh EKS cluster, AT RISK 0/100, seven platform fixes offered
- panel/2-fix-previewed-*: after metrics-server, Kyverno, cert-manager and Pod Identity (75.5, CONDITIONAL), the LBC fix previewed and waiting for APPROVE
- panel/3-after-fixes-*: the same four fixes done (0 → 30.6 → 61.2 → 65.3 → 75.5), the last fix's log, and the next three suggestions
- panel/header/: the map before (main) and after the SCORE key, Pip-Boy 1280/1920 and pro 1920: same header rows, no truncation
