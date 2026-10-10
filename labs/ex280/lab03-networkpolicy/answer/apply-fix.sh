#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"
ex280_require_admin
oc delete networkpolicy allow-frontend -n ex280-lab03-back --ignore-not-found >/dev/null
oc apply -f "$LAB_DIR/answer/networkpolicies.yaml" >/dev/null
echo "Applied lab 03 fix"
