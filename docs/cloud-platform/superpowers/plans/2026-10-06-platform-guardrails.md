# Platform Guardrails Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the AWS Organization guardrails from the [milestone 1 spec](../specs/2026-10-06-sealed-outage-loop-design.md) (sections 4 and 8): SCPs, a €20 hard-stop budget, anomaly detection, and the solver permission boundary, all as code. The account bootstrap is a manual checklist.

**Architecture:** Two Pulumi (Python) projects. `platform/aws/management/` runs with management-account credentials and owns the OU, SCPs, budget, budget action, and anomaly detection. `platform/aws/sandbox/` runs with sandbox credentials and owns only the `lab-solver-boundary` policy. Policy documents are JSON files tested by pytest. The Pulumi programs only load and attach them.

**Tech Stack:** Python 3.12, uv, Pulumi CLI 3.x with `pulumi-aws`, local file backend, pytest, AWS CLI v2, IAM Identity Center.

**Execution order across plans:**
1. This plan, Tasks 1–4. No AWS needed.
2. [Harness plan](2026-10-06-labctl-harness.md), Tasks 1–12. No AWS needed.
3. The user completes `platform/aws/BOOTSTRAP.md`.
4. This plan, Task 5. Applies the guardrails and verifies them.
5. Harness plan, Task 13. Live smoke test.

## Global Constraints

- **Home region:** `eu-central-1` only.
- **Allowed instance types:** `t3.micro`, `t3.small`, `t4g.micro`, `t4g.small`.
- **Budget:** €20 per month, scoped to the sandbox account. Alert at 50% actual (€10) and at 100% forecasted. The budget action fires at 100% actual and applies the `deny-new-spend` SCP to the `labs` OU, with `approval_model` `AUTOMATIC`.
- **Credentials:** no IAM users, no access keys. Operators use IAM Identity Center permission sets `MgmtAdmin` (management) and `LabOperator` (sandbox), with sessions up to 8h.
- **Solver boundary name:** `lab-solver-boundary`. It allows `ec2:*` in `eu-central-1` plus `sts:GetCallerIdentity`, and denies `iam:*`, `cloudtrail:*`, `organizations:*`, `ssm:*`, and `ec2:*NetworkInsights*`.
- **Pulumi state:** local file backend at `file://<repo>/.lab/pulumi-state`. `.lab/` is gitignored. The passphrase lives in the macOS keychain under service `cloud-platform-pulumi`.
- **SCP size:** each SCP, minified, is under 5,120 characters.
- **CLI profile names:** `cp-mgmt` (MgmtAdmin) and `cp-lab` (LabOperator).
- **Spoilers:** none in this plan. It touches no scenario.

---

### Task 1: Python scaffold and SCP policy documents

**Files:**
- Create: `pyproject.toml`
- Create: `.python-version`
- Create: `tests/__init__.py`
- Create: `tests/platform/__init__.py`
- Create: `platform/aws/management/policies/region-lock.json`
- Create: `platform/aws/management/policies/guardrails.json`
- Create: `platform/aws/management/policies/deny-new-spend.json`
- Test: `tests/platform/test_policies.py`

**Interfaces:**
- Consumes: nothing.
- Produces: the three SCP JSON files, loaded by Task 3 by file name (`region-lock`, `guardrails`, `deny-new-spend`). It also produces the `uv` environment at `.venv/`, used by every Pulumi project (`virtualenv: ../../../.venv`) and by the harness plan.

- [ ] **Step 1: Check prerequisites**

Run: `uv --version && pulumi version && aws --version`
Expected: three version lines. If any are missing, run `brew install uv pulumi/tap/pulumi awscli`.

- [ ] **Step 2: Create the project files**

`.python-version`:

```text
3.12
```

`pyproject.toml`:

```toml
[project]
name = "labctl"
version = "0.1.0"
description = "Sealed outage lab loop"
requires-python = ">=3.12"
dependencies = [
    "boto3>=1.35",
    "pulumi>=3.130,<4",
    "pulumi-aws>=6.50,<7",
    "pyyaml>=6",
]

[project.scripts]
lab = "labctl.cli:main"

[dependency-groups]
dev = ["pytest>=8"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["labctl"]

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

Create empty files `tests/__init__.py` and `tests/platform/__init__.py`. Create `labctl/__init__.py` as an empty file too, so the hatchling build finds the package (the harness plan fills it in).

Run: `uv sync`
Expected: creates `.venv/` and `uv.lock` with no errors.

- [ ] **Step 3: Write the failing policy tests**

`tests/platform/test_policies.py`:

```python
import json
from pathlib import Path

import pytest

POLICY_DIR = Path(__file__).resolve().parents[2] / "platform" / "aws" / "management" / "policies"
SCP_NAMES = ["region-lock", "guardrails", "deny-new-spend"]
ALLOWED_TYPES = ["t3.micro", "t3.small", "t4g.micro", "t4g.small"]


def load(name: str) -> dict:
    return json.loads((POLICY_DIR / f"{name}.json").read_text())


@pytest.mark.parametrize("name", SCP_NAMES)
def test_scp_is_valid_and_under_size_limit(name):
    policy = load(name)
    assert policy["Version"] == "2012-10-17"
    assert len(json.dumps(policy, separators=(",", ":"))) < 5120
    assert all(s["Effect"] == "Deny" for s in policy["Statement"])


def test_region_lock_denies_everything_outside_home_region():
    (statement,) = load("region-lock")["Statement"]
    assert statement["Condition"] == {"StringNotEquals": {"aws:RequestedRegion": ["eu-central-1"]}}
    exempt = set(statement["NotAction"])
    # Global services, plus read-only describes so the janitor can scan every region.
    for action in ["iam:*", "sts:*", "organizations:*", "budgets:*", "ce:*", "sso:*",
                   "ec2:Describe*", "elasticloadbalancing:Describe*"]:
        assert action in exempt
    assert not any(a.startswith("ec2:") and not a.startswith("ec2:Describe") for a in exempt)


def test_guardrails_allowlist_instance_types():
    statements = {s["Sid"]: s for s in load("guardrails")["Statement"]}
    types = statements["DenyNonAllowlistedInstanceTypes"]["Condition"]["StringNotEquals"]["ec2:InstanceType"]
    assert sorted(types) == sorted(ALLOWED_TYPES)


def test_guardrails_deny_nat_and_expensive_services():
    actions = {s["Sid"]: s for s in load("guardrails")["Statement"]}["DenyExpensiveServices"]["Action"]
    for action in ["ec2:CreateNatGateway", "eks:*", "sagemaker:*", "bedrock:*", "rds:*", "savingsplans:*"]:
        assert action in actions


def test_guardrails_deny_leaving_org():
    actions = [s["Action"] for s in load("guardrails")["Statement"]]
    assert "organizations:LeaveOrganization" in actions


def test_deny_new_spend_blocks_compute_and_load_balancers():
    (statement,) = load("deny-new-spend")["Statement"]
    for action in ["ec2:RunInstances", "ec2:StartInstances", "ec2:AllocateAddress",
                   "elasticloadbalancing:CreateLoadBalancer"]:
        assert action in statement["Action"]
