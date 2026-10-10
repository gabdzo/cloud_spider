#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

NS=ex280-lab10
ex280_require_admin
ex280_require_cmd helm

status="$(helm status catalog -n "$NS" -o json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("info",{}).get("status",""))' || true)"
revisions="$(helm history catalog -n "$NS" -o json 2>/dev/null | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' || echo 0)"
if [[ "$status" == "deployed" && "$revisions" -ge 2 ]]; then
  ex280_pass "catalog release is deployed and has history"
else
  ex280_fail "catalog release is not in the required state"
fi

if helm get values catalog -n "$NS" -o json | python3 -c '
import json,sys
v=json.load(sys.stdin)
image=v.get("image") or {}
svc=v.get("service") or {}
ok = v.get("replicaCount")==3 and image.get("repository")=="registry.access.redhat.com/ubi9/httpd-24" and str(image.get("tag"))=="latest" and int(svc.get("port",0))==8080 and int(svc.get("targetPort",0))==8080
sys.exit(0 if ok else 1)
'; then
  ex280_pass "catalog values match the requirement"
else
  ex280_fail "catalog values do not match the requirement"
fi

if ex280_deployment_ready "$NS" catalog 3 && ex280_route_http_ok "$(ex280_host catalog-lab10)" CHART-OK; then
  ex280_pass "catalog route responds successfully"
else
  ex280_fail "catalog application is still unavailable"
fi

image="$(oc get deploy notice -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
if ex280_deployment_ready "$NS" notice 2 && [[ "$image" == "registry.access.redhat.com/ubi9/httpd-24:latest" ]]; then
  ex280_pass "notice deployment matches the overlay requirement"
else
  ex280_fail "notice deployment does not match the overlay requirement"
fi

if ex280_route_http_ok "$(ex280_host notice-lab10)" NOTICE-OK; then
  ex280_pass "notice route responds successfully"
else
  ex280_fail "notice application is still unavailable"
fi

ex280_finish
