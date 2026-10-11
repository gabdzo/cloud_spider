# Production readiness scorecard

Date: 2026-10-11
Status: DRAFT. Not approved. Do not implement until you accept this spec and `docs/business/cloud-spider-platform-strategy.md`.
This is the architecture. It is not a certification against AWS Well-Architected, CIS, NIST, NSA/CISA, or Red Hat. A finding may cite a control id. The report says which ids were checked.

## What it is

A pure function over data Cloud Spider already reads, plus an explicit list of checks it did not run.

```text
AWS diagram + path graph          kube GET lists
(src/aws.js, src/aws-path.js,     (src/kube.js PATHS)
 src/path-diagnose.js)
        \                         /
         \                       /
          v                     v
              adapters (facts only)
                     |
                     v
           controls (YAML) + profile
                     |
                     v
              findings[] + coverage
                     |
                     v
         score | INSUFFICIENT_EVIDENCE
         gate  | NOT_READY if any critical FAIL
                     |
                     v
            JSON and Markdown on disk
```

No new listener. No write to AWS. No write to the cluster. No Pulumi from the scorer.

## Results

Every control ends in exactly one of:

| Result | Meaning | In the score |
| --- | --- | --- |
| PASS | Evidence shows the condition holds | yes, earned |
| FAIL | Evidence shows it does not | yes, lost |
| UNKNOWN | The API answered and the field was missing, partial, or contradictory | no. Counts against coverage |
| NOT_APPLICABLE | The profile or the resource type says this control does not apply | excluded from coverage and from the score |
| NOT_ASSESSED | The call was not made, returned 403 or 404, or the collector does not implement it | no. Counts against coverage |

A missing permission is NOT_ASSESSED or UNKNOWN. It is never PASS. An empty list is not a pass unless the control says an empty list is the healthy state (for example, zero load balancers means the ALB controls are NOT_APPLICABLE, not PASS).

## Score

Applicable assessed = PASS + FAIL.
Coverage = applicable assessed / (applicable assessed + UNKNOWN + NOT_ASSESSED).
NOT_APPLICABLE is in neither side.

Weights, used only on PASS and FAIL:

| Severity | Weight |
| --- | --- |
| informational | 0 |
| low | 1 |
| medium | 3 |
| high | 8 |
| critical | 21 |

Category score = 100 * (sum of weights of PASS) / (sum of weights of PASS and FAIL), rounded to an integer. If a category has zero assessed weight, it has no score.

Overall score uses the same formula across categories. It is printed only when both are true:

- coverage is at least 0.60
- at least 8 applicable controls were assessed

Otherwise the overall value is `INSUFFICIENT_EVIDENCE`. Category scores still print when that category has at least 3 assessed controls. Failures still list.

### Critical gate

Weights are not enough. One hundred low passes and one critical fail can still average above 80. So the report always prints a gate beside the number:

- `NOT_READY` if any FAIL has severity critical
- `READY_WITH_RISK` if any FAIL has severity high and none are critical
- `NO_OPEN_HIGH` if coverage is sufficient and there is no high or critical FAIL

The gate is the readiness decision. The number is the weighted residue of assessed checks. A UI that shows the number without the gate is a bug.

### Confidence

Each finding has `high`, `medium`, or `low` confidence.

- high: a field on the resource (a security group rule, a probe, a target state)
- medium: inferred from a neighbor (a pod is the target because the IP matches)
- low: a name or tag heuristic

Category confidence = applicable assessed / (applicable assessed + UNKNOWN) for that category. NOT_ASSESSED is reported beside it as coverage, not folded into confidence. A category at 100 with confidence 0.4 was scored on the checks that returned, and a lot of checks came back unclear. The report prints both numbers.

### Config versus runtime

`evidenceKind` is `config` or `runtime`. A NetworkPolicy object is config. A target group with zero healthy targets is runtime. The overall score mixes them and the report splits them, so a clean config score cannot be read as "the site is up."

### History

v1 writes one JSON file per scan under a local directory, named by time. It does not diff. Diff, trend, and "opened or resolved" are the paid slice in the strategy, and they are out of the first code.

## Profiles

A profile changes applicability and, in one case, severity. It does not turn UNKNOWN into PASS.

| Profile | What changes |
| --- | --- |
| `aws-sandbox` | Single-AZ and a missing backup plan are NOT_APPLICABLE. A world-open security group on a tagged sandbox stays FAIL at high, not critical. Missing CloudTrail stays high. |
| `aws-production` | Single-AZ, missing backup, and world-open management ports are in scope. World-open SSH or RDP is critical. |
| `kubernetes-development` | Missing PodDisruptionBudget and missing topology spread are NOT_APPLICABLE. Privileged containers stay critical. |
| `kubernetes-production` | Probes, requests, PDB, and spread are in scope. Privileged stays critical. |
| `openshift-production` | Kubernetes pod checks still apply. SCC, ClusterOperator, MachineConfigPool, Routes, and the OpenShift monitoring stack are the platform checks. A missing NetworkPolicy is not automatically a fail if an SCC and NetworkPolicy-equivalent isolation is in force. Until those APIs are read, the platform checks are NOT_ASSESSED. |

