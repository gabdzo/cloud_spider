#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../../common/helpers.sh
source "$LAB_DIR/../../common/helpers.sh"
ex280_require_admin
oc apply -f "$LAB_DIR/answer/shop.yaml" >/dev/null
ex280_wait_deployment ex280-mock01 shop 240
echo "Applied mock 01 fix"
