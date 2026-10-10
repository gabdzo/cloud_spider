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
    assert creds.expiration == datetime(2099, 1, 1, tzinfo=UTC)


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


def test_solver_env_strips_pulumi_passphrase_and_other_credential_sources():
    env = solver_env(
        {"PULUMI_CONFIG_PASSPHRASE": "secret", "LAB_AWS_PROFILE": "cp-lab", "AWS_ROLE_ARN": "arn"},
        CREDS, "eu-central-1", "r-1",
    )
    assert not {"PULUMI_CONFIG_PASSPHRASE", "LAB_AWS_PROFILE", "AWS_ROLE_ARN"} & env.keys()


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
