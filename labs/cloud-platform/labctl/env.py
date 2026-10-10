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
