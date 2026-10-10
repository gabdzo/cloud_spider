from datetime import UTC, datetime

from labctl.aws.janitor import find_leftovers
from tests.fakes import FakeClient

HOME = "eu-central-1"


def factory_with(responses_by_key):
    clients = {}

    def factory(service, region):
        key = (service, region)
        if key not in clients:
            clients[key] = FakeClient(responses_by_key.get(key, {}))
        return clients[key]

    return factory, clients


def only_unfiltered(response):
    return lambda **kwargs: {} if ("Filters" in kwargs or "Filter" in kwargs) else response


def paged(*pages, token_in="NextToken", token_out="NextToken"):
    def respond(**kwargs):
        index = int(kwargs.get(token_in, "0"))
        page = dict(pages[index])
        if index + 1 < len(pages):
            page[token_out] = str(index + 1)
            if token_out == "Marker":
                page["IsTruncated"] = True
        return page

    return respond


def test_clean_account_reports_nothing():
    factory, _ = factory_with({("ec2", HOME): {"describe_regions": {"Regions": [{"RegionName": HOME}]}}})
    assert find_leftovers(factory, HOME) == []


def test_run_scoped_uses_run_tag_and_skips_terminated_instances():
    factory, clients = factory_with({
        ("ec2", HOME): {
            "describe_instances": {"Reservations": [{"Instances": [
                {"InstanceId": "i-dead", "State": {"Name": "terminated"}},
                {"InstanceId": "i-live", "State": {"Name": "running"}},
            ]}]},
            "describe_vpcs": {"Vpcs": [{"VpcId": "vpc-1"}]},
        },
        ("iam", HOME): {"list_roles": {"Roles": [
            {"RoleName": "lab-solver-r-1"},
            {"RoleName": "lab-solver-r-2"},
            {"RoleName": "OrganizationAccountAccessRole"},
        ]}},
    })
    found = find_leftovers(factory, HOME, run_id="r-1")
    assert found == [
        "eu-central-1 instances i-live",
        "eu-central-1 vpcs vpc-1",
        "global iam_role lab-solver-r-1",
    ]
    ec2_calls = clients[("ec2", HOME)].calls
    assert ec2_calls[0] == ("describe_instances", {"Filters": [{"Name": "tag:lab_run_id", "Values": ["r-1"]}]})
    assert ("describe_nat_gateways", {"Filter": [{"Name": "tag:lab_run_id", "Values": ["r-1"]}]}) in ec2_calls
    assert not any(name == "describe_regions" for name, _ in ec2_calls)


def test_account_wide_scans_every_region_for_untagged_spend():
    factory, clients = factory_with({
        ("ec2", HOME): {
            "describe_regions": {"Regions": [{"RegionName": HOME}, {"RegionName": "us-east-1"}]},
            "describe_vpcs": only_unfiltered({"Vpcs": [{"VpcId": "vpc-default", "IsDefault": True}]}),
        },
        ("ec2", "us-east-1"): {
            "describe_instances": {"Reservations": [{"Instances": [
                {"InstanceId": "i-us", "State": {"Name": "running"}},
            ]}]},
            "describe_vpcs": {"Vpcs": [{"VpcId": "vpc-x", "IsDefault": False}]},
        },
        ("elbv2", "us-east-1"): {"describe_load_balancers": {"LoadBalancers": [{"LoadBalancerName": "lb-1"}]}},
    })
    assert find_leftovers(factory, HOME) == [
        "us-east-1 instances i-us",
        "us-east-1 load_balancers lb-1",
        "us-east-1 vpcs vpc-x",
    ]
    assert clients[("ec2", HOME)].calls[0][1] == {"Filters": [{"Name": "tag:lab", "Values": ["true"]}]}


def tagged_only(response):
    return lambda **kwargs: response if ("Filters" in kwargs or "Filter" in kwargs) else {}


def expires(moment):
    return [{"Key": "lab", "Value": "true"}, {"Key": "lab_expires_at", "Value": moment}]