```

- [ ] **Step 4: Run the tests to verify they fail**

Run: `uv run pytest tests/platform/test_policies.py -v`
Expected: FAIL with `FileNotFoundError` for the policy JSON files.

- [ ] **Step 5: Write the policy documents**

`platform/aws/management/policies/region-lock.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyOutsideEuCentral1",
      "Effect": "Deny",
      "NotAction": [
        "a4b:*", "account:*", "acm:*", "aws-marketplace-management:*", "aws-marketplace:*",
        "aws-portal:*", "billing:*", "budgets:*", "ce:*", "chime:*", "cloudfront:*", "config:*",
        "cur:*", "directconnect:*", "ec2:Describe*", "elasticloadbalancing:Describe*", "fms:*",
        "globalaccelerator:*", "health:*", "iam:*", "identitystore:*", "importexport:*", "kms:*",
        "networkmanager:*", "organizations:*", "pricing:*", "route53:*", "route53domains:*",
        "s3:GetAccountPublic*", "s3:ListAllMyBuckets", "s3:PutAccountPublic*", "shield:*",
        "sso:*", "sso-directory:*", "sts:*", "support:*", "tag:GetResources", "trustedadvisor:*",
        "waf-regional:*", "waf:*", "wafv2:*", "wellarchitected:*"
      ],
      "Resource": "*",
      "Condition": {
        "StringNotEquals": {
          "aws:RequestedRegion": ["eu-central-1"]
        }
      }
    }
  ]
}
```

`platform/aws/management/policies/guardrails.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyExpensiveServices",
      "Effect": "Deny",
      "Action": [
        "ec2:CreateNatGateway", "ec2:PurchaseReservedInstancesOffering", "ec2:PurchaseHostReservation",
        "ec2:AllocateHosts", "eks:*", "sagemaker:*", "bedrock:*", "es:*", "aoss:*", "rds:*",
        "redshift:*", "redshift-serverless:*", "savingsplans:*"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DenyNonAllowlistedInstanceTypes",
      "Effect": "Deny",
      "Action": "ec2:RunInstances",
      "Resource": "arn:aws:ec2:*:*:instance/*",
      "Condition": {
        "StringNotEquals": {
          "ec2:InstanceType": ["t3.micro", "t3.small", "t4g.micro", "t4g.small"]
        }
      }
    },
    {
      "Sid": "DenyLeaveOrganization",
      "Effect": "Deny",
      "Action": "organizations:LeaveOrganization",
      "Resource": "*"
    }
  ]
}
```

`platform/aws/management/policies/deny-new-spend.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "DenyNewSpend",
      "Effect": "Deny",
      "Action": [
        "ec2:RunInstances", "ec2:StartInstances", "ec2:AllocateAddress", "ec2:CreateNatGateway",
        "ec2:CreateVolume", "ec2:CreateSnapshot", "ec2:CreateVpcEndpoint",
        "elasticloadbalancing:CreateLoadBalancer", "lambda:CreateFunction", "s3:CreateBucket",
        "dynamodb:CreateTable", "ecs:CreateService", "ecs:RunTask"
      ],
      "Resource": "*"
    }
  ]
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv run pytest tests/platform/test_policies.py -v`
Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add pyproject.toml uv.lock .python-version labctl/__init__.py tests/__init__.py tests/platform platform/aws/management/policies
git commit -m "feat(platform): python scaffold and SCP policy documents"
```

---

### Task 2: Solver permission boundary and the sandbox project

**Files:**
- Create: `platform/aws/sandbox/policies/lab-solver-boundary.json`
- Create: `platform/aws/sandbox/Pulumi.yaml`
- Create: `platform/aws/sandbox/__main__.py`
- Test: `tests/platform/test_boundary.py`

**Interfaces:**
- Consumes: the `.venv` from Task 1.
- Produces: the managed policy `arn:aws:iam::<sandbox>:policy/lab-solver-boundary`. The harness (`labctl/aws/infra.py` `boundary_arn()`) builds this ARN by name, so the name must not change.

- [ ] **Step 1: Write the failing test**

`tests/platform/test_boundary.py`:

```python
import json
from pathlib import Path

BOUNDARY = Path(__file__).resolve().parents[2] / "platform" / "aws" / "sandbox" / "policies" / "lab-solver-boundary.json"


def statements() -> dict:
    return {s["Sid"]: s for s in json.loads(BOUNDARY.read_text())["Statement"]}


def test_boundary_allows_only_ec2_in_home_region_and_whoami():
    s = statements()
    assert s["AllowEc2InHomeRegion"]["Action"] == "ec2:*"
    assert s["AllowEc2InHomeRegion"]["Condition"] == {"StringEquals": {"aws:RequestedRegion": "eu-central-1"}}
    assert s["AllowWhoAmI"]["Action"] == "sts:GetCallerIdentity"
    allows = [x for x in s.values() if x["Effect"] == "Allow"]
    assert len(allows) == 2


def test_boundary_denies_escalation_and_spoiler_tools():
    denied = statements()["DenyEscalationAndSpoilers"]["Action"]
    for action in ["iam:*", "cloudtrail:*", "organizations:*", "ssm:*", "ec2:*NetworkInsights*"]:
        assert action in denied
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/platform/test_boundary.py -v`
Expected: FAIL with `FileNotFoundError`.

