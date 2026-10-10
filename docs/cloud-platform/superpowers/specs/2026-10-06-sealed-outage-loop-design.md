# Milestone 1 design: the sealed outage loop

Status: approved 2026-10-06. Scope is milestone 1 only. Product context lives in the root docs ([BUSINESS_THESIS.md](../../../BUSINESS_THESIS.md), [CUSTOMER_ZERO.md](../../../CUSTOMER_ZERO.md), [DECISION_LOG.md](../../../DECISION_LOG.md)).

## 1. Goal

You can start a real AWS outage whose cause you do not know. You diagnose it with a restricted, short-lived identity. You prove the fix from outside the system. You leave the account provably empty.

**Roles.** The agent authors and implements every scenario. You only solve. That makes you a cold solver by construction, as long as you stay out of the spoiler paths (section 11).

Brainstorming decisions this design depends on:

| Decision | Choice |
|---|---|
| The author problem | The agent authors, you solve. Sealed randomness on top: each lab has several possible causes, and one is picked at `up` and hidden from the solver. |
| First scenario | `aws-web-unreachable-001`. One web instance with three possible causes. Merges planned labs 2, 4, and 5. |
| What "solved" means | Outcome check plus hygiene guards. Pass/fail per check, no numeric score. |
| Cold solver | You. No second human in milestone 1. |
| Construction approach | A healthy baseline, proven healthy, then a fault injected on top. |
| IaC and language | Pulumi (Python, local file backend). Python also for the CLI, injectors, and validators. |
| Future B2B isolation | Temporary accounts through AWS Organizations. Designed for, not built. |

## 2. Definition of done

1. `lab up aws-web-unreachable-001` builds the baseline, confirms validation **passes**, injects a random fault, then confirms validation **fails**. If either check is wrong, the run aborts and destroys the stack.
2. You solve the lab three times using only the solver identity, and see at least two different causes. Each run leaves an evidence record (section 9).
3. `lab selftest` passes for every fault. It injects the fault, applies the author's reference fix, and confirms validation passes.
4. Your confusion during solving goes into each run's `notes.md`. The agent folds it into the brief or `AUTHOR.md` without leaking the cause.
5. `lab down` is safe to run twice. After it, `lab janitor` reports zero lab resources in any region.
6. The €20 budget action has fired once on purpose and applied its deny SCP. You record the cost of each run from Cost Explorer the next day.

## 3. Lifecycle overview

```
scenario definition   scenarios/<id>/ (yaml + brief + Pulumi program + faults + validator)
        │
provision             pulumi up (stack per run, all resources tagged with run id)
        │
baseline proof        validate → must PASS, else abort + destroy
        │
failure injection     random fault → inject() with operator creds → sealed record
        │
fault proof           validate → outcome must FAIL, else abort + destroy
        │
temporary access      STS assume solver role (1h) → `lab shell` / `lab console`
        │
lab execution         you diagnose and fix as the solver
        │
validation            `lab validate` any number of times; attempts recorded
        │
evidence/results      run.json + CloudTrail change trail + postmortem notes
        │
teardown              pulumi refresh + destroy → stack rm → janitor → lock cleared
```

Every arrow above is a step in the `lab` CLI. There is no service, queue, or control plane.

## 4. Account strategy and security boundaries

### Evaluation

| Option | What it gives | Cost | Verdict |
|---|---|---|---|
| One standalone sandbox account plus a permission boundary (current `ARCHITECTURE.md`) | Boundaries constrain roles that you remember to attach them to. As admin you can remove them. A budget action can only attach an IAM policy. | One account | Too weak against the main threat, which is you |
| **Organizations: an empty management account plus one sandbox member account** | SCPs constrain *every* principal in the sandbox, including the operator running Pulumi. A budget action can apply an SCP. IAM Identity Center removes long-lived keys. It is the same structure future account vending needs. | Free. Two root MFAs, about 1–2 hours of console setup. | **Build now** |
| Control Tower / Landing Zone | Log archive and audit accounts, Config, guardrails | AWS Config and extra accounts. Heavy for one person. | Postpone |
| A pool of accounts, one per run | Real blast-radius isolation for strangers | Account closure quotas, cleanup with aws-nuke, vending code | Design for, do not build |

