#!/usr/bin/env bash
# READ-ONLY check for lab06-configmaps-secrets (Kubernetes variant). Prints PASS/FAIL per
# requirement and exits 1 if any fails. It never changes the cluster.
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LAB_DIR
# shellcheck source=../common/check-lib.sh
source "$LAB_DIR/../common/check-lib.sh"
k8s_require

k8s_check "config-app is ready" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab06 config-app 1'
k8s_check "config-app mounts app-config key message as /etc/app/message" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_json deploy config-app -n k8s-lab06 | python3 "$LAB_DIR/mounts.py" config'
k8s_check "secret-app mounts app-secret without subPath at /etc/secret" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_json deploy secret-app -n k8s-lab06 | python3 "$LAB_DIR/mounts.py" secret'
k8s_check "secret-app is ready" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab06 secret-app 1'

k8s_finish