def test_account_wide_marks_overdue_tagged_resources():
    instance = {"Reservations": [{"Instances": [
        {"InstanceId": "i-old", "State": {"Name": "running"}, "Tags": expires("2026-01-01T10:00:00+00:00")},
        {"InstanceId": "i-new", "State": {"Name": "running"}, "Tags": expires("2026-01-01T14:00:00+00:00")},
    ]}]}
    factory, _ = factory_with({
        ("ec2", HOME): {
            "describe_regions": {"Regions": [{"RegionName": HOME}]},
            "describe_instances": instance,
            "describe_vpcs": tagged_only({"Vpcs": [
                {"VpcId": "vpc-old", "Tags": expires("2026-01-01T11:59:59+00:00")},
                {"VpcId": "vpc-untimed", "Tags": [{"Key": "lab", "Value": "true"}]},
            ]}),
        },
    })
    now = datetime(2026, 1, 1, 12, 0, tzinfo=UTC)
    assert find_leftovers(factory, HOME, now=now) == [
        "eu-central-1 instances i-new",
        "eu-central-1 instances i-old (overdue)",
        "eu-central-1 vpcs vpc-old (overdue)",
        "eu-central-1 vpcs vpc-untimed",
    ]
    assert "eu-central-1 instances i-old" in find_leftovers(factory, HOME)


def test_run_scoped_never_marks_overdue():
    factory, _ = factory_with({
        ("ec2", HOME): {"describe_vpcs": {"Vpcs": [{"VpcId": "vpc-1", "Tags": expires("2000-01-01T00:00:00+00:00")}]}},
    })
    now = datetime(2026, 1, 1, tzinfo=UTC)
    assert find_leftovers(factory, HOME, run_id="r-1", now=now) == ["eu-central-1 vpcs vpc-1"]


def test_run_scoped_follows_every_page():
    factory, clients = factory_with({
        ("ec2", HOME): {
            "describe_instances": paged(
                {"Reservations": [{"Instances": [{"InstanceId": "i-1", "State": {"Name": "running"}}]}]},
                {"Reservations": [{"Instances": [{"InstanceId": "i-2", "State": {"Name": "running"}}]}]},
            ),
            "describe_nat_gateways": paged({"NatGateways": []}, {"NatGateways": [{"NatGatewayId": "nat-2"}]}),
        },
        ("iam", HOME): {"list_roles": paged(
            {"Roles": [{"RoleName": "OrganizationAccountAccessRole"}]},
            {"Roles": [{"RoleName": "lab-solver-r-1"}]},
            token_in="Marker",
            token_out="Marker",
        )},
    })
    assert find_leftovers(factory, HOME, run_id="r-1") == [
        "eu-central-1 instances i-1",
        "eu-central-1 instances i-2",
        "eu-central-1 nat_gateways nat-2",
        "global iam_role lab-solver-r-1",
    ]
    run_filter = [{"Name": "tag:lab_run_id", "Values": ["r-1"]}]
    assert ("describe_instances", {"Filters": run_filter, "NextToken": "1"}) in clients[("ec2", HOME)].calls


def test_account_wide_follows_every_page_in_every_region():
    second = "us-east-1"
    factory, clients = factory_with({
        ("ec2", HOME): {"describe_regions": {"Regions": [{"RegionName": HOME}, {"RegionName": second}]}},
        ("ec2", second): {
            "describe_instances": paged(
                {"Reservations": []},
                {"Reservations": [{"Instances": [{"InstanceId": "i-late", "State": {"Name": "pending"}}]}]},
            ),
            "describe_vpcs": paged({"Vpcs": [{"VpcId": "vpc-d", "IsDefault": True}]}, {"Vpcs": [{"VpcId": "vpc-late"}]}),
        },
        ("elbv2", second): {"describe_load_balancers": paged(
            {"LoadBalancers": [{"LoadBalancerName": "lb-1"}]},
            {"LoadBalancers": [{"LoadBalancerName": "lb-2"}]},
            token_in="Marker",
            token_out="NextMarker",
        )},
    })
    found = find_leftovers(factory, HOME)
    assert found == [
        f"{second} instances i-late",
        f"{second} load_balancers lb-1",
        f"{second} load_balancers lb-2",
        f"{second} vpcs vpc-late",
    ]
    assert ("describe_load_balancers", {"Marker": "1"}) in clients[("elbv2", second)].calls