**This reverses one point in the 2026-10-06 decision log** ("no Organizations"). The reason: SCPs are the only guardrail the operator cannot remove from inside the account, and self-inflicted cost is the main threat this phase. The management account must be **new and empty**. Do not promote your existing personal account to management, because SCPs never apply to the management account and it would hold your unrelated resources.

### Accounts and identities (build now)

```
Organization
├── management account   (no workloads; root MFA; billing, SCPs, budgets, Identity Center)
└── OU: labs
    └── labs-sandbox     (all lab resources; SCPs attached at the OU)
```

| Identity | Where | How you get it | Lifetime | Can do |
|---|---|---|---|---|
| Root users | Both accounts | Never in daily use | n/a | Break-glass only. MFA on, no access keys. |
| `MgmtAdmin` permission set | Management | `aws sso login` | Up to 8h | Platform bootstrap (SCPs, budgets) |
| `LabOperator` permission set | Sandbox | `aws sso login` | Up to 8h | Admin, capped by SCPs. Runs Pulumi, injectors, validators, janitor. |
| `lab-solver-<run_id>` role | Sandbox, created per run | `sts:AssumeRole` from a `LabOperator` session | 1h (role chaining limit), re-issued on demand | Scenario-scoped read and fix permissions, capped by a permission boundary |

There are no IAM users and no access keys anywhere.

### SCPs on the `labs` OU (build now)

- **Region lock:** deny everything outside `eu-central-1`. Global services (IAM, STS, Organizations, SSO, Budgets, Cost Explorer, Support, CloudFront, Route 53) are exempt via `NotAction`, following the AWS reference SCP.
- **Expensive or out-of-scope services:** deny `ec2:CreateNatGateway`, EKS, SageMaker, Bedrock, OpenSearch, RDS, Redshift, and Reserved Instance or Savings Plan purchases.
- **Instance types:** deny `ec2:RunInstances` unless `ec2:InstanceType` is one of `t3.micro`, `t3.small`, `t4g.micro`, `t4g.small`.
- **Org integrity:** deny `organizations:LeaveOrganization`.
- **`deny-new-spend` (detached by default):** denies `ec2:RunInstances`, `elasticloadbalancing:Create*`, `ec2:AllocateAddress`, and other `Create*` actions on billable resources. Only the budget action attaches it (section 8).

### Permission boundary (build now)

`lab-solver-boundary` is a managed policy in the sandbox, created by the platform stack. Every solver role gets it. It allows only `ec2:*`, plus `sts:GetCallerIdentity`, in `eu-central-1`. It explicitly denies `iam:*`, `cloudtrail:*`, `organizations:*`, `ssm:*`, and `ec2:*NetworkInsights*` (section 6 explains why). Each scenario's solver policy sits inside this cap.

Enforcing the boundary *through an SCP* (so no role can be created without it) is designed for, not built. The only role creator today is you.

### Security boundaries summary

| Boundary | Separates | Enforced by |
|---|---|---|
| B1 | Management account vs. sandbox | Organizations, with SCPs applying to the sandbox only |
| B2 | Operator vs. solver | Separate role, 1h STS, permission boundary, tag-scoped mutations |
| B3 | Laptop secrets vs. git | `.lab/` is gitignored and holds Pulumi state, the sealed fault, run evidence, and the Pulumi passphrase |
| B4 | Lab instance vs. internet | Port 80 open only to the operator's public IP (/32), no SSH ingress, no key pair, IMDSv2 required |
| B5 | Lab instance vs. AWS API | No instance profile. The box holds no AWS credentials. |

The seal between you and the answer is not a security boundary. You hold operator credentials and could read the fault. The design adds friction (separate shell, no spoilers in names, outputs, or AWS-visible tags) and relies on the spoiler-free working agreement in section 11. Real sealing arrives with a second human, and they get no operator access.

## 5. Infrastructure as code

### Evaluation

| Tool | Fit for milestone 1 |
|---|---|
| Terraform | Works, but HCL means the injectors and validators live in a second language. The BSL license is irrelevant now but a question if this is ever offered as a hosted service. |
| OpenTofu | The same fit as Terraform with an MPL license. It's the HCL choice if Pulumi is ever dropped. |
| Terragrunt | Keeps many environments and stacks DRY. There is one stack per run and one scenario, so it solves a problem we don't have. |
| **Pulumi (Python)** | One language across provisioning, injection, validation, and the CLI. Apache 2.0. A stack per run maps cleanly to a run. You also wanted to learn it. **Chosen.** |

