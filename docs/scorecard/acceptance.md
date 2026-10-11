# Scorecard live acceptance run

The scorecard MVP's top-level acceptance test, run by hand on a real AWS
account. The automated version is `test/score-acceptance.test.js` (fakes for
kube and Pulumi, run by `npm test`); this run checks the same flow against EKS
and the real add-on stacks. Record the result (screenshots of the three scans
and the numbers) in the PR or issue that closes the slice.

**Cost:** one EKS control plane ($0.10/h) plus one t4g.medium node, its 20 GB
gp3 volume and public IPv4, roughly $0.15 an hour; the EKS card shows the
exact bill line before you run it. The run takes about 1.5 hours including
the ~15 min cluster create and ~10 min take-down, so about $0.25–0.30.
Metrics-server, Kyverno and cert-manager add pods only, no AWS resources.
Take everything down at the end (step 9).

## Before you start

- `npm start` is running (or `npm start -- --config cloudspider.yaml`) and the
  page is open at the address it printed (default http://127.0.0.1:9241).
- AWS credentials for the **sandbox** account are in the shell that ran
  `npm start` (`AWS_PROFILE` / `aws.profile`), with rights to run the EKS and
  add-on stacks (the same rights STACKS already needs).
- `features.stacksRun` is on in `cloudspider.yaml` (the default).
- Nothing else is running on the cluster name you pick.
- `kube.autoConnect` is on (the default): RUN on the EKS card CONNECTs the
  new cluster by itself and TAKE IT DOWN DISCONNECTs it (RUN-ME §21).

## Steps

1. **Fresh cluster.** STACKS → EKS card → `clusterName: score-demo`,
   `instanceType: t4g.medium` → PREVIEW → RUN. Wait for DONE (about 15 min).
   t4g.medium has room for 17 pods. On t4g.small (11 pods) the third fix
   below is refused for pod room before any Pulumi call, which is the
   preflight working: record that, then use t4g.medium for the full flow.
   The EKS PREVIEW should list the scanner's read-only access with the rest
   (Task 18: the `scanner` Kubernetes provider, the `cloudspider-scanner`
   ClusterRole and its ClusterRoleBinding, 3 creates; RUN-ME §23). This is
   the one live preview that change still needs: note it in the PR or issue.
   Without it, SCAN on a fresh cluster with only the viewer role shows some
   reads refused (UNKNOWN) and may say INSUFFICIENT EVIDENCE instead of a
   number; the panel shows the read-only grant to fix that.
2. **Connect.** When the RUN is DONE, CONNECT runs by itself (the run log
   and the radio say "connected by itself"). If `kube.autoConnect` is off or
   that step failed, press CONNECT NOW on the EKS card. Then pick
   `score-demo-viewer` in the Cluster view's context switcher: SCORE scans the
   cluster picked there (the kubeconfig's current context is not changed).
3. **Low score.** Press the SCORE key → SCAN. Expect:
   - verdict `AT RISK` and a score under 30 (the fake cluster scores 0);
   - the verdict before the number, coverage next to it, and "no environment
     set: production assumed";
   - a "Fix next" row and, in the controls list, failing platform controls
     first, each with a `FIX: <add-on>` button: K8S-PLT-001 Kyverno,
     K8S-PLT-002 metrics-server, K8S-PLT-003 LBC, K8S-PLT-004 cert-manager,
     K8S-PLT-005 Karpenter, K8S-PLT-006 Pod Identity, K8S-PLT-007 KEDA.
4. **Fix metrics-server.** `FIX: metrics-server` → the pane shows the plan
   (stack `metrics-server-score-demo`, the pods it needs, the pod slots free)
   → PREVIEW → read the Pulumi preview ("Preview finished: nothing changed
   yet") → APPROVE. The steps bar moves Plan → Preview → Approve → Install →
   Rescan, then "metrics-server installed. Score +N." Expect the number to
   rise (about +30) and K8S-PLT-002 to show PASS.
5. **Fix Kyverno, then cert-manager,** the same way. Expect the score to rise
   each time (reference fake: 0 → 30.6 → 61.2 → 65.3) and the verdict to move
   from AT RISK to CONDITIONAL. The trend bars show one bar per scan.
6. **Already installed.** Install an add-on from its STACKS card without
   rescanning (e.g. Pod Identity), then press its `FIX` in the panel: the plan
   says it "is already on score-demo" and offers no PREVIEW. SCAN again: the
   control passes and the FIX is gone.
7. **Export and AWS account (read-only).** EXPORT → MD, HTML and JSON each
   download the latest scan (file `cloudspider-scorecard-score-demo-<date>.*`):
   verdict before number, the disclaimer, no evidence fields. Then press
   AWS ACCOUNT → SCAN: it reads the account in `scorecard.regions` with
   Describe/List/Get calls only; refused reads show as UNKNOWN with the IAM
   grant to add. Press CLUSTER to go back.
8. **Refusals.**
   - Another origin:
     `curl -s -X POST -H 'origin: http://evil.test' -H 'content-type: application/json' -d '{}' http://127.0.0.1:9241/api/score/fix`
     answers "nothing was changed" (same for `/api/score/scan`: "the scan did
     not run").
   - With `features: { stacksRun: false }` in `cloudspider.yaml` (restart),
     the FIX POST answers 403 and SCAN still works.
9. **Take it down.** Take down the add-on stacks from their STACKS cards
   (cert-manager, Kyverno, metrics-server, and any other you installed), then
   the EKS stack (TAKE IT DOWN, type the cluster name). DISCONNECT runs by
   itself: `score-demo-viewer` leaves the kubeconfig and the contexts file.
   Check the EKS card shows no cluster and the bill line is gone.

## Pass criteria

- The fresh scan is AT RISK with a low score, and every platform failure has
  a FIX.
- Each FIX went plan → preview → approve → up → automatic rescan with no
  terminal command, and each rescan scored higher than the one before.
- Pod-room and already-installed preflights refused before any Pulumi call.
- No scan, report or panel showed a number without its verdict, and every
  view carried the disclaimer.
