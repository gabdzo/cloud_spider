#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../../common/helpers.sh
source "$LAB_DIR/../../common/helpers.sh"
# shellcheck source=../../../lab12-tls-routes/manifests/tls.sh
source "$LAB_DIR/../../lab12-tls-routes/manifests/tls.sh"

EX280_LAB=mock03
NS=ex280-mock03
ex280_require_admin
ex280_require_cmd helm

oc patch svc shop -n "$NS" --type=merge -p '{"spec":{"selector":{"app":"shop"}}}' >/dev/null
oc patch route billing -n "$NS" --type=merge -p '{"spec":{"to":{"name":"billing"}}}' >/dev/null
helm upgrade store "$LAB_DIR/manifests/chart" -n "$NS" -f "$LAB_DIR/answer/values.yaml" >/dev/null

work="${EX280_STATE}/mock03-tls-fix"
rm -rf "$work"
mkdir -p "$work"
ex280_tls_ca "$work" ex280-mock03-fix
edge_host="$(ex280_host edge-mock03)"
ex280_tls_cert "$work" edge "$edge_host" "$work"
ex280_tls_apply_route "$NS" edge edge "$edge_host" edge "$work/edge.crt" "$work/edge.key"

ex280_delete_project ex280-mock03-stale
oc apply -f - >/dev/null <<'EOF'
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: cert-manager
  namespace: ex280-mock03-operators
spec:
  channel: stable
  installPlanApproval: Automatic
  name: cert-manager
  source: community-operators
  sourceNamespace: openshift-marketplace
EOF
ex280_wait_deployment "$NS" store 240
for _ in $(seq 1 60); do
  if oc get csv -n ex280-mock03-operators -o jsonpath='{range .items[*]}{.status.phase}{"\n"}{end}' 2>/dev/null | grep -qx Succeeded; then
    break
  fi
  sleep 10
done
oc apply -f "$LAB_DIR/answer/operator.yaml" >/dev/null
for _ in $(seq 1 30); do
  state="$(oc get issuer selfsigned -n ex280-mock03-operators -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
  if [[ "$state" == "True" ]]; then
    echo "Applied mock 03 fix"
    exit 0
  fi
  sleep 2
done
echo "FAIL: operator or issuer did not become ready"
exit 1
