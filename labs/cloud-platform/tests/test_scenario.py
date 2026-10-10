import shutil
from pathlib import Path

import pytest

from labctl.checks import all_passed
from labctl.scenario import ScenarioError, load_scenario
from tests.fakes import FakeSession, make_env

FIXTURES = Path(__file__).parent / "fixtures" / "scenarios"


def test_load_scenario_reads_yaml():
    s = load_scenario(FIXTURES, "fake-001")
    assert s.id == "fake-001"
    assert s.version == 1
    assert s.fault_ids == ("break-a", "break-b")
    assert s.handover == ("endpoint",)
    assert s.baseline_timeout_s == 0
    assert s.infra_dir == FIXTURES / "fake-001" / "infra"
    assert s.readme_path == FIXTURES / "fake-001" / "README.md"


def test_faults_load_in_yaml_order():
    faults = load_scenario(FIXTURES, "fake-001").faults()
    assert [f.id for f in faults] == ["break-a", "break-b"]


def test_unknown_scenario():
    with pytest.raises(ScenarioError, match="unknown scenario"):
        load_scenario(FIXTURES, "nope-001")


def test_fault_mismatch_error_does_not_name_faults(tmp_path):
    shutil.copytree(FIXTURES / "fake-001", tmp_path / "fake-001")
    spec = tmp_path / "fake-001" / "scenario.yaml"
    spec.write_text(spec.read_text().replace("faults: [break-a, break-b]", "faults: [break-a]"))
    with pytest.raises(ScenarioError) as error:
        load_scenario(tmp_path, "fake-001").faults()
    assert "break-b" not in str(error.value)


def test_only_aws_provider_supported(tmp_path):
    shutil.copytree(FIXTURES / "fake-001", tmp_path / "fake-001")
    spec = tmp_path / "fake-001" / "scenario.yaml"
    spec.write_text(spec.read_text().replace("provider: aws", "provider: gcp"))
    with pytest.raises(ScenarioError, match="provider"):
        load_scenario(tmp_path, "fake-001")


def test_checks_and_baseline_come_from_validate_py():
    s = load_scenario(FIXTURES, "fake-001")
    env = make_env(FakeSession())
    assert s.baseline(env) == {"instances": ["i-1"]}
    assert all_passed(s.checks(env))


def _copy_fixture(tmp_path):
    shutil.copytree(FIXTURES / "fake-001", tmp_path / "fake-001")
    return tmp_path / "fake-001"


def _edit_spec(tmp_path, old, new):
    spec = _copy_fixture(tmp_path) / "scenario.yaml"
    spec.write_text(spec.read_text().replace(old, new))
    return spec


@pytest.mark.parametrize(
    ("old", "new", "field"),
    [
        ("faults: [break-a, break-b]", "faults: break-a", "faults"),
        ("faults: [break-a, break-b]", "faults: [1, 2]", "faults"),
        ("handover: [endpoint]", "handover: endpoint", "handover"),
        ("handover: [endpoint]", "handover: {a: b}", "handover"),
    ],
)
def test_list_fields_must_be_lists_of_strings(tmp_path, old, new, field):
    spec = _edit_spec(tmp_path, old, new)
    with pytest.raises(ScenarioError) as error:
        load_scenario(tmp_path, "fake-001")
    assert field in str(error.value)
    assert str(spec) in str(error.value)


@pytest.mark.parametrize(
    ("old", "new", "field"),
    [
        ("version: 1", "version: one", "version"),
        ("version: 1", "version:", "version"),
        ("ttl_minutes: 30", "ttl_minutes: soon", "ttl_minutes"),
        ("baseline_timeout_s: 0", "baseline_timeout_s: [1]", "baseline_timeout_s"),
        ("fault_timeout_s: 0", "fault_timeout_s: x", "fault_timeout_s"),
    ],
)
def test_int_fields_raise_scenario_error(tmp_path, old, new, field):
    spec = _edit_spec(tmp_path, old, new)
    with pytest.raises(ScenarioError) as error:
        load_scenario(tmp_path, "fake-001")
    assert field in str(error.value)
    assert str(spec) in str(error.value)


@pytest.mark.parametrize("text", ["id: [unclosed\n", "- just\n- a list\n", "plain string\n"])
def test_bad_yaml_raises_scenario_error(tmp_path, text):
    spec = _copy_fixture(tmp_path) / "scenario.yaml"
    spec.write_text(text)
    with pytest.raises(ScenarioError) as error:
        load_scenario(tmp_path, "fake-001")
    assert str(spec) in str(error.value)


def _assert_no_spoilers(message):
    for spoiler in ("break-a", "break-b", "break_a", "break_b"):
        assert spoiler not in message


def test_fault_module_missing_attr_is_spoiler_safe(tmp_path):
    path = _copy_fixture(tmp_path)
    fault = path / "faults" / "break_b.py"
    fault.write_text(fault.read_text().replace("def revert(env)", "def _revert(env)"))
    with pytest.raises(ScenarioError) as error:
        load_scenario(tmp_path, "fake-001").faults()
    assert "fault module #2 (sorted order) is missing revert" in str(error.value)
    _assert_no_spoilers(str(error.value))


@pytest.mark.parametrize(
    "source",
    ["def inject(:\n", "import labctl_does_not_exist\n", "raise RuntimeError('break-a in break_a.py')\n"],
)
def test_fault_module_load_failure_is_spoiler_safe(tmp_path, source):
    path = _copy_fixture(tmp_path)
    (path / "faults" / "break_a.py").write_text(source)
    with pytest.raises(ScenarioError) as error:
        load_scenario(tmp_path, "fake-001").faults()
    assert str(error.value) == "fault module #1 failed to load"
    assert error.value.__cause__ is not None


def test_validate_load_failure_raises_scenario_error(tmp_path):
    path = _copy_fixture(tmp_path)
    (path / "validate.py").write_text("def checks(:\n")
    with pytest.raises(ScenarioError, match="validate.py"):
        load_scenario(tmp_path, "fake-001").checks(make_env(FakeSession()))


def test_duplicate_fault_ids_in_yaml(tmp_path):
    _edit_spec(tmp_path, "faults: [break-a, break-b]", "faults: [break-a, break-b, break-a]")
    with pytest.raises(ScenarioError, match="duplicate") as error:
        load_scenario(tmp_path, "fake-001").faults()
    _assert_no_spoilers(str(error.value))


def test_duplicate_fault_ids_across_modules(tmp_path):
    path = _copy_fixture(tmp_path)
    fault = path / "faults" / "break_b.py"
    fault.write_text(fault.read_text().replace('ID = "break-b"', 'ID = "break-a"'))
    with pytest.raises(ScenarioError, match="duplicate") as error:
        load_scenario(tmp_path, "fake-001").faults()
    _assert_no_spoilers(str(error.value))


def test_fake_sts_expiration_is_far_future():
    from datetime import UTC, datetime

    creds = FakeSession().client("sts").assume_role()["Credentials"]
    assert creds["Expiration"] == datetime(2099, 1, 1, tzinfo=UTC)


def test_fake_responses_are_deep_copies():
    first = FakeSession().client("ec2").describe_regions()
    first["Regions"][0]["RegionName"] = "mutated"
    again = FakeSession().client("ec2").describe_regions()
    assert again["Regions"][0]["RegionName"] == "eu-central-1"


def test_fake_session_records_region_name():
    session = FakeSession()
    client = session.client("ec2", region_name="us-east-1")
    assert client.region_name == "us-east-1"
    assert session.client("ec2") is client
    assert session.client("sts").region_name is None
