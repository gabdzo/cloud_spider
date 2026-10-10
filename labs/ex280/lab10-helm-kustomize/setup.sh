#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

EX280_LAB=lab10
NS=ex280-lab10
ex280_require_admin
ex280_require_cmd helm
ex280_recreate_project "$NS" "$EX280_LAB"

helm upgrade --install catalog "$LAB_DIR/manifests/chart" -n "$NS" \
  --set replicaCount=1 >/dev/null
helm upgrade catalog "$LAB_DIR/manifests/chart" -n "$NS" \
  --set replicaCount=1 \
  --set image.tag=ex280-missing \
  --set service.targetPort=9090 >/dev/null

oc apply -k "$LAB_DIR/manifests/base" -n "$NS" >/dev/null
ex280_apply_route "$NS" catalog catalog "$(ex280_host catalog-lab10)"
ex280_apply_route "$NS" notice notice "$(ex280_host notice-lab10)"

echo
echo "Lab 10 is ready in project ${NS}"
echo "  chart: manifests/chart"
echo "  overlay: manifests/overlays/prod"
echo "  http://$(ex280_host catalog-lab10)/"
echo "  http://$(ex280_host notice-lab10)/"
