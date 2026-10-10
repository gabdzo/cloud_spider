#!/usr/bin/env bash
# READ-ONLY check for lab08-probes-health (Kubernetes variant). Prints PASS/FAIL per
# requirement and exits 1 if any fails. It never changes the cluster.
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LAB_DIR
# shellcheck source=../common/check-lib.sh
source "$LAB_DIR/../common/check-lib.sh"
k8s_require

k8s_check "web has 2 ready replicas" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab08 web 2'
k8s_check "service web has ready endpoints" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_endpoints k8s-lab08 web'
k8s_check "worker is ready" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab08 worker 1'
k8s_check "worker's liveness probe targets port 8080" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.spec.template.spec.containers[0].livenessProbe.tcpSocket.port}{.spec.template.spec.containers[0].livenessProbe.httpGet.port}" deploy worker -n k8s-lab08)" =~ ^(8080|http)$ ]]'

k8s_finish
