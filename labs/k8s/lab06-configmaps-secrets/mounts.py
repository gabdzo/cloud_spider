"""Read-only mount checks for lab06 (Deployment JSON on stdin).
  config  app-config key `message` ends up at /etc/app/message
  secret  app-secret is mounted as a directory at /etc/secret (no subPath)
"""
import json
import sys

doc = json.load(sys.stdin)
spec = doc["spec"]["template"]["spec"]
volumes = {v["name"]: v for v in spec.get("volumes") or []}
mounts = [m for c in spec["containers"] for m in c.get("volumeMounts") or []]
mode = sys.argv[1]
ok = False
for m in mounts:
    vol = volumes.get(m["name"]) or {}
    if mode == "config" and "configMap" in vol and vol["configMap"].get("name") == "app-config":
        items = vol["configMap"].get("items")
        if m.get("subPath") == "message" and m["mountPath"] == "/etc/app/message":
            ok = True
        elif not m.get("subPath") and m["mountPath"].rstrip("/") == "/etc/app":
            ok = items is None or any(i["key"] == "message" and i["path"] == "message" for i in items)
    if mode == "secret" and "secret" in vol and vol["secret"].get("secretName") == "app-secret":
        if not m.get("subPath") and m["mountPath"].rstrip("/") == "/etc/secret":
            items = vol["secret"].get("items")
            ok = items is None or any(i["key"] == "password" and i["path"] == "password" for i in items)
sys.exit(0 if ok else 1)
