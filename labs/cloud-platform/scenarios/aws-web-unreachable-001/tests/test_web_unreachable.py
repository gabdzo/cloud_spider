import ast
import copy
import dataclasses
import functools
import inspect
import ipaddress
import urllib.request
from pathlib import Path

import pytest

from labctl.checks import all_passed, outcome_failed_guards_passed
from labctl.lifecycle import author_section
from labctl.scenario import load_scenario
from tests.fakes import FakeClient, FakeSession, make_env

SCENARIO_DIR = Path(__file__).resolve().parents[1]
SCENARIOS = SCENARIO_DIR.parent
ID = SCENARIO_DIR.name
OPERATOR = "198.51.100.7"
CLIENT_PORT = 50123
OUTPUTS = {
    "endpoint": "http://203.0.113.10/health", "instance_id": "i-1", "vpc_id": "vpc-1", "subnet_id": "subnet-1",
    "igw_id": "igw-1", "route_table_id": "rtb-1", "nacl_id": "acl-1", "sg_id": "sg-1",
    "solver_role_arn": "arn:aws:iam::111111111111:role/lab-solver-r-test",
}
TAGS = [{"Key": "lab_run_id", "Value": "r-test"}, {"Key": "aws:cloudformation:x", "Value": "y"}]


def healthy_world():
    return {
        "sg": [{"IpProtocol": "tcp", "FromPort": 80, "ToPort": 80, "IpRanges": [{"CidrIp": f"{OPERATOR}/32"}],
                "Ipv6Ranges": [], "Tags": TAGS}],
        "routes": {"10.20.0.0/16": "local", "0.0.0.0/0": "igw-1"},
        "nacl": [
            {"RuleNumber": 100, "Egress": False, "Protocol": "6", "RuleAction": "allow",
             "CidrBlock": f"{OPERATOR}/32", "PortRange": {"From": 80, "To": 80}},
            {"RuleNumber": 110, "Egress": False, "Protocol": "6", "RuleAction": "allow",
             "CidrBlock": "0.0.0.0/0", "PortRange": {"From": 1024, "To": 65535}},
            {"RuleNumber": 32767, "Egress": False, "Protocol": "-1", "RuleAction": "deny", "CidrBlock": "0.0.0.0/0"},
            {"RuleNumber": 100, "Egress": True, "Protocol": "-1", "RuleAction": "allow", "CidrBlock": "0.0.0.0/0"},
            {"RuleNumber": 32767, "Egress": True, "Protocol": "-1", "RuleAction": "deny", "CidrBlock": "0.0.0.0/0"},
        ],
        "instances": [{"InstanceId": "i-1", "VpcId": "vpc-1", "State": "running",
                       "Tags": [{"Key": "lab_run_id", "Value": "r-test"}]}],
        "vpcs": [{"VpcId": "vpc-default", "Tags": []}, {"VpcId": "vpc-1", "Tags": TAGS}],
        "igws": [{"InternetGatewayId": "igw-1", "Attachments": [{"VpcId": "vpc-1"}], "Tags": TAGS}],
        "enis": ["eni-1"], "eips": [],
    }


# ---- simulated network ---------------------------------------------------

def _matches(item, filters):
    """EC2 Filters on a fake VPC, gateway or address (all filters must hold)."""
    for f in filters:
        name, values = f["Name"], f["Values"]
        if name.startswith("tag:"):
            ok = any(t["Key"] == name[4:] and t["Value"] in values for t in item.get("Tags", []))
        elif name == "attachment.vpc-id":
            ok = any(a["VpcId"] in values for a in item.get("Attachments", []))
        elif name == "network-interface-id":
            ok = item.get("NetworkInterfaceId") in values
        else:
            raise AssertionError(f"unexpected filter {name}")
        if not ok:
            return False
    return True


def _in(ip, cidr):
    return ipaddress.ip_address(ip) in ipaddress.ip_network(cidr)


