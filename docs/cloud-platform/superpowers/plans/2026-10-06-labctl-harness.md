# labctl Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `lab` CLI from the [milestone 1 spec](../specs/2026-10-06-sealed-outage-loop-design.md) (sections 3, 7–11). It covers the whole lifecycle (up with baseline and fault gates, solver access, validate, reveal, down, janitor, report, selftest), proven end to end on a non-learning smoke scenario.

**Architecture:**
- The CLI is a single Python package, `labctl`. `lifecycle.Lab` orchestrates. Every outside effect (boto3 session, Pulumi binary, clock, randomness, operator IP, shell) is injected through `Deps`, so the whole lifecycle is unit-tested with fakes.
- Scenarios are directories that follow a convention (`scenario.yaml`, `infra/`, `faults/*.py`, `validate.py`), loaded with importlib.
- AWS-specific code lives only under `labctl/aws/`.

**Tech Stack:** Python 3.12, uv, argparse, boto3, PyYAML, Pulumi CLI (subprocess) plus `pulumi-aws` for scenario programs, pytest.

**Execution order:**
- Tasks 1–12 need no AWS.
- Task 13 needs [platform guardrails](2026-10-06-platform-guardrails.md) Task 5 done.
- This plan assumes platform Task 1 (the `pyproject.toml` and `.venv` scaffold) is done.

**Deviations from the spec's section 11 tree, all small:**
- Added `labctl/config.py` (settings), `labctl/env.py` (the `Env` passed to scenarios), `labctl/lifecycle.py` (orchestration, to keep `cli.py` thin), `labctl/net.py` (operator IP), and `labctl/aws/infra.py` (solver role helper for Pulumi programs).
- Added `scenarios/aws-smoke-001`, a harness test fixture and not a learning lab.
- `scenario.yaml` gains optional `handover`, `baseline_timeout_s`, and `fault_timeout_s`, all read by the CLI.

## Global Constraints

