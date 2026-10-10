#!/usr/bin/env bash
set -euo pipefail
LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=../../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"
NS=ex280-lab11
ex280_require_admin
oc apply -f "$LAB_DIR/answer/subscription.yaml" >/dev/null
ready=no
for _ in $(seq 1 60); do
  if oc get csv -n "$NS" -o jsonpath='{range .items[*]}{.status.phase}{"\n"}{end}' 2>/dev/null | grep -qx Succeeded; then
    ready=yes
    break
  fi
  sleep 10
done
if [[ "$ready" != "yes" ]]; then
  echo "FAIL: operator did not become ready"
  exit 1
fi
oc apply -f "$LAB_DIR/answer/issuer.yaml" >/dev/null
for _ in $(seq 1 30); do
  state="$(oc get issuer selfsigned -n "$NS" -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null || true)"
  if [[ "$state" == "True" ]]; then
    echo "Applied lab 11 fix"
    exit 0
  fi
  sleep 2
done
echo "FAIL: issuer did not become ready"
exit 1