def _nacl_allows(entries, egress, port, peer):
    for e in sorted((e for e in entries if e["Egress"] == egress), key=lambda e: e["RuleNumber"]):
        proto_ok = e["Protocol"] == "-1" or (
            e["Protocol"] == "6" and e["PortRange"]["From"] <= port <= e["PortRange"]["To"]
        )
        if proto_ok and _in(peer, e["CidrBlock"]):
            return e["RuleAction"] == "allow"
    return False


def reachable(w):
    sg_ok = any(
        (p["IpProtocol"] == "-1" or (p["IpProtocol"] == "tcp" and p["FromPort"] <= 80 <= p["ToPort"]))
        and any(_in(OPERATOR, r["CidrIp"]) for r in p.get("IpRanges", []))
        for p in w["sg"]
    )
    running = any(i["InstanceId"] == "i-1" and i["State"] == "running" for i in w["instances"])
    return (running and sg_ok and w["routes"].get("0.0.0.0/0") == "igw-1"
            and _nacl_allows(w["nacl"], False, 80, OPERATOR)
            and _nacl_allows(w["nacl"], True, CLIENT_PORT, OPERATOR))


def _same_perm(a, b):
    keys = ("IpProtocol", "FromPort", "ToPort")
    return all(a.get(k) == b.get(k) for k in keys) and a.get("IpRanges", []) == b.get("IpRanges", [])


def ec2_responses(w):
    def revoke(GroupId, IpPermissions):
        before = len(w["sg"])
        w["sg"] = [p for p in w["sg"] if not any(_same_perm(p, q) for q in IpPermissions)]
        assert len(w["sg"]) < before, "revoke matched nothing"

    def authorize(GroupId, IpPermissions, TagSpecifications=()):
        tags = [t for spec in TagSpecifications for t in spec["Tags"]]
        assert all(not t["Key"].startswith("aws:") for t in tags)
        w["sg"] += [dict(p, Ipv6Ranges=p.get("Ipv6Ranges", []), Tags=tags) for p in IpPermissions]

    def sg_rules(Filters):
        return {"SecurityGroupRules": [
            {"SecurityGroupRuleId": f"sgr-{n}", "IsEgress": False, "IpProtocol": p["IpProtocol"],
             "FromPort": p.get("FromPort", -1), "ToPort": p.get("ToPort", -1), "CidrIpv4": r["CidrIp"],
             "Tags": p.get("Tags", [])}
            for n, p in enumerate(w["sg"]) for r in p.get("IpRanges", [])
        ]}

    def groups(Filters):
        perms = [{k: v for k, v in p.items() if k != "Tags"} for p in w["sg"]]
        return {"SecurityGroups": [{"GroupId": "sg-1", "VpcId": "vpc-1", "IpPermissions": perms}]}

    def delete_route(RouteTableId, DestinationCidrBlock):
        del w["routes"][DestinationCidrBlock]

    def create_route(RouteTableId, DestinationCidrBlock, GatewayId):
        assert DestinationCidrBlock not in w["routes"]
        w["routes"][DestinationCidrBlock] = GatewayId

    def _find(number, egress):
        return next(i for i, e in enumerate(w["nacl"]) if e["RuleNumber"] == number and e["Egress"] == egress)

    def _entry(kw):
        e = {k: kw[k] for k in ("RuleNumber", "Egress", "Protocol", "RuleAction", "CidrBlock")}
        if "PortRange" in kw:
            e["PortRange"] = kw["PortRange"]
        return e

    def replace_entry(**kw):
        w["nacl"][_find(kw["RuleNumber"], kw["Egress"])] = _entry(kw)

    def create_entry(**kw):
        assert not any(e["RuleNumber"] == kw["RuleNumber"] and e["Egress"] == kw["Egress"] for e in w["nacl"])
        w["nacl"].append(_entry(kw))

    def delete_entry(NetworkAclId, RuleNumber, Egress):
        del w["nacl"][_find(RuleNumber, Egress)]

    def instances(Filters):
        def match(i, f):
            name, values = f["Name"], f["Values"]
            if name == "instance-state-name":
                return i["State"] in values
            if name == "instance-id":
                return i["InstanceId"] in values
            if name == "vpc-id":
                return i["VpcId"] in values
            if name.startswith("tag:"):
                return any(t["Key"] == name[4:] and t["Value"] in values for t in i["Tags"])
            raise AssertionError(f"unexpected filter {name}")
        found = [copy.deepcopy(i) for i in w["instances"] if all(match(i, f) for f in Filters)]
        return {"Reservations": [{"Instances": found}] if found else []}

    return {
        "revoke_security_group_ingress": revoke,
        "authorize_security_group_ingress": authorize,
        "describe_security_group_rules": sg_rules,
        "describe_security_groups": groups,
        "delete_route": delete_route,
        "create_route": create_route,
        "replace_network_acl_entry": replace_entry,
        "create_network_acl_entry": create_entry,
        "delete_network_acl_entry": delete_entry,
        "describe_network_acls": lambda NetworkAclIds: {
            "NetworkAcls": [{"NetworkAclId": "acl-1", "Entries": copy.deepcopy(w["nacl"])}]},
        "describe_instances": instances,
        "describe_vpcs": lambda Filters: {"Vpcs": [copy.deepcopy(v) for v in w["vpcs"] if _matches(v, Filters)]},
        "describe_internet_gateways": lambda Filters: {
            "InternetGateways": [copy.deepcopy(g) for g in w["igws"] if _matches(g, Filters)]},
        "describe_network_interfaces": lambda Filters: {
            "NetworkInterfaces": [{"NetworkInterfaceId": n} for n in w["enis"]]},
        "describe_addresses": lambda Filters: {"Addresses": [copy.deepcopy(a) for a in w["eips"] if _matches(a, Filters)]},
    }


