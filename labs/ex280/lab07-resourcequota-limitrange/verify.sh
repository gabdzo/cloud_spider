#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

NS=ex280-lab07
ex280_require_admin

if oc get quota project-quota -n "$NS" -o json | python3 -c '
import json,sys
def cpu(v):
    v=str(v)
    return float(v[:-1]) if v.endswith("m") else float(v)*1000
def mem(v):
    v=str(v)
    for suf,mul in (("Ki",1024),("Mi",1024**2),("Gi",1024**3)):
        if v.endswith(suf):
            return float(v[:-len(suf)])*mul
    return float(v)
hard=json.load(sys.stdin)["spec"]["hard"]
ok = hard.get("pods")=="4" and cpu(hard["requests.cpu"])==1000 and cpu(hard["limits.cpu"])==2000 and mem(hard["requests.memory"])==1024**3 and mem(hard["limits.memory"])==2*1024**3
sys.exit(0 if ok else 1)
'; then
  ex280_pass "quota matches the requirement"
else
  ex280_fail "quota does not match the requirement"
fi

for name in alpha beta; do
  if ex280_deployment_ready "$NS" "$name" 2; then
    ex280_pass "${name} is available"
  else
    ex280_fail "${name} is not available"
  fi
done

if oc get deploy -n "$NS" -o json | python3 -c '
import json,sys
def cpu(v):
    if not v: return 0
    v=str(v)
    return float(v[:-1]) if v.endswith("m") else float(v)*1000
def mem(v):
    if not v: return 0
    v=str(v)
    for suf,mul in (("Ki",1024),("Mi",1024**2),("Gi",1024**3)):
        if v.endswith(suf):
            return float(v[:-len(suf)])*mul
    return float(v)
doc=json.load(sys.stdin)
ok=True
for item in doc["items"]:
    if item["metadata"]["name"] not in ("alpha","beta"):
        continue
    c=item["spec"]["template"]["spec"]["containers"][0]
    req=(c.get("resources") or {}).get("requests") or {}
    lim=(c.get("resources") or {}).get("limits") or {}
    if cpu(req.get("cpu"))<50 or mem(req.get("memory"))<32*1024**2 or cpu(lim.get("cpu"))<=0 or mem(lim.get("memory"))<=0:
        ok=False
sys.exit(0 if ok else 1)
'; then
  ex280_pass "container requests and limits fit the requirement"
else
  ex280_fail "container requests and limits do not fit the requirement"
fi

ex280_finish
