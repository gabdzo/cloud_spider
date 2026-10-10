#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

EX280_LAB=lab09
NS=ex280-lab09
ex280_require_admin
ex280_recreate_project "$NS" "$EX280_LAB"

oc apply -f - >/dev/null <<EOF
apiVersion: batch/v1
kind: Job
metadata:
  name: batch
  namespace: ${NS}
spec:
  completions: 3
  parallelism: 2
  backoffLimit: 2
  template:
    spec:
      restartPolicy: Never
      containers:
      - name: batch
        image: ${EX280_HTTPD_IMAGE}
        command: ["/bin/sh", "-c", "exit 1"]
        resources:
          requests:
            cpu: 20m
            memory: 64Mi
          limits:
            cpu: 200m
            memory: 256Mi
---
apiVersion: batch/v1
kind: CronJob
metadata:
  name: tick
  namespace: ${NS}
spec:
  schedule: "0 0 31 2 *"
  suspend: true
  successfulJobsHistoryLimit: 1
  failedJobsHistoryLimit: 4
  jobTemplate:
    spec:
      template:
        spec:
          restartPolicy: Never
          containers:
          - name: tick
            image: ${EX280_HTTPD_IMAGE}
            command: ["/bin/sh", "-c", "exit 1"]
            resources:
              requests:
                cpu: 20m
                memory: 64Mi
              limits:
                cpu: 200m
                memory: 256Mi
EOF

echo
echo "Lab 09 is ready in project ${NS}"
