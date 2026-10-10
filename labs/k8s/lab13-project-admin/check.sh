#!/usr/bin/env bash
# READ-ONLY check for lab13-project-admin (Kubernetes variant). Prints PASS/FAIL per
# requirement and exits 1 if any fails. It never changes the cluster.
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LAB_DIR
# shellcheck source=../common/check-lib.sh
source "$LAB_DIR/../common/check-lib.sh"
k8s_require

k8s_check "label and annotation are set" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.metadata.labels.ex280\.governance}|{.metadata.annotations.ex280\.owner}" ns k8s-lab13-app)" == "enforced|platform" ]]'
k8s_check "quota pods 10 and the LimitRange exist" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.spec.hard.pods}" resourcequota project-quota -n k8s-lab13-app)" == 10 ]] && k8s_get limitrange default-limits -n k8s-lab13-app'
k8s_check "default-deny denies all ingress" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.spec.podSelector}|{.spec.policyTypes}|{.spec.ingress}" netpol default-deny -n k8s-lab13-app)" == "{}|[\"Ingress\"]|" ]]'
k8s_check "dev is admin in the namespace" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; kubectl auth can-i create rolebindings -n k8s-lab13-app --as dev && ! kubectl auth can-i create namespaces --as dev'
k8s_check "PVC data is Bound" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.status.phase}" pvc data -n k8s-lab13-app)" == Bound ]]'

k8s_finish
