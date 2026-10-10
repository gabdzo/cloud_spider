#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

EX280_LAB=lab04
NS=ex280-lab04
ex280_require_admin
ex280_recreate_project "$NS" "$EX280_LAB"
ex280_apply_web "$NS" web WEB-OK 1

alice_pw="$(openssl rand -hex 8)"
bob_pw="$(openssl rand -hex 8)"
carol_pw="$(openssl rand -hex 8)"
ex280_ensure_user ex280-alice "$alice_pw"
ex280_ensure_user ex280-bob "$bob_pw"
ex280_ensure_user ex280-carol "$carol_pw"
ex280_ensure_user ex280-legacy "$(openssl rand -hex 8)"
ex280_sync_htpasswd
ex280_wait_authentication

oc delete group ex280-viewers ex280-editors ex280-contractors ex280-auditors --ignore-not-found >/dev/null
oc adm groups new ex280-viewers ex280-alice >/dev/null
oc adm groups new ex280-editors ex280-bob >/dev/null
oc adm groups new ex280-contractors ex280-carol >/dev/null
oc label group ex280-viewers ex280-editors ex280-contractors ex280.lab=lab04 --overwrite >/dev/null

oc adm groups new ex280-auditors >/dev/null
oc label group ex280-auditors ex280.lab=lab04 --overwrite >/dev/null

oc apply -f - >/dev/null <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: pod-reader
  namespace: ${NS}
rules:
- apiGroups: [""]
  resources: ["pods"]
  verbs: ["get", "list", "watch"]
- apiGroups: [""]
  resources: ["pods/log"]
  verbs: ["get"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: auditors-pod-reader
  namespace: ${NS}
subjects:
- kind: Group
  name: ex280-auditors
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: pod-reader
  apiGroup: rbac.authorization.k8s.io
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: legacy-edit
  namespace: ${NS}
subjects:
- kind: User
  name: ex280-legacy
  apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: edit
  apiGroup: rbac.authorization.k8s.io
EOF

echo
echo "Lab 04 is ready in project ${NS}"
echo "Identity provider: ex280-labs"
echo "  ex280-alice  ${alice_pw}"
echo "  ex280-bob    ${bob_pw}"
echo "  ex280-carol  ${carol_pw}"
echo "Find group membership on the cluster. The starting grants are not the required access."
