import json

import pytest

from labctl.lifecycle import LabError
from labctl.scenario import Fault
from tests.test_lifecycle import make_lab


def _raise(exc):
    def inject(env):
        raise exc
    return inject


def test_injection_error_is_sealed_out_of_run_json(tmp_path):
    h = make_lab(tmp_path)
    fault = Fault("break-a", _raise(RuntimeError("RevokeSecurityGroupIngress denied")), lambda env: None)
    with pytest.raises(LabError) as error:
        h.lab.up("fake-001", forced_fault=fault)
    assert error.value.state == "failed_injection"
    assert error.value.__cause__ is None
    run = h.lab.store.load(h.pulumi.calls[0][1])
    assert "RevokeSecurityGroupIngress" not in json.dumps(run.data)
    assert "RevokeSecurityGroupIngress" in (run.dir / "sealed-error.txt").read_text()


def test_interrupted_up_keeps_lock_and_points_to_down(tmp_path):
    h = make_lab(tmp_path)
    fault = Fault("break-a", _raise(KeyboardInterrupt()), lambda env: None)
    with pytest.raises(LabError, match="lab down") as error:
        h.lab.up("fake-001", forced_fault=fault)
    assert error.value.__cause__ is None
    assert "break-a" not in str(error.value)
    active = h.lab.store.active()
    assert active.state == "injecting"
    assert any(e["type"] == "interrupted" for e in active.data["events"])


def test_down_with_unreadable_stack_list_stays_dirty(tmp_path):
    h = make_lab(tmp_path)
    h.lab.up("fake-001")

    def broken_stack_ls(stack):
        from labctl.pulumi_cli import PulumiError
        raise PulumiError("stack ls failed")

    h.pulumi.stack_exists = broken_stack_ls
    assert h.lab.down() is False
    active = h.lab.store.active()
    assert active.state == "down_dirty"
    assert any(e["type"] == "stack_ls_failed" for e in active.data["events"])


def _access_denied():
    from botocore.exceptions import ClientError
    return ClientError({"Error": {"Code": "AccessDenied", "Message": "not yet"}}, "AssumeRole")


def test_up_retries_solver_preflight_until_role_is_assumable(tmp_path):
    h = make_lab(tmp_path)
    sts = h.session.client("sts")
    ok = sts.responses["assume_role"]
    calls = []

    def flaky(**kwargs):
        calls.append(kwargs)
        if len(calls) < 3:
            raise _access_denied()
        return ok

    sts.responses["assume_role"] = flaky
    run = h.lab.up("fake-001")
    assert run.state == "handed_over"
    assert len(calls) == 3
    assert calls[0]["RoleSessionName"] == f"run-{run.run_id}"


def test_up_tears_down_when_solver_role_never_assumable(tmp_path):
    h = make_lab(tmp_path)

    def denied(**kwargs):
        raise _access_denied()

    h.session.client("sts").responses["assume_role"] = denied
    with pytest.raises(LabError) as error:
        h.lab.up("fake-001")
    assert error.value.state == "failed_handover"
    assert h.lab.store.active() is None


def test_stack_config_pins_aws_profile(tmp_path):
    h = make_lab(tmp_path)
    run = h.lab.up("fake-001")
    assert h.pulumi.stacks[run.run_id]["aws:profile"] == "test"


def test_down_rechecks_leftovers_once(tmp_path):
    from tests.fakes import FakeClient

    h = make_lab(tmp_path)
    run = h.lab.up("fake-001")
    pages = [{"Roles": [{"RoleName": f"lab-solver-{run.run_id}"}]}]
    iam = FakeClient({"list_roles": lambda **kwargs: pages.pop() if pages else {"Roles": []}})
    h.session.clients["iam"] = iam
    assert h.lab.down() is True
