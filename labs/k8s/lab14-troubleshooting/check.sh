#!/usr/bin/env bash
# READ-ONLY check for lab14-troubleshooting (Kubernetes variant). Prints PASS/FAIL per
# requirement and exits 1 if any fails. It never changes the cluster.
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LAB_DIR
# shellcheck source=../common/check-lib.sh
source "$LAB_DIR/../common/check-lib.sh"
k8s_require

k8s_check "storefront is ready" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab14-store storefront 2'
k8s_check "payments has ready endpoints" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_endpoints k8s-lab14-pay payments'
k8s_check "catalog is ready" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab14-cat catalog 1'
k8s_check "inventory has 2 ready replicas" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab14-inv inventory 2'
k8s_check "audit is ready" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab14-audit audit 1'

k8s_finish
