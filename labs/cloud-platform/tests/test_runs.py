import random
import re
import threading
from datetime import UTC, datetime

import pytest

from labctl.checks import Check
from labctl.runs import RunError, RunStore, new_run_id

NOW = datetime(2026, 10, 6, 12, 0, tzinfo=UTC)


def make_store(tmp_path):
    return RunStore(tmp_path / "runs", tmp_path / "active")


def create(store, run_id="r-1"):
    return store.create(
        run_id=run_id, scenario_id="fake-001", scenario_version=1, now=NOW, ttl_minutes=30,
        nonce="n1", operator_ip="198.51.100.7", git_sha="abc", purpose="solve",
    )


def test_new_run_id_format():
    assert re.fullmatch(r"r-20261006-1200-[0-9a-f]{4}", new_run_id(NOW, random.Random(1)))


def test_create_sets_active_and_persists(tmp_path):
    store = make_store(tmp_path)
    create(store)
    assert store.active().run_id == "r-1"
    loaded = store.load("r-1")
    assert loaded.data["expires_at"] == "2026-10-06T12:30:00+00:00"
    assert loaded.state == "created"


def test_second_create_refused_while_active(tmp_path):
    store = make_store(tmp_path)
    create(store)
    with pytest.raises(RunError, match="r-1 is active"):
        create(store, "r-2")


def test_clear_active_only_for_matching_run(tmp_path):
    store = make_store(tmp_path)
    create(store)
    store.clear_active("other")
    assert store.active() is not None
    store.clear_active("r-1")
    assert store.active() is None


def test_attempts_and_solved(tmp_path):
    store = make_store(tmp_path)
    run = create(store)
    run.add_attempt([Check("h", "outcome", False)], NOW, "fault_gate")
    assert not store.load("r-1").solved
    run.add_attempt([Check("h", "outcome", True)], NOW, "baseline_gate")
    assert not store.load("r-1").solved
    run.add_attempt([Check("h", "outcome", True)], NOW, "solve")
    assert store.load("r-1").solved


def test_seal_round_trip_and_run_json_never_contains_fault(tmp_path):
    store = make_store(tmp_path)
    run = create(store)
    assert run.sealed_fault() is None
    run.seal("break-a", NOW)
    assert run.sealed_fault() == "break-a"
    assert "break-a" not in (run.dir / "run.json").read_text()


def test_set_state_records_event(tmp_path):
    store = make_store(tmp_path)
    run = create(store)
    run.set_state("provisioning", NOW)
    loaded = store.load("r-1")
    assert loaded.state == "provisioning"
    assert loaded.data["events"][-1] == {"at": "2026-10-06T12:00:00+00:00", "type": "state", "state": "provisioning"}


def test_load_unknown_run(tmp_path):
    with pytest.raises(RunError, match="unknown run"):
        make_store(tmp_path).load("r-missing")


def test_lock_held_by_run_without_run_json_still_refuses(tmp_path):
    store = make_store(tmp_path)
    store.active_file.write_text("r-0\n")
    with pytest.raises(RunError, match="r-0 is active"):
        create(store)
    assert store.active_file.read_text() == "r-0\n"
    assert not (store.runs_dir / "r-1").exists()


def test_concurrent_creates_only_one_wins(tmp_path):
    store = make_store(tmp_path)
    barrier = threading.Barrier(8)
    winners, losers = [], []

    def attempt(i):
        barrier.wait()
        try:
            winners.append(create(store, f"r-{i}").run_id)
        except RunError:
            losers.append(i)

    threads = [threading.Thread(target=attempt, args=(i,)) for i in range(8)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert len(winners) == 1
    assert len(losers) == 7
    assert store.active().run_id == winners[0]
    assert [p.name for p in store.runs_dir.iterdir()] == winners


def test_lock_released_when_run_dir_creation_fails(tmp_path):
    store = make_store(tmp_path)
    (store.runs_dir / "r-1").mkdir(parents=True)
    with pytest.raises(FileExistsError):
        create(store)
    assert store.active() is None


def test_lock_released_when_writing_lock_fails(tmp_path, monkeypatch):
    store = make_store(tmp_path)

    def full_disk(*args, **kwargs):
        raise OSError("no space left")

    monkeypatch.setattr("labctl.runs.os.write", full_disk)
    with pytest.raises(OSError, match="no space left"):
        create(store)
    monkeypatch.undo()
    assert not store.active_file.exists()


def test_crash_mid_write_keeps_previous_run_json(tmp_path, monkeypatch):
    store = make_store(tmp_path)
    run = create(store)

    def crash(*args, **kwargs):
        raise OSError("simulated crash")

    monkeypatch.setattr("labctl.runs.os.replace", crash)
    with pytest.raises(OSError, match="simulated crash"):
        run.set_state("provisioning", NOW)
    monkeypatch.undo()
    assert store.load("r-1").state == "created"
    assert sorted(p.name for p in run.dir.iterdir()) == ["run.json"]
