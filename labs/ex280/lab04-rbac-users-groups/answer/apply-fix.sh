#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"
ex280_require_admin
oc apply -f "$LAB_DIR/answer/rbac.yaml" >/dev/null
echo "Applied lab 04 fix"
