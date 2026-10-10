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
        if len(set(self.fault_ids)) != len(self.fault_ids):
            raise ScenarioError(
                f"{self.id}: scenario.yaml lists {len(self.fault_ids)} faults but only "
                f"{len(set(self.fault_ids))} unique IDs (duplicate fault IDs)"
            )
        files = [f for f in sorted((self.path / "faults").glob("*.py")) if not f.name.startswith("_")]
        found: dict[str, Fault] = {}
        for n, file in enumerate(files, start=1):
            try:
                module = _load_module(file, f"{_module_prefix(self.id)}_fault_{n}")
            except Exception as e:
                raise ScenarioError(f"fault module #{n} failed to load") from e
            for attr in ("ID", "inject", "revert"):
                if not hasattr(module, attr):
                    raise ScenarioError(f"fault module #{n} (sorted order) is missing {attr}")
            if not isinstance(module.ID, str):
                raise ScenarioError(f"fault module #{n} (sorted order) has a non-string ID")
            found[module.ID] = Fault(module.ID, module.inject, module.revert)
        if len(found) != len(files):
            raise ScenarioError(
                f"{self.id}: {len(files)} fault modules define only {len(found)} unique IDs "
                "(duplicate fault IDs)"
            )
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
        try:
            module = _load_module(file, f"{_module_prefix(self.id)}_validate")
        except Exception as e:
            raise ScenarioError(f"{file} failed to load") from e
        if not hasattr(module, "checks"):
            raise ScenarioError(f"{file} has no checks(env)")
        return module


def load_scenario(scenarios_dir: Path, scenario_id: str, region: str | None = None) -> Scenario:
    path = scenarios_dir / scenario_id
    spec_file = path / "scenario.yaml"
    if not spec_file.exists():
        raise ScenarioError(f"unknown scenario {scenario_id} (no {spec_file})")
    try:
        raw = yaml.safe_load(spec_file.read_text())
    except yaml.YAMLError as e:
        raise ScenarioError(f"{spec_file}: invalid YAML: {e}") from e
    if raw is None:
        raw = {}
    if not isinstance(raw, dict):
        raise ScenarioError(f"{spec_file}: top level must be a mapping, got {type(raw).__name__}")
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
        version=_int_field(raw, "version", spec_file),
        provider=raw["provider"],
        region=region or raw["region"],
        ttl_minutes=_int_field(raw, "ttl_minutes", spec_file),
        fault_ids=_str_list_field(raw, "faults", spec_file),
        handover=_str_list_field(raw, "handover", spec_file, ()),
        baseline_timeout_s=_int_field(raw, "baseline_timeout_s", spec_file, 300),
        fault_timeout_s=_int_field(raw, "fault_timeout_s", spec_file, 60),
    )


def _int_field(raw: dict, field: str, spec_file: Path, default: int | None = None) -> int:
    value = raw.get(field, default)
    if isinstance(value, bool):
        raise ScenarioError(f"{spec_file}: {field} must be an integer, got {value!r}")
    try:
        return int(value)
    except (TypeError, ValueError) as e:
        raise ScenarioError(f"{spec_file}: {field} must be an integer, got {value!r}") from e


def _str_list_field(raw: dict, field: str, spec_file: Path, default: tuple = ()) -> tuple[str, ...]:
    value = raw.get(field, list(default))
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ScenarioError(f"{spec_file}: {field} must be a YAML list of strings")
    return tuple(value)


def _module_prefix(scenario_id: str) -> str:
    return "labscenario_" + scenario_id.replace("-", "_")


def _load_module(path: Path, name: str) -> ModuleType:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ScenarioError(f"cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module
