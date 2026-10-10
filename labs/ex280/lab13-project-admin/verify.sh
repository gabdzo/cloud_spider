#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

NS=ex280-lab13-app
ex280_require_admin

template="$(oc get project.config.openshift.io cluster -o jsonpath='{.spec.projectRequestTemplate.name}' 2>/dev/null || true)"
if [[ "$template" == "ex280-project-request" ]]; then
  ex280_pass "cluster uses the lab project template"
else
  ex280_fail "cluster project template is not configured"
fi

if oc get template ex280-project-request -n openshift-config -o yaml | grep -q 'ex280.governance: enforced' \
  && oc get template ex280-project-request -n openshift-config -o yaml | grep -q 'pods: "10"'; then
  ex280_pass "project template includes the required governance"
else
  ex280_fail "project template is missing required governance"
fi

label="$(oc get ns "$NS" -o jsonpath='{.metadata.labels.ex280\.governance}' 2>/dev/null || true)"
owner="$(oc get ns "$NS" -o jsonpath='{.metadata.annotations.ex280\.owner}' 2>/dev/null || true)"
if [[ "$label" == "enforced" && "$owner" == "platform" ]]; then
  ex280_pass "project identity matches the requirement"
else
  ex280_fail "project identity does not match the requirement"
fi

pods="$(oc get quota project-quota -n "$NS" -o jsonpath='{.spec.hard.pods}' 2>/dev/null || true)"
if [[ "$pods" == "10" ]] && oc get limitrange default-limits -n "$NS" >/dev/null 2>&1; then
  ex280_pass "quota and limit range are present"
else
  ex280_fail "quota or limit range is missing"
fi

if oc get networkpolicy default-deny -n "$NS" -o json | python3 -c '
import json,sys
spec=json.load(sys.stdin)["spec"]
sys.exit(0 if spec.get("policyTypes")==["Ingress"] and not spec.get("ingress") else 1)
'; then
  ex280_pass "default deny policy is present"
else
  ex280_fail "default deny policy is missing"
fi

if oc get rolebinding admin -n "$NS" -o json | python3 -c '
import json,sys
doc=json.load(sys.stdin)
subjects=doc.get("subjects") or []
role=doc.get("roleRef") or {}
ok=role.get("name")=="admin" and any(s.get("name")=="ex280-dev" for s in subjects)
sys.exit(0 if ok else 1)
'; then
  ex280_pass "project admin binding is present"
else
  ex280_fail "project admin binding is missing"
fi

phase="$(oc get pvc data -n "$NS" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
if [[ "$phase" == "Bound" ]]; then
  ex280_pass "volume is bound"
else
  ex280_fail "volume is not usable"
fi

ex280_finish
