#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

NS=ex280-lab15
PEER=ex280-lab15-peer
ex280_require_admin

label="$(oc get ns "$NS" -o jsonpath='{.metadata.labels.env}' 2>/dev/null || true)"
if [[ "$label" == "lab15" ]]; then
  ex280_pass "task 1 project label is set"
else
  ex280_fail "task 1 is incomplete"
fi

greeting="$(oc get configmap web-config -n "$NS" -o jsonpath='{.data.greeting}' 2>/dev/null || true)"
env_name="$(oc get deploy web -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="GREETING")].valueFrom.configMapKeyRef.key}' 2>/dev/null || true)"
if [[ "$greeting" == "hello" && "$env_name" == "greeting" ]]; then
  ex280_pass "task 2 configuration is visible to the application"
else
  ex280_fail "task 2 is incomplete"
fi

probe="$(oc get deploy web -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].readinessProbe.httpGet.path}' 2>/dev/null || true)"
if ex280_deployment_ready "$NS" web 2 && [[ "$probe" == "/" ]]; then
  ex280_pass "task 3 web deployment is available"
else
  ex280_fail "task 3 is incomplete"
fi

if oc get deploy web -n "$NS" -o json | python3 -c '
import json,sys
c=json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0]
req=(c.get("resources") or {}).get("requests") or {}
cpu=str(req.get("cpu",""))
value=float(cpu[:-1]) if cpu.endswith("m") else (float(cpu)*1000 if cpu else 0)
sys.exit(0 if value>=50 else 1)
'; then
  ex280_pass "task 3 compute request is set"
else
  ex280_fail "task 3 compute request is missing"
fi

port="$(oc get svc web -n "$NS" -o jsonpath='{.spec.ports[0].port}' 2>/dev/null || true)"
eps="$(oc get endpoints web -n "$NS" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || true)"
if [[ "$port" == "8080" && -n "$eps" ]]; then
  ex280_pass "task 4 service is publishing the application"
else
  ex280_fail "task 4 is incomplete"
fi

if ex280_route_http_ok "$(ex280_host web-lab15)" WEB-OK; then
  ex280_pass "task 5 route responds successfully"
else
  ex280_fail "task 5 application is still unavailable"
fi

if oc get quota project-quota -n "$NS" -o json | python3 -c '
import json,sys
def cpu(v):
    v=str(v)
    return float(v[:-1]) if v.endswith("m") else float(v)*1000
hard=json.load(sys.stdin)["spec"]["hard"]
sys.exit(0 if hard.get("pods")=="5" and cpu(hard.get("requests.cpu",0))==1000 else 1)
'; then
  ex280_pass "task 6 quota matches the requirement"
else
  ex280_fail "task 6 is incomplete"
fi

if ! oc auth can-i list pods -n "$NS" --as=ex280-reader >/dev/null 2>&1 \
  && ex280_user_can ex280-reader "$NS" list pods \
  && ! ex280_user_can ex280-reader "$NS" delete pods
then
  ex280_pass "task 7 reader access is correct"
else
  ex280_fail "task 7 access is not correct"
fi

if ! ex280_deployment_ready "$PEER" client 1; then
  ex280_fail "task 8 peer client is not ready"
elif ex280_exec_fail "$PEER" client curl -fsS --max-time 5 http://web.ex280-lab15.svc:8080/; then
  ex280_pass "task 8 unrelated projects cannot reach the application"
else
  ex280_fail "task 8 an unrelated project can reach the application"
fi

ex280_finish
