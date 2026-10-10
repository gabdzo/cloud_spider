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
