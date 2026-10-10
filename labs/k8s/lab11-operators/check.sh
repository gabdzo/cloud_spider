#!/usr/bin/env bash
# READ-ONLY check for lab11-operators (Kubernetes variant). Prints PASS/FAIL per
# requirement and exits 1 if any fails. It never changes the cluster.
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LAB_DIR
# shellcheck source=../common/check-lib.sh
source "$LAB_DIR/../common/check-lib.sh"
k8s_require

k8s_check "cert-manager deployments are ready" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab11 cert-manager 1 && k8s_ready k8s-lab11 cert-manager-webhook 1 && k8s_ready k8s-lab11 cert-manager-cainjector 1'
k8s_check "issuer selfsigned is self-signed" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.spec.selfSigned}" issuer selfsigned -n k8s-lab11)" == "{}" || -n "$(k8s_jsonpath "{.spec.selfSigned}" issuer selfsigned -n k8s-lab11)" ]] && [[ -z "$(k8s_jsonpath "{.spec.ca}" issuer selfsigned -n k8s-lab11)" ]]'
k8s_check "issuer selfsigned is Ready" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.status.conditions[?(@.type==\"Ready\")].status}" issuer selfsigned -n k8s-lab11)" == True ]]'

k8s_finish
