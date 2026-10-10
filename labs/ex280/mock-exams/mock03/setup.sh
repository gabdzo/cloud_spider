#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../../common/helpers.sh"
# shellcheck source=../../../lab12-tls-routes/manifests/tls.sh
source "$LAB_DIR/../../lab12-tls-routes/manifests/tls.sh"

EX280_LAB=mock03
NS=ex280-mock03
ex280_require_admin
ex280_require_cmd helm

if ex280_cert_manager_present; then
  if [[ -f "${EX280_STATE}/cert-manager-owned" ]]; then
    ex280_remove_cert_manager
  else
    echo "FAIL: cert-manager is already installed. Remove it before this mock."
    exit 1
  fi
fi

ex280_recreate_project "$NS" "$EX280_LAB"
ex280_recreate_project ex280-mock03-stale "$EX280_LAB"
ex280_recreate_project ex280-mock03-operators "$EX280_LAB"
ex280_mark_cert_manager

ex280_apply_web "$NS" shop SHOP-OK 1
oc patch svc shop -n "$NS" --type=merge -p '{"spec":{"selector":{"app":"shop-old"}}}' >/dev/null
ex280_apply_route "$NS" shop shop "$(ex280_host shop-mock03)"

ex280_apply_web "$NS" billing BILLING-OK 1
ex280_apply_route "$NS" billing shop "$(ex280_host billing-mock03)"

helm upgrade --install store "$LAB_DIR/manifests/chart" -n "$NS" --set replicaCount=1 --set html=HELM-OK >/dev/null
helm upgrade store "$LAB_DIR/manifests/chart" -n "$NS" --set replicaCount=1 --set html=HELM-OK --set image.tag=ex280-missing >/dev/null
ex280_apply_route "$NS" store store "$(ex280_host store-mock03)"

ex280_apply_web "$NS" edge EDGE-OK 1
work="${EX280_STATE}/mock03-tls"
rm -rf "$work"
mkdir -p "$work/good" "$work/bad"
ex280_tls_ca "$work/good" ex280-mock03-ca
ex280_tls_ca "$work/bad" ex280-mock03-bad
edge_host="$(ex280_host edge-mock03)"
ex280_tls_cert "$work/good" edge "$edge_host" "$work/good"
ex280_tls_cert "$work/bad" wrong wrong.example.com "$work/bad"
ex280_tls_apply_route "$NS" edge edge "$edge_host" edge "$work/good/edge.crt" "$work/bad/wrong.key"

oc apply -f - >/dev/null <<'EOF'
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: stale
  namespace: ex280-mock03-stale
spec:
  targetNamespaces:
  - ex280-mock03-stale
---
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: stale-catalog
  namespace: ex280-mock03-stale
spec:
  channel: stable
  installPlanApproval: Automatic
  name: does-not-exist
  source: community-operators
  sourceNamespace: openshift-marketplace
---
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: cert-manager
  namespace: ex280-mock03-operators
spec: {}
---
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: cert-manager
  namespace: ex280-mock03-operators
spec:
  channel: obsolete
  installPlanApproval: Automatic
  name: cert-manager
  source: community-operators
  sourceNamespace: openshift-marketplace
EOF

echo
echo "Mock 03 is ready"
echo "  http://$(ex280_host shop-mock03)/"
echo "  http://$(ex280_host billing-mock03)/"
echo "  http://$(ex280_host store-mock03)/"
echo "  https://${edge_host}/"
echo "  remove namespace ex280-mock03-stale"
echo "  cert-manager namespace: ex280-mock03-operators"
