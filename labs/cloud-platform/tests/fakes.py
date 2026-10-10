from __future__ import annotations

import copy
from datetime import UTC, datetime

from labctl.env import Env
from labctl.pulumi_cli import PulumiError

DEFAULT_RESPONSES = {
    "sts": {
        "get_caller_identity": {
            "Account": "111111111111",
            "Arn": "arn:aws:sts::111111111111:assumed-role/AWSReservedSSO_LabOperator_abc/me",
        },
        "assume_role": {
            "Credentials": {
                "AccessKeyId": "AKIA",
                "SecretAccessKey": "secret",
                "SessionToken": "token",
                "Expiration": datetime(2099, 1, 1, tzinfo=UTC),
            }
        },
    },
    "ec2": {"describe_regions": {"Regions": [{"RegionName": "eu-central-1"}]}},
    "cloudtrail": {"lookup_events": {"Events": []}},
}


class FakeClient:
    def __init__(self, responses: dict | None = None, region_name: str | None = None):
        self.responses = dict(responses or {})
        self.region_name = region_name
        self.calls: list[tuple[str, dict]] = []

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)

        def method(**kwargs):
            self.calls.append((name, kwargs))
            value = self.responses.get(name, {})
            return value(**kwargs) if callable(value) else copy.deepcopy(value)

        return method


class FakeSession:
    def __init__(self, world: dict | None = None):
        self.world = world if world is not None else {"baseline_ok": True, "broken": set(), "guards_ok": True}
        self.clients: dict[str, FakeClient] = {}

    def client(self, service, region_name=None):
        if service not in self.clients:
            self.clients[service] = FakeClient(DEFAULT_RESPONSES.get(service, {}), region_name)
        return self.clients[service]


def make_env(session, outputs: dict | None = None) -> Env:
    return Env(
        run_id="r-test",
        nonce="n",
        region="eu-central-1",
        operator_ip="198.51.100.7",
        outputs=outputs or {},
        session=session,
        baseline={},
    )


class FakePulumi:
    def __init__(self, outputs: dict | None = None, fail_on: tuple[str, ...] = ()):
        self.stacks: dict[str, dict] = {}
        self.calls: list[tuple[str, str]] = []
        self.outputs_value = outputs or {
            "endpoint": "http://203.0.113.10/health",
            "solver_role_arn": "arn:aws:iam::111111111111:role/lab-solver-x",
        }
        self.fail_on = set(fail_on)

    def _call(self, name: str, stack: str) -> None:
        self.calls.append((name, stack))
        if name in self.fail_on:
            raise PulumiError(f"fake {name} failure")

    def stack_exists(self, stack):
        return stack in self.stacks

    def init(self, stack, config):
        self._call("init", stack)
        self.stacks[stack] = dict(config)

    def up(self, stack):
        self._call("up", stack)

    def outputs(self, stack):
        self._call("outputs", stack)
        return dict(self.outputs_value)

    def refresh(self, stack):
        self._call("refresh", stack)

    def destroy(self, stack):
        self._call("destroy", stack)

    def remove(self, stack):
        self._call("remove", stack)
        self.stacks.pop(stack, None)
