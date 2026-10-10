#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"
ex280_require_admin
oc apply -f "$LAB_DIR/answer/probes.yaml" >/dev/null
ex280_wait_deployment ex280-lab08 web 180
ex280_wait_deployment ex280-lab08 worker 180
echo "Applied lab 08 fix"
