#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

EX280_LAB=lab01
NS=ex280-lab01
ex280_require_admin

if ex280_deployment_ready "$NS" catalog 3; then
  ex280_pass "catalog is available"
else
  ex280_fail "catalog is not available"
fi

if ex280_resources_match "$NS" catalog 50m 64Mi 200m 256Mi; then
  ex280_pass "catalog compute resources match the requirement"
else
  ex280_fail "catalog compute resources do not match the requirement"
fi

if ex280_route_http_ok "$(ex280_host catalog-lab01)" CATALOG-OK; then
  ex280_pass "catalog route is serving the application"
else
  ex280_fail "catalog route is not serving the application"
fi

image="$(oc get deploy inventory -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].image}' 2>/dev/null || true)"
if [[ "$image" == "inventory:current" || "$image" == "${NS}/inventory:current" || "$image" == */"${NS}/inventory:current" ]]; then
  ex280_pass "inventory uses the required image stream tag"
else
  ex280_fail "inventory is not running from the required image stream tag"
fi

if ex280_deployment_ready "$NS" inventory 2; then
  ex280_pass "inventory is available"
else
  ex280_fail "inventory is not available"
fi

if ex280_resources_match "$NS" inventory 50m 64Mi 200m 256Mi; then
  ex280_pass "inventory compute resources match the requirement"
else
  ex280_fail "inventory compute resources do not match the requirement"
fi

if ex280_route_http_ok "$(ex280_host inventory-lab01)" INVENTORY-OK; then
  ex280_pass "inventory route is serving the application"
else
  ex280_fail "inventory route is not serving the application"
fi

ex280_finish
