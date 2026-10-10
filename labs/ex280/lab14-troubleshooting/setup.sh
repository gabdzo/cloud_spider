#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

EX280_LAB=lab14
ex280_require_admin
missing="${EX280_HTTPD_IMAGE%:*}:ex280-missing"

prepare() {
  local ns="$1"
  ex280_recreate_project "$ns" "$EX280_LAB"
}

prepare ex280-lab14-storefront
ex280_apply_web ex280-lab14-storefront storefront STORE-OK 1
oc patch svc storefront -n ex280-lab14-storefront --type=merge -p '{"spec":{"selector":{"app":"storefront-old"}}}' >/dev/null
ex280_apply_route ex280-lab14-storefront storefront storefront "$(ex280_host storefront-lab14)"

prepare ex280-lab14-payments
ex280_apply_web ex280-lab14-payments payments PAY-OK 1
oc patch svc payments -n ex280-lab14-payments --type=json \
  -p='[{"op":"replace","path":"/spec/ports/0/targetPort","value":9090}]' >/dev/null
ex280_apply_route ex280-lab14-payments payments payments "$(ex280_host payments-lab14)"

prepare ex280-lab14-catalog
ex280_apply_web ex280-lab14-catalog catalog CATALOG-OK 1
ex280_apply_web ex280-lab14-catalog decoy DECOY 1
ex280_apply_route ex280-lab14-catalog catalog decoy "$(ex280_host catalog-lab14)"

prepare ex280-lab14-inventory
ex280_apply_web ex280-lab14-inventory inventory INV-OK 1
oc patch deploy inventory -n ex280-lab14-inventory --type=json \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/not-ready"}]' >/dev/null
ex280_apply_route ex280-lab14-inventory inventory inventory "$(ex280_host inventory-lab14)"

prepare ex280-lab14-reports
ex280_apply_web ex280-lab14-reports reports REPORT-OK 1
ex280_apply_route ex280-lab14-reports reports reports "$(ex280_host reports-lab14)"
oc apply -f - >/dev/null <<'EOF'
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: ex280-lab14-reports
spec:
  podSelector: {}
  policyTypes:
  - Ingress
EOF

prepare ex280-lab14-checkout
oc apply -f - >/dev/null <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: checkout-config
  namespace: ex280-lab14-checkout
data:
  profile: "on"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: checkout
  namespace: ex280-lab14-checkout
spec:
  replicas: 1
  selector:
    matchLabels:
      app: checkout
  template:
    metadata:
      labels:
        app: checkout
    spec:
      containers:
      - name: app
        image: ${EX280_HTTPD_IMAGE}
        env:
        - name: CHECKOUT_MODE
          valueFrom:
            configMapKeyRef:
              name: checkout-config
              key: mode
        resources:
          requests:
            cpu: 20m
            memory: 16Mi
          limits:
            cpu: 100m
            memory: 64Mi
EOF

prepare ex280-lab14-audit
oc apply -f - >/dev/null <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: audit
  namespace: ex280-lab14-audit
spec:
  replicas: 1
  selector:
    matchLabels:
      app: audit
  template:
    metadata:
      labels:
        app: audit
    spec:
      containers:
      - name: app
        image: ${EX280_HTTPD_IMAGE}
        securityContext:
          runAsUser: 0
        resources:
          requests:
            cpu: 20m
            memory: 16Mi
          limits:
            cpu: 100m
            memory: 64Mi
EOF

prepare ex280-lab14-search
ex280_apply_web ex280-lab14-search search SEARCH-OK 1 "$missing"
ex280_apply_route ex280-lab14-search search search "$(ex280_host search-lab14)"

echo
echo "Lab 14 is ready. Eight projects named ex280-lab14-*"
echo "  http://$(ex280_host storefront-lab14)/"
echo "  http://$(ex280_host payments-lab14)/"
echo "  http://$(ex280_host catalog-lab14)/"
echo "  http://$(ex280_host inventory-lab14)/"
echo "  http://$(ex280_host reports-lab14)/"
echo "  http://$(ex280_host search-lab14)/"
