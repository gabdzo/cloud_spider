import pytest

from labctl.checks import all_passed
from labctl.lifecycle import LabError
from tests.fakes import FakeClient, FakeSession
from tests.test_lifecycle import make_lab


def test_validate_fails_until_fixed_then_marks_solved(tmp_path):
    h = make_lab(tmp_path)
    h.lab.up("fake-001")
    assert not all_passed(h.lab.validate())
    h.session.world["broken"].clear()
    assert all_passed(h.lab.validate())
    run = h.lab.store.active()
    assert run.state == "solved"
    assert [a["purpose"] for a in run.data["attempts"]][-2:] == ["solve", "solve"]


def test_validate_without_active_run(tmp_path):
    with pytest.raises(LabError, match="no active run"):
        make_lab(tmp_path).lab.validate()


def test_reveal_requires_pass_unless_giving_up(tmp_path):
    h = make_lab(tmp_path)
    h.lab.up("fake-001")
    with pytest.raises(LabError, match="not solved"):
        h.lab.reveal()
    fault_id, section, notes = h.lab.reveal(give_up=True)
    assert fault_id in {"break-a", "break-b"}
    assert section.startswith(f"## {fault_id}")
    assert notes.read_text().startswith("# Postmortem")
    assert h.lab.store.active().data["revealed_before_pass"] is True


def test_reveal_after_pass_is_not_flagged(tmp_path):
    h = make_lab(tmp_path)
    h.lab.up("fake-001")
    h.session.world["broken"].clear()
    h.lab.validate()
    h.lab.reveal()
    assert h.lab.store.active().data["revealed_before_pass"] is False


def test_status_shows_time_left_and_ip_drift(tmp_path):
    h = make_lab(tmp_path)
    assert h.lab.status() == "no active run"
    h.lab.up("fake-001")
    assert "time left: 30 min" in h.lab.status()
    h.lab.d.operator_ip = lambda: "203.0.113.99"
    assert "your public IP changed (198.51.100.7 -> 203.0.113.99)" in h.lab.status()


def test_shell_runs_users_shell_with_solver_credentials_only(tmp_path):
    h = make_lab(tmp_path)
    h.lab.up("fake-001")
    assert h.lab.shell() == 0
    argv, env = h.shells[-1]
    assert argv == ["/bin/zsh"]
    assert "AWS_PROFILE" not in env
    assert env["AWS_ACCESS_KEY_ID"] == "AKIA"
    assert "AWS_PROFILE" in h.out[-1]


def test_janitor_account_wide_flags_overdue(tmp_path):
    h = make_lab(tmp_path)
    old = [{"Key": "lab", "Value": "true"}, {"Key": "lab_expires_at", "Value": "2000-01-01T00:00:00+00:00"}]
    h.session.clients["ec2"] = FakeClient({
        "describe_regions": {"Regions": [{"RegionName": "eu-central-1"}]},
        "describe_vpcs": lambda **kw: {"Vpcs": [{"VpcId": "vpc-1", "Tags": old}]} if "Filters" in kw else {},
    })
    assert h.lab.janitor() == ["eu-north-1 vpcs vpc-1 (overdue)"]


def test_janitor_account_wide(tmp_path):
    h = make_lab(tmp_path)
    assert h.lab.janitor() == []
    h.session.clients["ec2"] = FakeClient({
        "describe_regions": {"Regions": [{"RegionName": "eu-central-1"}]},
        "describe_nat_gateways": lambda **kw: {} if "Filter" in kw else {"NatGateways": [{"NatGatewayId": "nat-1", "State": "available"}]},
    })
    assert h.lab.janitor() == ["eu-central-1 nat_gateways nat-1"]


def test_selftest_reports_by_number_and_cleans_up(tmp_path):
    h = make_lab(tmp_path)
    assert h.lab.selftest("fake-001") == [(1, True, ""), (2, True, "")]
    assert h.lab.store.active() is None
    assert [name for name, _ in h.pulumi.calls].count("destroy") == 2


def test_selftest_single_fault_and_bad_number(tmp_path):
    h = make_lab(tmp_path)
    assert h.lab.selftest("fake-001", fault_number=2) == [(2, True, "")]
    with pytest.raises(LabError, match="1..2"):
        h.lab.selftest("fake-001", fault_number=3)


