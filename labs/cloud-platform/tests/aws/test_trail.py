import json

from labctl.aws.trail import fetch_changes
from tests.fakes import FakeClient


def event(name, read_only, time):
    return {
        "EventName": name,
        "EventSource": "ec2.amazonaws.com",
        "CloudTrailEvent": json.dumps({
            "readOnly": read_only,
            "eventTime": time,
            "requestParameters": {"groupId": "sg-1"},
        }),
    }


def test_keeps_only_mutations_sorted_across_pages():
    pages = {
        None: {"Events": [
            event("DescribeVpcs", True, "2026-10-06T12:05:00Z"),
            event("ModifyThing", False, "2026-10-06T12:10:00Z"),
        ], "NextToken": "p2"},
        "p2": {"Events": [event("CreateThing", False, "2026-10-06T12:07:00Z")]},
    }
    client = FakeClient({"lookup_events": lambda **kwargs: pages[kwargs.get("NextToken")]})
    changes = fetch_changes(client, "r-1")
    assert [c["event"] for c in changes] == ["CreateThing", "ModifyThing"]
    assert changes[0] == {
        "time": "2026-10-06T12:07:00Z",
        "event": "CreateThing",
        "source": "ec2.amazonaws.com",
        "error": None,
        "request": {"groupId": "sg-1"},
    }
    assert client.calls[0][1]["LookupAttributes"] == [{"AttributeKey": "Username", "AttributeValue": "run-r-1"}]
    assert len(client.calls) == 2