- [ ] **Step 3: Write the boundary and the Pulumi project**

`platform/aws/sandbox/policies/lab-solver-boundary.json`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "AllowEc2InHomeRegion",
      "Effect": "Allow",
      "Action": "ec2:*",
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "eu-central-1"
        }
      }
    },
    {
      "Sid": "AllowWhoAmI",
      "Effect": "Allow",
      "Action": "sts:GetCallerIdentity",
      "Resource": "*"
    },
    {
      "Sid": "DenyEscalationAndSpoilers",
      "Effect": "Deny",
      "Action": ["iam:*", "cloudtrail:*", "organizations:*", "ssm:*", "ec2:*NetworkInsights*"],
      "Resource": "*"
    }
  ]
}
```

`platform/aws/sandbox/Pulumi.yaml`:

```yaml
name: labs-sandbox
description: Long-lived guardrails inside the labs-sandbox account
runtime:
  name: python
  options:
    toolchain: pip
    virtualenv: ../../../.venv
```

`platform/aws/sandbox/__main__.py`:

```python
import json
from pathlib import Path

import pulumi
import pulumi_aws as aws

POLICIES = Path(__file__).parent / "policies"

boundary = aws.iam.Policy(
    "lab-solver-boundary",
    name="lab-solver-boundary",
    description="Upper bound for every per-run lab solver role",
    policy=json.dumps(json.loads((POLICIES / "lab-solver-boundary.json").read_text())),
)

pulumi.export("boundary_arn", boundary.arn)
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/platform -v`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add platform/aws/sandbox tests/platform/test_boundary.py
git commit -m "feat(platform): lab-solver-boundary policy and sandbox project"
```

---

### Task 3: Management project (OU, SCPs, budget, hard stop, anomaly detection)

**Files:**
- Create: `platform/aws/management/Pulumi.yaml`
- Create: `platform/aws/management/__main__.py`

**Interfaces:**
- Consumes: the policy files from Task 1 (`policies/<name>.json`).
- Produces: stack outputs `labs_ou_id` and `deny_new_spend_policy_id`, used in Task 5 and in BOOTSTRAP.md to move the account and to detach the SCP after the test-fire.

This task has no unit test. A Pulumi program is verified by `pulumi preview` in Task 5, and the policy content is already tested in Task 1.

- [ ] **Step 1: Write the Pulumi project file**

`platform/aws/management/Pulumi.yaml`:

```yaml
name: labs-management
description: Organization guardrails for the labs OU (run with cp-mgmt)
runtime:
  name: python
  options:
    toolchain: pip
    virtualenv: ../../../.venv
```

- [ ] **Step 2: Write the program**

`platform/aws/management/__main__.py`:

```python
import json
from pathlib import Path

import pulumi
import pulumi_aws as aws

POLICIES = Path(__file__).parent / "policies"

cfg = pulumi.Config()
sandbox_account_id = cfg.require("sandbox_account_id")
alert_email = cfg.require("alert_email")
budget_limit = cfg.require("budget_limit")
budget_unit = cfg.get("budget_unit") or "USD"
activate_cost_tags = cfg.get_bool("activate_cost_tags") or False


def scp_content(name: str) -> str:
    return json.dumps(json.loads((POLICIES / f"{name}.json").read_text()), separators=(",", ":"))


root_id = aws.organizations.get_organization().roots[0].id

labs_ou = aws.organizations.OrganizationalUnit("labs", name="labs", parent_id=root_id)

for name in ("region-lock", "guardrails"):
    policy = aws.organizations.Policy(
        f"labs-{name}",
        name=f"labs-{name}",
        type="SERVICE_CONTROL_POLICY",
        content=scp_content(name),
    )
    aws.organizations.PolicyAttachment(f"labs-{name}", policy_id=policy.id, target_id=labs_ou.id)

# Created detached. Only the budget action attaches it.
deny_new_spend = aws.organizations.Policy(
    "labs-deny-new-spend",
    name="labs-deny-new-spend",
    type="SERVICE_CONTROL_POLICY",
    content=scp_content("deny-new-spend"),
)

budget = aws.budgets.Budget(
    "labs-monthly",
    name="labs-monthly",
    budget_type="COST",
    time_unit="MONTHLY",
    limit_amount=budget_limit,
    limit_unit=budget_unit,
    cost_filters=[aws.budgets.BudgetCostFilterArgs(name="LinkedAccount", values=[sandbox_account_id])],
    notifications=[
        aws.budgets.BudgetNotificationArgs(
            comparison_operator="GREATER_THAN",
            threshold=50,
            threshold_type="PERCENTAGE",
            notification_type="ACTUAL",
            subscriber_email_addresses=[alert_email],
        ),
        aws.budgets.BudgetNotificationArgs(
            comparison_operator="GREATER_THAN",
            threshold=100,
            threshold_type="PERCENTAGE",
            notification_type="FORECASTED",
            subscriber_email_addresses=[alert_email],
        ),
    ],
)

budgets_role = aws.iam.Role(
    "labs-budgets-action",
    name="labs-budgets-action",
    assume_role_policy=json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"Service": "budgets.amazonaws.com"},
            "Action": "sts:AssumeRole",
        }],
    }),
)

aws.iam.RolePolicy(
    "labs-budgets-action",
    role=budgets_role.id,
    policy=json.dumps({
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Action": [
                "organizations:AttachPolicy",
                "organizations:DetachPolicy",
                "organizations:Describe*",
                "organizations:List*",
            ],
            "Resource": "*",
        }],
    }),
)

aws.budgets.BudgetAction(
    "labs-hard-stop",
    budget_name=budget.name,
    action_type="APPLY_SCP_POLICY",
    approval_model="AUTOMATIC",
    notification_type="ACTUAL",
    execution_role_arn=budgets_role.arn,
    action_threshold=aws.budgets.BudgetActionActionThresholdArgs(
        action_threshold_type="PERCENTAGE",
        action_threshold_value=100,
    ),
    definition=aws.budgets.BudgetActionDefinitionArgs(
        scp_action_definition=aws.budgets.BudgetActionDefinitionScpActionDefinitionArgs(
            policy_id=deny_new_spend.id,
            target_ids=[labs_ou.id],
        ),
    ),
    subscribers=[aws.budgets.BudgetActionSubscriberArgs(address=alert_email, subscription_type="EMAIL")],
)

anomaly_monitor = aws.costexplorer.AnomalyMonitor(
    "labs-anomaly",
    name="labs-services",
    monitor_type="DIMENSIONAL",
    monitor_dimension="SERVICE",
)

aws.costexplorer.AnomalySubscription(
    "labs-anomaly-email",
    name="labs-anomaly-email",
    frequency="DAILY",
    monitor_arn_lists=[anomaly_monitor.arn],
    subscribers=[aws.costexplorer.AnomalySubscriptionSubscriberArgs(type="EMAIL", address=alert_email)],
    threshold_expression=aws.costexplorer.AnomalySubscriptionThresholdExpressionArgs(
        dimension=aws.costexplorer.AnomalySubscriptionThresholdExpressionDimensionArgs(
            key="ANOMALY_TOTAL_IMPACT_ABSOLUTE",
            match_options=["GREATER_THAN_OR_EQUAL"],
            values=["5"],
        ),
    ),
)

# A tag key can only be activated after AWS has seen it on a resource, so this waits for the first lab run.
if activate_cost_tags:
    for key in ("lab_run_id", "lab_scenario"):
        aws.costexplorer.CostAllocationTag(f"cost-tag-{key}", tag_key=key, status="Active")

pulumi.export("labs_ou_id", labs_ou.id)
pulumi.export("deny_new_spend_policy_id", deny_new_spend.id)
```

- [ ] **Step 3: Check that the program compiles**