Environment comes from a label the user sets for the scan (`dev`, `test`, `staging`, `production`), not from a guessed name. If they do not set it, the profile is the production one and the report says so.

## Control file

One YAML document per control. v1 ships a small set in `scorecard/controls/`. Rule version is the file's `version` plus a hash of the file contents stored on the finding.

```yaml
id: aws.sg.world-admin-port
version: 1
title: Security group allows the world onto an admin port
target: aws-account
category: security
severity: critical
evidenceKind: config
profiles:
  aws-production: { applies: true, severity: critical }
  aws-sandbox: { applies: true, severity: high }
sources:
  - path-graph.securityGroups
citations:
  - framework: AWS Well-Architected
    control: SEC05-BP02
    note: Control id cited as guidance. This scan is not a Well-Architected review.
result: fail-when-any
passWhen: no ingress rule has cidr 0.0.0.0/0 or ::/0 on tcp 22, 3389, or 10250
unknownWhen: a group was listed and its ingress rules were not included
notAssessedWhen: DescribeSecurityGroups was not called or returned a permission error
notApplicableWhen: the account has no security groups in the scanned VPCs
why: Anyone on the internet can attempt that port.
remediation: Remove the world CIDR from that port. Prefer a VPN or SSM.
effort: small
operationalRisk: Locking out the only admin path if you delete the rule before adding a replacement.
automatedRemediation: false
verify: A new path read shows the rule gone, and an admin can still reach the host the intended way.
```

`automatedRemediation: true` is forbidden in v1. A later pack may set it only for a Pulumi preview that still requires the typed name and a human button. The scorer never calls `pulumi up`.

## Finding

```yaml
id: aws.sg.world-admin-port
result: FAIL
severity: critical
confidence: high
category: security
evidenceKind: config
resource: sg-0123456789abcdef0
account: "one local account"
region: eu-central-1
profile: aws-production
ruleVersion: 1
evidence: "ingress tcp 22 from 0.0.0.0/0"
why: Anyone on the internet can attempt SSH.
remediation: Drop that CIDR. Use SSM or a known network.
effort: small
operationalRisk: You can lock yourself out if this was the only path.
automatedRemediation: false
verify: Rescan shows the rule absent and you can still connect the intended way.
citations:
  - { framework: "AWS Well-Architected", control: "SEC05-BP02" }
```

Fields the brief asked for and v1 omits on purpose: a Pulumi preview, a PDF, a trend. They are not on the finding.

## v1 controls

Only controls whose inputs exist today. Anything else is a stub control with result forced to NOT_ASSESSED and a `blockedBy` string. Stubs exist so the coverage math is honest. They are not a promise to implement the API.

### AWS, assessed in v1

| Id | Input that exists | FAIL when |
| --- | --- | --- |
| `aws.path.unhealthy-targets` | `diagnose()` in `src/path-diagnose.js` | The headline is an unhealthy or 5xx target |
| `aws.path.stops-before-pod` | same, plus services and pods if the kube read succeeded | Informational. The path object has no Service. Not a score failure |
| `aws.sg.world-admin-port` | `DescribeSecurityGroups` in `src/aws-path.js` | tcp 22, 3389, or 10250 from `0.0.0.0/0` or `::/0` |
| `aws.net.public-subnet` | route tables in `src/aws-arch.js` | Informational count of subnets whose default route is an internet gateway. Not a fail by itself |
| `aws.eks.cluster-not-active` | cluster status already on the path | status is not ACTIVE |
| `aws.lb.no-healthy-target` | target health on the path | a target group has listeners and zero healthy targets |

### AWS, stubbed as NOT_ASSESSED in v1

IAM least privilege, root MFA, CloudTrail trail configuration (the page reads lookup events, not trail config), encryption at rest, KMS, Secrets Manager, Security Hub, GuardDuty, RDS Multi-AZ, backup plans, NAT single points, VPC endpoints, CloudWatch alarms, cost allocation tags, budget alerts, IaC coverage, tag policy. Each stub names the API that would assess it. Coverage drops until you add the call. That is the point.

### Kubernetes, assessed in v1

Inputs are the GET paths in `src/kube.js`. A 403 on a path makes every control that needed it NOT_ASSESSED for that cluster.

