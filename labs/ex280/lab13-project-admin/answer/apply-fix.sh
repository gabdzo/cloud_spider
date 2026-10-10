#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"
NS=ex280-lab13-app
ex280_require_admin
oc apply -f "$LAB_DIR/answer/template.yaml" >/dev/null
oc patch project.config.openshift.io cluster --type=merge \
  -p '{"spec":{"projectRequestTemplate":{"name":"ex280-project-request"}}}' >/dev/null
oc label ns "$NS" ex280.governance=enforced --overwrite >/dev/null
oc annotate ns "$NS" ex280.owner=platform --overwrite >/dev/null
oc delete pvc data -n "$NS" --ignore-not-found --wait=true >/dev/null
oc apply -f "$LAB_DIR/answer/project.yaml" >/dev/null
oc wait --for=jsonpath='{.status.phase}'=Bound "pvc/data" -n "$NS" --timeout=180s >/dev/null
echo "Applied lab 13 fix"
