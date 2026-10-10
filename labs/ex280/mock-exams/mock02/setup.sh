#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../../common/helpers.sh"

EX280_LAB=mock02
NS=ex280-mock02
PEER=ex280-mock02-peer
STRANGER=ex280-mock02-stranger
ex280_require_admin
ex280_recreate_project "$NS" "$EX280_LAB"
ex280_recreate_project "$PEER" "$EX280_LAB"
ex280_recreate_project "$STRANGER" "$EX280_LAB"

maya_pw="$(openssl rand -hex 8)"
liam_pw="$(openssl rand -hex 8)"
ex280_ensure_user ex280-maya "$maya_pw"
ex280_ensure_user ex280-liam "$liam_pw"
ex280_sync_htpasswd
ex280_wait_authentication

oc delete group ex280-mock02-ops ex280-mock02-empty --ignore-not-found >/dev/null
oc adm groups new ex280-mock02-ops ex280-maya >/dev/null
oc adm groups new ex280-mock02-empty >/dev/null
oc label group ex280-mock02-ops ex280-mock02-empty ex280.lab=mock02 --overwrite >/dev/null

oc create serviceaccount batch -n "$NS" >/dev/null
ex280_apply_client "$PEER" client
ex280_apply_client "$STRANGER" client
ex280_apply_route "$NS" web web "$(ex280_host web-mock02)"

oc apply -f - >/dev/null <<EOF
apiVersion: v1
kind: ResourceQuota
metadata:
  name: project-quota
  namespace: ${NS}
spec:
  hard:
    pods: "4"
    requests.cpu: 500m
    requests.memory: 512Mi
    limits.cpu: "1"
    limits.memory: 1Gi
---
apiVersion: v1
kind: LimitRange
metadata:
  name: default-limits
  namespace: ${NS}
spec:
  limits:
  - type: Container
    defaultRequest:
      cpu: 400m
      memory: 256Mi
    default:
      cpu: 500m
      memory: 512Mi
---
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
            path: /
            port: http
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
  name: batch
  namespace: ${NS}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: batch
  template:
    metadata:
      labels:
        app: batch
    spec:
      serviceAccountName: batch
      containers:
      - name: app
        image: ${EX280_HTTPD_IMAGE}
        securityContext:
          privileged: true
          allowPrivilegeEscalation: true
        resources:
          requests:
            cpu: 50m
            memory: 64Mi
          limits:
            cpu: 100m
            memory: 128Mi
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: ${NS}
spec:
  podSelector: {}
  policyTypes:
  - Ingress
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ops
  namespace: ${NS}
subjects:
- kind: Group
  name: ex280-mock02-empty
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: view
  apiGroup: rbac.authorization.k8s.io
EOF

echo
echo "Mock 02 is ready"
echo "  ex280-maya  ${maya_pw}"
echo "  ex280-liam  ${liam_pw}"
echo "  http://$(ex280_host web-mock02)/"
