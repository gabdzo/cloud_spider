#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"
ex280_require_admin
oc delete job batch -n ex280-lab09 --ignore-not-found >/dev/null
oc delete job -n ex280-lab09 -l job-name --ignore-not-found >/dev/null 2>&1 || true
oc apply -f "$LAB_DIR/answer/jobs.yaml" >/dev/null
oc wait --for=condition=complete job/batch -n ex280-lab09 --timeout=180s >/dev/null
echo "Applied lab 09 fix"
