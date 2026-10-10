#!/usr/bin/env bash
set -euo pipefail

source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/helpers.sh"

ex280_require_admin

echo "Removing EX280 lab projects"
mapfile -t projects < <(oc get ns -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | grep -E '^ex280-(lab|mock)' || true)
if [[ "${#projects[@]}" -eq 0 ]]; then
  echo "No ex280- projects found"
else
  for ns in "${projects[@]}"; do
    ex280_delete_project "$ns"
    echo "Deleted project ${ns}"
  done
fi

echo "Removing lab identity provider"
ex280_remove_lab_idp

if [[ -d "${EX280_STATE}/users" ]]; then
  for user_file in "${EX280_STATE}/users"/*; do
    [[ -e "$user_file" ]] || continue
    user="$(basename "$user_file")"
    oc delete "group" -l "ex280.user=${user}" --ignore-not-found >/dev/null 2>&1 || true
  done
fi

echo "Removing lab users"
while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  oc delete "identity/ex280-labs:${name}" --ignore-not-found >/dev/null
  oc delete "user/${name}" --ignore-not-found >/dev/null
  echo "Deleted user ${name}"
done < <(oc get users -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | grep '^ex280-' || true)

echo "Removing lab groups, roles, and SCCs"
while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  oc delete "group/${name}" --ignore-not-found >/dev/null
  echo "Deleted group ${name}"
done < <(oc get groups -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | grep '^ex280-' || true)

while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  oc delete "clusterrole/${name}" --ignore-not-found >/dev/null
  echo "Deleted clusterrole ${name}"
done < <(oc get clusterrole -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | grep '^ex280-' || true)

while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  oc delete "clusterrolebinding/${name}" --ignore-not-found >/dev/null
  echo "Deleted clusterrolebinding ${name}"
done < <(oc get clusterrolebinding -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | grep '^ex280-' || true)

while IFS= read -r name; do
  [[ -z "$name" ]] && continue
  oc delete "scc/${name}" --ignore-not-found >/dev/null
  echo "Deleted scc ${name}"
done < <(oc get scc -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | grep '^ex280-' || true)

echo "Removing lab operators if this repo installed them"
ex280_remove_cert_manager

echo "Restoring project request template"
ex280_restore_project_template
oc delete template ex280-project-request -n openshift-config --ignore-not-found >/dev/null

rm -rf "$EX280_STATE"
echo "Cleanup finished"