### How Pulumi is used

- **Backend:** local file at `file://<repo>/.lab/pulumi-state`. No Pulumi Cloud. `PULUMI_CONFIG_PASSPHRASE` is read from your keychain or env, never committed.
- **One Pulumi project per scenario** (`scenarios/<id>/infra/`). **One stack per run**, named after the run ID. The stack is removed at `down`.
- **One Pulumi project per account for the platform** (`platform/aws/management/`, `platform/aws/sandbox/`). These are long-lived stacks, and their state is backed up manually.
- **The CLI shells out to the `pulumi` binary** (`up`, `stack output --json`, `refresh`, `destroy`, `stack rm`) with `--yes --non-interactive`. The Automation API is postponed until subprocess handling actually hurts.
- **Faults are injected out-of-band with boto3**, not through Pulumi. `lab down` runs `pulumi refresh` before `destroy`, so drift from the fault or the fix never blocks teardown.

## 6. Scenario: `aws-web-unreachable-001`

### Healthy baseline

- One VPC (`10.20.0.0/16`), one public subnet, an internet gateway, and a route table with `0.0.0.0/0 → IGW`.
- A custom NACL. Inbound allows TCP 80 from the operator /32 and TCP 1024–65535 from `0.0.0.0/0`. Outbound allows all.
- A security group with inbound TCP 80 from the operator /32 as a separate rule resource. Outbound allows all.
- One `t4g.micro` running Amazon Linux 2023 (arm64, AMI from the public SSM parameter), with an auto-assigned public IPv4, IMDSv2 required, and no key pair or instance profile.
- User data does two things:
  - It starts a systemd unit that runs `python3 -m http.server`-style code to serve `GET /health → 200 "ok <run_nonce>"`. No package installs, so boot does not depend on outbound internet.
  - It runs `shutdown -h +<ttl_minutes + 15>` with `InstanceInitiatedShutdownBehavior=terminate`. That makes it a self-destruct timer (section 8).
- Every resource is tagged `lab=true`, `lab_scenario=<id>`, `lab_run_id=<run_id>`, `lab_expires_at=<iso8601>`. No resource name or tag mentions a fault.

All three fault targets (security group, route table, NACL) exist in every run, so the inventory gives nothing away.

### Faults

Every fault has the same user-visible symptom: HTTP to the public IP times out.

| Fault ID | `inject()` | Reference `revert()` (selftest only) |
|---|---|---|
| `sg-no-http` | Revoke the SG's inbound TCP 80 rule | Re-authorize TCP 80 from the operator /32 |
| `route-no-igw` | Delete the `0.0.0.0/0` route | Re-create the route to the IGW |
| `nacl-no-ephemeral` | Replace the outbound allow-all with outbound allow TCP 80 and 443 only, so return traffic to client ephemeral ports is dropped | Restore the outbound allow-all |

### Solver policy (scenario-provided, inside the boundary)

- **Read:** `ec2:Describe*` and `ec2:GetConsoleOutput` across the account. Describe calls don't support resource conditions. The sandbox runs one lab at a time, so this is acceptable.
- **Fix, only on resources tagged `lab_run_id=<this run>`:** authorize, revoke, and modify SG rules; create, replace, and delete routes; create, replace, and delete NACL entries. Use the condition key `aws:ResourceTag/lab_run_id`, and verify per action during implementation that EC2 honours resource tags for it.
- **No create** of instances, VPCs, SGs, IGWs, ENIs, or EIPs. The boundary has no IAM.
- **No CloudTrail.** Event history would show the injector's API call, which is the answer.
- **No Reachability Analyzer (`*NetworkInsights*`) in v1.** It names the blocking component, which skips the diagnosis this lab exists to practise. Whether a tool is allowed is a per-scenario choice. It does not belong in the platform.
- **No SSM.** There is no instance profile anyway. Solving happens from outside plus the API, the way an on-call engineer would approach a box they cannot reach.

### Brief (`README.md`, solver-facing)

"The health endpoint at the printed URL stopped responding. Nobody changed the application. Restore service without creating new infrastructure and without opening the instance to the world. Time box: 60 minutes. Done when `lab validate` passes." It shows no causes and no console paths.

## 7. Validation

The validator is `scenarios/<id>/validate.py`. It returns a list of checks. The harness runs them, prints a table, records the attempt, and exits 0 only if all pass.