class _Response:
    status = 200

    def read(self):
        return b"ok n\n"

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def lab(monkeypatch):
    world = healthy_world()

    def urlopen(url, timeout):
        assert url == OUTPUTS["endpoint"] and timeout == 3
        if not reachable(world):
            raise TimeoutError("timed out")
        return _Response()

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    session = FakeSession()
    session.clients["ec2"] = FakeClient(ec2_responses(world))
    scenario = load_scenario(SCENARIOS, ID)
    env = make_env(session, outputs=dict(OUTPUTS))
    env = dataclasses.replace(env, baseline=scenario.baseline(env))
    return scenario, env, world


def by_name(checks):
    return {c.name: c for c in checks}


def fault(scenario, fault_id):
    return next(f for f in scenario.faults() if f.id == fault_id)


FAULT_IDS = ["sg-no-http", "route-no-igw", "nacl-no-ephemeral"]


# ---- tests ---------------------------------------------------------------

def test_scenario_loads():
    scenario = load_scenario(SCENARIOS, ID)
    assert sorted(f.id for f in scenario.faults()) == sorted(FAULT_IDS)
    assert scenario.handover == ("endpoint", "instance_id")
    assert scenario.ttl_minutes == 90


def test_every_fault_has_author_notes():
    for fault_id in FAULT_IDS:
        assert author_section(SCENARIO_DIR / "AUTHOR.md", fault_id).startswith(f"## {fault_id}\n")


def test_healthy_baseline_passes_and_baseline_is_json_safe(lab):
    import json

    scenario, env, _ = lab
    json.dumps(env.baseline)
    assert all_passed(scenario.checks(env)), scenario.checks(env)


@pytest.mark.parametrize("fault_id", FAULT_IDS)
def test_fault_breaks_outcome_cleanly_and_revert_restores_baseline(lab, fault_id):
    scenario, env, world = lab
    original = copy.deepcopy(world)
    f = fault(scenario, fault_id)

    f.inject(env)
    checks = scenario.checks(env)
    assert outcome_failed_guards_passed(checks), checks
    assert not by_name(checks)["health-200"].passed

    f.revert(env)
    assert all_passed(scenario.checks(env))
    assert world["routes"] == original["routes"]
    assert sorted(world["nacl"], key=str) == sorted(original["nacl"], key=str)
    assert [{k: v for k, v in p.items() if k != "Tags"} for p in world["sg"]] == \
        [{k: v for k, v in p.items() if k != "Tags"} for p in original["sg"]]


