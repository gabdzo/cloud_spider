#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"
EX280_LAB=lab15
NS=ex280-lab15
ex280_require_admin
oc label ns "$NS" env=lab15 --overwrite >/dev/null
oc apply -f "$LAB_DIR/answer/workloads.yaml" >/dev/null
ex280_apply_route "$NS" web web "$(ex280_host web-lab15)"
ex280_wait_deployment "$NS" web 240
echo "Applied lab 15 fix"
