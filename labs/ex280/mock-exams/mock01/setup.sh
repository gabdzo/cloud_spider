#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../../common/helpers.sh"

EX280_LAB=mock01
NS=ex280-mock01
ex280_require_admin
ex280_recreate_project "$NS" "$EX280_LAB"
ex280_apply_web "$NS" shop SHOP-OK 1
ex280_apply_route "$NS" shop shop "$(ex280_host shop-mock01)"
ex280_wait_deployment "$NS" shop 240
missing="${EX280_HTTPD_IMAGE%:*}:ex280-missing"
oc set image deployment/shop "app=${missing}" -n "$NS" >/dev/null

echo
echo "Mock 01 is ready in project ${NS}"
echo "  http://$(ex280_host shop-mock01)/"