def test_reverted_rule_keeps_user_tags(lab):
    scenario, env, world = lab
    f = fault(scenario, "sg-no-http")
    f.inject(env)
    f.revert(env)
    assert world["sg"][0]["Tags"] == [{"Key": "lab_run_id", "Value": "r-test"}]


def test_inject_is_deterministic(lab):
    scenario, env, world = lab
    for fault_id in FAULT_IDS:
        f = fault(scenario, fault_id)
        f.inject(env)
        first = copy.deepcopy(world)
        f.revert(env)
        f.inject(env)
        assert world == first
        f.revert(env)


def test_alternative_fix_passes(lab):
    scenario, env, world = lab
    fault(scenario, "nacl-no-ephemeral").inject(env)
    env.session.clients["ec2"].create_network_acl_entry(
        NetworkAclId="acl-1", RuleNumber=120, Egress=True, Protocol="6", RuleAction="allow",
        CidrBlock="0.0.0.0/0", PortRange={"From": 1024, "To": 65535},
    )
    assert all_passed(scenario.checks(env))


@pytest.mark.parametrize("perm", [
    {"IpProtocol": "-1", "IpRanges": [{"CidrIp": "0.0.0.0/0"}], "Ipv6Ranges": []},
    {"IpProtocol": "tcp", "FromPort": 0, "ToPort": 65535, "IpRanges": [], "Ipv6Ranges": [{"CidrIpv6": "::/0"}]},
    {"IpProtocol": "tcp", "FromPort": 22, "ToPort": 22, "IpRanges": [{"CidrIp": "0.0.0.0/0"}], "Ipv6Ranges": []},
    {"IpProtocol": "tcp", "FromPort": 80, "ToPort": 80, "IpRanges": [{"CidrIp": "0.0.0.0/0"}], "Ipv6Ranges": []},
    {"IpProtocol": "tcp", "FromPort": 80, "ToPort": 80, "IpRanges": [], "Ipv6Ranges": [{"CidrIpv6": "::/0"}]},
])
def test_any_world_ingress_trips_guard(lab, perm):
    scenario, env, world = lab
    world["sg"].append(perm)
    check = by_name(scenario.checks(env))["no-world-ingress"]
    assert not check.passed
    assert "sg-1" in check.detail


def test_world_open_web_port_fix_fails_validation(lab):
    scenario, env, world = lab
    fault(scenario, "sg-no-http").inject(env)
    world["sg"].append({"IpProtocol": "tcp", "FromPort": 80, "ToPort": 80,
                        "IpRanges": [{"CidrIp": "0.0.0.0/0"}], "Ipv6Ranges": []})
    checks = by_name(scenario.checks(env))
    assert checks["health-200"].passed and not checks["no-world-ingress"].passed


def test_world_open_fix_after_fault_trips_guard(lab):
    scenario, env, world = lab
    for fault_id in FAULT_IDS:
        fault(scenario, fault_id).inject(env)
        world["sg"].append({"IpProtocol": "-1", "IpRanges": [{"CidrIp": "0.0.0.0/0"}], "Ipv6Ranges": []})
        assert not all_passed(scenario.checks(env))
        world["sg"].pop()
        fault(scenario, fault_id).revert(env)


def test_replacement_instance_trips_guard(lab):
    scenario, env, world = lab
    world["instances"][0]["State"] = "terminated"
    world["instances"].append({"InstanceId": "i-2", "VpcId": "vpc-1", "State": "running", "Tags": []})
    world["enis"] = ["eni-2"]
    checks = by_name(scenario.checks(env))
    assert not checks["same-instance"].passed
    assert "i-1" in checks["same-instance"].detail and "i-2" in checks["same-instance"].detail
    assert not checks["no-new-network"].passed


