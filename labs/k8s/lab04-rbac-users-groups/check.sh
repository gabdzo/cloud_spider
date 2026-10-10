#!/usr/bin/env bash
# READ-ONLY check for lab04-rbac-users-groups (Kubernetes variant). Prints PASS/FAIL per
# requirement and exits 1 if any fails. It never changes the cluster.
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LAB_DIR
# shellcheck source=../common/check-lib.sh
source "$LAB_DIR/../common/check-lib.sh"
k8s_require

k8s_check "alice can list pods through her group" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_can alice lab04-readers k8s-lab04 list pods && ! k8s_can alice '\'''\'' k8s-lab04 list pods'
k8s_check "alice can read pod logs" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_can alice lab04-readers k8s-lab04 get pods --subresource=log'
k8s_check "alice cannot delete pods" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; ! k8s_can alice lab04-readers k8s-lab04 delete pods'
k8s_check "bob can create and delete deployments through his group" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_can bob lab04-deployers k8s-lab04 create deployments.apps && k8s_can bob lab04-deployers k8s-lab04 delete deployments.apps && ! k8s_can bob '\'''\'' k8s-lab04 create deployments.apps'
k8s_check "bob cannot create rolebindings" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; ! k8s_can bob lab04-deployers k8s-lab04 create rolebindings.rbac.authorization.k8s.io'
k8s_check "carol cannot get pods or secrets" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; ! k8s_can carol lab04-guests k8s-lab04 get pods && ! k8s_can carol lab04-guests k8s-lab04 get secrets'

k8s_finish
