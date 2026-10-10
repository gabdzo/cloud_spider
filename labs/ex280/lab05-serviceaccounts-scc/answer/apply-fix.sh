#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"
NS=ex280-lab05
ex280_require_admin
oc apply -f "$LAB_DIR/answer/fixeduid-scc.yaml" >/dev/null
oc apply -f "$LAB_DIR/answer/collector-rbac.yaml" >/dev/null
oc adm policy add-scc-to-user privileged -z priv -n "$NS" >/dev/null
oc rollout restart deployment/fixed-uid deployment/priv -n "$NS" >/dev/null
ex280_wait_deployment "$NS" fixed-uid 180
ex280_wait_deployment "$NS" priv 180
ex280_wait_deployment "$NS" normal 180
ex280_wait_deployment "$NS" collector 180
echo "Applied lab 05 fix"
