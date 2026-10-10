from __future__ import annotations

import json
from typing import Any

from labctl.aws.access import session_name


def fetch_changes(cloudtrail: Any, run_id: str) -> list[dict]:
    kwargs: dict = {
        "LookupAttributes": [{"AttributeKey": "Username", "AttributeValue": session_name(run_id)}],
        "MaxResults": 50,
    }
    changes = []
    while True:
        response = cloudtrail.lookup_events(**kwargs)
        for event in response.get("Events", []):
            detail = json.loads(event["CloudTrailEvent"])
            if detail.get("readOnly", False):
                continue
            changes.append({
                "time": detail.get("eventTime"),
                "event": event["EventName"],
                "source": event.get("EventSource"),
                "error": detail.get("errorCode"),
                "request": detail.get("requestParameters"),
            })
        token = response.get("NextToken")
        if not token:
            break
        kwargs["NextToken"] = token
    return sorted(changes, key=lambda change: change["time"] or "")
