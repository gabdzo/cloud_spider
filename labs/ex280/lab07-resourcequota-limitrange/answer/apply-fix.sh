#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"
ex280_require_admin
oc delete deploy alpha beta -n ex280-lab07 --ignore-not-found --wait=true >/dev/null
oc apply -f "$LAB_DIR/answer/workloads.yaml" >/dev/null
ex280_wait_deployment ex280-lab07 alpha 240
ex280_wait_deployment ex280-lab07 beta 240
echo "Applied lab 07 fix"
