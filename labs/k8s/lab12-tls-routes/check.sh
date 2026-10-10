#!/usr/bin/env bash
# READ-ONLY check for lab12-tls-routes (Kubernetes variant). Prints PASS/FAIL per
# requirement and exits 1 if any fails. It never changes the cluster.
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LAB_DIR
# shellcheck source=../common/check-lib.sh
source "$LAB_DIR/../common/check-lib.sh"
k8s_require

k8s_check "edge TLS secret holds a cert for edge-lab12.example.test" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; python3 "$LAB_DIR/cert.py" k8s-lab12 edge edge-lab12.example.test'
k8s_check "passthrough has ssl-passthrough on" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.metadata.annotations.nginx\.ingress\.kubernetes\.io/ssl-passthrough}" ingress passthrough -n k8s-lab12)" == true ]]'
k8s_check "reencrypt speaks HTTPS to the backend with a valid cert" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.metadata.annotations.nginx\.ingress\.kubernetes\.io/backend-protocol}" ingress reencrypt -n k8s-lab12)" == HTTPS ]] && python3 "$LAB_DIR/cert.py" k8s-lab12 reencrypt reencrypt-lab12.example.test'

k8s_finish
