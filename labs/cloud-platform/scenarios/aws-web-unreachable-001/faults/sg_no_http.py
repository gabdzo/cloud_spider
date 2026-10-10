ID = "sg-no-http"


def _ec2(env):
    return env.session.client("ec2", region_name=env.region)


def _permission(env):
    return [{"IpProtocol": "tcp", "FromPort": 80, "ToPort": 80, "IpRanges": [{"CidrIp": f"{env.operator_ip}/32"}]}]


def inject(env):
    _ec2(env).revoke_security_group_ingress(GroupId=env.outputs["sg_id"], IpPermissions=_permission(env))


def revert(env):
    cidr = f"{env.operator_ip}/32"
    original = next(
        (r for r in env.baseline.get("sg_ingress", []) if r.get("CidrIpv4") == cidr and r.get("FromPort") == 80),
        {},
    )
    kwargs = {}
    tags = [t for t in original.get("Tags", []) if not t["Key"].startswith("aws:")]
    if tags:
        kwargs["TagSpecifications"] = [{"ResourceType": "security-group-rule", "Tags": tags}]
    _ec2(env).authorize_security_group_ingress(GroupId=env.outputs["sg_id"], IpPermissions=_permission(env), **kwargs)
