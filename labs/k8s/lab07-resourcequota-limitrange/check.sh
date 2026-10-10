#!/usr/bin/env bash
# READ-ONLY check for lab07-resourcequota-limitrange (Kubernetes variant). Prints PASS/FAIL per
# requirement and exits 1 if any fails. It never changes the cluster.
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LAB_DIR
# shellcheck source=../common/check-lib.sh
source "$LAB_DIR/../common/check-lib.sh"
k8s_require

k8s_check "quota is unchanged" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.spec.hard.pods}/{.spec.hard.requests\.cpu}/{.spec.hard.requests\.memory}/{.spec.hard.limits\.cpu}/{.spec.hard.limits\.memory}" resourcequota project-quota -n k8s-lab07)" == "4/1/1Gi/2/2Gi" ]]'
k8s_check "alpha has 2 ready replicas" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab07 alpha 2'
k8s_check "beta has 2 ready replicas" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab07 beta 2'
k8s_check "every running container has requests >= 50m/32Mi and limits" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_json pods -n k8s-lab07 | python3 "$LAB_DIR/requests.py"'

k8s_finish
