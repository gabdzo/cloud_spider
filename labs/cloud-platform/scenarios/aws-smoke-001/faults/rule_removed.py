ID = "rule-removed"
PERMISSION = [{"IpProtocol": "tcp", "FromPort": 8080, "ToPort": 8080, "IpRanges": [{"CidrIp": "10.0.0.0/8"}]}]


def _ec2(env):
    return env.session.client("ec2", region_name=env.region)


def inject(env):
    _ec2(env).revoke_security_group_ingress(GroupId=env.outputs["sg_id"], IpPermissions=PERMISSION)


def revert(env):
    _ec2(env).authorize_security_group_ingress(GroupId=env.outputs["sg_id"], IpPermissions=PERMISSION)
