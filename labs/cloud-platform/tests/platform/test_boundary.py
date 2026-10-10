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
