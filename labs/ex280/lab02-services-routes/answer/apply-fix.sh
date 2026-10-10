#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"
EX280_LAB=lab02
NS=ex280-lab02
ex280_require_admin
domain="$(ex280_apps_domain)"
sed "s/APPS_DOMAIN/${domain}/g" "$LAB_DIR/answer/services-routes.yaml" | oc apply -f - >/dev/null
ex280_apply_web "$NS" web WEB-OK 1
ex280_apply_web "$NS" api API-OK 1 "$EX280_HTTPD_IMAGE" /api
ex280_wait_deployment "$NS" web 180
ex280_wait_deployment "$NS" api 180
echo "Applied lab 02 fix"
