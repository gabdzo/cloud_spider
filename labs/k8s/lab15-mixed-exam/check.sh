#!/usr/bin/env bash
# READ-ONLY check for lab15-mixed-exam (Kubernetes variant). Prints PASS/FAIL per
# requirement and exits 1 if any fails. It never changes the cluster.
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export LAB_DIR
# shellcheck source=../common/check-lib.sh
source "$LAB_DIR/../common/check-lib.sh"
k8s_require

k8s_check "namespace labelled env=lab15" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.metadata.labels.env}" ns k8s-lab15)" == lab15 ]]'
k8s_check "web-config greeting=hello is GREETING in web" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.data.greeting}" configmap web-config -n k8s-lab15)" == hello ]] && k8s_json deploy web -n k8s-lab15 | python3 -c '\''import json,sys; c=json.load(sys.stdin)["spec"]["template"]["spec"]["containers"][0]; ok=any(e.get("name")=="GREETING" and (e.get("valueFrom") or {}).get("configMapKeyRef",{}).get("name")=="web-config" for e in c.get("env") or []) or any((f.get("configMapRef") or {}).get("name")=="web-config" for f in c.get("envFrom") or []); sys.exit(0 if ok else 1)'\'''
k8s_check "web: 2 ready, readiness on /, cpu request >= 50m" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_ready k8s-lab15 web 2 && [[ "$(k8s_jsonpath "{.spec.template.spec.containers[0].readinessProbe.httpGet.path}" deploy web -n k8s-lab15)" == / ]] && k8s_json deploy web -n k8s-lab15 | python3 "$LAB_DIR/../common/cpu.py" 50'
k8s_check "service web publishes 8080 with endpoints" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.spec.ports[0].port}" svc web -n k8s-lab15)" == 8080 ]] && k8s_endpoints k8s-lab15 web'
k8s_check "quota pods 5, requests.cpu 1" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; [[ "$(k8s_jsonpath "{.spec.hard.pods}/{.spec.hard.requests\.cpu}" resourcequota project-quota -n k8s-lab15)" == 5/1 ]]'
k8s_check "reader lists pods through the group, cannot delete" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_can reader lab15-readers k8s-lab15 list pods && ! k8s_can reader '\'''\'' k8s-lab15 list pods && ! k8s_can reader lab15-readers k8s-lab15 delete pods'
k8s_check "a policy keeps the peer namespace out" bash -c 'source "$LAB_DIR/../common/check-lib.sh"; LAB_DIR="$LAB_DIR"; k8s_json netpol -n k8s-lab15 | python3 "$LAB_DIR/../lab03-networkpolicy/policy.py" denies k8s-lab15-peer'

k8s_finish
