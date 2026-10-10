from labctl.aws.infra import boundary_arn, run_tagged_statement, solver_role_name, trust_policy


def test_names():
    assert solver_role_name("r-1") == "lab-solver-r-1"
    assert boundary_arn("111111111111") == "arn:aws:iam::111111111111:policy/lab-solver-boundary"


def test_trust_policy_only_admits_the_lab_operator_sso_role():
    (statement,) = trust_policy("111111111111")["Statement"]
    assert statement["Principal"] == {"AWS": "arn:aws:iam::111111111111:root"}
    assert statement["Action"] == "sts:AssumeRole"
    assert statement["Condition"] == {"ArnLike": {
        "aws:PrincipalArn": "arn:aws:iam::111111111111:role/aws-reserved/sso.amazonaws.com/*AWSReservedSSO_LabOperator_*",
    }}


def test_run_tagged_statement():
    assert run_tagged_statement(["ec2:DoThing"], ["arn:aws:ec2:eu-central-1:1:thing/*"], "r-1") == {
        "Effect": "Allow",
        "Action": ["ec2:DoThing"],
        "Resource": ["arn:aws:ec2:eu-central-1:1:thing/*"],
        "Condition": {"StringEquals": {"aws:ResourceTag/lab_run_id": "r-1"}},
    }