```python
@dataclass
class Check:
    name: str
    kind: Literal["outcome", "guard"]
    passed: bool
    detail: str
```

It runs with **operator credentials**, read-only calls only. The checks are evaluated from the laptop, outside the VPC.

| Check | Kind | Pass condition |
|---|---|---|
| `health-200` | outcome | `GET http://<ip>/health` returns 200 with body `ok <run_nonce>`. 3s connect timeout, 3 tries. The nonce proves it's the original instance. |
| `same-instance` | guard | The instance ID from the stack outputs is running. No other running instances are tagged with or inside the lab VPC. |
| `no-new-network` | guard | The VPC, IGW, ENI, and EIP inventory equals the baseline inventory recorded at `up`. |
| `no-world-all-ports` | guard | No SG ingress rule with protocol `-1` or port range 0–65535 from `0.0.0.0/0` or `::/0` |
| `no-world-ssh` | guard | No SG ingress rule covering TCP 22 from `0.0.0.0/0` or `::/0` |

The rules that keep validation honest:

- **It is cause-agnostic.** No check looks at the specific resource the fault touched. `lab selftest` proves every reference fix passes. Any other correct fix (for example, adding an outbound ephemeral NACL rule instead of restoring allow-all) must also pass.
- **Opening port 80 to `0.0.0.0/0` is allowed.** It's a normal web posture, not a hygiene failure.
- **Gate checks at `up` reuse the same validator.** Baseline: all checks must pass. After injection: `health-200` must fail and the guards must still pass, so the injector itself is proven to stay within hygiene.
- **Known limitation:** if your public IP changes mid-run, the /32 rules lock you out. `lab status` warns when the current IP differs from the recorded one. A command to re-pin the IP is postponed.

## 8. TTL, cleanup, and cost controls

### TTL

| Thing | TTL | Enforced by |
|---|---|---|
| Solver credentials | 1h | STS (the role chaining maximum). `lab shell` or `lab console` re-issues them until the run ends. |
| Solver role | Lifetime of the run | Deleted by `pulumi destroy` at `down` |
| Run | `ttl_minutes` from `scenario.yaml` (90 for this lab) | Instance self-terminates at TTL plus 15 minutes. `lab status` shows time left. The `lab_expires_at` tag lets the janitor flag overdue runs. |

After self-termination, only free resources remain: the VPC, subnet, route table, NACL, SG, IGW, and IAM role. The public IPv4 is released with the instance. **For this scenario, the instance timer is a complete cost TTL, with no reaper service.** The first scenario with a resource that can't self-destruct (an ALB) is when an in-account reaper becomes necessary (section 12).

### Cleanup

`lab down [<run_id>]`:
1. If the stack exists: `pulumi refresh`, then `pulumi destroy`, retrying once. Then `pulumi stack rm`.
2. Run `lab janitor --run-id <run_id>`. It must report zero resources, otherwise the command exits non-zero and leaves the lock in place.
3. Fetch the CloudTrail change trail into evidence (section 9).
4. Clear `.lab/active`.

Every step tolerates "already gone", so a second `down` succeeds.

`lab janitor [--run-id X]` lists only. Automatic deletion is postponed until a dirty destroy actually happens. It checks:
- The Resource Groups Tagging API for `lab=true` in `eu-central-1`.
- EC2 instances, EIPs, NAT gateways, load balancers, and non-default VPCs in **all enabled regions**, tagged or not, as a check that the SCP region lock works.
- IAM roles named `lab-solver-*`.

### Cost controls, in order of defence

1. `lab down` and the janitor after every run.
2. The instance self-destruct timer.
3. SCPs: region lock, instance type allowlist, NAT and expensive services denied.
4. AWS Budgets in the management account, scoped to the sandbox, with a monthly limit of €20. Email alerts at €10 actual spend and at €20 forecasted spend. Verify whether Budgets accepts EUR or needs a USD equivalent.
5. A budget action at €20 actual spend that automatically applies the `deny-new-spend` SCP to the `labs` OU. You test it once on purpose: temporarily lower the threshold below month-to-date spend, wait for evaluation, confirm the SCP is attached, then detach it. Budget data lags by hours, so this is a backstop, not a brake.
6. Cost Anomaly Detection on the sandbox account (free), with email alerts.
7. `lab_run_id` and `lab_scenario` activated as cost allocation tags, so cost per run shows in Cost Explorer about 24h later. You copy it into the run record by hand.

