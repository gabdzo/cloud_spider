#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

NS=ex280-lab02
ex280_require_admin
host="$(ex280_host shop-lab02)"

if ex280_route_http_ok "$host" WEB-OK /; then
  ex280_pass "web path responds successfully"
else
  ex280_fail "web path is still unavailable"
fi

if ex280_route_http_ok "$host" API-OK /api; then
  ex280_pass "API path responds successfully"
else
  ex280_fail "API path is still unavailable"
fi

web_eps="$(oc get endpoints web -n "$NS" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || true)"
if [[ -n "$web_eps" ]]; then
  ex280_pass "web service has ready endpoints"
else
  ex280_fail "web service has no ready endpoints"
fi

api_eps="$(oc get endpoints api -n "$NS" -o jsonpath='{.subsets[*].addresses[*].ip}' 2>/dev/null || true)"
if [[ -n "$api_eps" ]]; then
  ex280_pass "API service has ready endpoints"
else
  ex280_fail "API service has no ready endpoints"
fi

ex280_finish
