#!/usr/bin/env bash
# READ-ONLY check for lab09-jobs-cronjobs (Kubernetes variant). Prints PASS/FAIL per
# requirement and exits 1 if any fails. It never changes the cluster.
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LAB_DIR
# shellcheck source=../common/check-lib.sh
source "$LAB_DIR/../common/check-lib.sh"
k8s_require

k8s_check "batch succeeded 3 times with parallelism 2" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.spec.completions}/{.spec.parallelism}/{.status.succeeded}" job batch -n k8s-lab09)" == "3/2/3" ]]'
k8s_check "tick is scheduled every minute and not suspended" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.spec.schedule}|{.spec.suspend}|{.spec.successfulJobsHistoryLimit}|{.spec.failedJobsHistoryLimit}" cronjob tick -n k8s-lab09)" == "*/1 * * * *|false|3|1" ]]'
k8s_check "a Job made by tick succeeded" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_json jobs -n k8s-lab09 | python3 -c '\''import json,sys; d=json.load(sys.stdin); sys.exit(0 if any((r.get("kind")=="CronJob" and r.get("name")=="tick") for j in d["items"] if (j.get("status") or {}).get("succeeded") for r in j["metadata"].get("ownerReferences") or []) else 1)'\'''

k8s_finish
