from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

REPO_ROOT = Path(__file__).resolve().parent.parent
# Cloud Spider runs in eu-north-1. LAB_REGION moves every scenario and the
# janitor to another region without editing scenario.yaml.
DEFAULT_REGION = "eu-north-1"
_REGION = re.compile(r"^[a-z]{2}(-gov)?-[a-z]+-\d$")


class SettingsError(ValueError):
    pass


@dataclass(frozen=True)
class Settings:
    scenarios_dir: Path
    state_dir: Path
    aws_profile: str
    home_region: str = DEFAULT_REGION
    # Set from LAB_REGION: replaces each scenario's own region when present.
    region_override: str | None = None

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
    region = environ.get("LAB_REGION", "").strip() or None
    if region is not None and not _REGION.match(region):
        raise SettingsError(f"LAB_REGION {region!r} is not an AWS region name")
    return Settings(
        scenarios_dir=root / "scenarios",
        state_dir=root / ".lab",
        aws_profile=environ.get("LAB_AWS_PROFILE", "cp-lab"),
        home_region=region or DEFAULT_REGION,
        region_override=region,
    )
