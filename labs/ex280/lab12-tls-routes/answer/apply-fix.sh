#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"
# shellcheck source=../manifests/tls.sh
source "$LAB_DIR/manifests/tls.sh"

EX280_LAB=lab12
NS=ex280-lab12
ex280_require_admin
work="${EX280_STATE}/lab12"
mkdir -p "$work/fix"
ex280_tls_ca "$work/fix" ex280-lab12-fix
edge_host="$(ex280_host edge-lab12)"
pass_host="$(ex280_host passthrough-lab12)"
re_host="$(ex280_host reencrypt-lab12)"
ex280_tls_cert "$work/fix" edge "$edge_host" "$work/fix"
ex280_tls_cert "$work/fix" pass "$pass_host" "$work/fix"
ex280_tls_cert "$work/fix" re "$re_host" "$work/fix"

ex280_tls_secret "$NS" passthrough-tls "$work/fix/pass.crt" "$work/fix/pass.key"
ex280_tls_secret "$NS" reencrypt-tls "$work/fix/re.crt" "$work/fix/re.key"
oc rollout restart deployment/passthrough deployment/reencrypt -n "$NS" >/dev/null
ex280_tls_apply_route "$NS" edge edge "$edge_host" edge "$work/fix/edge.crt" "$work/fix/edge.key"
ex280_tls_apply_route "$NS" passthrough passthrough "$pass_host" passthrough
ex280_tls_apply_route "$NS" reencrypt reencrypt "$re_host" reencrypt \
  "$work/fix/re.crt" "$work/fix/re.key" "$work/fix/ca.crt"
ex280_wait_deployment "$NS" edge 180
ex280_wait_deployment "$NS" passthrough 240
ex280_wait_deployment "$NS" reencrypt 240
echo "Applied lab 12 fix"
