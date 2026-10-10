#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"
ex280_require_admin
oc apply -f "$LAB_DIR/answer/workloads.yaml" >/dev/null
ex280_wait_deployment ex280-lab06 config-app 180
ex280_wait_deployment ex280-lab06 secret-app 180
echo "Applied lab 06 fix"