Run: `uv run python -m py_compile platform/aws/management/__main__.py platform/aws/sandbox/__main__.py`
Expected: no output, exit 0.

- [ ] **Step 4: Commit**

```bash
git add platform/aws/management/Pulumi.yaml platform/aws/management/__main__.py
git commit -m "feat(platform): management project with SCPs, budget hard stop, anomaly detection"
```

---

### Task 4: Bootstrap checklist and shell environment

**Files:**
- Create: `platform/aws/BOOTSTRAP.md`
- Create: `scripts/lab-env.sh`
- Modify: `.gitignore` (append one line)

**Interfaces:**
- Consumes: the output names from Task 3.
- Produces: environment variables `LAB_REPO_ROOT`, `LAB_AWS_PROFILE`, `PULUMI_BACKEND_URL`, `PULUMI_CONFIG_PASSPHRASE`, and `PULUMI_SKIP_UPDATE_CHECK`, read by every Pulumi command and by `labctl.config.load_settings()` in the harness plan.

- [ ] **Step 1: Write `scripts/lab-env.sh`**

```sh
# Usage, from the repo root:  source scripts/lab-env.sh
if [ ! -f "$PWD/scripts/lab-env.sh" ]; then
  echo "source this from the repo root" >&2
  return 1
fi

export LAB_REPO_ROOT="$PWD"
export LAB_AWS_PROFILE="${LAB_AWS_PROFILE:-cp-lab}"
mkdir -p "$LAB_REPO_ROOT/.lab/pulumi-state"
export PULUMI_BACKEND_URL="file://$LAB_REPO_ROOT/.lab/pulumi-state"
export PULUMI_SKIP_UPDATE_CHECK=true

if ! PULUMI_CONFIG_PASSPHRASE="$(security find-generic-password -a "$USER" -s cloud-platform-pulumi -w 2>/dev/null)"; then
  echo "no Pulumi passphrase in the keychain; see platform/aws/BOOTSTRAP.md step 9" >&2
  return 1
fi
export PULUMI_CONFIG_PASSPHRASE
```

- [ ] **Step 2: Write `platform/aws/BOOTSTRAP.md`**

````markdown
# AWS bootstrap (manual, once)

Done by you, in order. Nothing here is automated, because it creates accounts and identities.
Pulumi takes over at step 10.

1. **Management account.** Sign up a new AWS account with a fresh email alias
   (for example `you+cp-mgmt@…`). Do not use your existing personal account. Enable root MFA.
   Create no root access keys. In Account settings, enable "IAM user and role access to Billing information".
2. **Organization.** In the management account, open AWS Organizations, then
   Create organization (all features).
3. **SCPs.** Organizations → Policies → Service control policies → Enable.
4. **Sandbox account.** Organizations → Add an AWS account → Create. Name it `labs-sandbox`, with
   email `you+cp-labs@…` and the default role name `OrganizationAccountAccessRole`.
   Write down the 12-digit account ID.
5. **Member root credentials.** IAM → Root access management → enable centralized root access for
   member accounts. Then delete the root credentials of `labs-sandbox`. That account then has no root
   password to protect.
6. **IAM Identity Center.** Enable it in `eu-central-1` (organization instance). Create a user for
   yourself with MFA required.
7. **Permission sets.** Create both with session duration 8 hours:
   - `MgmtAdmin`, using `AdministratorAccess`, assigned to you in the **management** account.
   - `LabOperator`, using `AdministratorAccess`, assigned to you in **labs-sandbox**.
8. **CLI profiles.** Run `aws configure sso` twice. Use SSO session name `cp`, region
   `eu-central-1`, profile `cp-mgmt` (management, MgmtAdmin), and profile `cp-lab` (labs-sandbox, LabOperator).
   Check:
   `aws sts get-caller-identity --profile cp-lab` must show an ARN containing `AWSReservedSSO_LabOperator_`.
9. **Pulumi passphrase.**
   `security add-generic-password -a "$USER" -s cloud-platform-pulumi -w "$(openssl rand -base64 32)"`.
   Back it up in your password manager. Without it, the local Pulumi state cannot be decrypted.
