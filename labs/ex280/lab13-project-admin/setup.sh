#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

EX280_LAB=lab13
NS=ex280-lab13-app
ex280_require_admin
ex280_backup_project_template
ex280_recreate_project "$NS" "$EX280_LAB"
oc get user ex280-dev >/dev/null 2>&1 || oc create user ex280-dev >/dev/null

oc apply -f "$LAB_DIR/manifests/project-request.yaml" >/dev/null
oc patch project.config.openshift.io cluster --type=merge \
  -p '{"spec":{"projectRequestTemplate":{"name":"ex280-project-request"}}}' >/dev/null

oc apply -f - >/dev/null <<EOF
apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: data
  namespace: ${NS}
spec:
  accessModes:
  - ReadWriteOnce
  storageClassName: ex280-missing
  resources:
    requests:
      storage: 1Gi
EOF

echo
echo "Lab 13 is ready"
echo "  project: ${NS}"
echo "  template: ex280-project-request"
echo "  user: ex280-dev"
