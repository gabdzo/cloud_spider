from __future__ import annotations

import json
import os
import urllib.parse
import urllib.request
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Callable, Mapping

FEDERATION_URL = "https://signin.aws.amazon.com/federation"
SOLVER_SESSION_SECONDS = 3600
_OPERATOR_VARIABLES = (
    "AWS_PROFILE", "AWS_DEFAULT_PROFILE", "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_SECURITY_TOKEN",
    "AWS_ROLE_ARN", "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_AUTHORIZATION_TOKEN",
    "LAB_AWS_PROFILE", "PULUMI_CONFIG_PASSPHRASE", "PULUMI_CONFIG_PASSPHRASE_FILE",
)


@dataclass(frozen=True)
class SolverCredentials:
    access_key_id: str
    secret_access_key: str
    session_token: str
    expiration: datetime


def session_name(run_id: str) -> str:
    return f"run-{run_id}"


def assume_solver(session: Any, role_arn: str, run_id: str) -> SolverCredentials:
    response = session.client("sts").assume_role(
        RoleArn=role_arn,
        RoleSessionName=session_name(run_id),
        DurationSeconds=SOLVER_SESSION_SECONDS,
    )
    c = response["Credentials"]
    return SolverCredentials(c["AccessKeyId"], c["SecretAccessKey"], c["SessionToken"], c["Expiration"])


def solver_env(base_env: Mapping[str, str], creds: SolverCredentials, region: str, run_id: str) -> dict:
    env = {key: value for key, value in base_env.items() if key not in _OPERATOR_VARIABLES}
    env.update({
        "AWS_ACCESS_KEY_ID": creds.access_key_id,
        "AWS_SECRET_ACCESS_KEY": creds.secret_access_key,
        "AWS_SESSION_TOKEN": creds.session_token,
        "AWS_REGION": region,
        "AWS_DEFAULT_REGION": region,
        # No profile fallback: `--profile cp-lab` inside the solver shell fails.
        "AWS_CONFIG_FILE": os.devnull,
        "AWS_SHARED_CREDENTIALS_FILE": os.devnull,
        "LAB_SOLVER_RUN": run_id,
    })
    return env


def _fetch_json(url: str) -> dict:
    with urllib.request.urlopen(url, timeout=10) as response:
        return json.loads(response.read().decode())


def console_url(creds: SolverCredentials, region: str, fetch: Callable[[str], dict] = _fetch_json) -> str:
    session = json.dumps({
        "sessionId": creds.access_key_id,
        "sessionKey": creds.secret_access_key,
        "sessionToken": creds.session_token,
    })
    token = fetch(f"{FEDERATION_URL}?Action=getSigninToken&Session={urllib.parse.quote(session)}")["SigninToken"]
    destination = f"https://{region}.console.aws.amazon.com/ec2/home?region={region}"
    return (
        f"{FEDERATION_URL}?Action=login&Issuer=labctl"
        f"&Destination={urllib.parse.quote(destination, safe='')}&SigninToken={token}"
    )
