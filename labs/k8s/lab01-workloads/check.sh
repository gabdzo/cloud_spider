#!/usr/bin/env bash
# READ-ONLY check for lab01-workloads (Kubernetes variant). Prints PASS/FAIL per
# requirement and exits 1 if any fails. It never changes the cluster.
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LAB_DIR
# shellcheck source=../common/check-lib.sh
source "$LAB_DIR/../common/check-lib.sh"
k8s_require

k8s_check "catalog is available with 3 replicas" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab01 catalog 3'
k8s_check "catalog requests and limits match" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_resources k8s-lab01 catalog 50m 64Mi 200m 256Mi'
k8s_check "inventory is available with 2 replicas" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab01 inventory 2'
k8s_check "inventory uses the pinned image" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.spec.template.spec.containers[0].image}" deploy inventory -n k8s-lab01)" == "nginxinc/nginx-unprivileged:1.27-alpine" ]]'
k8s_check "inventory requests and limits match" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_resources k8s-lab01 inventory 50m 64Mi 200m 256Mi'

k8s_finish
