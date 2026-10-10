from __future__ import annotations

from datetime import datetime
from typing import Any, Callable, Iterable, Iterator

ClientFactory = Callable[[str, str], Any]

# (describe method, response key, id field, name of the filter parameter)
_TAGGED_EC2 = (
    ("describe_instances", "Reservations", None, "Filters"),
    ("describe_vpcs", "Vpcs", "VpcId", "Filters"),
    ("describe_subnets", "Subnets", "SubnetId", "Filters"),
    ("describe_security_groups", "SecurityGroups", "GroupId", "Filters"),
    ("describe_internet_gateways", "InternetGateways", "InternetGatewayId", "Filters"),
    ("describe_route_tables", "RouteTables", "RouteTableId", "Filters"),
    ("describe_network_acls", "NetworkAcls", "NetworkAclId", "Filters"),
    ("describe_network_interfaces", "NetworkInterfaces", "NetworkInterfaceId", "Filters"),
    ("describe_addresses", "Addresses", "AllocationId", "Filters"),
    ("describe_nat_gateways", "NatGateways", "NatGatewayId", "Filter"),
)


def _items(
    call: Callable[..., dict],
    key: str,
    request_token: str = "NextToken",
    response_token: str = "NextToken",
    **kwargs: Any,
) -> Iterator[dict]:
    while True:
        page = call(**kwargs)
        yield from page.get(key, [])
        token = page.get(response_token)
        if not token:
            return
        kwargs = {**kwargs, request_token: token}


def _live_instance_items(reservations: Iterable[dict]) -> Iterator[dict]:
    for reservation in reservations:
        for instance in reservation.get("Instances", []):
            if instance.get("State", {}).get("Name") != "terminated":
                yield instance


def _live_instances(reservations: Iterable[dict]) -> Iterator[str]:
    for instance in _live_instance_items(reservations):
        yield instance["InstanceId"]


def _overdue(item: dict, now: datetime | None) -> bool:
    if now is None:
        return False
    tags = {tag["Key"]: tag["Value"] for tag in item.get("Tags", [])}
    expires_at = tags.get("lab_expires_at")
    return expires_at is not None and datetime.fromisoformat(expires_at) < now


def _tag_filter(run_id: str | None) -> list[dict]:
    if run_id:
        return [{"Name": "tag:lab_run_id", "Values": [run_id]}]
    return [{"Name": "tag:lab", "Values": ["true"]}]


def _tagged_in_region(ec2: Any, region: str, run_id: str | None, now: datetime | None) -> list[str]:
    found = []
    filters = _tag_filter(run_id)
    for method, key, id_field, filter_param in _TAGGED_EC2:
        items = _items(getattr(ec2, method), key, **{filter_param: filters})
        if key == "Reservations":
            live = [(i, i["InstanceId"]) for i in _live_instance_items(items)]
        else:
            live = [(item, item[id_field]) for item in items if item.get("State") != "deleted"]
        kind = method.removeprefix("describe_")
        found += [
            f"{region} {kind} {resource_id}" + (" (overdue)" if _overdue(item, now) else "")
            for item, resource_id in live
        ]
    return found


def _untagged_everywhere(client_factory: ClientFactory, home_region: str) -> list[str]:
    regions = [r["RegionName"] for r in client_factory("ec2", home_region).describe_regions().get("Regions", [])]
    found = []
    for region in regions:
        ec2 = client_factory("ec2", region)
        found += [f"{region} instances {i}" for i in _live_instances(_items(ec2.describe_instances, "Reservations"))]
        found += [
            f"{region} nat_gateways {n['NatGatewayId']}"
            for n in _items(ec2.describe_nat_gateways, "NatGateways")
            if n.get("State") != "deleted"
        ]
        found += [
            f"{region} addresses {a.get('AllocationId', a.get('PublicIp'))}"
            for a in _items(ec2.describe_addresses, "Addresses")
        ]
        found += [f"{region} vpcs {v['VpcId']}" for v in _items(ec2.describe_vpcs, "Vpcs") if not v.get("IsDefault")]
        elbv2 = client_factory("elbv2", region)
        found += [
            f"{region} load_balancers {lb['LoadBalancerName']}"
            for lb in _items(elbv2.describe_load_balancers, "LoadBalancers", "Marker", "NextMarker")
        ]
    return found


def _solver_roles(iam: Any, run_id: str | None) -> list[str]:
    prefix = f"lab-solver-{run_id}" if run_id else "lab-solver-"
    roles = _items(iam.list_roles, "Roles", "Marker", "Marker")
    return [f"global iam_role {r['RoleName']}" for r in roles if r["RoleName"].startswith(prefix)]


def find_leftovers(
    client_factory: ClientFactory,
    home_region: str,
    run_id: str | None = None,
    now: datetime | None = None,
) -> list[str]:
    if run_id is not None:
        now = None
    found = _tagged_in_region(client_factory("ec2", home_region), home_region, run_id, now)
    found += _solver_roles(client_factory("iam", home_region), run_id)
    if run_id is None:
        found += _untagged_everywhere(client_factory, home_region)
    overdue = {line.removesuffix(" (overdue)") for line in found if line.endswith(" (overdue)")}
    return sorted({line for line in found if line not in overdue})