10. **Hand back to the agent** with the sandbox account ID and the alert email address. It runs Task 5 of
    the platform guardrails plan.

## After the management stack exists

11. **Move the sandbox into the `labs` OU:**
    ```
    ROOT=$(aws organizations list-roots --profile cp-mgmt --query 'Roots[0].Id' --output text)
    OU=$(cd platform/aws/management && pulumi stack output labs_ou_id --stack main)
    aws organizations move-account --profile cp-mgmt --account-id <sandbox-id> \
      --source-parent-id "$ROOT" --destination-parent-id "$OU"
    ```

## After the first lab run

12. **Cost allocation tags.** AWS only lists a tag key after it has seen it, so these can't be activated earlier:
    ```
    cd platform/aws/management
    AWS_PROFILE=cp-mgmt pulumi config set activate_cost_tags true --stack main
    AWS_PROFILE=cp-mgmt pulumi up --stack main
    ```
````

- [ ] **Step 3: Gitignore the stack config files**

Append to `.gitignore`. Stack files hold account IDs and the alert email, and the repo keeps account IDs out of git:

```text
Pulumi.*.yaml
```

This matches `Pulumi.main.yaml` and per-run stack files, but not the project files named `Pulumi.yaml`.

Run: `git check-ignore -v platform/aws/management/Pulumi.main.yaml; git check-ignore platform/aws/management/Pulumi.yaml || echo "project file tracked"`
Expected: the first command prints the matching `.gitignore` rule, the second prints `project file tracked`.

- [ ] **Step 4: Check the script syntax**

Run: `zsh -n scripts/lab-env.sh && bash -n scripts/lab-env.sh`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add .gitignore platform/aws/BOOTSTRAP.md scripts/lab-env.sh
git commit -m "docs(platform): manual AWS bootstrap checklist and lab-env.sh"
```

---

### Task 5: Apply and verify the guardrails (requires BOOTSTRAP.md steps 1–10)

**Files:** none created. This task changes the AWS accounts only.

**Interfaces:**
- Consumes: the `cp-mgmt` and `cp-lab` profiles, the sandbox account ID, and the alert email.
- Produces: live SCPs on the `labs` OU, the budget and hard stop, the anomaly monitor, and the `lab-solver-boundary` policy in the sandbox.

- [ ] **Step 1: Check the budget currency**

In the management console, Billing → Budgets → Create budget. Check whether the amount field accepts EUR.
- If it does, set `BUDGET_UNIT=EUR` and `BUDGET_LIMIT=20`.
- If it only offers USD, set `BUDGET_UNIT=USD` and `BUDGET_LIMIT=22`, which is about €20.

Cancel the wizard without creating anything.

- [ ] **Step 2: Create and preview the management stack**

```bash
source scripts/lab-env.sh
cd platform/aws/management
export AWS_PROFILE=cp-mgmt
pulumi stack init main
pulumi config set aws:region eu-central-1
pulumi config set sandbox_account_id <sandbox-id>
pulumi config set alert_email <email>
pulumi config set budget_limit "$BUDGET_LIMIT"
pulumi config set budget_unit "$BUDGET_UNIT"
pulumi preview
```

Expected: a plan to create about 14 resources (OU, 3 policies, 2 attachments, budget, role, role policy, budget action, anomaly monitor, anomaly subscription) with no errors.

If the preview fails because a `DIMENSIONAL`/`SERVICE` anomaly monitor already exists (AWS sometimes creates a default one):
1. Get its ARN with `aws ce get-anomaly-monitors --profile cp-mgmt`.
2. Run `pulumi import aws:costexplorer/anomalyMonitor:AnomalyMonitor labs-anomaly <arn>`.
3. Change `name=` in the program to the existing monitor's name, then preview again.

- [ ] **Step 3: Apply the management stack**

Run: `pulumi up --yes`
Expected: `Resources: N created` with no errors. Then run `pulumi stack output` and write down `labs_ou_id` and `deny_new_spend_policy_id`.

- [ ] **Step 4: Move the sandbox into the OU**

Follow BOOTSTRAP.md step 11.

Run: `aws organizations list-parents --child-id <sandbox-id> --profile cp-mgmt`
Expected: the parent ID equals `labs_ou_id`.

- [ ] **Step 5: Apply the sandbox stack**

```bash
cd ../sandbox
export AWS_PROFILE=cp-lab
pulumi stack init main
pulumi config set aws:region eu-central-1
pulumi up --yes
```

Expected: one policy created. `pulumi stack output boundary_arn` prints `arn:aws:iam::<sandbox-id>:policy/lab-solver-boundary`.

- [ ] **Step 6: Verify the SCPs deny what they should, with no spend (dry runs)**

```bash
AMI=$(aws ssm get-parameter --profile cp-lab --region eu-central-1 \
  --name /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64 --query Parameter.Value --output text)
