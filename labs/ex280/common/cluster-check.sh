#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/helpers.sh"

ex280_require_admin

echo "PASS: logged in as $(oc whoami)"
echo "PASS: cluster-admin permissions present"
echo "PASS: apps domain is $(ex280_apps_domain)"

if ! oc get ns openshift-ingress >/dev/null 2>&1; then
  echo "FAIL: openshift-ingress namespace is missing"
  exit 1
fi
echo "PASS: ingress namespace is present"

if ! oc get ns openshift-dns >/dev/null 2>&1; then
  echo "FAIL: openshift-dns namespace is missing"
  exit 1
fi
echo "PASS: DNS namespace is present"

echo
echo "Cluster check passed"
