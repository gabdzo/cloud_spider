#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

EX280_LAB=lab07
NS=ex280-lab07
ex280_require_admin
ex280_recreate_project "$NS" "$EX280_LAB"

oc apply -f - >/dev/null <<EOF
apiVersion: v1
kind: ResourceQuota
metadata:
  name: project-quota
  namespace: ${NS}
spec:
  hard:
    pods: "4"
    requests.cpu: "1"
    requests.memory: 1Gi
    limits.cpu: "2"
    limits.memory: 2Gi
---
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: ${NS}
spec:
  limits:
  - type: Container
    min:
      cpu: 50m
      memory: 32Mi
    defaultRequest:
      cpu: 500m
      memory: 512Mi
    default:
      cpu: "1"
      memory: 1Gi
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: alpha
  namespace: ${NS}
spec:
  replicas: 2
  selector:
    matchLabels:
      app: alpha
  template:
    metadata:
      labels:
        app: alpha
    spec:
      containers:
      - name: app
        image: ${EX280_HTTPD_IMAGE}
        ports:
        - containerPort: 8080
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: beta
  namespace: ${NS}
spec:
  replicas: 2
  selector:
    matchLabels:
      app: beta
  template:
    metadata:
      labels:
        app: beta
    spec:
      containers:
      - name: app
        image: ${EX280_HTTPD_IMAGE}
        ports:
        - containerPort: 8080
EOF

echo
echo "Lab 07 is ready in project ${NS}"
echo "Quota project-quota must remain at the required ceilings"
