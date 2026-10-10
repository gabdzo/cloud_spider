"""Every running pod's containers request >= 50m CPU and >= 32Mi memory and
have limits (pods JSON on stdin; LimitRange defaults are already applied to
admitted pods, so either way of fixing the lab passes)."""
import json
import sys


def cpu_m(v):
    v = str(v)
    return float(v[:-1]) if v.endswith("m") else float(v) * 1000


def mem_mi(v):
    v = str(v)
    units = {"Ki": 1 / 1024, "Mi": 1, "Gi": 1024, "K": 1000 / 1048576, "M": 1e6 / 1048576, "G": 1e9 / 1048576}
    for unit, factor in units.items():
        if v.endswith(unit):
            return float(v[: -len(unit)]) * factor
    return float(v) / 1048576


pods = [p for p in json.load(sys.stdin).get("items") or [] if (p.get("status") or {}).get("phase") == "Running"]
if not pods:
    sys.exit(1)
for pod in pods:
    for c in pod["spec"]["containers"]:
        r = c.get("resources") or {}
        req, lim = r.get("requests") or {}, r.get("limits") or {}
        if not lim or "cpu" not in req or "memory" not in req:
            sys.exit(1)
        if cpu_m(req["cpu"]) < 50 or mem_mi(req["memory"]) < 32:
            sys.exit(1)
sys.exit(0)
