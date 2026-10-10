import pulumi
import pulumi_aws as aws

from labctl.aws.infra import LabConfig, run_tagged_statement, solver_role

lab = LabConfig.load()
ec2_arn = f"arn:aws:ec2:{lab.region}:{lab.account_id}"
sg_actions = ["ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupIngress"]

vpc = aws.ec2.Vpc("vpc", cidr_block="10.99.0.0/16")
sg = aws.ec2.SecurityGroup("app", vpc_id=vpc.id, description="labctl smoke test")
aws.vpc.SecurityGroupIngressRule(
    "app-8080",
    security_group_id=sg.id,
    ip_protocol="tcp",
    from_port=8080,
    to_port=8080,
    cidr_ipv4="10.0.0.0/8",
)

role = solver_role(lab, [
    {"Effect": "Allow", "Action": ["ec2:Describe*"], "Resource": "*"},
    run_tagged_statement(sg_actions, [f"{ec2_arn}:security-group/*"], lab.run_id),
    # A new rule has no tags yet, so the rule resource cannot carry the run-tag condition.
    {"Effect": "Allow", "Action": sg_actions, "Resource": [f"{ec2_arn}:security-group-rule/*"]},
])

pulumi.export("vpc_id", vpc.id)
pulumi.export("sg_id", sg.id)
pulumi.export("solver_role_arn", role.arn)