def test_new_network_resources_trip_guard(lab):
    scenario, env, world = lab
    world["eips"].append({"AllocationId": "eipalloc-1", "NetworkInterfaceId": "eni-1", "Tags": []})
    world["igws"].append({"InternetGatewayId": "igw-2", "Attachments": [{"VpcId": "vpc-1"}], "Tags": []})
    check = by_name(scenario.checks(env))["no-new-network"]
    assert not check.passed
    assert "eipalloc-1" in check.detail and "igw-2" in check.detail


def test_other_stacks_in_the_account_do_not_trip_the_network_guard(lab):
    # Cloud Spider's EKS / RDS stacks live in the same account: their VPCs,
    # gateways and addresses are not this run's and must not count.
    scenario, env, world = lab
    world["vpcs"].append({"VpcId": "vpc-eks", "Tags": [{"Key": "project", "Value": "eks"}]})
    world["igws"].append({"InternetGatewayId": "igw-eks", "Attachments": [{"VpcId": "vpc-eks"}], "Tags": []})
    world["eips"].append({"AllocationId": "eipalloc-nat", "NetworkInterfaceId": "eni-nat", "Tags": []})
    assert by_name(scenario.checks(env))["no-new-network"].passed


def test_a_new_vpc_tagged_with_the_run_trips_the_guard(lab):
    scenario, env, world = lab
    world["vpcs"].append({"VpcId": "vpc-2", "Tags": TAGS})
    check = by_name(scenario.checks(env))["no-new-network"]
    assert not check.passed and "vpc-2" in check.detail


# ---- static check of the Pulumi program -----------------------------------

