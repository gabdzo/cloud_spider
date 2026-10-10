#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

NS=ex280-lab09
ex280_require_admin

succeeded="$(oc get job batch -n "$NS" -o jsonpath='{.status.succeeded}' 2>/dev/null || true)"
if [[ "$succeeded" == "3" ]]; then
  ex280_pass "batch job succeeded"
else
  ex280_fail "batch job has not succeeded"
fi

if oc get cronjob tick -n "$NS" -o json | python3 -c '
import json,sys
spec=json.load(sys.stdin)["spec"]
ok = spec.get("schedule")=="*/1 * * * *" and spec.get("suspend") is False and spec.get("successfulJobsHistoryLimit")==3 and spec.get("failedJobsHistoryLimit")==1
sys.exit(0 if ok else 1)
'; then
  ex280_pass "tick schedule and history match the requirement"
else
  ex280_fail "tick does not match the required schedule"
fi

found=no
for _ in $(seq 1 24); do
  if oc get jobs -n "$NS" -o json | python3 -c '
import json,sys
doc=json.load(sys.stdin)
for job in doc.get("items") or []:
    owners=job["metadata"].get("ownerReferences") or []
    if any(o.get("kind")=="CronJob" and o.get("name")=="tick" for o in owners):
        if job.get("status",{}).get("succeeded",0) >= 1:
            sys.exit(0)
sys.exit(1)
'; then
    found=yes
    break
  fi
  sleep 5
done
if [[ "$found" == "yes" ]]; then
  ex280_pass "tick has a successful run"
else
  ex280_fail "tick has no successful run"
fi

ex280_finish
