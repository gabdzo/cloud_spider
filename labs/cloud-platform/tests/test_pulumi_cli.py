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
