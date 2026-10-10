#!/usr/bin/env bash
# READ-ONLY check for lab05-serviceaccounts-scc (Kubernetes variant). Prints PASS/FAIL per
# requirement and exits 1 if any fails. It never changes the cluster.
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LAB_DIR
# shellcheck source=../common/check-lib.sh
source "$LAB_DIR/../common/check-lib.sh"
k8s_require

k8s_check "namespace still enforces restricted" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.metadata.labels.pod-security\.kubernetes\.io/enforce}" ns k8s-lab05)" == restricted ]]'
k8s_check "fixed-uid is ready as UID 1000" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab05 fixed-uid 1 && [[ "$(k8s_jsonpath "{.items[0].spec.securityContext.runAsUser}{.items[0].spec.containers[0].securityContext.runAsUser}" pods -n k8s-lab05 -l app=fixed-uid)" == *1000* ]]'
k8s_check "priv is ready and privileged in a privileged namespace" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.metadata.labels.pod-security\.kubernetes\.io/enforce}" ns k8s-lab05-priv)" == privileged ]] && k8s_ready k8s-lab05-priv priv 1 && [[ "$(k8s_jsonpath "{.spec.template.spec.containers[0].securityContext.privileged}" deploy priv -n k8s-lab05-priv)" == true ]]'
k8s_check "normal is ready" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab05 normal 1'
k8s_check "collector runs as ServiceAccount collector" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab05 collector 1 && [[ "$(k8s_jsonpath "{.spec.template.spec.serviceAccountName}" deploy collector -n k8s-lab05)" == collector ]]'
k8s_check "collector can get configmaps" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; kubectl auth can-i get configmaps -n k8s-lab05 --as system:serviceaccount:k8s-lab05:collector'

k8s_finish
