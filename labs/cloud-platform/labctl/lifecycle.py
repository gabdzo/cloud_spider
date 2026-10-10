from __future__ import annotations

import json
import os
import random
import subprocess
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

from botocore.exceptions import ClientError

from labctl.aws.access import assume_solver, console_url, solver_env
from labctl.aws.janitor import find_leftovers
from labctl.aws.trail import fetch_changes
from labctl.checks import Check, all_passed, outcome_failed_guards_passed
from labctl.config import Settings
from labctl.env import Env
from labctl.pulumi_cli import PulumiError
from labctl.runs import Run, RunStore, new_run_id
from labctl.scenario import Fault, Scenario, load_scenario

POLL_INTERVAL_S = 10
SELF_TERMINATE_GRACE_MINUTES = 15
# New IAM roles take a few seconds to become assumable.
SOLVER_PREFLIGHT_ATTEMPTS = 6
SOLVER_PREFLIGHT_DELAY_S = 5
# IAM list calls can still show a just-deleted role.
JANITOR_RECHECK_DELAY_S = 10
_FAILED_STATE = {
    "provisioning": "failed_provision",
    "baseline_check": "failed_baseline",
    "injecting": "failed_injection",
    "handover_check": "failed_handover",
}

NOTES_TEMPLATE = """# Postmortem

## What I saw

## What I checked, in order

## Root cause

## Fix

## How I would detect this faster next time

## What confused me (feedback for the lab author)
"""


class LabError(Exception):
    def __init__(self, message: str, state: str | None = None):
        super().__init__(message)
        self.state = state


@dataclass
class Deps:
    settings: Settings
    session_factory: Callable[[str, str], Any]
    pulumi_factory: Callable[[Path], Any]
    operator_ip: Callable[[], str]
    rng: random.Random
    now: Callable[[], datetime]
    sleep: Callable[[float], None]
    out: Callable[[str], None]
    git_sha: Callable[[], str]
    environ: dict = field(default_factory=lambda: dict(os.environ))
    run_shell: Callable[[list[str], dict], int] = lambda argv, env: subprocess.call(argv, env=env)


def _skipped(numbered: list) -> list[tuple[int, bool, str]]:
    return [(number, False, "skipped: previous teardown incomplete") for number, _ in numbered]


def author_section(path: Path, fault_id: str) -> str:
    if not path.exists():
        return "(no author notes)"
    lines, capturing = [], False
    for line in path.read_text().splitlines():
        if line.startswith("## "):
            if capturing:
                break
            capturing = line[3:].strip() == fault_id
        if capturing:
            lines.append(line)
    return "\n".join(lines).strip() or "(no author notes for this fault)"


