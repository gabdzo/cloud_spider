#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

EX280_LAB=lab08
NS=ex280-lab08
ex280_require_admin
ex280_recreate_project "$NS" "$EX280_LAB"

oc apply -f - >/dev/null <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: web-html
  namespace: ${NS}
data:
  index.html: |
    WEB-OK
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: web
  namespace: ${NS}
spec:
  replicas: 2
  selector:
    matchLabels:
      app: web
  template:
    metadata:
      labels:
        app: web
    spec:
      containers:
      - name: app
        image: ${EX280_HTTPD_IMAGE}
        ports:
        - name: http
          containerPort: 8080
        readinessProbe:
          httpGet:
            path: /not-ready
            port: http
          periodSeconds: 5
          failureThreshold: 3
        resources:
          requests:
            cpu: 20m
            memory: 64Mi
          limits:
            cpu: 200m
            memory: 256Mi
        volumeMounts:
        - name: html
          mountPath: /var/www/html/index.html
          subPath: index.html
      volumes:
      - name: html
        configMap:
          name: web-html
---
apiVersion: v1
kind: Service
metadata:
  name: web
  namespace: ${NS}
spec:
  selector:
    app: web
  ports:
  - name: http
    port: 8080
    targetPort: http
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
  namespace: ${NS}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: worker
  template:
    metadata:
      labels:
        app: worker
    spec:
      containers:
      - name: app
        image: ${EX280_HTTPD_IMAGE}
        ports:
        - name: http
          containerPort: 8080
        startupProbe:
          httpGet:
            path: /starting
            port: 8081
          periodSeconds: 2
          failureThreshold: 3
        livenessProbe:
          httpGet:
            path: /healthz
            port: http
          periodSeconds: 5
          failureThreshold: 1
        resources:
          requests:
            cpu: 20m
            memory: 64Mi
          limits:
            cpu: 200m
            memory: 256Mi
EOF

ex280_apply_route "$NS" web web "$(ex280_host web-lab08)"

echo
echo "Lab 08 is ready in project ${NS}"
echo "  http://$(ex280_host web-lab08)/"
