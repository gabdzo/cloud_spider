ID = "nacl-no-ephemeral"
REPLACED_RULE = 100
ADDED_RULE = 110


def _ec2(env):
    return env.session.client("ec2", region_name=env.region)


def _entry(env, number, protocol, cidr, port_range=None):
    entry = {
        "NetworkAclId": env.outputs["nacl_id"], "RuleNumber": number, "Egress": True,
        "Protocol": protocol, "RuleAction": "allow", "CidrBlock": cidr,
    }
    if port_range:
        entry["PortRange"] = port_range
    return entry


def inject(env):
    ec2 = _ec2(env)
    ec2.replace_network_acl_entry(**_entry(env, REPLACED_RULE, "6", "0.0.0.0/0", {"From": 80, "To": 80}))
    ec2.create_network_acl_entry(**_entry(env, ADDED_RULE, "6", "0.0.0.0/0", {"From": 443, "To": 443}))


def revert(env):
    ec2 = _ec2(env)
    ec2.delete_network_acl_entry(NetworkAclId=env.outputs["nacl_id"], RuleNumber=ADDED_RULE, Egress=True)
    original = next(
        (e for e in env.baseline.get("nacl_egress", []) if e["RuleNumber"] == REPLACED_RULE),
        {"Protocol": "-1", "CidrBlock": "0.0.0.0/0"},
    )
    ec2.replace_network_acl_entry(
        **_entry(env, REPLACED_RULE, original["Protocol"], original["CidrBlock"], original.get("PortRange"))
    )