class Lab:
    def __init__(self, deps: Deps):
        self.d = deps
        self.store = RunStore(deps.settings.runs_dir, deps.settings.active_file)

    # ---- helpers -------------------------------------------------------

    def _scenario(self, scenario_id: str) -> Scenario:
        return load_scenario(self.d.settings.scenarios_dir, scenario_id, region=self.d.settings.region_override)

    def _session(self, scenario: Scenario) -> Any:
        return self.d.session_factory(self.d.settings.aws_profile, scenario.region)

    def _env(self, scenario: Scenario, run: Run, session: Any) -> Env:
        return Env(
            run_id=run.run_id,
            nonce=run.data["nonce"],
            region=scenario.region,
            operator_ip=run.data["operator_ip"],
            outputs=run.data["outputs"],
            session=session,
            baseline=run.data["baseline"],
        )

    def _run_checks(self, scenario: Scenario, env: Env) -> list[Check]:
        try:
            return scenario.checks(env)
        except Exception as exc:
            return [Check("validator-error", "outcome", False, f"{type(exc).__name__}: {exc}")]

    def _poll(self, scenario: Scenario, env: Env, predicate, timeout_s: int) -> list[Check]:
        attempts = max(1, timeout_s // POLL_INTERVAL_S + 1)
        checks: list[Check] = []
        for attempt in range(attempts):
            checks = self._run_checks(scenario, env)
            if predicate(checks):
                return checks
            if attempt < attempts - 1:
                self.d.sleep(POLL_INTERVAL_S)
        return checks

    def _stack_config(self, scenario: Scenario, run: Run, account_id: str) -> dict[str, str]:
        tags = {
            "lab": "true",
            "lab_scenario": scenario.id,
            "lab_run_id": run.run_id,
            "lab_expires_at": run.data["expires_at"],
        }
        return {
            "aws:region": scenario.region,
            # Provider config beats static AWS_* keys left in the operator's environment.
            "aws:profile": self.d.settings.aws_profile,
            "aws:defaultTags": json.dumps({"tags": tags}),
            "lab:run_id": run.run_id,
            "lab:nonce": run.data["nonce"],
            "lab:operator_ip": run.data["operator_ip"],
            "lab:self_terminate_minutes": str(scenario.ttl_minutes + SELF_TERMINATE_GRACE_MINUTES),
            "lab:account_id": account_id,
        }

    def _client_factory(self, session: Any) -> Callable[[str, str], Any]:
        return lambda service, region: session.client(service, region_name=region)

    def _save_changes(self, run: Run, session: Any, region: str) -> int | None:
        try:
            changes = fetch_changes(session.client("cloudtrail", region_name=region), run.run_id)
        except Exception as exc:
            run.event("trail_fetch_failed", self.d.now(), message=f"{type(exc).__name__}: {exc}")
            return None
        (run.dir / "changes.json").write_text(json.dumps(changes, indent=2, default=str) + "\n")
        return len(changes)

    # ---- lifecycle -----------------------------------------------------

    def up(self, scenario_id: str, forced_fault: Fault | None = None, purpose: str = "solve") -> Run:
        scenario = self._scenario(scenario_id)
        faults = scenario.faults()
        session = self._session(scenario)
        account_id = session.client("sts").get_caller_identity()["Account"]
        pulumi = self.d.pulumi_factory(scenario.infra_dir)
        operator_ip = self.d.operator_ip()
        now = self.d.now()
        run = self.store.create(
            run_id=new_run_id(now, self.d.rng),
            scenario_id=scenario.id,
            scenario_version=scenario.version,
            now=now,
            ttl_minutes=scenario.ttl_minutes,
            nonce=f"{self.d.rng.getrandbits(64):016x}",
            operator_ip=operator_ip,
            git_sha=self.d.git_sha(),
            purpose=purpose,
        )
        try:
            run.set_state("provisioning", self.d.now())
            pulumi.init(run.run_id, self._stack_config(scenario, run, account_id))
            pulumi.up(run.run_id)
            run.data["outputs"] = pulumi.outputs(run.run_id)
            run.save()

            run.set_state("baseline_check", self.d.now())
            run.data["baseline"] = scenario.baseline(self._env(scenario, run, session))
            run.save()
            env = self._env(scenario, run, session)
            checks = self._poll(scenario, env, all_passed, scenario.baseline_timeout_s)
            run.add_attempt(checks, self.d.now(), "baseline_gate")
            if not all_passed(checks):
                raise LabError("the healthy baseline did not pass validation")

            run.set_state("injecting", self.d.now())
            fault = forced_fault or self.d.rng.choice(faults)
            run.seal(fault.id, self.d.now())
            fault.inject(env)
            checks = self._poll(scenario, env, outcome_failed_guards_passed, scenario.fault_timeout_s)
            run.add_attempt(checks, self.d.now(), "fault_gate")
            if not outcome_failed_guards_passed(checks):
                raise LabError("the injected fault did not break the outcome cleanly")

            run.set_state("handover_check", self.d.now())
            self._preflight_solver(session, run)
        except KeyboardInterrupt:
            run.event("interrupted", self.d.now())
            raise LabError(
                f"{run.state}: run {run.run_id} was interrupted and may still own resources; "
                "run `lab down` to clean up.",
                state=run.state,
            ) from None
        except Exception as exc:
            failed = _FAILED_STATE.get(run.state, "failed_provision")
            message = f"{type(exc).__name__}: {exc}"
            if run.state == "injecting":
                # Errors raised by fault code name the API calls they made.
                (run.dir / "sealed-error.txt").write_text(message + "\n")
                message = "details sealed in sealed-error.txt"
            run.event("error", self.d.now(), message=message)
            run.set_state(failed, self.d.now())
            try:
                clean = self.down(run.run_id)
            except Exception as teardown_exc:
                run = self.store.load(run.run_id)
                run.event("teardown_failed", self.d.now(),
                          message=f"{type(teardown_exc).__name__}: {teardown_exc}")
                clean = False
            outcome = "was aborted and torn down" if clean else (
                "was aborted but teardown is incomplete; run `lab down` to retry"
            )
            raise LabError(
                f"{failed}: run {run.run_id} {outcome}. "
                f"Details in {run.dir / 'run.json'} (may contain spoilers).",
                state=failed,
            ) from None
        run.set_state("handed_over", self.d.now())
        return run

    def _preflight_solver(self, session: Any, run: Run) -> None:
        role_arn = run.data["outputs"].get("solver_role_arn")
        if not role_arn:
            raise LabError("the scenario's infra does not export solver_role_arn")
        for attempt in range(1, SOLVER_PREFLIGHT_ATTEMPTS + 1):
            try:
                assume_solver(session, role_arn, run.run_id)
                return
            except ClientError:
                if attempt == SOLVER_PREFLIGHT_ATTEMPTS:
                    raise
                self.d.sleep(SOLVER_PREFLIGHT_DELAY_S)

    def handover_text(self, run: Run) -> str:
        scenario = self._scenario(run.scenario_id)
        lines = [f"Run {run.run_id} is ready.", f"Brief:   {scenario.readme_path}"]
        lines += [f"{key}: {run.data['outputs'].get(key, '(missing output)')}" for key in scenario.handover]
        lines += [
            f"Expires: {run.data['expires_at']}",
            "Next:    lab shell (or lab console); run lab validate from this terminal, not the solver shell",
        ]
        return "\n".join(lines)

    def down(self, run_id: str | None = None) -> bool:
        run = self.store.load(run_id) if run_id else self.store.active()
        if run is None:
            self.d.out("no active run")
            return True
        scenario = self._scenario(run.scenario_id)
        session = self._session(scenario)
        pulumi = self.d.pulumi_factory(scenario.infra_dir)
        run.set_state("tearing_down", self.d.now())

        try:
            stack_exists = pulumi.stack_exists(run.run_id)
        except PulumiError as exc:
            run.event("stack_ls_failed", self.d.now(), message=str(exc))
            stack_exists = None
        destroyed = stack_exists is False
        if stack_exists:
            try:
                pulumi.refresh(run.run_id)
            except PulumiError as exc:
                run.event("refresh_failed", self.d.now(), message=str(exc))
            destroyed = False
            for attempt in (1, 2):
                try:
                    pulumi.destroy(run.run_id)
                    destroyed = True
                    break
                except PulumiError as exc:
                    run.event("destroy_failed", self.d.now(), attempt=attempt, message=str(exc))
            if destroyed:
                try:
                    pulumi.remove(run.run_id)
                except PulumiError as exc:
                    run.event("stack_rm_failed", self.d.now(), message=str(exc))

        leftovers = find_leftovers(self._client_factory(session), scenario.region, run_id=run.run_id)
        if leftovers:
            self.d.sleep(JANITOR_RECHECK_DELAY_S)
            leftovers = find_leftovers(self._client_factory(session), scenario.region, run_id=run.run_id)
        run.data["janitor"] = leftovers
        run.save()
        self._save_changes(run, session, scenario.region)

        if leftovers or not destroyed:
            run.set_state("down_dirty", self.d.now())
            if stack_exists is None:
                self.d.out(f"leftover: pulumi stack {run.run_id} (could not list stacks; is lab-env.sh sourced?)")
            elif not destroyed:
                self.d.out(f"leftover: pulumi stack {run.run_id} (destroy failed)")
            for line in leftovers:
                self.d.out(f"leftover: {line}")
            return False
        run.set_state("down", self.d.now())
        self.store.clear_active(run.run_id)
        return True

    # ---- solving -------------------------------------------------------

    def _require_active(self) -> Run:
        run = self.store.active()
        if run is None:
            raise LabError("no active run; start one with `lab up <scenario>`")
        return run

    def _require_solvable(self) -> Run:
        run = self._require_active()
        if run.state not in ("handed_over", "solved"):
            raise LabError(f"run {run.run_id} is {run.state}; nothing to solve")
        return run

    def validate(self) -> list[Check]:
        run = self._require_solvable()
        scenario = self._scenario(run.scenario_id)
        checks = self._run_checks(scenario, self._env(scenario, run, self._session(scenario)))
        attempt = run.add_attempt(checks, self.d.now(), "solve")
        if attempt["passed"] and run.state == "handed_over":
            run.set_state("solved", self.d.now())
        return checks

    def reveal(self, give_up: bool = False) -> tuple[str, str, Path]:
        run = self._require_active()
        solved = run.solved
        if not solved:
            if not give_up:
                raise LabError("not solved yet. Keep going, or use `lab reveal --give-up`.")
            run.data["revealed_before_pass"] = True
            run.save()
        fault_id = run.sealed_fault()
        if fault_id is None:
            raise LabError(f"run {run.run_id} has no sealed fault")
        scenario = self._scenario(run.scenario_id)
        notes = run.dir / "notes.md"
        if not notes.exists():
            notes.write_text(NOTES_TEMPLATE)
        run.event("revealed", self.d.now(), before_pass=not solved)
        return fault_id, author_section(scenario.author_path, fault_id), notes

    def status(self) -> str:
        run = self.store.active()
        if run is None:
            return "no active run"
        minutes_left = int((datetime.fromisoformat(run.data["expires_at"]) - self.d.now()).total_seconds() // 60)
        lines = [
            f"run:       {run.run_id} ({run.scenario_id})",
            f"state:     {run.state}",
            f"time left: {minutes_left} min" if minutes_left >= 0 else f"time left: expired {-minutes_left} min ago",
        ]
        solves = [a for a in run.data["attempts"] if a["purpose"] == "solve"]
        if solves:
            lines.append(f"validate:  {len(solves)} attempt(s), last {'PASS' if solves[-1]['passed'] else 'FAIL'}")
        try:
            current_ip = self.d.operator_ip()
        except Exception:
            current_ip = None
        if current_ip and current_ip != run.data["operator_ip"]:
            lines.append(
                f"warning:   your public IP changed ({run.data['operator_ip']} -> {current_ip}); "
                "rules pinned to the old IP will not match"
            )
        return "\n".join(lines)

    def _solver_credentials(self):
        run = self._require_solvable()
        scenario = self._scenario(run.scenario_id)
        role_arn = run.data["outputs"].get("solver_role_arn")
        if not role_arn:
            raise LabError("the scenario's infra does not export solver_role_arn")
        return run, scenario, assume_solver(self._session(scenario), role_arn, run.run_id)

    def shell(self) -> int:
        run, scenario, creds = self._solver_credentials()
        env = solver_env(self.d.environ, creds, scenario.region, run.run_id)
        run.event("shell_opened", self.d.now())
        self.d.out(
            f"Solver shell for {run.run_id}. Credentials expire at {creds.expiration:%H:%M %Z}. "
            "If your shell startup files export AWS_PROFILE, AWS calls in this shell will break. "
            "Type `exit` to leave."
        )
        return self.d.run_shell([self.d.environ.get("SHELL", "/bin/sh")], env)

    def console(self) -> str:
        run, scenario, creds = self._solver_credentials()
        run.event("console_opened", self.d.now())
        return console_url(creds, scenario.region)

    # ---- maintenance ---------------------------------------------------

    def janitor(self, run_id: str | None = None) -> list[str]:
        region = self.d.settings.home_region
        session = self.d.session_factory(self.d.settings.aws_profile, region)
        return find_leftovers(self._client_factory(session), region, run_id=run_id, now=self.d.now())

    def report(self, run_id: str) -> int:
        run = self.store.load(run_id)
        scenario = self._scenario(run.scenario_id)
        count = self._save_changes(run, self._session(scenario), scenario.region)
        if count is None:
            raise LabError("could not fetch the change trail; see the events in run.json")
        return count

    def selftest(self, scenario_id: str, fault_number: int | None = None) -> list[tuple[int, bool, str]]:
        scenario = self._scenario(scenario_id)
        numbered = list(enumerate(scenario.faults(), start=1))
        if fault_number is not None:
            numbered = [(n, f) for n, f in numbered if n == fault_number]
            if not numbered:
                raise LabError(f"fault number must be 1..{len(scenario.fault_ids)}")
        results = []
        for index, (number, fault) in enumerate(numbered):
            try:
                run = self.up(scenario_id, forced_fault=fault, purpose="selftest")
            except LabError as exc:
                if exc.state not in _FAILED_STATE.values():
                    raise
                results.append((number, False, exc.state or "failed"))
                if self.store.active() is not None:
                    results += _skipped(numbered[index + 1:])
                    break
                continue
            result = (number, False, "reference fix raised; see sealed-error.txt")
            interrupted = False
            try:
                env = self._env(scenario, run, self._session(scenario))
                fault.revert(env)
                checks = self._poll(scenario, env, all_passed, scenario.fault_timeout_s)
                run.add_attempt(checks, self.d.now(), "selftest_revert")
                failing = [c.name for c in checks if not c.passed]
                detail = "after reference fix, failing: " + ", ".join(failing) if failing else ""
                result = (number, not failing, detail)
            except KeyboardInterrupt:
                interrupted = True
            except Exception as exc:
                (run.dir / "sealed-error.txt").write_text(f"{type(exc).__name__}: {exc}\n")
                run.event("error", self.d.now(), message="reference fix raised; details sealed in sealed-error.txt")
            finally:
                try:
                    clean = self.down(run.run_id)
                except Exception as teardown_exc:
                    self.store.load(run.run_id).event(
                        "teardown_failed", self.d.now(), message=f"{type(teardown_exc).__name__}: {teardown_exc}",
                    )
                    clean = False
            if interrupted:
                raise LabError(f"selftest interrupted at fault {number}; teardown "
                               + ("done." if clean else "incomplete, run `lab down`."))
            if not clean:
                results.append((number, False, "teardown left resources"))
                results += _skipped(numbered[index + 1:])
                break
            results.append(result)
        return results
