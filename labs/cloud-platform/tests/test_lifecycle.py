import json
import random
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import pytest

from labctl.config import Settings
from labctl.lifecycle import Deps, Lab, LabError
from labctl.runs import RunError
from tests.fakes import FakeClient, FakePulumi, FakeSession

FIXTURES = Path(__file__).parent / "fixtures" / "scenarios"
NOW = datetime(2026, 10, 6, 12, 0, tzinfo=UTC)


def make_lab(tmp_path, session=None, pulumi=None):
    session = session or FakeSession()
    pulumi = pulumi or FakePulumi()
    out, shells = [], []
    deps = Deps(
        settings=Settings(scenarios_dir=FIXTURES, state_dir=tmp_path / ".lab", aws_profile="test"),
        session_factory=lambda profile, region: session,
        pulumi_factory=lambda project_dir: pulumi,
        operator_ip=lambda: "198.51.100.7",
        rng=random.Random(1),
        now=lambda: NOW,
        sleep=lambda seconds: None,
        out=out.append,
        git_sha=lambda: "abc123",
        environ={"SHELL": "/bin/zsh", "AWS_PROFILE": "cp-lab"},
        run_shell=lambda argv, env: shells.append((argv, env)) or 0,
    )
    return SimpleNamespace(lab=Lab(deps), session=session, pulumi=pulumi, out=out, shells=shells)


def test_up_hands_over_a_broken_run(tmp_path):
    h = make_lab(tmp_path)
    run = h.lab.up("fake-001")
    assert run.state == "handed_over"
    assert len(h.session.world["broken"]) == 1
    assert run.sealed_fault() in {"break-a", "break-b"}
    assert [name for name, _ in h.pulumi.calls] == ["init", "up", "outputs"]
    config = h.pulumi.stacks[run.run_id]
    assert config["lab:operator_ip"] == "198.51.100.7"
    assert config["lab:self_terminate_minutes"] == "45"
    assert config["lab:account_id"] == "111111111111"
    tags = json.loads(config["aws:defaultTags"])["tags"]
    assert tags == {"lab": "true", "lab_scenario": "fake-001", "lab_run_id": run.run_id,
                    "lab_expires_at": "2026-10-06T12:30:00+00:00"}
    assert [a["purpose"] for a in run.data["attempts"]] == ["baseline_gate", "fault_gate"]
    assert run.data["baseline"] == {"instances": ["i-1"]}


def test_handover_text_never_names_the_fault(tmp_path):
    h = make_lab(tmp_path)
    run = h.lab.up("fake-001")
    text = h.lab.handover_text(run)
    assert run.sealed_fault() not in text
    assert "endpoint: http://203.0.113.10/health" in text
    assert "README.md" in text


def test_up_refused_while_a_run_is_active(tmp_path):
    h = make_lab(tmp_path)
    h.lab.up("fake-001")
    with pytest.raises(RunError, match="is active"):
        h.lab.up("fake-001")


def test_failed_baseline_aborts_and_tears_down(tmp_path):
    h = make_lab(tmp_path, session=FakeSession({"baseline_ok": False, "broken": set(), "guards_ok": True}))
    with pytest.raises(LabError) as error:
        h.lab.up("fake-001")
    assert error.value.state == "failed_baseline"
    assert "may contain spoilers" in str(error.value)
    assert ("destroy", h.pulumi.calls[0][1]) in h.pulumi.calls
    assert h.lab.store.active() is None


def test_fault_that_does_not_break_aborts(tmp_path):
    world = {"baseline_ok": True, "broken": set(), "guards_ok": True, "fault_is_noop": True}
    h = make_lab(tmp_path, session=FakeSession(world))
    with pytest.raises(LabError) as error:
        h.lab.up("fake-001")
    assert error.value.state == "failed_injection"
    assert h.lab.store.active() is None
    fault = h.lab.store.load(h.pulumi.calls[0][1]).sealed_fault()
    assert fault not in str(error.value)
    assert not any(fault in line for line in h.out)


