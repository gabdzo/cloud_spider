#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../../common/helpers.sh"

NS=ex280-mock01
ex280_require_admin

if ex280_deployment_ready "$NS" shop 2; then
  ex280_pass "shop is available"
else
  ex280_fail "shop is not available"
fi

if ex280_resources_match "$NS" shop 50m 64Mi 200m 256Mi; then
  ex280_pass "shop compute resources match the requirement"
else
  ex280_fail "shop compute resources do not match the requirement"
fi

probe="$(oc get deploy shop -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].readinessProbe.httpGet.path}' 2>/dev/null || true)"
title="$(oc get configmap shop-config -n "$NS" -o jsonpath='{.data.title}' 2>/dev/null || true)"
key="$(oc get deploy shop -n "$NS" -o jsonpath='{.spec.template.spec.containers[0].env[?(@.name=="TITLE")].valueFrom.configMapKeyRef.key}' 2>/dev/null || true)"
if [[ "$probe" == "/" && "$title" == "summer" && "$key" == "title" ]]; then
  ex280_pass "shop probe and title match the requirement"
else
  ex280_fail "shop probe or title does not match the requirement"
fi

if ex280_route_http_ok "$(ex280_host shop-mock01)" SHOP-OK; then
  ex280_pass "shop route responds successfully"
else
  ex280_fail "shop route is still unavailable"
fi

ex280_finish