## 9. Evidence and results

These files are local and gitignored, under `.lab/runs/<run_id>/`:

| File | Contents | Written by |
|---|---|---|
| `run.json` | Scenario ID and version, git SHA, timestamps (up, baseline pass, injected, handover, every validate attempt, pass, down), check results per attempt, janitor result, `cost_eur` (filled in by hand) | CLI, appended at each step |
| `sealed.json` | Fault ID and injection timestamp | `up`. Read only by `reveal`, `selftest`, and `report`. |
| `changes.json` | CloudTrail event history for `userIdentity.arn` matching the solver session `run-<run_id>`, with `readOnly=false` only | `down` or `lab report`. Event history lags 5–15 minutes and persists 90 days without a trail, so `report` can be re-run later. |
| `notes.md` | Postmortem template: what you saw, what you checked in what order, the cause, the fix, how you would detect it faster | `reveal` creates it, you fill it in |

`lab reveal` shows the fault and the matching section of `AUTHOR.md` only after a passing validation. `--give-up` marks the run `revealed_before_pass`.

This is the non-invasive evidence model. It records **what changed in the infrastructure and whether service came back**, not keystrokes, screen, or webcam. A future interviewer reads the change trail and asks the candidate to explain it. That's the AI-era assessment hypothesis, testable later without any surveillance code.

## 10. CLI

`lab` is a Python package (`labctl`) with a console-script entry point. It uses `uv` for the environment and `argparse` for parsing, so there's no CLI framework dependency. One active run at a time, enforced by `.lab/active`.

| Command | Does |
|---|---|
| `lab up <scenario>` | Preflight (SSO session valid, region, no active run, operator IP), Pulumi stack init and up, baseline gate, random fault, injection, fault gate, solver role assumption, handover message (URL, brief path, TTL) |
| `lab shell` | Starts a subshell with solver STS credentials in env, `AWS_PROFILE` unset, and a prompt marker `[solver run-…]` |
| `lab console` | Prints an AWS console federation sign-in URL for the solver session, to open in a private window |
| `lab status` | Active run, time left, IP drift warning, last validate result |
| `lab validate` | Runs the checks, prints the table, records the attempt, exits 0 or 1 |
| `lab reveal [--give-up]` | Shows the fault and the author notes, creates `notes.md` |
| `lab down [<run_id>]` | Teardown (section 8), idempotent |
| `lab janitor [--run-id X]` | Lists leftovers, exits non-zero if any |
| `lab report <run_id>` | Re-fetches the CloudTrail change trail |
| `lab selftest <scenario> [--fault F]` | For each fault: up, baseline gate, inject, fault gate, revert, validate must pass, down |

**Who runs what.** The agent runs `selftest` and anything during development. For a real solve, you run `lab up`, `lab shell` or `lab console`, `lab validate`, `lab reveal`, and `lab down` yourself. `lab up` prints only the brief, the URL, and the TTL, never the fault.

### Failure handling in `up`

- `pulumi up` fails: destroy, mark the run `failed_provision`.
- The baseline doesn't pass within 5 minutes: destroy, `failed_baseline`. The lab is broken, not you.
- After injection, `health-200` still passes after 60s, or a guard fails: destroy, `failed_injection`.
- Any failure after the stack exists ends with an automatic `down`, so a failed `up` never leaves resources.

## 11. Repository structure

```
cloud-platform/
├── *.md                              existing product docs (root)
├── docs/superpowers/specs/           design docs (this file)
├── pyproject.toml                    labctl package + dev deps (pytest, boto3, pulumi, pulumi-aws)
├── labctl/
│   ├── cli.py                        command parsing and wiring
│   ├── runs.py                       run IDs, lock, run.json / sealed.json I/O
│   ├── pulumi_cli.py                 subprocess wrapper for the pulumi binary
│   ├── checks.py                     Check type, runner, table output
│   ├── scenario.py                   load scenario.yaml, import faults/validate modules
│   └── aws/
│       ├── access.py                 assume solver role, console federation URL
│       ├── janitor.py
│       └── trail.py                  CloudTrail event history fetch
├── platform/aws/
│   ├── BOOTSTRAP.md                  manual checklist: create org, accounts, MFA, Identity Center
│   ├── management/                   Pulumi: OU, SCPs, budgets, budget action, cost tags
│   └── sandbox/                      Pulumi: solver boundary policy, anomaly monitor
├── scenarios/aws-web-unreachable-001/
│   ├── scenario.yaml
│   ├── README.md                     solver brief
│   ├── AUTHOR.md                     spoilers: causes, intended diagnosis path, solver feedback
│   ├── infra/                        Pulumi project (Pulumi.yaml, __main__.py, solver policy)
│   ├── faults/
│   │   ├── sg_no_http.py             ID, inject(env), revert(env)
│   │   ├── route_no_igw.py
│   │   └── nacl_no_ephemeral.py
│   └── validate.py                   checks(env) -> list[Check]
├── tests/                            unit tests: guard logic on fixture describe responses, run-state transitions
└── .lab/                             gitignored: pulumi-state/, runs/, active
```