def _aws_calls(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            parts, target = [], node.func
            while isinstance(target, ast.Attribute):
                parts.insert(0, target.attr)
                target = target.value
            if isinstance(target, ast.Name) and target.id == "aws" and parts:
                yield parts, node


@functools.cache
def _program():
    import runpy
    import warnings

    import pulumi

    created = {}

    class Mocks(pulumi.runtime.Mocks):
        def new_resource(self, args):
            created[(args.typ, args.name)] = (args.typ, args.inputs)
            state = dict(args.inputs, arn=f"arn:aws:x::{args.name}")
            if args.typ == "aws:ec2/instance:Instance":
                state["publicIp"] = "203.0.113.10"
            return f"{args.name}-id", state

        def call(self, args):
            assert args.token == "aws:ssm/getParameter:getParameter"
            return {"name": args.args["name"], "value": "ami-123", "type": "String", "arn": "a", "id": "x"}

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", DeprecationWarning)
        pulumi.runtime.set_mocks(Mocks(), preview=False)
        for key, value in {
            "lab:run_id": "r-test", "lab:nonce": "n0nce", "lab:operator_ip": OPERATOR,
            "lab:self_terminate_minutes": "105", "lab:account_id": "111111111111", "aws:region": "eu-central-1",
        }.items():
            pulumi.runtime.set_config(key, value)
        pulumi.runtime.test(lambda: runpy.run_path(str(SCENARIO_DIR / "infra" / "__main__.py")) and None)()
    return created


def _inputs(typ):
    return next(i for t, i in _program().values() if t == typ)


def _user_data():
    return _inputs("aws:ec2/instance:Instance")["userData"]


def _heredoc(user_data, path):
    return user_data.split(f"cat > {path} <<'EOF'\n", 1)[1].split("\nEOF\n", 1)[0] + "\n"


def test_pulumi_program_runs_under_mocks():
    created = _program()
    assert len(created) == 17, sorted(created)
    instance = _inputs("aws:ec2/instance:Instance")
    assert instance["instanceType"] == "t4g.micro"
    assert instance["instanceInitiatedShutdownBehavior"] == "terminate"
    assert instance["metadataOptions"]["httpTokens"] == "required"
    assert "keyName" not in instance and "iamInstanceProfile" not in instance
    assert "ok n0nce" in instance["userData"]
    cidrs = [i.get("cidrIpv4") for t, i in created.values() if t == "aws:vpc/securityGroupIngressRule:SecurityGroupIngressRule"]
    assert cidrs == [f"{OPERATOR}/32"]
    banned = ("NatGateway", "Eip", "LoadBalancer", "KeyPair", "InstanceProfile")
    assert not [t for t, _ in created.values() if any(b in t for b in banned)]


def test_user_data_is_valid_bash():
    import subprocess

    subprocess.run(["bash", "-n"], input=_user_data(), text=True, check=True)


def test_self_terminate_deadline_survives_reboot():
    user_data = _user_data()
    assert user_data.index('date -u -d "+105 minutes" +%s') < user_data.index("systemctl")
    unit = _heredoc(user_data, "/etc/systemd/system/selfterm.service")
    assert "ExecStart=/opt/web/selfterm.sh" in unit and "WantedBy=multi-user.target" in unit
    assert "systemctl enable --now selfterm.service" in user_data


@pytest.mark.parametrize("deadline_offset_s, expected", [(3000, "shutdown -h +50"), (-60, "shutdown -h now")])
def test_self_terminate_script_reschedules_from_deadline(tmp_path, deadline_offset_s, expected):
    import subprocess
    import time

    script = _heredoc(_user_data(), "/opt/web/selfterm.sh")
    (tmp_path / "deadline").write_text(f"{int(time.time()) + deadline_offset_s}\n")
    (tmp_path / "shutdown").write_text('#!/bin/sh\necho "shutdown $*"\n')
    (tmp_path / "shutdown").chmod(0o755)
    script = script.replace("/opt/web/deadline", str(tmp_path / "deadline"))
    result = subprocess.run(["bash", "-c", script], text=True, capture_output=True, check=True,
                            env={"PATH": f"{tmp_path}:/usr/bin:/bin"})
    assert result.stdout.strip() == expected


def test_server_answers_while_another_client_holds_a_connection_open():
    import socket
    import threading

    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    source = _heredoc(_user_data(), "/opt/web/server.py")
    assert '("0.0.0.0", 80)' in source
    source = source.replace('("0.0.0.0", 80)', f'("127.0.0.1", {port})')
    threading.Thread(target=exec, args=(source, {"__name__": "server"}), daemon=True).start()
    for _ in range(50):
        try:
            idle = socket.create_connection(("127.0.0.1", port), timeout=1)
            break
        except OSError:
            import time
            time.sleep(0.05)
    with idle:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/health", timeout=2) as response:
            assert response.read() == b"ok n0nce\n"


def test_solver_policy_allows_reboot_of_run_instance_and_no_creates():
    import json

    statements = json.loads(_inputs("aws:iam/rolePolicy:RolePolicy")["policy"])["Statement"]
    reboot = [s for s in statements if "ec2:RebootInstances" in s["Action"]]
    assert reboot == [{
        "Effect": "Allow", "Action": ["ec2:RebootInstances"],
        "Resource": ["arn:aws:ec2:eu-central-1:111111111111:instance/*"],
        "Condition": {"StringEquals": {"aws:ResourceTag/lab_run_id": "r-test"}},
    }]
    actions = [a for s in statements for a in s["Action"]]
    banned = ("RunInstances", "StartInstances", "StopInstances", "ModifyInstanceAttribute", "CreateSecurityGroup",
              "CreateNetworkInterface", "AllocateAddress", "CreateVpc", "CreateInternetGateway", "CreateTags")
    assert not [a for a in actions if any(b in a for b in banned)]


@pytest.mark.filterwarnings("ignore::DeprecationWarning")
def test_pulumi_program_uses_only_real_pulumi_aws_args():
    import pulumi_aws as aws

    source = (SCENARIO_DIR / "infra" / "__main__.py").read_text()
    tree = ast.parse(source)
    compile(tree, "__main__.py", "exec")
    calls = list(_aws_calls(tree))
    assert calls
    for parts, node in calls:
        obj = aws
        for part in parts:
            obj = getattr(obj, part)
        fn = getattr(obj, "_internal_init", None) if inspect.isclass(obj) and hasattr(obj, "_internal_init") else (
            obj.__init__ if inspect.isclass(obj) else obj
        )
        params = inspect.signature(fn).parameters
        for kw in node.keywords:
            assert kw.arg in params, f"aws.{'.'.join(parts)} has no argument {kw.arg}"
