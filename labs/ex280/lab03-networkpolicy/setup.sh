#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

EX280_LAB=lab03
BACK=ex280-lab03-back
FRONT=ex280-lab03-front
OTHER=ex280-lab03-other
ex280_require_admin
variant="$(ex280_variant lab03 3)"

ex280_recreate_project "$BACK" "$EX280_LAB"
ex280_recreate_project "$FRONT" "$EX280_LAB"
ex280_recreate_project "$OTHER" "$EX280_LAB"

ex280_apply_web "$BACK" web WEB-OK 1
ex280_apply_client "$BACK" client
ex280_apply_client "$FRONT" client
ex280_apply_client "$OTHER" client
ex280_apply_route "$BACK" web web "$(ex280_host back-lab03)"

oc apply -f - >/dev/null <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: default-deny
  namespace: ${BACK}
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  - Egress
EOF

apply_allow_front() {
  local mode="$1"
  if [[ "$mode" == "and" ]]; then
    oc apply -f - >/dev/null <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend
  namespace: ${BACK}
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: ${FRONT}
      podSelector:
        matchLabels:
          app: not-the-client
EOF
  else
    oc apply -f - >/dev/null <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-frontend
  namespace: ${BACK}
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: ${FRONT}
EOF
  fi
}

apply_router() {
  oc apply -f - >/dev/null <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-router
  namespace: ${BACK}
spec:
  podSelector: {}
  policyTypes:
  - Ingress
  ingress:
  - from:
    - namespaceSelector:
        matchLabels:
          network.openshift.io/policy-group: ingress
EOF
}

apply_dns() {
  oc apply -f - >/dev/null <<EOF
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-dns
  namespace: ${BACK}
spec:
  podSelector: {}
  policyTypes:
  - Egress
  egress:
  - to:
    - namespaceSelector:
        matchLabels:
          kubernetes.io/metadata.name: openshift-dns
    ports:
    - protocol: UDP
      port: 5353
    - protocol: TCP
      port: 5353
EOF
}

case "$variant" in
  1) apply_allow_front and ;;
  2)
    apply_allow_front or
    apply_dns
    ;;
  3)
    apply_allow_front or
    apply_router
    ;;
esac

echo
echo "Lab 03 is ready"
echo "  backend: ${BACK}"
echo "  allowed client: ${FRONT}"
echo "  denied client: ${OTHER}"
echo "  http://$(ex280_host back-lab03)/"
