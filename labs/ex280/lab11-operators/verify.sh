#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

NS=ex280-lab11
ex280_require_admin

if oc get csv -n "$NS" -o jsonpath='{range .items[*]}{.status.phase}{"\n"}{end}' 2>/dev/null | grep -qx Succeeded; then
  ex280_pass "operator is installed"
else
  ex280_fail "operator is not available"
fi

ready="$(oc get issuer selfsigned -n "$NS" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
if [[ "$ready" == "True" ]]; then
  ex280_pass "self-signed issuer is ready"
else
  ex280_fail "self-signed issuer is not ready"
fi

channel="$(oc get subscription cert-manager -n "$NS" -o jsonpath='{.spec.channel}' 2>/dev/null || true)"
approval="$(oc get subscription cert-manager -n "$NS" -o jsonpath='{.spec.installPlanApproval}' 2>/dev/null || true)"
source="$(oc get subscription cert-manager -n "$NS" -o jsonpath='{.spec.source}' 2>/dev/null || true)"
if [[ "$channel" == "stable" && "$approval" == "Automatic" && "$source" == "community-operators" ]]; then
  ex280_pass "subscription matches the requirement"
else
  ex280_fail "subscription does not match the requirement"
fi

ex280_finish
