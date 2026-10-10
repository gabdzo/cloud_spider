#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

NS=ex280-lab05
ex280_require_admin

builtin_scc='anyuid|privileged|restricted|restricted-v2|restricted-v3|nonroot|nonroot-v2|hostnetwork|hostnetwork-v2|hostaccess|hostmount-anyuid|hostmount-anyuid-v2|hostpath-provisioner|machine-api-termination-handler|nested-container'

pod_json() {
  oc get pods -n "$NS" -l "app=$1" -o json 2>/dev/null || echo '{"items":[]}'
}

fixed="$(pod_json fixed-uid)"
fixed_ok="$(printf '%s' "$fixed" | python3 -c '
import json,sys,re
doc=json.load(sys.stdin)
items=doc.get("items") or []
if not items:
    sys.exit(1)
pod=items[0]
if not any(c.get("type")=="Ready" and c.get("status")=="True" for c in pod.get("status",{}).get("conditions") or []):
    sys.exit(1)
scc=pod.get("metadata",{}).get("annotations",{}).get("openshift.io/scc","")
if re.fullmatch(sys.argv[1], scc):
    sys.exit(1)
ctx=pod["spec"].get("securityContext") or {}
uid=ctx.get("runAsUser")
if uid is None:
    uid=pod["spec"]["containers"][0].get("securityContext",{}).get("runAsUser")
sys.exit(0 if uid==1000 else 1)
' "$builtin_scc" && echo yes || echo no)"
if [[ "$fixed_ok" == "yes" ]]; then
  ex280_pass "fixed-uid is running with a purpose-built constraint"
else
  ex280_fail "fixed-uid is not admitted"
fi

priv_ok="$(pod_json priv | python3 -c '
import json,sys
doc=json.load(sys.stdin)
items=doc.get("items") or []
if not items:
    sys.exit(1)
pod=items[0]
ready=any(c.get("type")=="Ready" and c.get("status")=="True" for c in pod.get("status",{}).get("conditions") or [])
priv=pod["spec"]["containers"][0].get("securityContext",{}).get("privileged") is True
sys.exit(0 if ready and priv else 1)
' && echo yes || echo no)"
if [[ "$priv_ok" == "yes" ]]; then
  ex280_pass "privileged workload is running"
else
  ex280_fail "privileged workload is not admitted"
fi

normal_ok="$(pod_json normal | python3 -c '
import json,sys
doc=json.load(sys.stdin)
items=doc.get("items") or []
if not items:
    sys.exit(1)
pod=items[0]
ready=any(c.get("type")=="Ready" and c.get("status")=="True" for c in pod.get("status",{}).get("conditions") or [])
scc=pod.get("metadata",{}).get("annotations",{}).get("openshift.io/scc","")
sys.exit(0 if ready and scc in ("restricted-v2","restricted-v3") else 1)
' && echo yes || echo no)"
if [[ "$normal_ok" == "yes" ]]; then
  ex280_pass "normal workload remains restricted"
else
  ex280_fail "normal workload is not on a restricted constraint"
fi

collector_sa="$(oc get deploy collector -n "$NS" -o jsonpath='{.spec.template.spec.serviceAccountName}' 2>/dev/null || true)"
if ex280_deployment_ready "$NS" collector 1 && [[ "$collector_sa" == "collector" ]]; then
  ex280_pass "collector workload is available"
else
  ex280_fail "collector workload is not available"
fi

if ex280_user_can "system:serviceaccount:${NS}:collector" "$NS" get configmaps; then
  ex280_pass "collector can read ConfigMaps"
else
  ex280_fail "API access denied"
fi

ex280_finish
