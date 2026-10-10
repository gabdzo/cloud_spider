#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

EX280_LAB=lab01
NS=ex280-lab01
ex280_require_admin
ex280_recreate_project "$NS" "$EX280_LAB"

ex280_apply_web "$NS" catalog CATALOG-OK 2
ex280_apply_route "$NS" catalog catalog "$(ex280_host catalog-lab01)"
ex280_wait_deployment "$NS" catalog 240

missing="${EX280_HTTPD_IMAGE%:*}:ex280-missing"
oc set image "deployment/catalog" "app=${missing}" -n "$NS" >/dev/null

oc import-image inventory:current -n "$NS" \
  --from="$EX280_HTTPD_IMAGE" \
  --confirm \
  --reference-policy=local >/dev/null

ex280_apply_web "$NS" inventory INVENTORY-OK 1 "$missing"
oc delete route inventory -n "$NS" --ignore-not-found >/dev/null
ex280_apply_route "$NS" inventory inventory "$(ex280_host inventory-lab01)"

echo
echo "Lab 01 is ready in project ${NS}"
echo "  http://$(ex280_host catalog-lab01)"
echo "  http://$(ex280_host inventory-lab01)"
echo "ImageStream: inventory:current"
