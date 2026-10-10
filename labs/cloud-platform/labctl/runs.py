from __future__ import annotations

import json
import os
import random
import tempfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Iterable

from labctl.checks import Check, all_passed, to_dicts


class RunError(Exception):
    pass


def new_run_id(now: datetime, rng: random.Random) -> str:
    return f"r-{now:%Y%m%d-%H%M}-{rng.getrandbits(16):04x}"


def _iso(moment: datetime) -> str:
    return moment.isoformat(timespec="seconds")


def _write_json(path: Path, data) -> None:
    text = json.dumps(data, indent=2, sort_keys=True, default=str) + "\n"
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.", suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            f.write(text)
            f.flush()
            os.fsync(f.fileno())
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise


class Run:
    def __init__(self, directory: Path, data: dict):
        self.dir = directory
        self.data = data

    @property
    def run_id(self) -> str:
        return self.data["run_id"]

    @property
    def scenario_id(self) -> str:
        return self.data["scenario"]

    @property
    def state(self) -> str:
        return self.data["state"]

    @property
    def solved(self) -> bool:
        return any(a["purpose"] == "solve" and a["passed"] for a in self.data["attempts"])

    def save(self) -> None:
        _write_json(self.dir / "run.json", self.data)

    def event(self, kind: str, now: datetime, **details) -> None:
        self.data["events"].append({"at": _iso(now), "type": kind, **details})
        self.save()

    def set_state(self, state: str, now: datetime) -> None:
        self.data["state"] = state
        self.event("state", now, state=state)

    def add_attempt(self, checks: Iterable[Check], now: datetime, purpose: str) -> dict:
        checks = list(checks)
        attempt = {"at": _iso(now), "purpose": purpose, "passed": all_passed(checks), "checks": to_dicts(checks)}
        self.data["attempts"].append(attempt)
        self.save()
        return attempt

    def seal(self, fault_id: str, now: datetime) -> None:
        _write_json(self.dir / "sealed.json", {"fault": fault_id, "injected_at": _iso(now)})

    def sealed_fault(self) -> str | None:
        path = self.dir / "sealed.json"
        return json.loads(path.read_text())["fault"] if path.exists() else None


class RunStore:
    def __init__(self, runs_dir: Path, active_file: Path):
        self.runs_dir = runs_dir
        self.active_file = active_file

    def create(self, *, run_id: str, scenario_id: str, scenario_version: int, now: datetime,
               ttl_minutes: int, nonce: str, operator_ip: str, git_sha: str, purpose: str) -> Run:
        run = Run(self.runs_dir / run_id, {
            "run_id": run_id,
            "scenario": scenario_id,
            "scenario_version": scenario_version,
            "purpose": purpose,
            "git_sha": git_sha,
            "state": "created",
            "created_at": _iso(now),
            "expires_at": _iso(now + timedelta(minutes=ttl_minutes)),
            "operator_ip": operator_ip,
            "nonce": nonce,
            "outputs": {},
            "baseline": {},
            "events": [],
            "attempts": [],
            "janitor": [],
            "revealed_before_pass": False,
            "cost_eur": None,
        })
        self._acquire(run_id)
        try:
            run.dir.mkdir(parents=True)
            run.save()
        except BaseException:
            self.active_file.unlink(missing_ok=True)
            raise
        return run

    def _acquire(self, run_id: str) -> None:
        self.active_file.parent.mkdir(parents=True, exist_ok=True)
        try:
            fd = os.open(self.active_file, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o644)
        except FileExistsError:
            try:
                holder = self.active_file.read_text().strip()
            except FileNotFoundError:
                holder = ""
            raise RunError(f"run {holder or '(unknown)'} is active; run `lab down` first") from None
        try:
            os.write(fd, (run_id + "\n").encode())
        except BaseException:
            self.active_file.unlink(missing_ok=True)
            raise
        finally:
            os.close(fd)

    def load(self, run_id: str) -> Run:
        path = self.runs_dir / run_id / "run.json"
        if not path.exists():
            raise RunError(f"unknown run {run_id}")
        return Run(path.parent, json.loads(path.read_text()))

    def active(self) -> Run | None:
        if not self.active_file.exists():
            return None
        return self.load(self.active_file.read_text().strip())

    def clear_active(self, run_id: str) -> None:
        if self.active_file.exists() and self.active_file.read_text().strip() == run_id:
            self.active_file.unlink()
