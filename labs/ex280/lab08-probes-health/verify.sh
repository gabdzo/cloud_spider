#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

NS=ex280-lab08
ex280_require_admin

if ex280_deployment_ready "$NS" web 2; then
  ex280_pass "web is ready"
else
  ex280_fail "web is not ready"
fi

eps="$(oc get endpoints web -n "$NS" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || true)"
if [[ -n "$eps" ]]; then
  ex280_pass "web endpoints are populated"
else
  ex280_fail "web has no ready endpoints"
fi

if ex280_route_http_ok "$(ex280_host web-lab08)" WEB-OK; then
  ex280_pass "web route responds successfully"
else
  ex280_fail "web route is still unavailable"
fi

if ex280_deployment_ready "$NS" worker 1; then
  ex280_pass "worker is ready"
else
  ex280_fail "worker is not ready"
fi

before="$(oc get pods -n "$NS" -l app=worker -o jsonpath='{.items[0].status.containerStatuses[0].restartCount}' 2>/dev/null || echo 0)"
sleep 15
after="$(oc get pods -n "$NS" -l app=worker -o jsonpath='{.items[0].status.containerStatuses[0].restartCount}' 2>/dev/null || echo 0)"
if ex280_deployment_ready "$NS" worker 1 && [[ "$before" == "$after" ]]; then
  ex280_pass "worker stays ready"
else
  ex280_fail "worker is still restarting"
fi

ex280_finish
