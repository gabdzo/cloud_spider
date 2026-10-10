from __future__ import annotations

import json
from dataclasses import dataclass

BOUNDARY_NAME = "lab-solver-boundary"
OPERATOR_ROLE_PATTERN = "arn:aws:iam::{account}:role/aws-reserved/sso.amazonaws.com/*AWSReservedSSO_LabOperator_*"


def solver_role_name(run_id: str) -> str:
    return f"lab-solver-{run_id}"


def boundary_arn(account_id: str) -> str:
    return f"arn:aws:iam::{account_id}:policy/{BOUNDARY_NAME}"


def trust_policy(account_id: str) -> dict:
    return {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"AWS": f"arn:aws:iam::{account_id}:root"},
            "Action": "sts:AssumeRole",
            "Condition": {"ArnLike": {"aws:PrincipalArn": OPERATOR_ROLE_PATTERN.format(account=account_id)}},
        }],
    }


def run_tagged_statement(actions: list[str], resources: list[str], run_id: str) -> dict:
    return {
        "Effect": "Allow",
        "Action": actions,
        "Resource": resources,
        "Condition": {"StringEquals": {"aws:ResourceTag/lab_run_id": run_id}},
    }


@dataclass(frozen=True)
class LabConfig:
    run_id: str
    nonce: str
    operator_ip: str
    self_terminate_minutes: int
    account_id: str
    region: str

    @classmethod
    def load(cls) -> "LabConfig":
        import pulumi

        cfg = pulumi.Config("lab")
        return cls(
            run_id=cfg.require("run_id"),
            nonce=cfg.require("nonce"),
            operator_ip=cfg.require("operator_ip"),
            self_terminate_minutes=cfg.require_int("self_terminate_minutes"),
            account_id=cfg.require("account_id"),
            region=pulumi.Config("aws").require("region"),
        )


def solver_role(lab: LabConfig, statements: list[dict]):
    import pulumi_aws as aws

    role = aws.iam.Role(
        "solver",
        name=solver_role_name(lab.run_id),
        assume_role_policy=json.dumps(trust_policy(lab.account_id)),
        permissions_boundary=boundary_arn(lab.account_id),
        max_session_duration=3600,
    )
    aws.iam.RolePolicy(
        "solver",
        role=role.id,
        policy=json.dumps({"Version": "2012-10-17", "Statement": statements}),
    )
    return role
