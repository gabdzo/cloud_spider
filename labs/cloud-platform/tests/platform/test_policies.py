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
