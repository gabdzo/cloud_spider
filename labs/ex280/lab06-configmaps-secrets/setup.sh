#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

EX280_LAB=lab06
NS=ex280-lab06
ex280_require_admin
ex280_recreate_project "$NS" "$EX280_LAB"

oc apply -f - >/dev/null <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: ${NS}
data:
  message: hello-from-config
---
apiVersion: v1
kind: Secret
metadata:
  name: app-secret
  namespace: ${NS}
type: Opaque
stringData:
  password: initial-password
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: config-app
  namespace: ${NS}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: config-app
  template:
    metadata:
      labels:
        app: config-app
    spec:
      containers:
      - name: app
        image: ${EX280_HTTPD_IMAGE}
        env:
        - name: APP_MESSAGE
          valueFrom:
            configMapKeyRef:
              name: app-config
              key: mesage
        ports:
        - containerPort: 8080
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
  name: secret-app
  namespace: ${NS}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: secret-app
  template:
    metadata:
      labels:
        app: secret-app
    spec:
      containers:
      - name: app
        image: ${EX280_HTTPD_IMAGE}
        env:
        - name: SECRET_PASSWORD
          valueFrom:
            secretKeyRef:
              name: app-secret
              key: password
        ports:
        - containerPort: 8080
        resources:
          requests:
            cpu: 20m
            memory: 64Mi
          limits:
            cpu: 200m
            memory: 256Mi
EOF

echo
echo "Lab 06 is ready in project ${NS}"
echo "ConfigMap app-config and Secret app-secret already exist"
