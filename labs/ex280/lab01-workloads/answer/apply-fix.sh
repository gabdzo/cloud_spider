#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"
EX280_LAB=lab01
NS=ex280-lab01
ex280_require_admin
oc apply -f "$LAB_DIR/answer/deployments.yaml" >/dev/null
ex280_apply_route "$NS" catalog catalog "$(ex280_host catalog-lab01)"
ex280_apply_route "$NS" inventory inventory "$(ex280_host inventory-lab01)"
ex280_wait_deployment "$NS" catalog 300
ex280_wait_deployment "$NS" inventory 300
echo "Applied lab 01 fix"