def test_provision_failure_tears_down(tmp_path):
    h = make_lab(tmp_path, pulumi=FakePulumi(fail_on=("up",)))
    with pytest.raises(LabError) as error:
        h.lab.up("fake-001")
    assert error.value.state == "failed_provision"
    assert [name for name, _ in h.pulumi.calls] == ["init", "up", "refresh", "destroy", "remove"]
    run = h.lab.store.load(h.pulumi.calls[0][1])
    assert run.state == "down"
    assert any(e["type"] == "error" and "fake up failure" in e["message"] for e in run.data["events"])
    assert "fake up failure" not in str(error.value)


def test_failed_up_keeps_lock_when_teardown_is_incomplete(tmp_path):
    h = make_lab(tmp_path, pulumi=FakePulumi(fail_on=("up", "destroy")))
    with pytest.raises(LabError) as error:
        h.lab.up("fake-001")
    assert error.value.state == "failed_provision"
    assert "lab down" in str(error.value)
    active = h.lab.store.active()
    assert active.state == "down_dirty"
    assert [e["attempt"] for e in active.data["events"] if e["type"] == "destroy_failed"] == [1, 2]


def test_failed_up_keeps_lock_when_teardown_raises(tmp_path):
    h = make_lab(tmp_path, pulumi=FakePulumi(fail_on=("up",)))

    def broken_janitor(**kwargs):
        raise RuntimeError("describe_instances exploded")

    h.session.client("ec2").responses["describe_instances"] = broken_janitor
    with pytest.raises(LabError) as error:
        h.lab.up("fake-001")
    assert error.value.state == "failed_provision"
    assert "lab down" in str(error.value)
    active = h.lab.store.active()
    assert active.state == "tearing_down"
    assert any(e["type"] == "teardown_failed" for e in active.data["events"])


def test_down_is_idempotent(tmp_path):
    h = make_lab(tmp_path)
    run = h.lab.up("fake-001")
    assert h.lab.down() is True
    assert h.lab.store.active() is None
    assert h.lab.down() is True
    assert "no active run" in h.out
    assert h.lab.down(run.run_id) is True
    assert h.lab.store.load(run.run_id).state == "down"


def test_down_keeps_lock_when_leftovers_remain(tmp_path):
    h = make_lab(tmp_path)
    h.lab.up("fake-001")
    h.session.clients["ec2"] = FakeClient({"describe_vpcs": {"Vpcs": [{"VpcId": "vpc-left"}]}})
    assert h.lab.down() is False
    active = h.lab.store.active()
    assert active.state == "down_dirty"
    assert active.data["janitor"] == ["eu-central-1 vpcs vpc-left"]
    assert "leftover: eu-central-1 vpcs vpc-left" in h.out


def test_down_keeps_lock_when_destroy_fails(tmp_path):
    h = make_lab(tmp_path)
    run = h.lab.up("fake-001")
    h.pulumi.fail_on.add("destroy")
    assert h.lab.down() is False
    assert h.lab.store.active().state == "down_dirty"
    assert f"leftover: pulumi stack {run.run_id} (destroy failed)" in h.out
    h.pulumi.fail_on.clear()
    assert h.lab.down() is True
    assert h.lab.store.active() is None


def test_down_saves_change_trail(tmp_path):
    h = make_lab(tmp_path)
    run = h.lab.up("fake-001")
    h.session.clients["cloudtrail"] = FakeClient({"lookup_events": {"Events": [{
        "EventName": "ModifyThing", "EventSource": "ec2.amazonaws.com",
        "CloudTrailEvent": json.dumps({"readOnly": False, "eventTime": "2026-10-06T12:10:00Z"}),
    }]}})
    h.lab.down()
    changes = json.loads((run.dir / "changes.json").read_text())
    assert [c["event"] for c in changes] == ["ModifyThing"]
