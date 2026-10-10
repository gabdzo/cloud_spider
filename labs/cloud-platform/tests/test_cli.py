import subprocess
from pathlib import Path

import pytest
from botocore.exceptions import ClientError, NoCredentialsError, TokenRetrievalError

from labctl.checks import Check
from labctl.cli import main
from labctl.config import REPO_ROOT
from labctl.lifecycle import LabError
from labctl.pulumi_cli import PulumiError
from labctl.runs import RunError
from labctl.scenario import ScenarioError


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


class RaisingLab:
    def __init__(self, error):
        self.error = error

    def __getattr__(self, name):
        def method(*args, **kwargs):
            raise self.error

        return method


SECRET = "fault-id-leak"
HANDLED = [
    LabError("lab boom"),
    RunError("run boom"),
    ScenarioError("scenario boom"),
    PulumiError(f"pulumi boom {SECRET}"),
    ClientError({"Error": {"Code": "AccessDenied", "Message": SECRET}}, "DescribeInstances"),
    NoCredentialsError(),
    TokenRetrievalError(provider="sso", error_msg=SECRET),
    KeyboardInterrupt(),
    OSError(f"urlopen error {SECRET}"),
]


@pytest.mark.parametrize("error", HANDLED, ids=lambda e: type(e).__name__)
@pytest.mark.parametrize("argv", [["validate"], ["status"], ["down"], ["selftest", "s"], ["up", "s"]])
def test_handled_errors_exit_1_without_traceback(capsys, argv, error):
    assert main(argv, lab_factory=lambda: RaisingLab(error)) == 1
    captured = capsys.readouterr()
    assert captured.err.startswith("error: ")
    assert "Traceback" not in captured.err + captured.out


@pytest.mark.parametrize("error", [e for e in HANDLED if SECRET in str(e)], ids=lambda e: type(e).__name__)
def test_up_does_not_echo_pulumi_or_aws_text(capsys, error):
    assert main(["up", "s"], lab_factory=lambda: RaisingLab(error)) == 1
    err = capsys.readouterr().err
    assert SECRET not in err
    assert "run.json" in err


def test_up_passes_lab_and_run_errors_through(capsys):
    assert main(["up", "s"], lab_factory=lambda: RaisingLab(LabError("failed_baseline: run r-1 was aborted"))) == 1
    assert capsys.readouterr().err.strip() == "error: failed_baseline: run r-1 was aborted"
    assert main(["up", "s"], lab_factory=lambda: RaisingLab(RunError("run r-1 is active; run `lab down` first"))) == 1
    assert capsys.readouterr().err.strip() == "error: run r-1 is active; run `lab down` first"


def test_errors_while_building_the_lab_are_handled(capsys):
    def factory():
        raise NoCredentialsError()

    assert main(["status"], lab_factory=factory) == 1
    assert capsys.readouterr().err.startswith("error: ")


def test_down_and_janitor_dirty_exit_1(capsys):
    class DirtyLab:
        def down(self, run_id):
            return False

        def janitor(self, run_id):
            return ["ec2 instance i-1"]

    assert main(["down"], lab_factory=DirtyLab) == 1
    assert main(["janitor"], lab_factory=DirtyLab) == 1
    assert "1 leftover(s)" in capsys.readouterr().out


def test_lab_console_script_help():
    result = subprocess.run(["uv", "run", "lab", "--help"], cwd=REPO_ROOT, capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    for command in ("up", "shell", "console", "status", "validate", "reveal", "down", "janitor", "report", "selftest"):
        assert command in result.stdout


def test_refuses_to_run_inside_solver_shell(capsys, monkeypatch):
    monkeypatch.setenv("LAB_SOLVER_RUN", "r-1")
    assert main(["status"], lab_factory=lambda: pytest.fail("lab must not be built")) == 1
    assert "exit the solver shell" in capsys.readouterr().err
