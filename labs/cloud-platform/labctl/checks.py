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
