#!/usr/bin/env bash
# READ-ONLY check for lab02-services-routes (Kubernetes variant). Prints PASS/FAIL per
# requirement and exits 1 if any fails. It never changes the cluster.
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LAB_DIR
# shellcheck source=../common/check-lib.sh
source "$LAB_DIR/../common/check-lib.sh"
k8s_require

k8s_check "service web has ready endpoints" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_endpoints k8s-lab02 web'
k8s_check "service api has ready endpoints" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_endpoints k8s-lab02 api'
k8s_check "service api targets port 8080" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.spec.ports[0].targetPort}" svc api -n k8s-lab02)" == "8080" ]]'
k8s_check "ingress / goes to web:8080" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.spec.rules[0].http.paths[?(@.path==\"/\")].backend.service.name}:{.spec.rules[0].http.paths[?(@.path==\"/\")].backend.service.port.number}" ingress shop -n k8s-lab02)" == "web:8080" ]]'
k8s_check "ingress /api goes to api:8080" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.spec.rules[0].http.paths[?(@.path==\"/api\")].backend.service.name}:{.spec.rules[0].http.paths[?(@.path==\"/api\")].backend.service.port.number}" ingress shop -n k8s-lab02)" == "api:8080" ]]'

k8s_finish
