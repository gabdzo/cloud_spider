from __future__ import annotations

import argparse
import os
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

SSO_HINT = "Is your SSO session valid? `aws sso login --profile cp-lab`"


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
    if os.environ.get("LAB_SOLVER_RUN"):
        print("error: run lab commands from your operator terminal (exit the solver shell first)", file=sys.stderr)
        return 1
    try:
        lab = (lab_factory or (lambda: Lab(build_deps())))()
        return COMMANDS[args.command](lab, args)
    except (LabError, RunError, ScenarioError) as exc:
        print(f"error: {exc}", file=sys.stderr)
    except (PulumiError, BotoCoreError, ClientError, OSError) as exc:
        aws = isinstance(exc, (BotoCoreError, ClientError))
        if args.command == "up":
            # Pulumi and AWS error text from `up` can name fault resources.
            message = f"`lab up` failed ({type(exc).__name__}). If a run was created, see .lab/runs/<run_id>/run.json."
        elif aws:
            message = f"AWS call failed: {exc}"
        elif isinstance(exc, OSError):
            message = f"{type(exc).__name__}: {exc}"
        else:
            message = str(exc)
        print(f"error: {message}" + (f"\n{SSO_HINT}" if aws else ""), file=sys.stderr)
    except KeyboardInterrupt:
        print("error: interrupted", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
