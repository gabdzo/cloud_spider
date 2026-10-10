#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

NS=ex280-lab06
ex280_require_admin

if ex280_deployment_ready "$NS" config-app 1; then
  ex280_pass "config-app is available"
else
  ex280_fail "config-app is still unavailable"
fi

expected="$(oc get configmap app-config -n "$NS" -o jsonpath='{.data.message}' 2>/dev/null || true)"
actual="$(oc exec -n "$NS" deploy/config-app -- cat /etc/app/message 2>/dev/null || true)"
actual="${actual//$'\r'/}"
actual="${actual%$'\n'}"
if [[ -n "$expected" && "$actual" == "$expected" ]]; then
  ex280_pass "config-app matches the current ConfigMap"
else
  ex280_fail "application configuration does not match the current ConfigMap"
fi

if ex280_deployment_ready "$NS" secret-app 1; then
  ex280_pass "secret-app is available"
else
  ex280_fail "secret-app is still unavailable"
fi

uid="$(oc get pods -n "$NS" -l app=secret-app -o jsonpath='{.items[0].metadata.uid}' 2>/dev/null || true)"
rotated="rotated-$(openssl rand -hex 4)"
oc create secret generic app-secret \
  --from-literal="password=${rotated}" \
  -n "$NS" \
  --dry-run=client -o yaml | oc apply -f - >/dev/null

matched=no
for _ in $(seq 1 36); do
  current="$(oc exec -n "$NS" deploy/secret-app -- cat /etc/secret/password 2>/dev/null || true)"
  current="${current//$'\r'/}"
  current="${current%$'\n'}"
  if [[ "$current" == "$rotated" ]]; then
    matched=yes
    break
  fi
  sleep 5
done
uid_after="$(oc get pods -n "$NS" -l app=secret-app -o jsonpath='{.items[0].metadata.uid}' 2>/dev/null || true)"
if [[ "$matched" == "yes" && -n "$uid" && "$uid" == "$uid_after" ]]; then
  ex280_pass "secret rotation is visible without replacing the pod"
else
  ex280_fail "application configuration does not match the current secret"
fi

ex280_finish
