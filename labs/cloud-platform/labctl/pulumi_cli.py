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
            output = "\n".join(part[-3000:] for part in (result.stdout, result.stderr) if part)
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
