# Architecture

Customer Zero only. An AWS Organization with an empty management account and one sandbox member account. Lab resources run in `eu-central-1`. Full design: [milestone 1 spec](docs/superpowers/specs/2026-10-06-sealed-outage-loop-design.md), sections 4 and 8.

## Now

- **Two new accounts.** The management account holds no workloads; it handles billing, SCPs, budgets, and IAM Identity Center. `labs-sandbox` sits in the `labs` OU and holds every lab resource. Do not use your existing personal account as the management account.
- **Root accounts:** root MFA on both, no root access keys.
- **No IAM users or access keys.** The operator signs in through Identity Center (`LabOperator` permission set, admin capped by SCPs). Each run creates a solver role assumed for 1 hour, scoped to resources tagged with that run, inside the `lab-solver-boundary` permission boundary.
- **SCPs on the `labs` OU:**
  - Deny every region except `eu-central-1` (global services exempt).
  - Deny NAT gateways, EKS, SageMaker, Bedrock, OpenSearch, RDS, Redshift, and Reserved Instance or Savings Plan purchases.
  - Allow only `t3.micro`, `t3.small`, `t4g.micro`, and `t4g.small` instances.
  - Deny leaving the organization.
- **Budget:** €20 per month. Email at €10 actual and at €20 forecasted. At €20 actual, a budget action attaches the `deny-new-spend` SCP. Test-fire it once. Until that test passes, it is a notification, not a control.
- **Other cost signals:** Cost Anomaly Detection on, and `lab_run_id` and `lab_scenario` activated as cost allocation tags.
- **Tags:** every lab resource carries `lab`, `lab_scenario`, `lab_run_id`, and `lab_expires_at`.
- **IaC:** Pulumi (Python) with a local file backend. State stays in gitignored `.lab/`.
- **Cleanup:** `lab down` runs refresh then destroy, followed by `lab janitor`, which lists leftovers in all enabled regions.

Region is `eu-central-1` because you are in central Europe. It is a cost and latency choice, not a compliance design.

## Isolation, later

Do not build these this month.

**Account per run, drawn from a pool in a `labs-pool` OU.** Best blast radius for strangers. Reuse accounts and clean them between runs, because account closure is rate-limited. Correct once someone who is not you receives credentials. The CLI already treats the target account as an input, so this is a vending step, not a rewrite.

**Shared account with IAM isolation.** Unacceptable for strangers. Resource policies and IAM privilege-escalation paths cross the boundary you thought you set.

## Threats that matter at this phase

Hostile internet users are not in the account yet. The threats that matter are the ones you can cause yourself:

- A lab left applied overnight (ALB, public IPv4, forgotten instance).
- A NAT gateway created while experimenting.
- A region other than `eu-central-1`.
- Root access keys.
- State files or credentials committed to git.

SCPs cover the region, NAT, and instance-type threats even against the operator. Privilege escalation, cryptomining, and cross-account movement become in scope the week a second person receives credentials. That week requires an account per run, not a tighter policy in the sandbox.

## Non-goals

No control plane, no provisioning service, no Control Tower. The `lab` CLI is the only runner. No multi-cloud abstraction: AWS code lives under `labctl/aws/`, and a provider interface gets extracted only when a second provider exists. A second provider waits for a year-gate in [VALIDATION_PLAN.md](VALIDATION_PLAN.md).
