#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

EX280_LAB=lab02
NS=ex280-lab02
ex280_require_admin
variant="$(ex280_variant lab02 4)"
ex280_recreate_project "$NS" "$EX280_LAB"

ex280_apply_web "$NS" web WEB-OK 1
ex280_apply_web "$NS" api API-OK 1 "$EX280_HTTPD_IMAGE" /api
host="$(ex280_host shop-lab02)"
ex280_apply_route "$NS" shop-web web "$host" /
ex280_apply_route "$NS" shop-api api "$host" /api

case "$variant" in
  1)
    oc patch svc web -n "$NS" --type=merge -p '{"spec":{"selector":{"app":"web-old"}}}' >/dev/null
    ;;
  2)
    oc patch svc api -n "$NS" --type=json \
      -p='[{"op":"replace","path":"/spec/ports/0/targetPort","value":9090}]' >/dev/null
    ;;
  3)
    oc patch route shop-api -n "$NS" --type=merge -p '{"spec":{"to":{"name":"web"}}}' >/dev/null
    ;;
  4)
    oc patch deploy api -n "$NS" --type=json -p='[
      {"op":"replace","path":"/spec/selector/matchLabels/app","value":"api-retired"},
      {"op":"replace","path":"/spec/template/metadata/labels/app","value":"api-retired"}
    ]' >/dev/null
    ;;
esac

echo
echo "Lab 02 is ready in project ${NS}"
echo "  http://${host}/"
echo "  http://${host}/api"
