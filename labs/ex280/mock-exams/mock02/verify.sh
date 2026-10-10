#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../../common/helpers.sh"

NS=ex280-mock02
ex280_require_admin

if ! oc auth can-i list pods -n "$NS" --as=ex280-maya >/dev/null 2>&1 \
  && ex280_user_can ex280-maya "$NS" list pods \
  && ! ex280_user_can ex280-maya "$NS" delete pods
then
  ex280_pass "maya access is correct"
else
  ex280_fail "maya access is not correct"
fi

if ! ex280_user_can ex280-liam "$NS" get secrets; then
  ex280_pass "liam cannot read secrets"
else
  ex280_fail "liam can read secrets"
fi

priv_ok="$(oc get pods -n "$NS" -l app=batch -o json | python3 -c '
import json,sys
doc=json.load(sys.stdin)
items=doc.get("items") or []
if not items:
    sys.exit(1)
pod=items[0]
ready=any(c.get("type")=="Ready" and c.get("status")=="True" for c in pod.get("status",{}).get("conditions") or [])
priv=pod["spec"]["containers"][0].get("securityContext",{}).get("privileged") is True
sys.exit(0 if ready and priv else 1)
' && echo yes || echo no)"
if [[ "$priv_ok" == "yes" ]]; then
  ex280_pass "privileged workload is running"
else
  ex280_fail "privileged workload is not admitted"
fi

if ex280_deployment_ready "$NS" web 2; then
  ex280_pass "web is available"
else
  ex280_fail "web is not available"
fi

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
ok=hard.get("pods")=="4" and cpu(hard["requests.cpu"])==500 and mem(hard["requests.memory"])==512*1024**2 and cpu(hard["limits.cpu"])==1000 and mem(hard["limits.memory"])==1024**3
sys.exit(0 if ok else 1)
'; then
  ex280_pass "quota matches the requirement"
else
  ex280_fail "quota does not match the requirement"
fi

if ex280_exec_ok ex280-mock02-peer client curl -fsS --max-time 8 http://web.ex280-mock02.svc:8080/; then
  ex280_pass "peer can reach web"
else
  ex280_fail "peer cannot reach web"
fi

if ex280_deployment_ready ex280-mock02-stranger client 1 \
  && ex280_exec_fail ex280-mock02-stranger client curl -fsS --max-time 5 http://web.ex280-mock02.svc:8080/
then
  ex280_pass "stranger cannot reach web"
else
  ex280_fail "stranger can reach web"
fi

if ex280_route_http_ok "$(ex280_host web-mock02)" WEB-OK; then
  ex280_pass "route responds successfully"
else
  ex280_fail "route is still unavailable"
fi

ex280_finish