aws ec2 run-instances --profile cp-lab --region eu-central-1 --dry-run --image-id "$AMI" --instance-type t4g.large
aws ec2 run-instances --profile cp-lab --region eu-central-1 --dry-run --image-id "$AMI" --instance-type t4g.micro
aws ec2 describe-instances --profile cp-lab --region us-east-1 --max-items 1
aws s3api create-bucket --profile cp-lab --region us-east-1 --bucket "cp-scp-test-$RANDOM"
```

Expected, in order:
1. `UnauthorizedOperation ... with an explicit deny in a service control policy`.
2. `DryRunOperation: Request would have succeeded`.
3. Succeeds (describes are exempt so the janitor can scan every region).
4. `AccessDenied ... explicit deny in a service control policy`.

If any result differs, stop and report it. Do not loosen a policy to make a check pass without asking the user.

- [ ] **Step 7: Test-fire the hard stop once (user and agent together)**

This needs month-to-date spend above zero in the sandbox. If there is none yet, do this step after the first harness smoke test (harness plan, Task 13).

```bash
cd platform/aws/management && export AWS_PROFILE=cp-mgmt
pulumi config set budget_limit 0.01 && pulumi up --yes
```

Wait for budget evaluation, which can take up to about 8 hours. Then:

```bash
aws organizations list-policies-for-target --profile cp-mgmt --target-id <labs_ou_id> --filter SERVICE_CONTROL_POLICY
aws organizations list-policies-for-target --profile cp-mgmt --target-id <sandbox-id> --filter SERVICE_CONTROL_POLICY
```

Expected: `labs-deny-new-spend` is attached to both targets, and you got the action email. Restore the limit, then reverse
the action through Budgets and re-arm it. Do not detach the policy by hand: that leaves the action spent and the hard stop
disarmed until next month.

```bash
pulumi config set budget_limit "$BUDGET_LIMIT" && pulumi up --yes
MGMT=$(aws sts get-caller-identity --profile cp-mgmt --query Account --output text)
ACTION=$(pulumi stack output budget_action_id)
aws budgets execute-budget-action --profile cp-mgmt --account-id "$MGMT" --budget-name labs-monthly \
  --action-id "$ACTION" --execution-type REVERSE_BUDGET_ACTION
aws budgets execute-budget-action --profile cp-mgmt --account-id "$MGMT" --budget-name labs-monthly \
  --action-id "$ACTION" --execution-type RESET_BUDGET_ACTION
aws budgets describe-budget-action --profile cp-mgmt --account-id "$MGMT" --budget-name labs-monthly \
  --action-id "$ACTION" --query Action.Status
```

Expected: both `list-policies-for-target` calls no longer list `labs-deny-new-spend`, and the status is `STANDBY`.
If the reset is rejected or the status is not `STANDBY`, stop and report it: the hard stop is not armed.

Write the date, and the time between lowering the limit and the email arriving, into `DECISION_LOG.md` under the "Organizations now" entry's next experiment.

- [ ] **Step 8: Commit the decision log only**

The `Pulumi.main.yaml` stack files hold the account ID and email. They are gitignored (Task 4) and backed up together with `.lab/`.

```bash
git status --short platform/   # expected: no Pulumi.main.yaml listed
git add DECISION_LOG.md
git commit -m "docs: record budget hard-stop test-fire"
```
