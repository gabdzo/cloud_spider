#!/usr/bin/env bash
# READ-ONLY check for lab10-helm-kustomize (Kubernetes variant). Prints PASS/FAIL per
# requirement and exits 1 if any fails. It never changes the cluster.
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LAB_DIR
# shellcheck source=../common/check-lib.sh
source "$LAB_DIR/../common/check-lib.sh"
k8s_require

k8s_check "catalog is deployed with more than one revision" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; helm status catalog -n k8s-lab10 -o json 2>/dev/null | python3 -c '\''import json,sys; d=json.load(sys.stdin); sys.exit(0 if d["info"]["status"]=="deployed" and d["version"]>1 else 1)'\'''
k8s_check "catalog has 3 ready replicas" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab10 catalog 3'
k8s_check "catalog runs the required image on port 8080" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.spec.template.spec.containers[0].image}|{.spec.template.spec.containers[0].ports[0].containerPort}" deploy catalog -n k8s-lab10)" == "nginxinc/nginx-unprivileged:1.27-alpine|8080" ]] && [[ "$(k8s_jsonpath "{.spec.ports[0].port}" svc catalog -n k8s-lab10)" == 8080 ]]'
k8s_check "notice has 2 ready replicas" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab10 notice 2'

k8s_finish
