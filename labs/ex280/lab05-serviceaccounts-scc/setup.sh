#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

EX280_LAB=lab05
NS=ex280-lab05
ex280_require_admin
ex280_recreate_project "$NS" "$EX280_LAB"
oc delete scc ex280-lab05-fixeduid --ignore-not-found >/dev/null

for sa in fixed-uid priv normal collector; do
  oc create serviceaccount "$sa" -n "$NS" >/dev/null
done

oc apply -f - >/dev/null <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: collector-config
  namespace: ${NS}
data:
  mode: active
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: fixed-uid
  namespace: ${NS}
  labels:
    app: fixed-uid
spec:
  replicas: 1
  selector:
    matchLabels:
      app: fixed-uid
  template:
    metadata:
      labels:
        app: fixed-uid
    spec:
      serviceAccountName: fixed-uid
      containers:
      - name: app
        image: ${EX280_HTTPD_IMAGE}
        securityContext:
          runAsUser: 1000
        ports:
        - name: http
          containerPort: 8080
        resources:
          requests:
            cpu: 20m
            memory: 64Mi
          limits:
            cpu: 200m
            memory: 256Mi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: priv
  namespace: ${NS}
  labels:
    app: priv
spec:
  replicas: 1
  selector:
    matchLabels:
      app: priv
  template:
    metadata:
      labels:
        app: priv
    spec:
      serviceAccountName: priv
      containers:
      - name: app
        image: ${EX280_HTTPD_IMAGE}
        securityContext:
          privileged: true
          allowPrivilegeEscalation: true
        ports:
        - name: http
          containerPort: 8080
        resources:
          requests:
            cpu: 20m
            memory: 64Mi
          limits:
            cpu: 200m
            memory: 256Mi
EOF

ex280_apply_web "$NS" normal NORMAL-OK 1
oc patch deploy normal -n "$NS" --type=merge -p '{"spec":{"template":{"spec":{"serviceAccountName":"normal"}}}}' >/dev/null
ex280_apply_web "$NS" collector COLLECTOR-OK 1
oc patch deploy collector -n "$NS" --type=merge -p '{"spec":{"template":{"spec":{"serviceAccountName":"collector"}}}}' >/dev/null

echo
echo "Lab 05 is ready in project ${NS}"
echo "ServiceAccounts: fixed-uid, priv, normal, collector"