`scenario.yaml` holds only fields the CLI reads:

```yaml
id: aws-web-unreachable-001
version: 1
provider: aws
region: eu-central-1
ttl_minutes: 90
faults: [sg-no-http, route-no-igw, nacl-no-ephemeral]
```

The scenario contract is three things found by convention: an `infra/` Pulumi project whose outputs are passed as `env.outputs`, `faults/*.py` modules exposing `ID`, `inject(env)` and `revert(env)`, and a `validate.py` exposing `checks(env)`. `env` holds the stack outputs, an operator boto3 session, the run ID and nonce, and the operator IP.

Reusable AWS guard helpers (like world-open SG detection) stay inside the scenario's `validate.py` until a second AWS scenario needs them. Then they move to `labctl/aws/`.

### Spoiler-free working agreement

The agent writes the scenarios. You solve them, so some files are off-limits to you until you've solved or given up on that scenario.

| Spoiler (do not read before solving) | Safe to read and review |
|---|---|
| `scenarios/*/AUTHOR.md`, `PLAN.md`, `faults/`, `validate.py`, `infra/` (except `aws-smoke-001`, a harness fixture) | `scenarios/*/README.md` (the brief), `scenario.yaml` minus the `faults` list |
| `.lab/runs/*/sealed.json`, `.lab/runs/*/sealed-error.txt`, Pulumi state and stack outputs beyond what `lab up` prints | `labctl/`, `platform/`, `tests/` (with fault-free fixtures), this spec's sections other than 6 |
| Agent messages that describe scenario internals | `lab selftest` output, which reports pass/fail per fault number, not per fault name |

In place of reading scenario code, you verify it by running `lab selftest` (every fault injected, gated, fixed, and passing) and through your own solves.

- **Specs and plans:** for future scenarios, any spec or plan you review leaves out causes and fault names, which live only in that scenario's `AUTHOR.md`. A scenario's own implementation plan lives in its `PLAN.md`.
- **This first scenario is partly spoiled:** section 6 names its three candidate causes, and you've already read them. Sealed randomness still hides which one you get on each run.
- **The fix for that:** the second scenario is the first one authored completely blind.

## 12. Build now / design for / postpone

### What we build now

- An Organization with an empty management account and one `labs-sandbox` member in the `labs` OU, root MFA on both, and IAM Identity Center with `MgmtAdmin` and `LabOperator`. The account setup is manual per `BOOTSTRAP.md`. SCPs and budgets are Pulumi.
- SCPs: region lock, service and NAT denies, instance type allowlist, org and CloudTrail integrity, detached `deny-new-spend`.
- A €20 monthly budget with alerts at €10 actual and €20 forecasted, a €20 budget action that applies `deny-new-spend` (tested once), Cost Anomaly Detection, and cost allocation tags.
- The `lab-solver-boundary` policy.
- The `labctl` CLI with the ten commands in section 10.
- One scenario, `aws-web-unreachable-001`, with three faults, reference reverts, and a validator with one outcome check and four guards.
- Local evidence: `run.json`, `sealed.json`, `changes.json`, `notes.md`.
- Unit tests for guard logic and run-state transitions. `lab selftest` as the integration test.

### What we design for but do not build