- **Spoilers:** this plan contains no `aws-web-unreachable-001` code. That scenario is planned separately, in its spoiler path. The CLI must never print a fault ID except in `lab reveal`. `lab up` errors point to `run.json` instead of echoing exceptions. `selftest` reports faults by number.
- **Home region:** `eu-central-1`.
- **Solver credentials:** `sts:AssumeRole`, `DurationSeconds=3600`, session name `run-<run_id>`.
- **Solver role name:** `lab-solver-<run_id>`. Boundary `arn:aws:iam::<account>:policy/lab-solver-boundary`.
- **Trust:** account root principal with `ArnLike aws:PrincipalArn arn:aws:iam::<account>:role/aws-reserved/sso.amazonaws.com/*AWSReservedSSO_LabOperator_*`.
- **Tags on every lab resource** (via `aws:defaultTags`): `lab=true`, `lab_scenario`, `lab_run_id`, `lab_expires_at`.
- **Instance self-terminate:** `ttl_minutes + 15`, passed to infra as `lab:self_terminate_minutes`.
- **Run ID:** `r-YYYYMMDD-HHMM-xxxx`, with four lowercase hex characters at the end.
- **State:** `.lab/` (gitignored) holds `runs/<run_id>/run.json`, `sealed.json`, `changes.json`, `notes.md`, the `active` lock file, and `pulumi-state/`.
- **Single active run:** `RunStore.create` refuses while `.lab/active` exists.
- **Settings:** profile from `LAB_AWS_PROFILE` (default `cp-lab`), repo root from `LAB_REPO_ROOT` (default: the package's parent directory).
- **Exit codes:** commands exit 0 on success. `validate`, `down`, `janitor`, and `selftest` exit 1 when not clean. Any handled error exits 1 with `error: …` on stderr.

---

### Task 1: Checks

**Files:**
- Create: `labctl/checks.py`
- Test: `tests/test_checks.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Check(name: str, kind: Literal["outcome","guard"], passed: bool, detail: str = "")`, a frozen dataclass.
  - `all_passed(checks) -> bool`
  - `outcome_failed_guards_passed(checks) -> bool`
  - `format_table(checks) -> str`
  - `to_dicts(checks) -> list[dict]`

- [ ] **Step 1: Write the failing test**

`tests/test_checks.py`:

```python
from labctl.checks import Check, all_passed, format_table, outcome_failed_guards_passed, to_dicts

UP = Check("health", "outcome", True, "200")
DOWN = Check("health", "outcome", False, "timeout")
GUARD_OK = Check("no-world-ssh", "guard", True)
GUARD_BAD = Check("no-world-ssh", "guard", False, "sg-1")


def test_all_passed_requires_every_check_and_at_least_one():
    assert all_passed([UP, GUARD_OK])
    assert not all_passed([UP, GUARD_BAD])
    assert not all_passed([])


def test_fault_gate_needs_a_failed_outcome_and_clean_guards():
    assert outcome_failed_guards_passed([DOWN, GUARD_OK])
    assert not outcome_failed_guards_passed([UP, GUARD_OK])
    assert not outcome_failed_guards_passed([DOWN, GUARD_BAD])
    assert not outcome_failed_guards_passed([GUARD_OK])


def test_format_table_aligns_names():
    assert format_table([UP, GUARD_BAD]).splitlines() == [
        "PASS  outcome  health        200",
        "FAIL  guard    no-world-ssh  sg-1",
    ]


def test_to_dicts():
    assert to_dicts([UP]) == [{"name": "health", "kind": "outcome", "passed": True, "detail": "200"}]
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/test_checks.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'labctl.checks'`.

- [ ] **Step 3: Implement**

`labctl/checks.py`:

```python
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Iterable, Literal

Kind = Literal["outcome", "guard"]


@dataclass(frozen=True)
class Check:
    name: str
    kind: Kind
    passed: bool
    detail: str = ""


def all_passed(checks: Iterable[Check]) -> bool:
    checks = list(checks)
    return bool(checks) and all(c.passed for c in checks)


def outcome_failed_guards_passed(checks: Iterable[Check]) -> bool:
    checks = list(checks)
    outcomes = [c for c in checks if c.kind == "outcome"]
    guards = [c for c in checks if c.kind == "guard"]
    return any(not c.passed for c in outcomes) and all(c.passed for c in guards)


def format_table(checks: Iterable[Check]) -> str:
    checks = list(checks)
    width = max((len(c.name) for c in checks), default=0)
    return "\n".join(
        f"{'PASS' if c.passed else 'FAIL'}  {c.kind:<7}  {c.name:<{width}}  {c.detail}".rstrip()
        for c in checks
    )


def to_dicts(checks: Iterable[Check]) -> list[dict]:
    return [asdict(c) for c in checks]
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/test_checks.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add labctl/checks.py tests/test_checks.py
git commit -m "feat(labctl): Check type and gate predicates"
```

---

### Task 2: Env, scenario loader, test fakes, and the fake scenario fixture

**Files:**
- Create: `labctl/env.py`
- Create: `labctl/scenario.py`
- Create: `tests/fakes.py`
- Create: `tests/fixtures/scenarios/fake-001/scenario.yaml`
- Create: `tests/fixtures/scenarios/fake-001/README.md`
- Create: `tests/fixtures/scenarios/fake-001/AUTHOR.md`
- Create: `tests/fixtures/scenarios/fake-001/infra/.gitkeep`
- Create: `tests/fixtures/scenarios/fake-001/faults/break_a.py`
- Create: `tests/fixtures/scenarios/fake-001/faults/break_b.py`
- Create: `tests/fixtures/scenarios/fake-001/validate.py`
- Test: `tests/test_scenario.py`

**Interfaces:**
- Consumes: `Check` from Task 1.
- Produces:
  - `Env(run_id: str, nonce: str, region: str, operator_ip: str, outputs: dict, session: Any, baseline: dict)`, a frozen dataclass.
  - `Fault(id: str, inject: Callable[[Env], None], revert: Callable[[Env], None])`
  - `Scenario` with fields `path, id, version, provider, region, ttl_minutes, fault_ids: tuple[str, ...], handover: tuple[str, ...], baseline_timeout_s: int, fault_timeout_s: int`; properties `infra_dir, readme_path, author_path`; and methods `faults() -> list[Fault]`, `checks(env) -> list[Check]`, `baseline(env) -> dict`.
  - `load_scenario(scenarios_dir: Path, scenario_id: str) -> Scenario`
  - `ScenarioError`
  - Test helpers: `FakeClient(responses)` (records `.calls` as `(method, kwargs)`; a response value may be a callable taking `**kwargs`), `FakeSession(world=None)` (`.client(service, region_name=None)` caches one `FakeClient` per service; `.world` dict), and `make_env(session, outputs=None) -> Env`.

- [ ] **Step 1: Write the fixture scenario**

`tests/fixtures/scenarios/fake-001/scenario.yaml`:

```yaml
id: fake-001
version: 1
provider: aws
region: eu-central-1
ttl_minutes: 30
faults: [break-a, break-b]
handover: [endpoint]
baseline_timeout_s: 0
fault_timeout_s: 0
```

`tests/fixtures/scenarios/fake-001/README.md`:

```markdown
# fake-001

Test fixture. The fake endpoint is down.
```

`tests/fixtures/scenarios/fake-001/AUTHOR.md`:

```markdown
# fake-001 author notes

## break-a

Fixture fault A.

## break-b

Fixture fault B.
```

`tests/fixtures/scenarios/fake-001/infra/.gitkeep`: empty file.

`tests/fixtures/scenarios/fake-001/faults/break_a.py`:

```python
ID = "break-a"


def inject(env):
    env.session.world["broken"].add(ID)


def revert(env):
    env.session.world["broken"].discard(ID)
```

`tests/fixtures/scenarios/fake-001/faults/break_b.py`:

```python
ID = "break-b"


def inject(env):
    env.session.world["broken"].add(ID)


def revert(env):
    env.session.world["broken"].discard(ID)
```

`tests/fixtures/scenarios/fake-001/validate.py`:

```python
from labctl.checks import Check


def baseline(env):
    return {"instances": ["i-1"]}


def checks(env):
    world = env.session.world
    broken = bool(world["broken"]) and not world.get("fault_is_noop", False)
    healthy = world["baseline_ok"] and not broken
    return [
        Check("endpoint-ok", "outcome", healthy, "fake endpoint"),
        Check("guard-ok", "guard", world["guards_ok"]),
    ]
```

- [ ] **Step 2: Write the test fakes**

`tests/fakes.py`:

```python
from __future__ import annotations

from datetime import UTC, datetime

from labctl.env import Env

DEFAULT_RESPONSES = {
    "sts": {
        "get_caller_identity": {
            "Account": "111111111111",
            "Arn": "arn:aws:sts::111111111111:assumed-role/AWSReservedSSO_LabOperator_abc/me",
        },
        "assume_role": {
            "Credentials": {
                "AccessKeyId": "AKIA",
                "SecretAccessKey": "secret",
                "SessionToken": "token",
                "Expiration": datetime(2026, 10, 6, 13, 0, tzinfo=UTC),
            }
        },
    },
    "ec2": {"describe_regions": {"Regions": [{"RegionName": "eu-central-1"}]}},
    "cloudtrail": {"lookup_events": {"Events": []}},
}


class FakeClient:
    def __init__(self, responses: dict | None = None):
        self.responses = dict(responses or {})
        self.calls: list[tuple[str, dict]] = []

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)

        def method(**kwargs):
            self.calls.append((name, kwargs))
            value = self.responses.get(name, {})
            return value(**kwargs) if callable(value) else value

        return method


class FakeSession:
    def __init__(self, world: dict | None = None):
        self.world = world if world is not None else {"baseline_ok": True, "broken": set(), "guards_ok": True}
        self.clients: dict[str, FakeClient] = {}

    def client(self, service, region_name=None):
        if service not in self.clients:
            self.clients[service] = FakeClient(DEFAULT_RESPONSES.get(service, {}))
        return self.clients[service]


def make_env(session, outputs: dict | None = None) -> Env:
    return Env(
        run_id="r-test",
        nonce="n",
        region="eu-central-1",
        operator_ip="198.51.100.7",
        outputs=outputs or {},
        session=session,
        baseline={},
    )
```

- [ ] **Step 3: Write the failing test**

`tests/test_scenario.py`:

```python
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
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `uv run pytest tests/test_scenario.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'labctl.env'`.

- [ ] **Step 5: Implement**

`labctl/env.py`:

```python
from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Env:
    run_id: str
    nonce: str
    region: str
    operator_ip: str
    outputs: dict
    session: Any
    baseline: dict
```

`labctl/scenario.py`:

```python
from __future__ import annotations

import importlib.util
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any, Callable

import yaml

from labctl.checks import Check

REQUIRED_FIELDS = ("id", "version", "provider", "region", "ttl_minutes", "faults")
SUPPORTED_PROVIDERS = ("aws",)


class ScenarioError(Exception):
    pass


@dataclass(frozen=True)
class Fault:
    id: str
    inject: Callable[[Any], None]
    revert: Callable[[Any], None]


@dataclass(frozen=True)
class Scenario:
    path: Path
    id: str
    version: int
    provider: str
    region: str
    ttl_minutes: int
    fault_ids: tuple[str, ...]
    handover: tuple[str, ...] = ()
    baseline_timeout_s: int = 300
    fault_timeout_s: int = 60

    @property
    def infra_dir(self) -> Path:
        return self.path / "infra"

    @property
    def readme_path(self) -> Path:
        return self.path / "README.md"

    @property
    def author_path(self) -> Path:
        return self.path / "AUTHOR.md"

    def faults(self) -> list[Fault]:
        found: dict[str, Fault] = {}
        for file in sorted((self.path / "faults").glob("*.py")):
            if file.name.startswith("_"):
                continue
            module = _load_module(file, f"{_module_prefix(self.id)}_fault_{file.stem}")
            for attr in ("ID", "inject", "revert"):
                if not hasattr(module, attr):
                    raise ScenarioError(f"{file} is missing {attr}")
            found[module.ID] = Fault(module.ID, module.inject, module.revert)
        if set(found) != set(self.fault_ids):
            raise ScenarioError(
                f"{self.id}: scenario.yaml lists {len(self.fault_ids)} faults but faults/ defines "
                f"{len(found)}, or their IDs differ"
            )
        return [found[fault_id] for fault_id in self.fault_ids]

    def checks(self, env) -> list[Check]:
        return list(self._validator().checks(env))

    def baseline(self, env) -> dict:
        fn = getattr(self._validator(), "baseline", None)
        return dict(fn(env)) if fn else {}

    def _validator(self) -> ModuleType:
        file = self.path / "validate.py"
        if not file.exists():
            raise ScenarioError(f"{self.id}: missing validate.py")
        module = _load_module(file, f"{_module_prefix(self.id)}_validate")
        if not hasattr(module, "checks"):
            raise ScenarioError(f"{file} has no checks(env)")
        return module


def load_scenario(scenarios_dir: Path, scenario_id: str) -> Scenario:
    path = scenarios_dir / scenario_id
    spec_file = path / "scenario.yaml"
    if not spec_file.exists():
        raise ScenarioError(f"unknown scenario {scenario_id} (no {spec_file})")
    raw = yaml.safe_load(spec_file.read_text()) or {}
    missing = [field for field in REQUIRED_FIELDS if field not in raw]
    if missing:
        raise ScenarioError(f"{spec_file}: missing {', '.join(missing)}")
    if raw["id"] != scenario_id:
        raise ScenarioError(f"{spec_file}: id {raw['id']!r} does not match the directory name")
    if raw["provider"] not in SUPPORTED_PROVIDERS:
        raise ScenarioError(f"{spec_file}: provider {raw['provider']!r} is not supported yet")
    return Scenario(
        path=path,
        id=raw["id"],
        version=int(raw["version"]),
        provider=raw["provider"],
        region=raw["region"],
        ttl_minutes=int(raw["ttl_minutes"]),
        fault_ids=tuple(raw["faults"]),
        handover=tuple(raw.get("handover", ())),
        baseline_timeout_s=int(raw.get("baseline_timeout_s", 300)),
        fault_timeout_s=int(raw.get("fault_timeout_s", 60)),
    )


def _module_prefix(scenario_id: str) -> str:
    return "labscenario_" + scenario_id.replace("-", "_")


def _load_module(path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ScenarioError(f"cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `uv run pytest tests/test_scenario.py -v`
Expected: 6 passed.

- [ ] **Step 7: Commit**

```bash
git add labctl/env.py labctl/scenario.py tests/fakes.py tests/fixtures tests/test_scenario.py
git commit -m "feat(labctl): scenario loader, Env, and test fakes"
```

---

### Task 3: Run store

**Files:**
- Create: `labctl/runs.py`
- Test: `tests/test_runs.py`

**Interfaces:**
- Consumes: `Check`, `all_passed`, `to_dicts` from Task 1.
- Produces:
  - `new_run_id(now: datetime, rng: random.Random) -> str`
  - `RunError`
  - `Run` with `.dir: Path`, `.data: dict`, properties `run_id, scenario_id, state, solved`, and methods `save()`, `event(kind, now, **details)`, `set_state(state, now)`, `add_attempt(checks, now, purpose) -> dict`, `seal(fault_id, now)`, `sealed_fault() -> str | None`.
  - `RunStore(runs_dir: Path, active_file: Path)` with `create(*, run_id, scenario_id, scenario_version, now, ttl_minutes, nonce, operator_ip, git_sha, purpose) -> Run`, `load(run_id) -> Run`, `active() -> Run | None`, `clear_active(run_id)`.
  - `run.json` keys: `run_id, scenario, scenario_version, purpose, git_sha, state, created_at, expires_at, operator_ip, nonce, outputs, baseline, events, attempts, janitor, revealed_before_pass, cost_eur`.
  - Attempt purposes used later: `baseline_gate`, `fault_gate`, `solve`, `selftest_revert`.

- [ ] **Step 1: Write the failing test**

`tests/test_runs.py`:

```python
import random
import re
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/test_runs.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'labctl.runs'`.

- [ ] **Step 3: Implement**

`labctl/runs.py`:

```python
from __future__ import annotations

import json
import os
import random
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
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True, default=str) + "\n")
    os.replace(tmp, path)


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
        current = self.active()
        if current is not None:
            raise RunError(f"run {current.run_id} is active; run `lab down` first")
        directory = self.runs_dir / run_id
        directory.mkdir(parents=True)
        run = Run(directory, {
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
        run.save()
        self.active_file.parent.mkdir(parents=True, exist_ok=True)
        self.active_file.write_text(run_id + "\n")
        return run

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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/test_runs.py -v`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add labctl/runs.py tests/test_runs.py
git commit -m "feat(labctl): run store with lock, attempts, and sealed fault"
```

---

### Task 4: Pulumi CLI wrapper

**Files:**
- Create: `labctl/pulumi_cli.py`
- Test: `tests/test_pulumi_cli.py`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `PulumiError`
  - `Pulumi(project_dir: Path, backend_url: str, aws_profile: str, runner=subprocess_runner, environ: Mapping | None = None)` with methods `stack_exists(stack) -> bool`, `init(stack, config: dict[str, str])`, `up(stack)`, `outputs(stack) -> dict`, `refresh(stack)`, `destroy(stack)`, `remove(stack)`.
  - The runner signature is `(argv: list[str], cwd: Path, env: dict) -> subprocess.CompletedProcess`.

- [ ] **Step 1: Write the failing test**

`tests/test_pulumi_cli.py`:

```python
import subprocess
from pathlib import Path

import pytest

from labctl.pulumi_cli import Pulumi, PulumiError

ENV = {"PULUMI_CONFIG_PASSPHRASE": "x", "PATH": "/usr/bin"}


class Recorder:
    def __init__(self, stdout_by_command=None, fail_on=None):
        self.calls = []
        self.stdout_by_command = stdout_by_command or {}
        self.fail_on = fail_on

    def __call__(self, argv, cwd, env):
        self.calls.append((argv, cwd, env))
        code = 1 if self.fail_on and self.fail_on in argv else 0
        stdout = self.stdout_by_command.get(" ".join(argv[1:3]), "")
        return subprocess.CompletedProcess(argv, code, stdout=stdout, stderr="boom" if code else "")


def make(recorder, environ=ENV):
    return Pulumi(Path("/proj"), "file:///state", "cp-lab", runner=recorder, environ=environ)


def test_init_creates_stack_then_sets_all_config_in_one_call():
    rec = Recorder()
    make(rec).init("r-1", {"aws:region": "eu-central-1", "lab:run_id": "r-1"})
    assert rec.calls[0][0] == ["pulumi", "stack", "init", "r-1", "--non-interactive"]
    assert rec.calls[1][0] == [
        "pulumi", "config", "set-all", "--stack", "r-1",
        "--plaintext", "aws:region=eu-central-1", "--plaintext", "lab:run_id=r-1",
    ]
    _, cwd, env = rec.calls[0]
    assert cwd == Path("/proj")
    assert env["PULUMI_BACKEND_URL"] == "file:///state"
    assert env["AWS_PROFILE"] == "cp-lab"
    assert env["PULUMI_CONFIG_PASSPHRASE"] == "x"


def test_up_refresh_destroy_are_non_interactive():
    rec = Recorder()
    p = make(rec)
    p.up("r-1")
    p.refresh("r-1")
    p.destroy("r-1")
    p.remove("r-1")
    assert [c[0] for c in rec.calls] == [
        ["pulumi", "up", "--stack", "r-1", "--yes", "--non-interactive", "--skip-preview"],
        ["pulumi", "refresh", "--stack", "r-1", "--yes", "--non-interactive", "--skip-preview"],
        ["pulumi", "destroy", "--stack", "r-1", "--yes", "--non-interactive", "--skip-preview"],
        ["pulumi", "stack", "rm", "r-1", "--yes", "--non-interactive"],
    ]


def test_outputs_parses_json():
    rec = Recorder({"stack output": '{"sg_id": "sg-1"}'})
    assert make(rec).outputs("r-1") == {"sg_id": "sg-1"}


def test_stack_exists_matches_short_and_qualified_names():
    rec = Recorder({"stack ls": '[{"name": "organization/aws-smoke-001/r-1"}, {"name": "r-2"}]'})
    p = make(rec)
    assert p.stack_exists("r-1")
    assert p.stack_exists("r-2")
    assert not p.stack_exists("r-3")


def test_missing_passphrase_is_a_clear_error():
    with pytest.raises(PulumiError, match="PULUMI_CONFIG_PASSPHRASE"):
        make(Recorder(), environ={"PATH": "/usr/bin"}).up("r-1")


def test_failure_raises_with_stderr():
    with pytest.raises(PulumiError, match="boom"):
        make(Recorder(fail_on="destroy")).destroy("r-1")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/test_pulumi_cli.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'labctl.pulumi_cli'`.

- [ ] **Step 3: Implement**

`labctl/pulumi_cli.py`:

```python
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Callable, Mapping

Runner = Callable[[list[str], Path, dict], subprocess.CompletedProcess]


class PulumiError(Exception):
    pass


def subprocess_runner(argv: list[str], cwd: Path, env: dict) -> subprocess.CompletedProcess:
    return subprocess.run(argv, cwd=cwd, env=env, capture_output=True, text=True, check=False)


class Pulumi:
    def __init__(self, project_dir: Path, backend_url: str, aws_profile: str,
                 runner: Runner = subprocess_runner, environ: Mapping[str, str] | None = None):
        self.project_dir = project_dir
        self.backend_url = backend_url
        self.aws_profile = aws_profile
        self.runner = runner
        self.environ = dict(os.environ if environ is None else environ)

    def _env(self) -> dict:
        if "PULUMI_CONFIG_PASSPHRASE" not in self.environ and "PULUMI_CONFIG_PASSPHRASE_FILE" not in self.environ:
            raise PulumiError("PULUMI_CONFIG_PASSPHRASE is not set. Run `source scripts/lab-env.sh` first.")
        return {
            **self.environ,
            "PULUMI_BACKEND_URL": self.backend_url,
            "AWS_PROFILE": self.aws_profile,
            "PULUMI_SKIP_UPDATE_CHECK": "true",
        }

    def _run(self, *args: str) -> str:
        argv = ["pulumi", *args]
        result = self.runner(argv, self.project_dir, self._env())
        if result.returncode != 0:
            output = (result.stderr or result.stdout or "")[-4000:]
            raise PulumiError(f"`pulumi {' '.join(args[:2])}` failed (exit {result.returncode}):\n{output}")
        return result.stdout

    def stack_exists(self, stack: str) -> bool:
        stacks = json.loads(self._run("stack", "ls", "--json") or "[]")
        return any(entry["name"].split("/")[-1] == stack for entry in stacks)

    def init(self, stack: str, config: dict[str, str]) -> None:
        self._run("stack", "init", stack, "--non-interactive")
        pairs: list[str] = []
        for key, value in config.items():
            pairs += ["--plaintext", f"{key}={value}"]
        self._run("config", "set-all", "--stack", stack, *pairs)

    def up(self, stack: str) -> None:
        self._run("up", "--stack", stack, "--yes", "--non-interactive", "--skip-preview")

    def outputs(self, stack: str) -> dict:
        return json.loads(self._run("stack", "output", "--stack", stack, "--json") or "{}")

    def refresh(self, stack: str) -> None:
        self._run("refresh", "--stack", stack, "--yes", "--non-interactive", "--skip-preview")

    def destroy(self, stack: str) -> None:
        self._run("destroy", "--stack", stack, "--yes", "--non-interactive", "--skip-preview")

    def remove(self, stack: str) -> None:
        self._run("stack", "rm", stack, "--yes", "--non-interactive")
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/test_pulumi_cli.py -v`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add labctl/pulumi_cli.py tests/test_pulumi_cli.py
git commit -m "feat(labctl): pulumi subprocess wrapper"
```

---

### Task 5: Solver access and operator IP

**Files:**
- Create: `labctl/aws/__init__.py` (empty)
- Create: `labctl/aws/access.py`
- Create: `labctl/net.py`
- Create: `tests/aws/__init__.py` (empty)
- Test: `tests/aws/test_access.py`

**Interfaces:**
- Consumes: `FakeSession` from Task 2.
- Produces:
  - `SolverCredentials(access_key_id, secret_access_key, session_token, expiration: datetime)`
  - `session_name(run_id) -> str`, which returns `"run-<run_id>"`
  - `assume_solver(session, role_arn, run_id) -> SolverCredentials`
  - `solver_env(base_env: Mapping, creds, region, run_id) -> dict`
  - `console_url(creds, region, fetch=...) -> str`
  - `labctl.net.operator_ip() -> str`

- [ ] **Step 1: Write the failing test**

`tests/aws/test_access.py`:

```python
import os
import urllib.parse
from datetime import UTC, datetime

from labctl.aws.access import SolverCredentials, assume_solver, console_url, session_name, solver_env
from tests.fakes import FakeSession

CREDS = SolverCredentials("AKIA", "secret", "token", datetime(2026, 10, 6, 13, 0, tzinfo=UTC))


def test_session_name():
    assert session_name("r-1") == "run-r-1"


def test_assume_solver_uses_run_session_name_and_one_hour():
    session = FakeSession()
    creds = assume_solver(session, "arn:aws:iam::111111111111:role/lab-solver-r-1", "r-1")
    assert session.clients["sts"].calls[-1] == ("assume_role", {
        "RoleArn": "arn:aws:iam::111111111111:role/lab-solver-r-1",
        "RoleSessionName": "run-r-1",
        "DurationSeconds": 3600,
    })
    assert creds.access_key_id == "AKIA"
    assert creds.expiration == datetime(2026, 10, 6, 13, 0, tzinfo=UTC)


def test_solver_env_strips_operator_identity_and_config():
    env = solver_env(
        {"AWS_PROFILE": "cp-lab", "AWS_DEFAULT_PROFILE": "cp-lab", "AWS_SESSION_TOKEN": "old", "HOME": "/h"},
        CREDS, "eu-central-1", "r-1",
    )
    assert "AWS_PROFILE" not in env and "AWS_DEFAULT_PROFILE" not in env
    assert env["AWS_ACCESS_KEY_ID"] == "AKIA"
    assert env["AWS_SESSION_TOKEN"] == "token"
    assert env["AWS_REGION"] == "eu-central-1"
    assert env["AWS_CONFIG_FILE"] == os.devnull
    assert env["AWS_SHARED_CREDENTIALS_FILE"] == os.devnull
    assert env["LAB_SOLVER_RUN"] == "r-1"
    assert env["HOME"] == "/h"


def test_console_url_exchanges_a_signin_token():
    seen = []

    def fetch(url):
        seen.append(url)
        return {"SigninToken": "TOKEN"}

    url = console_url(CREDS, "eu-central-1", fetch=fetch)
    assert "Action=getSigninToken" in seen[0]
    assert '"sessionId": "AKIA"' in urllib.parse.unquote(seen[0])
    assert url.startswith("https://signin.aws.amazon.com/federation?Action=login")
    assert "eu-central-1.console.aws.amazon.com" in urllib.parse.unquote(url)
    assert url.endswith("SigninToken=TOKEN")
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/aws/test_access.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'labctl.aws'`.

- [ ] **Step 3: Implement**

`labctl/aws/__init__.py`: empty file.

`labctl/aws/access.py`:

```python
from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Mapping

FEDERATION_URL = "https://signin.aws.amazon.com/federation"
SOLVER_SESSION_SECONDS = 3600
_OPERATOR_VARIABLES = (
    "AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN",
)


@dataclass(frozen=True)
class SolverCredentials:
    access_key_id: str
    secret_access_key: str
    session_token: str
    expiration: datetime


def session_name(run_id: str) -> str:
    return f"run-{run_id}"


def assume_solver(session: Any, role_arn: str, run_id: str) -> SolverCredentials:
    response = session.client("sts").assume_role(
        RoleArn=role_arn,
        RoleSessionName=session_name(run_id),
        DurationSeconds=SOLVER_SESSION_SECONDS,
    )
    c = response["Credentials"]
    return SolverCredentials(c["AccessKeyId"], c["SecretAccessKey"], c["SessionToken"], c["Expiration"])


def solver_env(base_env: Mapping[str, str], creds: SolverCredentials, region: str, run_id: str) -> dict:
    env = {key: value for key, value in base_env.items() if key not in _OPERATOR_VARIABLES}
    env.update({
        "AWS_ACCESS_KEY_ID": creds.access_key_id,
        "AWS_SECRET_ACCESS_KEY": creds.secret_access_key,
        "AWS_SESSION_TOKEN": creds.session_token,
        "AWS_REGION": region,
        "AWS_DEFAULT_REGION": region,
        # No profile fallback: `--profile cp-lab` inside the solver shell fails.
        "AWS_CONFIG_FILE": os.devnull,
        "AWS_SHARED_CREDENTIALS_FILE": os.devnull,
        "LAB_SOLVER_RUN": run_id,
    })
    return env


def _fetch_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.loads(response.read().decode())


def console_url(creds: SolverCredentials, region: str, fetch: Callable[[str], dict] = _fetch_json) -> str:
    session = json.dumps({
        "sessionId": creds.access_key_id,
        "sessionKey": creds.secret_access_key,
        "sessionToken": creds.session_token,
    })
    token = fetch(f"{FEDERATION_URL}?Action=getSigninToken&Session={urllib.parse.quote(session)}")["SigninToken"]
    destination = f"https://{region}.console.aws.amazon.com/ec2/home?region={region}"
    return (
        f"{FEDERATION_URL}?Action=login&Issuer=labctl"
        f"&Destination={urllib.parse.quote(destination, safe='')}&SigninToken={token}"
    )
```

`labctl/net.py`:

```python
from __future__ import annotations

import ipaddress
import urllib.request

CHECKIP_URL = "https://checkip.amazonaws.com"


def operator_ip() -> str:
    with urllib.request.urlopen(CHECKIP_URL, timeout=5) as response:
        ip = response.read().decode().strip()
    return str(ipaddress.IPv4Address(ip))
```

`tests/aws/__init__.py`: empty file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/aws/test_access.py -v`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add labctl/aws/__init__.py labctl/aws/access.py labctl/net.py tests/aws/__init__.py tests/aws/test_access.py
git commit -m "feat(labctl): solver STS access, solver env, console federation URL"
```

---

### Task 6: Janitor

**Files:**
- Create: `labctl/aws/janitor.py`
- Test: `tests/aws/test_janitor.py`

**Interfaces:**
- Consumes: `FakeClient` from Task 2.
- Produces: `find_leftovers(client_factory: Callable[[str, str], client], home_region: str, run_id: str | None = None) -> list[str]`. It returns sorted, de-duplicated lines of the form `"<region> <kind> <id>"` (for example `"eu-central-1 vpcs vpc-1"`, `"global iam_role lab-solver-r-1"`).
- With `run_id`, it scans only resources tagged `lab_run_id=<run_id>` in the home region, plus that run's solver role.
- Without `run_id`, it scans `lab=true` resources in the home region, all `lab-solver-*` roles, and untagged spend (instances, NAT gateways, EIPs, non-default VPCs, load balancers) in every enabled region.

- [ ] **Step 1: Write the failing test**

`tests/aws/test_janitor.py`:

```python
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/aws/test_janitor.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'labctl.aws.janitor'`.

- [ ] **Step 3: Implement**

`labctl/aws/janitor.py`:

```python
from __future__ import annotations

from typing import Any, Callable, Iterator

ClientFactory = Callable[[str, str], Any]

# (describe method, response key, id field, name of the filter parameter)
_TAGGED_EC2 = (
    ("describe_instances", "Reservations", None, "Filters"),
    ("describe_vpcs", "Vpcs", "VpcId", "Filters"),
    ("describe_subnets", "Subnets", "SubnetId", "Filters"),
    ("describe_security_groups", "SecurityGroups", "GroupId", "Filters"),
    ("describe_internet_gateways", "InternetGateways", "InternetGatewayId", "Filters"),
    ("describe_route_tables", "RouteTables", "RouteTableId", "Filters"),
    ("describe_network_acls", "NetworkAcls", "NetworkAclId", "Filters"),
    ("describe_network_interfaces", "NetworkInterfaces", "NetworkInterfaceId", "Filters"),
    ("describe_addresses", "Addresses", "AllocationId", "Filters"),
    ("describe_nat_gateways", "NatGateways", "NatGatewayId", "Filter"),
)


def _live_instances(response: dict) -> Iterator[str]:
    for reservation in response.get("Reservations", []):
        for instance in reservation.get("Instances", []):
            if instance.get("State", {}).get("Name") != "terminated":
                yield instance["InstanceId"]


def _tag_filter(run_id: str | None) -> list[dict]:
    if run_id:
        return [{"Name": "tag:lab_run_id", "Values": [run_id]}]
    return [{"Name": "tag:lab", "Values": ["true"]}]


def _tagged_in_region(ec2: Any, region: str, run_id: str | None) -> list[str]:
    found = []
    filters = _tag_filter(run_id)
    for method, key, id_field, filter_param in _TAGGED_EC2:
        response = getattr(ec2, method)(**{filter_param: filters})
        if key == "Reservations":
            ids = list(_live_instances(response))
        else:
            ids = [item[id_field] for item in response.get(key, []) if item.get("State") != "deleted"]
        kind = method.removeprefix("describe_")
        found += [f"{region} {kind} {resource_id}" for resource_id in ids]
    return found


def _untagged_everywhere(client_factory: ClientFactory, home_region: str) -> list[str]:
    regions = [r["RegionName"] for r in client_factory("ec2", home_region).describe_regions().get("Regions", [])]
    found = []
    for region in regions:
        ec2 = client_factory("ec2", region)
        found += [f"{region} instances {i}" for i in _live_instances(ec2.describe_instances())]
        found += [
            f"{region} nat_gateways {n['NatGatewayId']}"
            for n in ec2.describe_nat_gateways().get("NatGateways", [])
            if n.get("State") != "deleted"
        ]
        found += [
            f"{region} addresses {a.get('AllocationId', a.get('PublicIp'))}"
            for a in ec2.describe_addresses().get("Addresses", [])
        ]
        found += [f"{region} vpcs {v['VpcId']}" for v in ec2.describe_vpcs().get("Vpcs", []) if not v.get("IsDefault")]
        found += [
            f"{region} load_balancers {lb['LoadBalancerName']}"
            for lb in client_factory("elbv2", region).describe_load_balancers().get("LoadBalancers", [])
        ]
    return found


def _solver_roles(iam: Any, run_id: str | None) -> list[str]:
    prefix = f"lab-solver-{run_id}" if run_id else "lab-solver-"
    return [f"global iam_role {r['RoleName']}" for r in iam.list_roles().get("Roles", []) if r["RoleName"].startswith(prefix)]


def find_leftovers(client_factory: ClientFactory, home_region: str, run_id: str | None = None) -> list[str]:
    found = _tagged_in_region(client_factory("ec2", home_region), home_region, run_id)
    found += _solver_roles(client_factory("iam", home_region), run_id)
    if run_id is None:
        found += _untagged_everywhere(client_factory, home_region)
    return sorted(set(found))
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/aws/test_janitor.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add labctl/aws/janitor.py tests/aws/test_janitor.py
git commit -m "feat(labctl): janitor for run-scoped and account-wide leftovers"
```

---

### Task 7: CloudTrail change trail

**Files:**
- Create: `labctl/aws/trail.py`
- Test: `tests/aws/test_trail.py`

**Interfaces:**
- Consumes: `session_name` from Task 5, `FakeClient` from Task 2.
- Produces: `fetch_changes(cloudtrail_client, run_id) -> list[dict]`. Each dict has keys `time, event, source, error, request`. The list is sorted by time and holds only non-read-only events.

- [ ] **Step 1: Write the failing test**

`tests/aws/test_trail.py`:

```python
import json

from labctl.aws.trail import fetch_changes
from tests.fakes import FakeClient


def event(name, read_only, time):
    return {
        "EventName": name,
        "EventSource": "ec2.amazonaws.com",
        "CloudTrailEvent": json.dumps({
            "readOnly": read_only,
            "eventTime": time,
            "requestParameters": {"groupId": "sg-1"},
        }),
    }


def test_keeps_only_mutations_sorted_across_pages():
    pages = {
        None: {"Events": [
            event("DescribeVpcs", True, "2026-10-06T12:05:00Z"),
            event("ModifyThing", False, "2026-10-06T12:10:00Z"),
        ], "NextToken": "p2"},
        "p2": {"Events": [event("CreateThing", False, "2026-10-06T12:07:00Z")]},
    }
    client = FakeClient({"lookup_events": lambda **kwargs: pages[kwargs.get("NextToken")]})
    changes = fetch_changes(client, "r-1")
    assert [c["event"] for c in changes] == ["CreateThing", "ModifyThing"]
    assert changes[0] == {
        "time": "2026-10-06T12:07:00Z",
        "event": "CreateThing",
        "source": "ec2.amazonaws.com",
        "error": None,
        "request": {"groupId": "sg-1"},
    }
    assert client.calls[0][1]["LookupAttributes"] == [{"AttributeKey": "Username", "AttributeValue": "run-r-1"}]
    assert len(client.calls) == 2
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/aws/test_trail.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'labctl.aws.trail'`.

- [ ] **Step 3: Implement**

`labctl/aws/trail.py`:

```python
from __future__ import annotations

import json
from typing import Any

from labctl.aws.access import session_name


def fetch_changes(cloudtrail: Any, run_id: str) -> list[dict]:
    kwargs: dict = {
        "LookupAttributes": [{"AttributeKey": "Username", "AttributeValue": session_name(run_id)}],
        "MaxResults": 50,
    }
    changes = []
    while True:
        response = cloudtrail.lookup_events(**kwargs)
        for event in response.get("Events", []):
            detail = json.loads(event["CloudTrailEvent"])
            if detail.get("readOnly", False):
                continue
            changes.append({
                "time": detail.get("eventTime"),
                "event": event["EventName"],
                "source": event.get("EventSource"),
                "error": detail.get("errorCode"),
                "request": detail.get("requestParameters"),
            })
        token = response.get("NextToken")
        if not token:
            break
        kwargs["NextToken"] = token
    return sorted(changes, key=lambda change: change["time"] or "")
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/aws/test_trail.py -v`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add labctl/aws/trail.py tests/aws/test_trail.py
git commit -m "feat(labctl): fetch solver change trail from CloudTrail event history"
```

---

### Task 8: Settings and lifecycle up and down

**Files:**
- Create: `labctl/config.py`
- Create: `labctl/lifecycle.py`
- Modify: `tests/fakes.py` (append `FakePulumi`)
- Test: `tests/test_lifecycle.py`

**Interfaces:**
- Consumes: everything from Tasks 1–7.
- Produces:
  - `Settings(scenarios_dir: Path, state_dir: Path, aws_profile: str, home_region: str = "eu-central-1")` with properties `runs_dir`, `active_file`, `pulumi_backend_url`.
  - `load_settings(environ=os.environ) -> Settings` and `REPO_ROOT`.
  - `LabError(message, state=None)` with `.state`.
  - `Deps(settings, session_factory(profile, region), pulumi_factory(project_dir), operator_ip(), rng, now(), sleep(seconds), out(str), git_sha(), environ: dict, run_shell(argv, env) -> int)`.
  - `Lab(deps)` with `.store: RunStore`, `.d: Deps`, and in this task `up(scenario_id, forced_fault=None, purpose="solve") -> Run`, `down(run_id=None) -> bool`, `handover_text(run) -> str`.
  - `author_section(path, fault_id) -> str`
  - Run states: `created → provisioning → baseline_check → injecting → handed_over → solved`; failure states `failed_provision | failed_baseline | failed_injection`; teardown states `tearing_down → down | down_dirty`.
  - Stack config keys: `aws:region`, `aws:defaultTags` (a JSON string `{"tags": {...}}`), `lab:run_id`, `lab:nonce`, `lab:operator_ip`, `lab:self_terminate_minutes`, `lab:account_id`.

- [ ] **Step 1: Append `FakePulumi` to `tests/fakes.py`**

```python
from labctl.pulumi_cli import PulumiError


class FakePulumi:
    def __init__(self, outputs: dict | None = None, fail_on: tuple[str, ...] = ()):
        self.stacks: dict[str, dict] = {}
        self.calls: list[tuple[str, str]] = []
        self.outputs_value = outputs or {
            "endpoint": "http://203.0.113.10/health",
            "solver_role_arn": "arn:aws:iam::111111111111:role/lab-solver-x",
        }
        self.fail_on = set(fail_on)

    def _call(self, name: str, stack: str) -> None:
        self.calls.append((name, stack))
        if name in self.fail_on:
            raise PulumiError(f"fake {name} failure")

    def stack_exists(self, stack):
        return stack in self.stacks

    def init(self, stack, config):
        self._call("init", stack)
        self.stacks[stack] = dict(config)

    def up(self, stack):
        self._call("up", stack)

    def outputs(self, stack):
        self._call("outputs", stack)
        return dict(self.outputs_value)

    def refresh(self, stack):
        self._call("refresh", stack)

    def destroy(self, stack):
        self._call("destroy", stack)

    def remove(self, stack):
        self._call("remove", stack)
        self.stacks.pop(stack, None)
```

- [ ] **Step 2: Write the failing tests**

`tests/test_lifecycle.py`:

```python
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


def test_provision_failure_tears_down(tmp_path):
    h = make_lab(tmp_path, pulumi=FakePulumi(fail_on=("up",)))
    with pytest.raises(LabError) as error:
        h.lab.up("fake-001")
    assert error.value.state == "failed_provision"
    assert [name for name, _ in h.pulumi.calls] == ["init", "up", "refresh", "destroy", "remove"]


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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `uv run pytest tests/test_lifecycle.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'labctl.config'`.

- [ ] **Step 4: Implement `labctl/config.py`**

```python
from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

REPO_ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Settings:
    scenarios_dir: Path
    state_dir: Path
    aws_profile: str
    home_region: str = "eu-central-1"

    @property
    def runs_dir(self) -> Path:
        return self.state_dir / "runs"

    @property
    def active_file(self) -> Path:
        return self.state_dir / "active"

    @property
    def pulumi_backend_url(self) -> str:
        return f"file://{self.state_dir / 'pulumi-state'}"


def load_settings(environ: Mapping[str, str] = os.environ) -> Settings:
    root = Path(environ.get("LAB_REPO_ROOT", str(REPO_ROOT)))
    return Settings(
        scenarios_dir=root / "scenarios",
        state_dir=root / ".lab",
        aws_profile=environ.get("LAB_AWS_PROFILE", "cp-lab"),
    )
```

- [ ] **Step 5: Implement `labctl/lifecycle.py`**

```python
from __future__ import annotations

import json
import os
import random
import subprocess
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

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
_FAILED_STATE = {
    "provisioning": "failed_provision",
    "baseline_check": "failed_baseline",
    "injecting": "failed_injection",
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
        return load_scenario(self.d.settings.scenarios_dir, scenario_id)

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
        except Exception as exc:
            failed = _FAILED_STATE.get(run.state, "failed_provision")
            run.event("error", self.d.now(), message=f"{type(exc).__name__}: {exc}")
            run.set_state(failed, self.d.now())
            self.down(run.run_id)
            raise LabError(
                f"{failed}: run {run.run_id} was aborted and torn down. "
                f"Details in {run.dir / 'run.json'} (may contain spoilers).",
                state=failed,
            ) from exc
        run.set_state("handed_over", self.d.now())
        return run

    def handover_text(self, run: Run) -> str:
        scenario = self._scenario(run.scenario_id)
        lines = [f"Run {run.run_id} is ready.", f"Brief:   {scenario.readme_path}"]
        lines += [f"{key}: {run.data['outputs'].get(key, '(missing output)')}" for key in scenario.handover]
        lines += [
            f"Expires: {run.data['expires_at']}",
            "Next:    lab shell (or lab console), then lab validate",
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

        if pulumi.stack_exists(run.run_id):
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
        run.data["janitor"] = leftovers
        run.save()
        self._save_changes(run, session, scenario.region)

        if leftovers:
            run.set_state("down_dirty", self.d.now())
            for line in leftovers:
                self.d.out(f"leftover: {line}")
            return False
        run.set_state("down", self.d.now())
        self.store.clear_active(run.run_id)
        return True
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `uv run pytest tests/test_lifecycle.py -v`
Expected: 9 passed.

- [ ] **Step 7: Run the whole suite**

Run: `uv run pytest -q`
Expected: all tests pass.

- [ ] **Step 8: Commit**

```bash
git add labctl/config.py labctl/lifecycle.py tests/fakes.py tests/test_lifecycle.py
git commit -m "feat(labctl): lifecycle up with baseline and fault gates, idempotent down"
```

---

### Task 9: Lifecycle validate, reveal, status, shell, console, janitor, report, selftest

**Files:**
- Modify: `labctl/lifecycle.py` (add an import and methods on `Lab`)
- Test: `tests/test_lifecycle_solve.py`

**Interfaces:**
- Consumes: `Lab`, `Deps`, and `LabError` from Task 8. `assume_solver`, `console_url`, `solver_env` from Task 5.
- Produces these `Lab` methods:
  - `validate() -> list[Check]`
  - `reveal(give_up=False) -> tuple[str, str, Path]`, returning the fault ID, the author section, and the notes path.
  - `status() -> str`
  - `shell() -> int`
  - `console() -> str`
  - `janitor(run_id=None) -> list[str]`
  - `report(run_id) -> int`
  - `selftest(scenario_id, fault_number=None) -> list[tuple[int, bool, str]]`

- [ ] **Step 1: Write the failing tests**

`tests/test_lifecycle_solve.py`:

```python
import pytest

from labctl.checks import all_passed
from labctl.lifecycle import LabError
from tests.fakes import FakeClient
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `uv run pytest tests/test_lifecycle_solve.py -v`
Expected: FAIL with `AttributeError: 'Lab' object has no attribute 'validate'`.

- [ ] **Step 3: Implement**

Add to the imports at the top of `labctl/lifecycle.py`:

```python
from labctl.aws.access import assume_solver, console_url, solver_env
```

Add these methods to `class Lab`, after `down`:

```python
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
        return find_leftovers(self._client_factory(session), region, run_id=run_id)

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
        for number, fault in numbered:
            try:
                run = self.up(scenario_id, forced_fault=fault, purpose="selftest")
            except LabError as exc:
                results.append((number, False, exc.state or "failed"))
                continue
            result = (number, False, "reference fix raised; see run.json")
            try:
                env = self._env(scenario, run, self._session(scenario))
                fault.revert(env)
                checks = self._poll(scenario, env, all_passed, scenario.fault_timeout_s)
                run.add_attempt(checks, self.d.now(), "selftest_revert")
                failing = [c.name for c in checks if not c.passed]
                detail = "after reference fix, failing: " + ", ".join(failing) if failing else ""
                result = (number, not failing, detail)
            except Exception as exc:
                run.event("error", self.d.now(), message=f"{type(exc).__name__}: {exc}")
            if not self.down(run.run_id):
                result = (number, False, "teardown left resources")
            results.append(result)
        return results
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_lifecycle_solve.py tests/test_lifecycle.py -v`
Expected: all passed.

- [ ] **Step 5: Commit**

```bash
git add labctl/lifecycle.py tests/test_lifecycle_solve.py
git commit -m "feat(labctl): validate, reveal, status, solver shell/console, janitor, report, selftest"
```

---

### Task 10: CLI

**Files:**
- Create: `labctl/cli.py`
- Test: `tests/test_cli.py`

**Interfaces:**
- Consumes: `Lab`, `Deps`, `LabError` (Tasks 8–9); `load_settings`, `REPO_ROOT` (Task 8); `Pulumi`, `PulumiError` (Task 4); `operator_ip` (Task 5); `RunError`, `ScenarioError`, `format_table`, `all_passed`.
- Produces: `main(argv=None, lab_factory=None) -> int` and `build_deps() -> Deps`. The console script is `lab` (already declared in `pyproject.toml`).

- [ ] **Step 1: Write the failing test**

`tests/test_cli.py`:

```python
from pathlib import Path

from labctl.checks import Check
from labctl.cli import main
from labctl.lifecycle import LabError


class FakeLab:
    def __init__(self, checks=None, error=None):
        self.checks = checks or []
        self.error = error

    def validate(self):
        if self.error:
            raise self.error
        return self.checks

    def selftest(self, scenario, fault_number):
        return [(1, True, ""), (2, False, "after reference fix, failing: endpoint-ok")]

    def janitor(self, run_id):
        return []

    def reveal(self, give_up):
        return "some-fault", "## some-fault\nnotes", Path("/tmp/notes.md")


def test_validate_exit_codes(capsys):
    assert main(["validate"], lab_factory=lambda: FakeLab([Check("h", "outcome", True)])) == 0
    assert "SOLVED" in capsys.readouterr().out
    assert main(["validate"], lab_factory=lambda: FakeLab([Check("h", "outcome", False)])) == 1
    assert "Not yet" in capsys.readouterr().out


def test_selftest_prints_numbers_not_names(capsys):
    assert main(["selftest", "fake-001"], lab_factory=FakeLab) == 1
    assert capsys.readouterr().out.splitlines() == [
        "fault 1: PASS",
        "fault 2: FAIL  after reference fix, failing: endpoint-ok",
    ]


def test_janitor_clean(capsys):
    assert main(["janitor"], lab_factory=FakeLab) == 0
    assert capsys.readouterr().out.strip() == "clean"


def test_reveal_give_up_flag(capsys):
    assert main(["reveal", "--give-up"], lab_factory=FakeLab) == 0
    assert "Cause: some-fault" in capsys.readouterr().out


def test_lab_errors_become_exit_1(capsys):
    assert main(["validate"], lab_factory=lambda: FakeLab(error=LabError("no active run"))) == 1
    assert capsys.readouterr().err.strip() == "error: no active run"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/test_cli.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'labctl.cli'`.

- [ ] **Step 3: Implement**

`labctl/cli.py`:

```python
from __future__ import annotations

import argparse
import random
import subprocess
import sys
import time
from datetime import UTC, datetime

import boto3
from botocore.exceptions import BotoCoreError, ClientError

from labctl.checks import all_passed, format_table
from labctl.config import REPO_ROOT, load_settings
from labctl.lifecycle import Deps, Lab, LabError
from labctl.net import operator_ip
from labctl.pulumi_cli import Pulumi, PulumiError
from labctl.runs import RunError
from labctl.scenario import ScenarioError


def _git_sha() -> str:
    result = subprocess.run(["git", "rev-parse", "--short", "HEAD"], cwd=REPO_ROOT, capture_output=True, text=True)
    return result.stdout.strip() or "unknown"


def build_deps() -> Deps:
    settings = load_settings()
    (settings.state_dir / "pulumi-state").mkdir(parents=True, exist_ok=True)
    return Deps(
        settings=settings,
        session_factory=lambda profile, region: boto3.Session(profile_name=profile, region_name=region),
        pulumi_factory=lambda project_dir: Pulumi(project_dir, settings.pulumi_backend_url, settings.aws_profile),
        operator_ip=operator_ip,
        rng=random.SystemRandom(),
        now=lambda: datetime.now(UTC),
        sleep=time.sleep,
        out=print,
        git_sha=_git_sha,
    )


def cmd_up(lab, args) -> int:
    run = lab.up(args.scenario)
    print(lab.handover_text(run))
    return 0


def cmd_shell(lab, args) -> int:
    return lab.shell()


def cmd_console(lab, args) -> int:
    print("Open this in a private browser window. It signs you in as the solver for up to 1 hour:")
    print(lab.console())
    return 0


def cmd_status(lab, args) -> int:
    print(lab.status())
    return 0


def cmd_validate(lab, args) -> int:
    checks = lab.validate()
    print(format_table(checks))
    passed = all_passed(checks)
    print("\nSOLVED. Run `lab reveal`, then `lab down`." if passed else "\nNot yet.")
    return 0 if passed else 1


def cmd_reveal(lab, args) -> int:
    fault_id, section, notes = lab.reveal(give_up=args.give_up)
    print(f"Cause: {fault_id}\n")
    print(section)
    print(f"\nWrite your postmortem in {notes}")
    return 0


def cmd_down(lab, args) -> int:
    clean = lab.down(args.run_id)
    print("Torn down. Nothing left." if clean else "Teardown left resources (listed above). Run `lab down` again.")
    return 0 if clean else 1


def cmd_janitor(lab, args) -> int:
    leftovers = lab.janitor(args.run_id)
    for line in leftovers:
        print(line)
    print("clean" if not leftovers else f"{len(leftovers)} leftover(s)")
    return 0 if not leftovers else 1


def cmd_report(lab, args) -> int:
    print(f"{lab.report(args.run_id)} change(s) saved")
    return 0


def cmd_selftest(lab, args) -> int:
    results = lab.selftest(args.scenario, args.fault)
    for number, ok, detail in results:
        print(f"fault {number}: {'PASS' if ok else 'FAIL'}" + (f"  {detail}" if detail else ""))
    return 0 if results and all(ok for _, ok, _ in results) else 1


COMMANDS = {
    "up": cmd_up, "shell": cmd_shell, "console": cmd_console, "status": cmd_status,
    "validate": cmd_validate, "reveal": cmd_reveal, "down": cmd_down, "janitor": cmd_janitor,
    "report": cmd_report, "selftest": cmd_selftest,
}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="lab", description="Sealed outage lab loop")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("up", help="build, prove healthy, inject a hidden fault, hand over").add_argument("scenario")
    sub.add_parser("shell", help="subshell with 1h solver credentials")
    sub.add_parser("console", help="AWS console sign-in URL for the solver")
    sub.add_parser("status", help="active run, time left, IP drift")
    sub.add_parser("validate", help="run outcome and guard checks")
    sub.add_parser("reveal", help="show the cause (after a pass)").add_argument("--give-up", action="store_true")
    sub.add_parser("down", help="idempotent teardown").add_argument("run_id", nargs="?")
    sub.add_parser("janitor", help="list leftovers").add_argument("--run-id")
    sub.add_parser("report", help="re-fetch the solver change trail").add_argument("run_id")
    selftest = sub.add_parser("selftest", help="every fault: inject, fail, reference fix, pass")
    selftest.add_argument("scenario")
    selftest.add_argument("--fault", type=int, help="fault number (1-based)")
    return parser


def main(argv: list[str] | None = None, lab_factory=None) -> int:
    args = build_parser().parse_args(argv)
    lab = (lab_factory or (lambda: Lab(build_deps())))()
    try:
        return COMMANDS[args.command](lab, args)
    except (LabError, RunError, ScenarioError, PulumiError) as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except (BotoCoreError, ClientError) as exc:
        print(f"error: AWS call failed: {exc}\nIs your SSO session valid? `aws sso login --profile cp-lab`", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_cli.py -v`
Expected: 5 passed.

- [ ] **Step 5: Check that the entry point is installed**

Run: `uv sync && uv run lab --help`
Expected: usage text listing the 10 commands.

- [ ] **Step 6: Commit**

```bash
git add labctl/cli.py tests/test_cli.py
git commit -m "feat(labctl): lab CLI entry point"
```

---

### Task 11: Solver role helper for Pulumi programs

**Files:**
- Create: `labctl/aws/infra.py`
- Test: `tests/aws/test_infra.py`

**Interfaces:**
- Consumes: the stack config keys from Task 8 (`lab:run_id`, `lab:nonce`, `lab:operator_ip`, `lab:self_terminate_minutes`, `lab:account_id`, `aws:region`).
- Produces:
  - `LabConfig(run_id, nonce, operator_ip, self_terminate_minutes: int, account_id, region)` with `LabConfig.load()` (Pulumi programs only).
  - `solver_role_name(run_id)`, `boundary_arn(account_id)`, `trust_policy(account_id) -> dict`, `run_tagged_statement(actions, resources, run_id) -> dict`.
  - `solver_role(lab, statements) -> aws.iam.Role`, a Pulumi resource named `solver`. The program must export its `.arn` as `solver_role_arn`.

- [ ] **Step 1: Write the failing test**

`tests/aws/test_infra.py`:

```python
from labctl.aws.infra import boundary_arn, run_tagged_statement, solver_role_name, trust_policy


def test_names():
    assert solver_role_name("r-1") == "lab-solver-r-1"
    assert boundary_arn("111111111111") == "arn:aws:iam::111111111111:policy/lab-solver-boundary"


def test_trust_policy_only_admits_the_lab_operator_sso_role():
    (statement,) = trust_policy("111111111111")["Statement"]
    assert statement["Principal"] == {"AWS": "arn:aws:iam::111111111111:root"}
    assert statement["Action"] == "sts:AssumeRole"
    assert statement["Condition"] == {"ArnLike": {
        "aws:PrincipalArn": "arn:aws:iam::111111111111:role/aws-reserved/sso.amazonaws.com/*AWSReservedSSO_LabOperator_*",
    }}


def test_run_tagged_statement():
    assert run_tagged_statement(["ec2:DoThing"], ["arn:aws:ec2:eu-central-1:1:thing/*"], "r-1") == {
        "Effect": "Allow",
        "Action": ["ec2:DoThing"],
        "Resource": ["arn:aws:ec2:eu-central-1:1:thing/*"],
        "Condition": {"StringEquals": {"aws:ResourceTag/lab_run_id": "r-1"}},
    }
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/aws/test_infra.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'labctl.aws.infra'`.

- [ ] **Step 3: Implement**

`labctl/aws/infra.py`:

```python
from __future__ import annotations

import json
from dataclasses import dataclass

BOUNDARY_NAME = "lab-solver-boundary"
OPERATOR_ROLE_PATTERN = "arn:aws:iam::{account}:role/aws-reserved/sso.amazonaws.com/*AWSReservedSSO_LabOperator_*"


def solver_role_name(run_id: str) -> str:
    return f"lab-solver-{run_id}"


def boundary_arn(account_id: str) -> str:
    return f"arn:aws:iam::{account_id}:policy/{BOUNDARY_NAME}"


def trust_policy(account_id: str) -> dict:
    return {
        "Version": "2012-10-17",
        "Statement": [{
            "Effect": "Allow",
            "Principal": {"AWS": f"arn:aws:iam::{account_id}:root"},
            "Action": "sts:AssumeRole",
            "Condition": {"ArnLike": {"aws:PrincipalArn": OPERATOR_ROLE_PATTERN.format(account=account_id)}},
        }],
    }


def run_tagged_statement(actions: list[str], resources: list[str], run_id: str) -> dict:
    return {
        "Effect": "Allow",
        "Action": actions,
        "Resource": resources,
        "Condition": {"StringEquals": {"aws:ResourceTag/lab_run_id": run_id}},
    }


@dataclass(frozen=True)
class LabConfig:
    run_id: str
    nonce: str
    operator_ip: str
    self_terminate_minutes: int
    account_id: str
    region: str

    @classmethod
    def load(cls) -> "LabConfig":
        import pulumi

        cfg = pulumi.Config("lab")
        return cls(
            run_id=cfg.require("run_id"),
            nonce=cfg.require("nonce"),
            operator_ip=cfg.require("operator_ip"),
            self_terminate_minutes=cfg.require_int("self_terminate_minutes"),
            account_id=cfg.require("account_id"),
            region=pulumi.Config("aws").require("region"),
        )


def solver_role(lab: LabConfig, statements: list[dict]):
    import pulumi_aws as aws

    role = aws.iam.Role(
        "solver",
        name=solver_role_name(lab.run_id),
        assume_role_policy=json.dumps(trust_policy(lab.account_id)),
        permissions_boundary=boundary_arn(lab.account_id),
        max_session_duration=3600,
    )
    aws.iam.RolePolicy(
        "solver",
        role=role.id,
        policy=json.dumps({"Version": "2012-10-17", "Statement": statements}),
    )
    return role
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `uv run pytest tests/aws/test_infra.py -v`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add labctl/aws/infra.py tests/aws/test_infra.py
git commit -m "feat(labctl): solver role helper for scenario Pulumi programs"
```

---

### Task 12: Smoke scenario `aws-smoke-001`

This is a harness test fixture, not a learning lab. It costs nothing (a VPC and a security group, no instance) and is not a spoiler.

**Files:**
- Create: `scenarios/aws-smoke-001/scenario.yaml`
- Create: `scenarios/aws-smoke-001/README.md`
- Create: `scenarios/aws-smoke-001/AUTHOR.md`
- Create: `scenarios/aws-smoke-001/infra/Pulumi.yaml`
- Create: `scenarios/aws-smoke-001/infra/__main__.py`
- Create: `scenarios/aws-smoke-001/faults/rule_removed.py`
- Create: `scenarios/aws-smoke-001/validate.py`
- Test: `tests/test_smoke_scenario.py`

**Interfaces:**
- Consumes: the `labctl.aws.infra` helpers (Task 11), `Check` (Task 1), `load_scenario` (Task 2).
- Produces: stack outputs `vpc_id`, `sg_id`, `solver_role_arn`, plus fault `rule-removed`. Validator checks are `sg-allows-8080` (outcome) and `no-world-all-ports` (guard).

- [ ] **Step 1: Write the failing test**

`tests/test_smoke_scenario.py`:

```python
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


def test_opening_everything_fails_the_guard():
    checks = load_scenario(SCENARIOS, "aws-smoke-001").checks(env_with_rules([WORLD_ALL]))
    by_name = {c.name: c for c in checks}
    assert by_name["sg-allows-8080"].passed
    assert not by_name["no-world-all-ports"].passed
    assert "sgr-2" in by_name["no-world-all-ports"].detail


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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `uv run pytest tests/test_smoke_scenario.py -v`
Expected: FAIL with `ScenarioError: unknown scenario aws-smoke-001`.

- [ ] **Step 3: Write the scenario**

`scenarios/aws-smoke-001/scenario.yaml`:

```yaml
id: aws-smoke-001
version: 1
provider: aws
region: eu-central-1
ttl_minutes: 15
faults: [rule-removed]
handover: [sg_id]
baseline_timeout_s: 30
fault_timeout_s: 30
```

`scenarios/aws-smoke-001/README.md`:

```markdown
# aws-smoke-001: harness smoke test

Not a learning lab. It exists to prove the `lab` lifecycle end to end, and it costs nothing (no instance).

The security group printed as `sg_id` no longer allows TCP 8080 from `10.0.0.0/8`. Restore that rule
as the solver, without opening the group to the world. Done when `lab validate` passes.
```

`scenarios/aws-smoke-001/AUTHOR.md`:

```markdown
# aws-smoke-001 author notes

## rule-removed

The single ingress rule (TCP 8080 from 10.0.0.0/8) is revoked. Fix:
`aws ec2 authorize-security-group-ingress --group-id <sg_id> --protocol tcp --port 8080 --cidr 10.0.0.0/8`.
```

`scenarios/aws-smoke-001/infra/Pulumi.yaml`:

```yaml
name: aws-smoke-001
description: labctl smoke test scenario
runtime:
  name: python
  options:
    toolchain: pip
    virtualenv: ../../../.venv
```

`scenarios/aws-smoke-001/infra/__main__.py`:

```python
import pulumi
import pulumi_aws as aws

from labctl.aws.infra import LabConfig, run_tagged_statement, solver_role

lab = LabConfig.load()
ec2_arn = f"arn:aws:ec2:{lab.region}:{lab.account_id}"
sg_actions = ["ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupIngress"]

vpc = aws.ec2.Vpc("vpc", cidr_block="10.99.0.0/16")
sg = aws.ec2.SecurityGroup("app", vpc_id=vpc.id, description="labctl smoke test")
aws.vpc.SecurityGroupIngressRule(
    "app-8080",
    security_group_id=sg.id,
    ip_protocol="tcp",
    from_port=8080,
    to_port=8080,
    cidr_ipv4="10.0.0.0/8",
)

role = solver_role(lab, [
    {"Effect": "Allow", "Action": ["ec2:Describe*"], "Resource": "*"},
    run_tagged_statement(sg_actions, [f"{ec2_arn}:security-group/*"], lab.run_id),
    # A new rule has no tags yet, so the rule resource cannot carry the run-tag condition.
    {"Effect": "Allow", "Action": sg_actions, "Resource": [f"{ec2_arn}:security-group-rule/*"]},
])

pulumi.export("vpc_id", vpc.id)
pulumi.export("sg_id", sg.id)
pulumi.export("solver_role_arn", role.arn)
```

`scenarios/aws-smoke-001/faults/rule_removed.py`:

```python
ID = "rule-removed"
PERMISSION = [{"IpProtocol": "tcp", "FromPort": 8080, "ToPort": 8080, "IpRanges": [{"CidrIp": "10.0.0.0/8"}]}]


def _ec2(env):
    return env.session.client("ec2", region_name=env.region)


def inject(env):
    _ec2(env).revoke_security_group_ingress(GroupId=env.outputs["sg_id"], IpPermissions=PERMISSION)


def revert(env):
    _ec2(env).authorize_security_group_ingress(GroupId=env.outputs["sg_id"], IpPermissions=PERMISSION)
```

`scenarios/aws-smoke-001/validate.py`:

```python
from labctl.checks import Check


def _ingress_rules(env):
    ec2 = env.session.client("ec2", region_name=env.region)
    rules = ec2.describe_security_group_rules(
        Filters=[{"Name": "group-id", "Values": [env.outputs["sg_id"]]}]
    )["SecurityGroupRules"]
    return [r for r in rules if not r.get("IsEgress")]


def _world_all_ports(rule):
    world = rule.get("CidrIpv4") == "0.0.0.0/0" or rule.get("CidrIpv6") == "::/0"
    all_ports = rule.get("IpProtocol") == "-1" or (rule.get("FromPort") == 0 and rule.get("ToPort") == 65535)
    return world and all_ports


def checks(env):
    rules = _ingress_rules(env)
    allows_8080 = any(
        r.get("IpProtocol") in ("tcp", "-1")
        and (r.get("IpProtocol") == "-1" or r.get("FromPort", 0) <= 8080 <= r.get("ToPort", -1))
        and r.get("CidrIpv4")
        for r in rules
    )
    world_open = [r["SecurityGroupRuleId"] for r in rules if _world_all_ports(r)]
    return [
        Check("sg-allows-8080", "outcome", allows_8080, "" if allows_8080 else "no ingress rule covers tcp/8080"),
        Check("no-world-all-ports", "guard", not world_open, ", ".join(world_open)),
    ]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `uv run pytest tests/test_smoke_scenario.py -v`
Expected: 4 passed.

- [ ] **Step 5: Run the whole suite**

Run: `uv run pytest -q`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add scenarios/aws-smoke-001 tests/test_smoke_scenario.py
git commit -m "feat(scenarios): aws-smoke-001 harness smoke test"
```

---

### Task 13: Live end-to-end verification (requires platform Task 5)

**Files:** none. If a step fails, fix the code in the responsible earlier task's files, add a unit test that reproduces the failure, and commit with `fix(labctl): …`.

**Interfaces:**
- Consumes: the whole harness, `aws-smoke-001`, and the live sandbox with `lab-solver-boundary`.
- Produces: proof that the lifecycle works against real AWS. Results are recorded in `DECISION_LOG.md`.

- [ ] **Step 1: Session and environment**

```bash
aws sso login --profile cp-lab
source scripts/lab-env.sh
uv run lab janitor
```

Expected: `clean`, exit 0. If anything is listed, stop and show the user before continuing.

- [ ] **Step 2: Tags land (before anything else)**

The run-scoped janitor in `lab down` finds leftovers by the `lab_run_id` tag, so check that the tags apply before trusting it:

```bash
uv run lab up aws-smoke-001
RUN=$(cat .lab/active)
aws ec2 describe-vpcs --profile cp-lab --filters "Name=tag:lab_run_id,Values=$RUN" --query 'Vpcs[].VpcId'
uv run lab down
```

Expected: one VPC ID, then `lab down` exits 0. If no VPC is listed, run `uv run lab janitor`, clean up by hand, and stop.

- [ ] **Step 2b: Selftest**

Run: `uv run lab selftest aws-smoke-001`
Expected: `fault 1: PASS`, exit 0, in under about 3 minutes.

- [ ] **Step 3: Manual solve as the solver**

```bash
uv run lab up aws-smoke-001
```

Expected: `Run r-… is ready.`, then the brief path and `sg_id: sg-…`. Then confirm the tags were applied:

```bash
RUN=$(cat .lab/active)
aws ec2 describe-vpcs --profile cp-lab --filters "Name=tag:lab_run_id,Values=$RUN" --query 'Vpcs[].VpcId'
```

Expected: one VPC ID.

```bash
uv run lab validate        # expected: FAIL sg-allows-8080, exit 1
uv run lab shell
```

Inside the solver shell:

```bash
aws sts get-caller-identity            # expected: assumed-role/lab-solver-<run>/run-<run>
aws iam list-roles                     # expected: AccessDenied
aws cloudtrail lookup-events --max-results 1   # expected: AccessDenied
aws ec2 describe-vpcs --profile cp-lab # expected: error, profile not found
aws ec2 authorize-security-group-ingress --group-id <sg_id> --protocol tcp --port 8080 --cidr 10.0.0.0/8
exit
```

Expected: the authorize call succeeds. The other expectations are as commented.

```bash
uv run lab console         # open the URL in a private window; expected: EC2 console as lab-solver-<run>
uv run lab validate        # expected: PASS both checks, "SOLVED", exit 0
uv run lab status          # expected: state: solved, time left shown
uv run lab reveal          # expected: "Cause: rule-removed" and the AUTHOR.md section
```

- [ ] **Step 4: Teardown, twice, plus janitor**

```bash
uv run lab down            # expected: "Torn down. Nothing left.", exit 0
uv run lab down            # expected: "no active run", exit 0
uv run lab janitor         # expected: clean
```

- [ ] **Step 5: Change trail (wait 15 minutes after the fix)**

Run: `uv run lab report $RUN && cat .lab/runs/$RUN/changes.json`
Expected: at least one entry with `"event": "AuthorizeSecurityGroupIngress"`.

If the list is empty after 30 minutes, the `Username` lookup attribute does not match the role session name. Look up one event by `EventName=AuthorizeSecurityGroupIngress`, check which field carries `run-<run>`, then fix `fetch_changes` and its unit test.

- [ ] **Step 6: Record and commit**

Add to `DECISION_LOG.md`, under the "Milestone 1 is the sealed outage loop" entry, one line with the date, the selftest duration, and `lab up` wall-clock time for the smoke scenario. If month-to-date spend is now above zero, run platform Task 5 Step 7 (the hard-stop test-fire).

```bash
git add DECISION_LOG.md
git commit -m "docs: record first live harness run"
```
