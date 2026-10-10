#!/usr/bin/env bash
# Shared, READ-ONLY checks for the Kubernetes (EKS) variants of the EX280
# labs. Source it from a lab's check.sh. Every helper only reads the
# cluster: kubectl get / auth can-i / helm status. Nothing here applies,
# patches, deletes, execs into a pod or port-forwards, so Cloud Spider may
# run check.sh itself. Output: one PASS/FAIL line per check, exit 1 on any
# FAIL (the same contract as the OpenShift verify.sh).
set -uo pipefail

K8S_PASSES=0
K8S_FAILS=0

k8s_pass() { echo "PASS: $*"; K8S_PASSES=$((K8S_PASSES + 1)); }
k8s_fail() { echo "FAIL: $*"; K8S_FAILS=$((K8S_FAILS + 1)); }
k8s_check() { local text="$1"; shift; if "$@" >/dev/null 2>&1; then k8s_pass "$text"; else k8s_fail "$text"; fi; }

k8s_finish() {
  echo "${K8S_PASSES} passed, ${K8S_FAILS} failed"
  [[ "$K8S_FAILS" -eq 0 ]]
}

k8s_require() {
  if ! command -v kubectl >/dev/null 2>&1; then echo "FAIL: kubectl is not installed"; exit 1; fi
  if ! kubectl version --request-timeout=5s >/dev/null 2>&1; then echo "FAIL: kubectl cannot reach a cluster (context: $(kubectl config current-context 2>/dev/null || echo none))"; exit 1; fi
}

k8s_get() { kubectl get "$@" 2>/dev/null; }
k8s_json() { kubectl get "$@" -o json 2>/dev/null; }
k8s_jsonpath() { local path="$1"; shift; kubectl get "$@" -o "jsonpath=${path}" 2>/dev/null; }

# Deployment has at least N ready replicas and its latest rollout is done.
k8s_ready() {
  local ns="$1" name="$2" want="$3" ready updated
  ready="$(k8s_jsonpath '{.status.readyReplicas}' deploy "$name" -n "$ns")"
  updated="$(k8s_jsonpath '{.status.updatedReplicas}' deploy "$name" -n "$ns")"
  [[ "${ready:-0}" -ge "$want" && "${updated:-0}" -ge "$want" ]]
}

# Service has at least one ready endpoint.
k8s_endpoints() {
  local ns="$1" svc="$2" ips
  ips="$(k8s_jsonpath '{range .items[*].endpoints[?(@.conditions.ready==true)]}{.addresses[0]}{" "}{end}' endpointslices -n "$ns" -l "kubernetes.io/service-name=${svc}")"
  [[ -n "${ips// /}" ]]
}

# Every container of a deployment has these requests and limits.
k8s_resources() {
  local ns="$1" name="$2" rc="$3" rm="$4" lc="$5" lm="$6"
  k8s_json deploy "$name" -n "$ns" | python3 -c '
import json, sys
want = dict(zip(["rc", "rm", "lc", "lm"], sys.argv[1:5]))
doc = json.load(sys.stdin)
for c in doc["spec"]["template"]["spec"]["containers"]:
    r = c.get("resources") or {}
    got = {"rc": (r.get("requests") or {}).get("cpu"), "rm": (r.get("requests") or {}).get("memory"),
           "lc": (r.get("limits") or {}).get("cpu"), "lm": (r.get("limits") or {}).get("memory")}
    if got != want:
        sys.exit(1)
' "$rc" "$rm" "$lc" "$lm"
}

# can-i as a user with the groups given (impersonation; read-only).
k8s_can() {
  local user="$1" groups="$2" ns="$3"; shift 3
  local args=(--as "$user")
  local g
  for g in ${groups//,/ }; do args+=(--as-group "$g"); done
  kubectl auth can-i "$@" -n "$ns" "${args[@]}" >/dev/null 2>&1
}