| Id | FAIL when |
| --- | --- |
| `k8s.pod.privileged` | a container has `securityContext.privileged: true` outside `kube-system` |
| `k8s.pod.no-requests` | a container has no cpu or memory request, outside `kube-system` |
| `k8s.pod.no-ready-probe` | a Deployment pod template has no readiness probe, production profile |
| `k8s.workload.no-pdb` | a Deployment with more than one replica has no PodDisruptionBudget, production profile |
| `k8s.hpa.missing-metrics` | an HPA exists and metrics-server returned 404 |
| `k8s.kyverno.policy-fail` | a PolicyReport result is fail. If the CRD is 404, NOT_ASSESSED, not PASS |
| `k8s.net.no-policy` | production profile, a namespace other than system namespaces has pods and zero NetworkPolicies. NOT in v1 if NetworkPolicy is not in `PATHS` yet. Until that path is added, this control is NOT_ASSESSED |

`PATHS` today does not list NetworkPolicy, PodDisruptionBudget, or ResourceQuota. Those three stay NOT_ASSESSED in the first code unless the plan adds the GET path. Adding a GET path is still read-only. It is in the plan as its own task so a reviewer can reject it alone.

Kyverno policies already in `upgrades/addons/kyverno-policies.js` are Audit mode. The scorecard reads reports. It does not switch them to Enforce.

### OpenShift, designed, not built

Do not mark a cluster OpenShift because a sample drawing exists. Detection is a successful GET of `config.openshift.io/v1` `ClusterVersion`. If that 404s, every `ocp.*` control is NOT_APPLICABLE. If it 403s, they are NOT_ASSESSED.

| Id | Why it is not a Kubernetes copy |
| --- | --- |
| `ocp.scc.privileged-binding` | SecurityContextConstraints, not just PodSecurity admission |
| `ocp.operator.degraded` | ClusterOperator conditions. Kubernetes has no equivalent |
| `ocp.mcp.degraded` | MachineConfigPool. A stuck pool blocks upgrades |
| `ocp.version.upgradeable` | ClusterVersion conditions. Do not recommend a Kubernetes skew upgrade |
| `ocp.route.public-admin` | Routes, not only Ingress |
| `ocp.monitor.stack` | OpenShift ships a monitoring stack. Missing Prometheus in `openshift-monitoring` is a platform fault. Installing a second Prometheus is not the fix |
| `ocp.etcd.backup-unknown` | Backup visibility is often NOT_ASSESSED from a viewer role. Never PASS |

Version-aware text comes from the ClusterVersion status, not from a hardcoded "4.x is fine."

## Example cards

These are illustrations of the shape. They are not a scan of a customer account.

### AWS production, partial

Coverage 0.22 (4 assessed, 14 not assessed). Overall: `INSUFFICIENT_EVIDENCE`. Gate: `NOT_READY` because a critical FAIL exists even without an overall number.

| Control | Result | Severity |
| --- | --- | --- |
| aws.sg.world-admin-port on sg-0123 tcp 22 | FAIL | critical |
| aws.lb.no-healthy-target on tg-api | FAIL | high |
| aws.eks.cluster-not-active | PASS | high |
| aws.net.public-subnet | PASS, informational | informational |
| aws.iam.least-privilege | NOT_ASSESSED | critical weight not applied |
| aws.trail.enabled | NOT_ASSESSED | |

The critical gate fires. The number does not print. The IAM hole is visible as not assessed, not as a pass.

### Kubernetes production, enough coverage

8 assessed, 2 not assessed. Coverage 0.80. Weighted score 71. Gate `NOT_READY` if privileged is a fail, else `READY_WITH_RISK` when probes are missing at high.

| Control | Result |
| --- | --- |
| k8s.pod.privileged, pod shop/api | FAIL critical |
| k8s.pod.no-requests, three deployments | FAIL medium |
| k8s.pod.no-ready-probe, shop/api | FAIL high |
| k8s.kyverno.policy-fail | NOT_ASSESSED, CRD 404 |
| k8s.net.no-policy | NOT_ASSESSED, path not in the client |

### OpenShift production, cluster not connected

ClusterVersion was not requested. Every `ocp.*` control is NOT_ASSESSED. Overall for the OpenShift card: `INSUFFICIENT_EVIDENCE`. Do not copy the Kubernetes score into the OpenShift card.

## Dashboard, when a page exists

v1 can be JSON and Markdown only. If it is drawn on the existing page, the first screen shows three lines: gate, coverage, and the score or `INSUFFICIENT_EVIDENCE`. Then the critical and high FAILs. Then NOT_ASSESSED, so the user sees what was not looked at. Filters by account, region, cluster, namespace, and severity. A finding opens the evidence and the verify line.

