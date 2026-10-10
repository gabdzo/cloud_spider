#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

EX280_LAB=lab15
NS=ex280-lab15
PEER=ex280-lab15-peer
ex280_require_admin
ex280_recreate_project "$NS" "$EX280_LAB"
ex280_recreate_project "$PEER" "$EX280_LAB"
ex280_apply_client "$PEER" client
oc get user ex280-reader >/dev/null 2>&1 || oc create user ex280-reader >/dev/null
oc delete group ex280-lab15-readers ex280-lab15-other --ignore-not-found >/dev/null
oc adm groups new ex280-lab15-readers ex280-reader >/dev/null
oc adm groups new ex280-lab15-other >/dev/null
oc label group ex280-lab15-readers ex280-lab15-other ex280.lab=lab15 --overwrite >/dev/null

oc apply -f - >/dev/null <<EOF
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
  name: readers
  namespace: ${NS}
subjects:
- kind: Group
  name: ex280-lab15-other
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: view
  apiGroup: rbac.authorization.k8s.io
EOF

echo
echo "Lab 15 is ready"
echo "  project: ${NS}"
echo "  peer: ${PEER}"
echo "  user: ex280-reader"
echo "  route host: $(ex280_host web-lab15)"
