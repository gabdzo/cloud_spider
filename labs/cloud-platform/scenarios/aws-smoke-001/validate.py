import ipaddress

from labctl.checks import Check

# The brief: restore TCP 8080 from 10.0.0.0/8 "without opening the group to
# the world". So the outcome needs a rule from inside 10.0.0.0/8, and the
# guard fails on ANY ingress from 0.0.0.0/0 or ::/0, whatever the port
# (it used to catch only world-on-all-ports, so 0.0.0.0/0:8080 passed).
PRIVATE = ipaddress.ip_network("10.0.0.0/8")


def _ingress_rules(env):
    ec2 = env.session.client("ec2", region_name=env.region)
    rules = ec2.describe_security_group_rules(
        Filters=[{"Name": "group-id", "Values": [env.outputs["sg_id"]]}]
    )["SecurityGroupRules"]
    return [r for r in rules if not r.get("IsEgress")]


def _world(rule):
    return rule.get("CidrIpv4") == "0.0.0.0/0" or rule.get("CidrIpv6") == "::/0"


def _covers_8080(rule):
    proto = rule.get("IpProtocol")
    if proto == "-1":
        return True
    return proto == "tcp" and rule.get("FromPort", 0) <= 8080 <= rule.get("ToPort", -1)


def _from_private(rule):
    cidr = rule.get("CidrIpv4")
    if not cidr:
        return False
    try:
        return ipaddress.ip_network(cidr, strict=False).subnet_of(PRIVATE)
    except ValueError:
        return False


def checks(env):
    rules = _ingress_rules(env)
    allows_8080 = any(_covers_8080(r) and _from_private(r) for r in rules)
    world_open = [r["SecurityGroupRuleId"] for r in rules if _world(r)]
    return [
        Check("sg-allows-8080", "outcome", allows_8080, "" if allows_8080 else "no ingress rule covers tcp/8080 from 10.0.0.0/8"),
        Check("no-world-ingress", "guard", not world_open, ", ".join(world_open)),
    ]