Empty: no account and no kube context, say so, score nothing.
Error: one AWS call failed, that control is NOT_ASSESSED with the public error string from `publicError`, and the rest of the scan still returns.
Stale: the file has a scanned-at time. Older than 24 hours, the page says the scan is old. It does not refresh by itself in v1.

## Remediation

v1 recommendations are text. The existing Stacks buttons stay where they are. The scorecard does not gain an Apply button.

Later, a finding may point at an add-on id in `upgrades/addons/catalog.js` when `detect` says it is absent. The user still opens Stacks and types the name. Detect-before-install is already how the catalog is written. The scorecard must not recommend Kyverno if detect says the deployment exists, and must not recommend a second metrics stack on OpenShift when `ocp.monitor.stack` is PASS.

Destructive operations and CRD upgrades stay high risk. They are not scorecard actions.

## Incidents

An ALB 503 today becomes the path headline in `headline()`: the first broken edge, stopping at the cluster. That is an observed fact. "The pod is crash-looping" is a second fact only after a GET of that pod. "The deploy caused it" is an inference and must be labeled inference, with confidence, or omitted.

v1 does not correlate deploys, logs, and the path into a root cause. A later incident card may list observed hops and a separate inferred list. It may not say the cause is known when the Service and Pod were not read. `path-stops-at-cluster` is the boundary.

## Data

The scan writes one JSON file the process can read back, mode `0600`, under a directory that is gitignored. It stores resource ids, rule ids, and evidence strings. It does not store kube tokens, AWS keys, or Secret manifests. The kube client already does not GET Secrets.

Retention in v1 is "the files you leave there." No telemetry leaves the machine.

## Security

- The server stays on `127.0.0.1`.
- New scorecard routes, if any, are GET.
- Kube calls stay on the fixed path list. A control that needs a new path adds it in one place, GET only.
- Origin checks on existing mutations are unchanged. The scorecard adds none.
- Take down stays typed-name, local, and off this feature.
- A hosted collector is out of scope. If it is ever built, it is outbound and stores the report, not keys. That sentence is a constraint, not a design to build now.

## Alignment

| Source | How v1 uses it |
| --- | --- |
| AWS Well-Architected | Citation on a control. Not a pillar score. Not an official review |
| CIS Benchmarks | Not claimed. No CIS rule pack ships in v1 |
| Pod Security Standards | Privileged and host path match the baseline idea. v1 does not evaluate the restricted profile |
| NSA/CISA Kubernetes hardening | Not claimed |
| NIST | Not claimed |
| OpenShift security practices | Named on `ocp.*` controls when those controls exist. Not a compliance scan |
| SRE | Runtime evidence is separate from config. SLOs are not computed |

## Eng review (first pass, AUTO)

Scope gate: this file, named by the strategy request. You were AFK, so the complexity question was not asked. Recommendation recorded: the v1 scorer is one new module plus tests, reusing three readers. That is small enough to review as one plan. The platform vision is not.

| # | Severity | Finding | Remedy in this spec |
| --- | --- | --- | --- |
| 1 | high | A weighted average hides one critical under many lows | Gate `NOT_READY` is mandatory and tested |
| 2 | high | 403 or a missing collector becomes a pass if someone treats "no finding" as healthy | Result enum. Stubs are NOT_ASSESSED. Test both |
| 3 | high | Path health is not pod health | Informational control. No RCA sentence |
| 4 | medium | NetworkPolicy and PDB are not in `PATHS` | Those controls stay NOT_ASSESSED until a dedicated GET task |
| 5 | medium | OpenShift sample data could be scored as a real cluster | `ocp.*` applies only after ClusterVersion GET succeeds |
| 6 | medium | A later install button would fight OpenShift's monitoring stack | Scorer never installs. Detect before any future recommendation |
| 7 | low | Rule drift as AWS changes field names | `ruleVersion` on each finding |

Outside voice: not run. Codex was unauthenticated on the previous commercial review.

Approval readiness for engineering remedies: the remedies above are in the spec. They are not approval to code.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| Eng Review | `/plan-eng-review` | Scorecard architecture | 1 | ISSUES OPEN | 7 findings, 0 unaddressed in the spec, execution withheld |
| Outside Review | not run | AFK, prior Codex auth failure | 0 | unavailable | no completed external review |
| CEO Review | strategy file | Scope cut to this spec | 1 | ISSUES OPEN | VALIDATE FIRST |

**OUTSIDE COVERAGE:** provider codex, phase plan-review, not run this pass. No completed external review.

**VERDICT:** Spec is internally consistent for a local v1 scorer. It is not approved to implement.

**UNRESOLVED DECISIONS:**
- You have not approved this spec. The implementation plan stays blocked on that approval.
