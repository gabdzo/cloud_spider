#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"
ex280_require_admin

oc patch svc storefront -n ex280-lab14-storefront --type=merge -p '{"spec":{"selector":{"app":"storefront"}}}' >/dev/null
oc patch svc payments -n ex280-lab14-payments --type=json \
  -p='[{"op":"replace","path":"/spec/ports/0/targetPort","value":"http"}]' >/dev/null
oc patch route catalog -n ex280-lab14-catalog --type=merge -p '{"spec":{"to":{"name":"catalog"}}}' >/dev/null
oc patch deploy inventory -n ex280-lab14-inventory --type=json \
  -p='[{"op":"replace","path":"/spec/template/spec/containers/0/readinessProbe/httpGet/path","value":"/"}]' >/dev/null
oc apply -f - >/dev/null <<'EOF'
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: allow-router
  namespace: ex280-lab14-reports
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
oc patch configmap checkout-config -n ex280-lab14-checkout --type=merge -p '{"data":{"mode":"live"}}' >/dev/null
oc rollout restart deployment/checkout -n ex280-lab14-checkout >/dev/null
oc patch deploy audit -n ex280-lab14-audit --type=json \
  -p='[{"op":"remove","path":"/spec/template/spec/containers/0/securityContext"}]' >/dev/null
oc set image deployment/search "app=${EX280_HTTPD_IMAGE}" -n ex280-lab14-search >/dev/null

ex280_wait_deployment ex280-lab14-inventory inventory 180
ex280_wait_deployment ex280-lab14-checkout checkout 180
ex280_wait_deployment ex280-lab14-audit audit 180
ex280_wait_deployment ex280-lab14-search search 240
echo "Applied lab 14 fix"