def test_selftest_reports_failing_checks_without_naming_the_fault(tmp_path):
    h = make_lab(tmp_path)
    original = h.lab._run_checks

    def guards_break_after_gate(scenario, env):
        # Baseline and fault gates are recorded by now, so this is the post-revert check.
        if len(h.lab.store.active().data["attempts"]) >= 2:
            h.session.world["guards_ok"] = False
        return original(scenario, env)

    h.lab._run_checks = guards_break_after_gate
    results = h.lab.selftest("fake-001", fault_number=1)
    assert results == [(1, False, "after reference fix, failing: guard-ok")]


# ---- spoiler rules ---------------------------------------------------------

FAULT_IDS = ("break-a", "break-b")
LEAKY = "boto: ModifyThing on break-a failed"


def _assert_no_spoilers(*texts):
    for text in texts:
        assert LEAKY not in text
        for fault_id in FAULT_IDS:
            assert fault_id not in text


def test_status_does_not_print_events_or_the_fault(tmp_path):
    h = make_lab(tmp_path)
    h.lab.up("fake-001")
    h.lab.store.active().event("error", h.lab.d.now(), message=LEAKY)
    h.lab.validate()
    _assert_no_spoilers(h.lab.status(), *h.out)


def test_validate_does_not_surface_events_or_the_fault(tmp_path):
    h = make_lab(tmp_path)
    h.lab.up("fake-001")
    h.lab.store.active().event("error", h.lab.d.now(), message=LEAKY)
    checks = h.lab.validate()
    _assert_no_spoilers(*(f"{c.name} {c.kind} {c.detail}" for c in checks), *h.out)


def test_report_failure_does_not_echo_the_trail_error(tmp_path):
    h = make_lab(tmp_path)
    run = h.lab.up("fake-001")

    def leaky_lookup(**kwargs):
        raise RuntimeError(LEAKY)

    h.session.clients["cloudtrail"] = FakeClient({"lookup_events": leaky_lookup})
    with pytest.raises(LabError) as error:
        h.lab.report(run.run_id)
    _assert_no_spoilers(str(error.value), *h.out)
    assert any(LEAKY in e.get("message", "") for e in h.lab.store.load(run.run_id).data["events"])


def test_report_counts_changes(tmp_path):
    h = make_lab(tmp_path)
    run = h.lab.up("fake-001")
    h.session.clients["cloudtrail"] = FakeClient({"lookup_events": {"Events": []}})
    assert h.lab.report(run.run_id) == 0
    assert (run.dir / "changes.json").exists()


def test_selftest_never_names_faults(tmp_path):
    h = make_lab(tmp_path)
    original = h.lab._run_checks

    def explode_after_gate(scenario, env):
        if len(h.lab.store.active().data["attempts"]) >= 2:
            raise RuntimeError(LEAKY)
        return original(scenario, env)

    h.lab._run_checks = explode_after_gate
    results = h.lab.selftest("fake-001")
    assert [(n, ok) for n, ok, _ in results] == [(1, False), (2, False)]
    _assert_no_spoilers(*(detail for _, _, detail in results), *h.out)


def test_selftest_failed_up_reports_state_not_fault(tmp_path):
    world = {"baseline_ok": True, "broken": set(), "guards_ok": True, "fault_is_noop": True}
    h = make_lab(tmp_path, session=FakeSession(world))
    results = h.lab.selftest("fake-001")
    assert results == [(1, False, "failed_injection"), (2, False, "failed_injection")]
    _assert_no_spoilers(*h.out)


def test_selftest_stops_after_dirty_teardown_and_keeps_results(tmp_path):
    h = make_lab(tmp_path)
    original_down = h.lab.down
    h.lab.down = lambda run_id=None: (original_down(run_id), False)[1]
    results = h.lab.selftest("fake-001")
    assert results == [(1, False, "teardown left resources"), (2, False, "skipped: previous teardown incomplete")]


def test_selftest_survives_down_raising(tmp_path):
    h = make_lab(tmp_path)

    def exploding_down(run_id=None):
        raise RuntimeError("throttled")

    h.lab.down = exploding_down
    results = h.lab.selftest("fake-001", fault_number=1)
    assert results == [(1, False, "teardown left resources")]


def test_selftest_interrupt_during_revert_still_tears_down(tmp_path, monkeypatch):
    from labctl.scenario import Fault, Scenario

    h = make_lab(tmp_path)
    real = h.lab._scenario("fake-001").faults()[0]

    def interrupt(env):
        raise KeyboardInterrupt

    monkeypatch.setattr(Scenario, "faults", lambda self: [Fault(real.id, real.inject, interrupt)])
    with pytest.raises(LabError, match="interrupted at fault 1; teardown done"):
        h.lab.selftest("fake-001")
    assert h.lab.store.active() is None