| Future need | Seam already in this design | What would be built then |
|---|---|---|
| One account per run for strangers (B2B) | The CLI only needs a target account ID and an operator role to assume in it. Solver roles live in the target account. Nothing assumes the operator and lab share an account. | An account pool in a `labs-pool` OU, reused rather than closed (closure quotas), cleaned with aws-nuke between runs. A vending step before `pulumi up`. |
| Boundary enforced on every role | `lab-solver-boundary` already exists | An SCP that denies `iam:CreateRole` and `iam:PutRolePermissionsBoundary` unless the boundary ARN is attached |
| Resources that can't self-destruct (ALB, later RDS) | The `lab_expires_at` tag on everything. The janitor already flags overdue runs. | An in-account reaper (EventBridge schedule plus Lambda) that destroys by tag in dependency order |
| Azure | Provider is a field in `scenario.yaml`. Access, janitor, and trail live under `labctl/aws/`. Validators are plain Python. | `labctl/azure/`. The isolation unit is a resource group per run (a subscription per run for strangers). Access is a short-lived role assignment scoped to the RG via Entra. The trail is the Activity Log. |
| GCP | Same | `labctl/gcp/`. A project per run under a `labs` folder. Access is service account impersonation with short-lived tokens. Org policy constraints play the SCP role. The trail is Cloud Audit Logs. |
| Kubernetes | Same. Pulumi has a Kubernetes provider, so a scenario's `infra/` can target a cluster. | `labctl/k8s/`. A namespace per run on local kind or k3s, access through a ServiceAccount token from the TokenRequest API with an expiry and namespace-scoped RBAC. Teardown deletes the namespace. Cluster-level labs need a cluster per run. |
| OpenShift | Same as Kubernetes | A Project per run, RBAC, an `oc` login token with an expiry |
| Live interviews | `lab shell` and `lab console` already hand over a solver-only surface. The evidence model has no surveillance. | Issue solver creds to a remote candidate (needs an account per run first), plus an interviewer view of `run.json` and `changes.json` |

No provider interface, plugin system, or abstract base class is written now. The seam is the directory convention plus keeping AWS code under `labctl/aws/`. The interface gets extracted when the second provider exists and shows what is actually common.

### What we deliberately postpone

- Web UI, multi-user accounts, billing, SSO for others, interviewer dashboard
- Numeric scoring, leaderboards, hints
- AI allow/block policies, AI detection, any screen, keystroke, or webcam recording
- Control Tower, a log archive or audit account, an organization CloudTrail trail
- Automatic janitor deletion, re-pinning the operator IP mid-run, a Cost Explorer command
- Pulumi Automation API, Pulumi Cloud, a scenario DSL, a generic validator library
- IAM, ALB, NACL-only, and any other scenarios. The next scenario is chosen after your three solves.
- Concurrent runs
- Company-specific incident simulations (risk 9 in `RISKS.md`)

## 13. Testing strategy

- **Unit tests (no AWS):**
  - Guard functions on recorded `describe_security_groups` and `describe_network_acls` fixtures, including the alternative NACL fix.
  - Run-state transitions, so `down` stays idempotent across every failure state.
  - Scenario loading.
- **`lab selftest`:** every fault, end to end, against the real sandbox. It's the only proof that the validator accepts every reference fix. Run it after any change to `infra/`, `faults/`, or `validate.py`, and monthly as the scenario rot test (risk 7).
- **Every `up` doubles as a test:** the baseline and fault gates run each time.
- **Platform tests (once, then after SCP edits):**
  - From `LabOperator`, try `RunInstances` with a `t3.large` and a NAT gateway in `eu-central-1`, and anything in `us-east-1`. All must be denied.
  - Fire the budget action once.

## 14. Root docs updated on approval

Done 2026-10-06:

- **`DECISION_LOG.md`:** new entries for the Organizations reversal, Pulumi over Terraform, sealed randomness, and baseline-plus-injector.
- **`ARCHITECTURE.md`:** replace the standalone account and IAM user with section 4.
- **`MVP.md` and `SCENARIO_SPEC.md`:** replace the Terraform and `validate.sh` layout with section 11, and replace the first-five-labs ordering with this milestone.
- **`CUSTOMER_ZERO.md`:** the first lab becomes `aws-web-unreachable-001`.

## 15. Open questions for review

1. ~~**The Organizations reversal.**~~ Accepted 2026-10-06: a new, empty management account plus a `labs-sandbox` member.
2. ~~**Budget thresholds.**~~ Decided 2026-10-06: hard stop at €20, warning at €10.
3. ~~**The cold solver.**~~ Decided 2026-10-06: the agent authors, you solve. A second human is not part of milestone 1.
