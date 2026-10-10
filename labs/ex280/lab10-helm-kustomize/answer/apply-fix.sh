#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"
EX280_LAB=lab10
NS=ex280-lab10
ex280_require_admin
ex280_require_cmd helm
helm upgrade catalog "$LAB_DIR/manifests/chart" -n "$NS" -f "$LAB_DIR/answer/values.yaml" >/dev/null
oc apply -k "$LAB_DIR/answer/overlay" -n "$NS" >/dev/null
ex280_apply_route "$NS" catalog catalog "$(ex280_host catalog-lab10)"
ex280_apply_route "$NS" notice notice "$(ex280_host notice-lab10)"
ex280_wait_deployment "$NS" catalog 240
ex280_wait_deployment "$NS" notice 240
echo "Applied lab 10 fix"
