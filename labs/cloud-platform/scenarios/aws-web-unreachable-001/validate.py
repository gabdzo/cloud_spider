import urllib.request

from labctl.checks import Check

TRIES = 3
TIMEOUT_S = 3
WORLD = ("0.0.0.0/0", "::/0")


def _ec2(env):
    return env.session.client("ec2", region_name=env.region)


def _vpc_filter(env):
    return [{"Name": "vpc-id", "Values": [env.outputs["vpc_id"]]}]


def _instances(ec2, filters):
    reservations = ec2.describe_instances(Filters=filters)["Reservations"]
    return [i for r in reservations for i in r["Instances"]]


def _run_tag(env):
    return [{"Name": "tag:lab_run_id", "Values": [env.run_id]}]


# Only this run's network: the lab VPC and anything tagged with the run id,
# gateways attached to the lab VPC, addresses on the lab VPC's interfaces.
# (It used to list every VPC, gateway and Elastic IP in the account, so any
# unrelated stack in a shared account tripped the no-new-network guard.)
def _inventory(env):
    ec2, vpc = _ec2(env), env.outputs["vpc_id"]
    enis = sorted(
        n["NetworkInterfaceId"]
        for n in ec2.describe_network_interfaces(Filters=_vpc_filter(env))["NetworkInterfaces"]
    )
    vpcs = {vpc} | {v["VpcId"] for v in ec2.describe_vpcs(Filters=_run_tag(env))["Vpcs"]}
    igws = {
        g["InternetGatewayId"]
        for filters in ([{"Name": "attachment.vpc-id", "Values": [vpc]}], _run_tag(env))
        for g in ec2.describe_internet_gateways(Filters=filters)["InternetGateways"]
    }
    address_filters = [_run_tag(env)] + ([[{"Name": "network-interface-id", "Values": enis}]] if enis else [])
    eips = {a["AllocationId"] for filters in address_filters for a in ec2.describe_addresses(Filters=filters)["Addresses"]}
    return {"vpcs": sorted(vpcs), "igws": sorted(igws), "enis": enis, "eips": sorted(eips)}


def baseline(env):
    ec2 = _ec2(env)
    rules = ec2.describe_security_group_rules(
        Filters=[{"Name": "group-id", "Values": [env.outputs["sg_id"]]}]
    )["SecurityGroupRules"]
    acl = ec2.describe_network_acls(NetworkAclIds=[env.outputs["nacl_id"]])["NetworkAcls"][0]
    return {
        "inventory": _inventory(env),
        "sg_ingress": [r for r in rules if not r.get("IsEgress")],
        "nacl_egress": [e for e in acl["Entries"] if e["Egress"] and e["RuleNumber"] < 32767],
        "igw_id": env.outputs["igw_id"],
    }


def _health(env):
    url, want = env.outputs["endpoint"], f"ok {env.nonce}"
    last = ""
    for _ in range(TRIES):
        try:
            with urllib.request.urlopen(url, timeout=TIMEOUT_S) as response:
                body = response.read().decode(errors="replace").strip()
                if response.status == 200 and body == want:
                    return Check("health-200", "outcome", True)
                last = f"HTTP {response.status}, unexpected body"
        except Exception as exc:
            last = type(exc).__name__
    return Check("health-200", "outcome", False, last)


def _same_instance(env):
    ec2, original = _ec2(env), env.outputs["instance_id"]
    live = [{"Name": "instance-state-name", "Values": ["pending", "running"]}]
    running = {i["InstanceId"] for i in _instances(ec2, live + [{"Name": "instance-id", "Values": [original]}])}
    others = {
        i["InstanceId"]
        for filters in (_vpc_filter(env), [{"Name": "tag:lab_run_id", "Values": [env.run_id]}])
        for i in _instances(ec2, live + filters)
    } - {original}
    detail = "; ".join(filter(None, [
        "" if original in running else f"{original} is not running",
        f"other instances: {', '.join(sorted(others))}" if others else "",
    ]))
    return Check("same-instance", "guard", not detail, detail)


def _no_new_network(env):
    want, have = env.baseline.get("inventory", {}), _inventory(env)
    diffs = [f"{k}: {sorted(set(have[k]) ^ set(want.get(k, [])))}" for k in have if have[k] != want.get(k)]
    return Check("no-new-network", "guard", not diffs, "; ".join(diffs))


def _world_ranges(permission):
    return [r["CidrIp"] for r in permission.get("IpRanges", []) if r.get("CidrIp") in WORLD] + [
        r["CidrIpv6"] for r in permission.get("Ipv6Ranges", []) if r.get("CidrIpv6") in WORLD
    ]


def _no_world_ingress(env):
    groups = _ec2(env).describe_security_groups(Filters=_vpc_filter(env))["SecurityGroups"]
    open_groups = sorted({
        g["GroupId"] for g in groups for p in g.get("IpPermissions", []) if _world_ranges(p)
    })
    return Check("no-world-ingress", "guard", not open_groups, ", ".join(open_groups))


def checks(env):
    return [_health(env), _same_instance(env), _no_new_network(env), _no_world_ingress(env)]
