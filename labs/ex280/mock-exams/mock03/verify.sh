#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../../common/helpers.sh"

NS=ex280-mock03
ex280_require_admin
ex280_require_cmd helm

if ex280_route_http_ok "$(ex280_host shop-mock03)" SHOP-OK; then
  ex280_pass "shop responds successfully"
else
  ex280_fail "shop is still unavailable"
fi

if ex280_route_http_ok "$(ex280_host billing-mock03)" BILLING-OK; then
  ex280_pass "billing responds successfully"
else
  ex280_fail "billing is still unavailable"
fi

status="$(helm status store -n "$NS" -o json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin).get("info",{}).get("status",""))' || true)"
revisions="$(helm history store -n "$NS" -o json 2>/dev/null | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))' || echo 0)"
if [[ "$status" == "deployed" && "$revisions" -ge 2 ]] && ex280_deployment_ready "$NS" store 2 \
  && ex280_route_http_ok "$(ex280_host store-mock03)" HELM-OK; then
  ex280_pass "store release responds successfully"
else
  ex280_fail "store release is not in the required state"
fi

edge_host="$(ex280_host edge-mock03)"
cert="$(echo | openssl s_client -connect "${edge_host}:443" -servername "$edge_host" 2>/dev/null | openssl x509 -noout -text 2>/dev/null || true)"
if [[ "$cert" == *"DNS:${edge_host}"* || "$cert" == *"CN = ${edge_host}"* || "$cert" == *"CN=${edge_host}"* ]] \
  && ex280_curl_contains "https://${edge_host}/" EDGE-OK -k; then
  ex280_pass "edge route TLS succeeded"
else
  ex280_fail "edge route TLS did not succeed"
fi

if oc get ns ex280-mock03-stale >/dev/null 2>&1; then
  ex280_fail "stale operator namespace is still present"
else
  ex280_pass "stale operator namespace is gone"
fi

if oc get csv -n ex280-mock03-operators -o jsonpath='{range .items[*]}{.status.phase}{"\n"}{end}' 2>/dev/null | grep -qx Succeeded; then
  ex280_pass "operator is installed"
else
  ex280_fail "operator is not available"
fi

ready="$(oc get issuer selfsigned -n ex280-mock03-operators -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
if [[ "$ready" == "True" ]]; then
  ex280_pass "self-signed issuer is ready"
else
  ex280_fail "self-signed issuer is not ready"
fi

ex280_finish
