"""The first container of a Deployment (JSON on stdin) requests at least
<millicores> CPU. Usage: cpu.py 50"""
import json
import sys

want = float(sys.argv[1])
c = json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0]
v = str(((c.get("resources") or {}).get("requests") or {}).get("cpu", "0"))
got = float(v[:-1]) if v.endswith("m") else float(v) * 1000
sys.exit(0 if got >= want else 1)
