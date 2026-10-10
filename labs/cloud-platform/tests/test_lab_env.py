"""scripts/lab-env.sh on Linux: no `security`, so the passphrase comes from
the environment, secret-tool, or a chmod-600 file."""
import os
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
BASH = shutil.which("bash")
pytestmark = pytest.mark.skipif(BASH is None, reason="needs bash")


def run_env(tmp_path, extra=None, path_dirs=()):
    env = {"HOME": str(tmp_path), "USER": "lab", "XDG_CONFIG_HOME": str(tmp_path / "cfg"),
           "PATH": os.pathsep.join([*map(str, path_dirs), "/usr/bin", "/bin"])}
    env.update(extra or {})
    script = 'source scripts/lab-env.sh && echo "OK $LAB_REGION $PULUMI_CONFIG_PASSPHRASE"'
    shutil.copytree(ROOT / "scripts", tmp_path / "repo" / "scripts")
    return subprocess.run([BASH, "-c", script], cwd=tmp_path / "repo", env=env, capture_output=True, text=True)


def test_env_passphrase_wins(tmp_path):
    out = run_env(tmp_path, {"PULUMI_CONFIG_PASSPHRASE": "from-env"})
    assert out.stdout.strip() == "OK eu-north-1 from-env"


def test_secret_tool_on_linux(tmp_path):
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    tool = bin_dir / "secret-tool"
    tool.write_text('#!/bin/sh\n[ "$1 $2 $3" = "lookup service cloud-platform-pulumi" ] && printf keyring-pass\n')
    tool.chmod(0o755)
    out = run_env(tmp_path, {"LAB_REGION": "eu-west-1"}, [bin_dir])
    assert out.stdout.strip() == "OK eu-west-1 keyring-pass"


def test_private_file_fallback_and_its_permissions(tmp_path):
    secret = tmp_path / "cfg" / "cloud-platform" / "pulumi-passphrase"
    secret.parent.mkdir(parents=True)
    secret.write_text("file-pass\n")
    secret.chmod(0o644)
    loose = run_env(tmp_path)
    assert "must be chmod 600" in loose.stderr and "OK" not in loose.stdout
    secret.chmod(0o600)
    shutil.rmtree(tmp_path / "repo")
    out = run_env(tmp_path)
    assert out.stdout.strip() == "OK eu-north-1 file-pass"


def test_nothing_found_explains_every_option(tmp_path):
    out = run_env(tmp_path)
    assert "OK" not in out.stdout
    assert "secret-tool" in out.stderr and "pulumi-passphrase" in out.stderr
