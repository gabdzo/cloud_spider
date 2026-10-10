#!/usr/bin/env bash
# READ-ONLY check for lab03-networkpolicy (Kubernetes variant). Prints PASS/FAIL per
# requirement and exits 1 if any fails. It never changes the cluster.
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LAB_DIR
# shellcheck source=../common/check-lib.sh
source "$LAB_DIR/../common/check-lib.sh"
k8s_require

k8s_check "default-deny still denies ingress and egress" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.spec.policyTypes}" netpol default-deny -n k8s-lab03-back)" == *Ingress*Egress* ]]'
k8s_check "front may reach web on 8080, other may not" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_json netpol -n k8s-lab03-back | python3 "$LAB_DIR/policy.py" allows k8s-lab03-front k8s-lab03-other 8080'
k8s_check "DNS egress to kube-system is allowed" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_json netpol -n k8s-lab03-back | python3 "$LAB_DIR/policy.py" dns'
k8s_check "web pods are ready" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab03-back web 1'

k8s_finish
