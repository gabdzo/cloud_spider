#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

EX280_LAB=lab11
NS=ex280-lab11
ex280_require_admin

if ex280_cert_manager_present && [[ ! -f "${EX280_STATE}/cert-manager-owned" ]]; then
  echo "FAIL: cert-manager is already installed. Remove it before this lab."
  exit 1
fi

ex280_recreate_project "$NS" "$EX280_LAB"
ex280_mark_cert_manager

oc apply -f - >/dev/null <<EOF
apiVersion: operators.coreos.com/v1
kind: OperatorGroup
metadata:
  name: ex280-lab11
  namespace: ${NS}
spec: {}
---
apiVersion: operators.coreos.com/v1alpha1
kind: Subscription
metadata:
  name: cert-manager
  namespace: ${NS}
spec:
  channel: obsolete
  installPlanApproval: Automatic
  name: cert-manager
  source: community-operators
  sourceNamespace: openshift-marketplace
EOF

echo
echo "Lab 11 is ready in project ${NS}"
echo "Subscription cert-manager is not healthy"
