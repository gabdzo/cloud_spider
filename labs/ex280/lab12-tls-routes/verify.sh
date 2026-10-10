#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

ex280_require_admin

cert_matches() {
  local host="$1"
  local text
  text="$(echo | openssl s_client -connect "${host}:443" -servername "$host" 2>/dev/null | openssl x509 -noout -text 2>/dev/null || true)"
  [[ "$text" == *"DNS:${host}"* || "$text" == *"CN = ${host}"* || "$text" == *"CN=${host}"* ]]
}

edge_host="$(ex280_host edge-lab12)"
pass_host="$(ex280_host passthrough-lab12)"
re_host="$(ex280_host reencrypt-lab12)"

if cert_matches "$edge_host" && ex280_curl_contains "https://${edge_host}/" EDGE-OK -k; then
  ex280_pass "edge route TLS succeeded"
else
  ex280_fail "edge route TLS did not succeed"
fi

if cert_matches "$pass_host" && ex280_curl_contains "https://${pass_host}/" PASSTHROUGH-OK -k; then
  ex280_pass "passthrough route TLS succeeded"
else
  ex280_fail "passthrough route TLS did not succeed"
fi

if ex280_curl_contains "https://${re_host}/" REENCRYPT-OK -k; then
  ex280_pass "reencrypt route TLS succeeded"
else
  ex280_fail "reencrypt route TLS did not succeed"
fi

ex280_finish
