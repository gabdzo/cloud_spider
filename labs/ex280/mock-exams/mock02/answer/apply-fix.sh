#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../../common/helpers.sh
source "$LAB_DIR/../../common/helpers.sh"
ex280_require_admin
oc delete deploy web -n ex280-mock02 --ignore-not-found --wait=true >/dev/null
oc apply -f "$LAB_DIR/answer/fix.yaml" >/dev/null
oc adm policy add-scc-to-user privileged -z batch -n ex280-mock02 >/dev/null
oc rollout restart deployment/batch -n ex280-mock02 >/dev/null
ex280_wait_deployment ex280-mock02 web 240
ex280_wait_deployment ex280-mock02 batch 180
echo "Applied mock 02 fix"
