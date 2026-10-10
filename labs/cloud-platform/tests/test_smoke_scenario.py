from pathlib import Path

from labctl.checks import all_passed, outcome_failed_guards_passed
from labctl.scenario import load_scenario
from tests.fakes import FakeClient, FakeSession, make_env

SCENARIOS = Path(__file__).resolve().parents[1] / "scenarios"

HEALTHY_RULE = {"SecurityGroupRuleId": "sgr-1", "IsEgress": False, "IpProtocol": "tcp",
                "FromPort": 8080, "ToPort": 8080, "CidrIpv4": "10.0.0.0/8"}
WORLD_ALL = {"SecurityGroupRuleId": "sgr-2", "IsEgress": False, "IpProtocol": "-1",
             "FromPort": -1, "ToPort": -1, "CidrIpv4": "0.0.0.0/0"}


def env_with_rules(rules):
    session = FakeSession()
    session.clients["ec2"] = FakeClient({"describe_security_group_rules": {"SecurityGroupRules": rules}})
    return make_env(session, outputs={"sg_id": "sg-1"})


def test_smoke_scenario_loads_with_one_fault():
    scenario = load_scenario(SCENARIOS, "aws-smoke-001")
    assert [f.id for f in scenario.faults()] == ["rule-removed"]
    assert scenario.handover == ("sg_id",)


def test_healthy_passes_removed_rule_fails_cleanly():
    scenario = load_scenario(SCENARIOS, "aws-smoke-001")
    assert all_passed(scenario.checks(env_with_rules([HEALTHY_RULE])))
    assert outcome_failed_guards_passed(scenario.checks(env_with_rules([])))


WORLD_8080 = {"SecurityGroupRuleId": "sgr-3", "IsEgress": False, "IpProtocol": "tcp",
              "FromPort": 8080, "ToPort": 8080, "CidrIpv4": "0.0.0.0/0"}
WORLD_V6 = {"SecurityGroupRuleId": "sgr-4", "IsEgress": False, "IpProtocol": "tcp",
            "FromPort": 8080, "ToPort": 8080, "CidrIpv6": "::/0"}


def _by_name(rules):
    return {c.name: c for c in load_scenario(SCENARIOS, "aws-smoke-001").checks(env_with_rules(rules))}


def test_opening_everything_fails_the_guard():
    by_name = _by_name([WORLD_ALL])
    assert not by_name["sg-allows-8080"].passed, "world is not the 10.0.0.0/8 rule the brief asks for"
    assert not by_name["no-world-ingress"].passed
    assert "sgr-2" in by_name["no-world-ingress"].detail


def test_world_on_just_8080_fails_the_guard_too():
    # The brief says "without opening the group to the world": any port counts.
    for rule in (WORLD_8080, WORLD_V6):
        by_name = _by_name([HEALTHY_RULE, rule])
        assert by_name["sg-allows-8080"].passed
        assert not by_name["no-world-ingress"].passed
        assert rule["SecurityGroupRuleId"] in by_name["no-world-ingress"].detail


def test_8080_from_a_narrower_private_range_counts():
    narrow = dict(HEALTHY_RULE, CidrIpv4="10.20.0.0/16")
    assert all_passed(load_scenario(SCENARIOS, "aws-smoke-001").checks(env_with_rules([narrow])))
    public = dict(HEALTHY_RULE, CidrIpv4="198.51.100.0/24")
    assert not _by_name([public])["sg-allows-8080"].passed


def test_fault_revokes_and_revert_restores_the_same_permission():
    scenario = load_scenario(SCENARIOS, "aws-smoke-001")
    (fault,) = scenario.faults()
    env = env_with_rules([])
    fault.inject(env)
    fault.revert(env)
    calls = env.session.clients["ec2"].calls
    permission = [{"IpProtocol": "tcp", "FromPort": 8080, "ToPort": 8080, "IpRanges": [{"CidrIp": "10.0.0.0/8"}]}]
    assert calls == [
        ("revoke_security_group_ingress", {"GroupId": "sg-1", "IpPermissions": permission}),
        ("authorize_security_group_ingress", {"GroupId": "sg-1", "IpPermissions": permission}),
    ]
