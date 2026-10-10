#!/usr/bin/env bash
# Shared helpers for EX280 labs. Source this file; do not execute it.

EX280_HTTPD_IMAGE="${EX280_HTTPD_IMAGE:-registry.access.redhat.com/ubi9/httpd-24:latest}"
EX280_UBI_IMAGE="${EX280_UBI_IMAGE:-registry.access.redhat.com/ubi9/ubi:latest}"
EX280_PASSES=0
EX280_FAILS=0

ex280_root() {
  cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd
}

EX280_ROOT="$(ex280_root)"
EX280_STATE="${EX280_ROOT}/.state"

ex280_require_cmd() {
  local cmd="$1"
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "FAIL: required command not found: ${cmd}"
    exit 1
  fi
}

ex280_apps_domain() {
  if [[ -n "${EX280_APPS_DOMAIN:-}" ]]; then
    printf '%s\n' "$EX280_APPS_DOMAIN"
    return
  fi
  EX280_APPS_DOMAIN="$(oc get ingresscontroller default -n openshift-ingress-operator -o jsonpath='{.status.domain}' 2>/dev/null || true)"
  export EX280_APPS_DOMAIN
  printf '%s\n' "$EX280_APPS_DOMAIN"
}

ex280_require_admin() {
  ex280_require_cmd oc
  ex280_require_cmd python3
  ex280_require_cmd openssl
  ex280_require_cmd curl
  if ! oc whoami >/dev/null 2>&1; then
    echo "FAIL: oc is not logged in to a cluster"
    exit 1
  fi
  if ! oc auth can-i '*' '*' --all-namespaces >/dev/null 2>&1; then
    echo "FAIL: current user is not cluster-admin"
    exit 1
  fi
  if [[ -z "$(ex280_apps_domain)" ]]; then
    echo "FAIL: default IngressController has no apps domain"
    exit 1
  fi
  mkdir -p "$EX280_STATE"
}

ex280_host() {
  local name="$1"
  printf '%s.%s\n' "$name" "$(ex280_apps_domain)"
}

ex280_delete_project() {
  local ns="$1"
  case "$ns" in
    ex280-*) ;;
    *)
      echo "FAIL: refusing to delete project outside the ex280- prefix: ${ns}"
      exit 1
      ;;
  esac
  if ! oc get ns "$ns" >/dev/null 2>&1; then
    return 0
  fi
  oc delete ns "$ns" --wait=false --ignore-not-found >/dev/null
  local i
  for i in $(seq 1 90); do
    if ! oc get ns "$ns" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "FAIL: timed out deleting project ${ns}"
  exit 1
}

ex280_recreate_project() {
  local ns="$1"
  local lab="$2"
  ex280_delete_project "$ns"
  oc apply -f - >/dev/null <<EOF
apiVersion: v1
kind: Namespace
metadata:
  name: ${ns}
  labels:
    ex280.lab: ${lab}
    app.kubernetes.io/part-of: ex280-labs
EOF
  local i
  for i in $(seq 1 30); do
    phase="$(oc get ns "$ns" -o jsonpath='{.status.phase}' 2>/dev/null || true)"
    if [[ "$phase" == "Active" ]]; then
      return 0
    fi
    sleep 1
  done
  echo "FAIL: project ${ns} did not become Active"
  exit 1
}

ex280_variant() {
  local lab="$1"
  local max="$2"
  local file="${EX280_STATE}/${lab}.variant"
  local choice
  mkdir -p "$EX280_STATE"
  if [[ -n "${VARIANT:-}" ]]; then
    if ! [[ "$VARIANT" =~ ^[0-9]+$ ]] || [[ "$VARIANT" -lt 1 ]] || [[ "$VARIANT" -gt "$max" ]]; then
      echo "FAIL: VARIANT must be between 1 and ${max}"
      exit 1
    fi
    printf '%s\n' "$VARIANT" >"$file"
    printf '%s\n' "$VARIANT"
    return
  fi
  if [[ "${SHUFFLE:-}" == "1" ]]; then
    choice=$(( (RANDOM % max) + 1 ))
    printf '%s\n' "$choice" >"$file"
    printf '%s\n' "$choice"
    return
  fi
  if [[ -f "$file" ]]; then
    cat "$file"
    return
  fi
  printf '1\n' >"$file"
  printf '1\n'
}

ex280_pass() {
  EX280_PASSES=$((EX280_PASSES + 1))
  echo "PASS: $*"
}

ex280_fail() {
  EX280_FAILS=$((EX280_FAILS + 1))
  echo "FAIL: $*"
}

ex280_finish() {
  echo
  echo "Result: ${EX280_PASSES} passed, ${EX280_FAILS} failed"
  if [[ "$EX280_FAILS" -gt 0 ]]; then
    exit 1
  fi
}

ex280_curl_contains() {
  local url="$1"
  local needle="$2"
  local insecure="${3:-}"
  local i out
  for i in $(seq 1 12); do
    if out="$(curl -fsSL --max-time 8 $insecure "$url" 2>/dev/null)"; then
      if [[ "$out" == *"$needle"* ]]; then
        return 0
      fi
    fi
    sleep 5
  done
  return 1
}

ex280_route_http_ok() {
  local host="$1"
  local needle="$2"
  local path="${3:-/}"
  ex280_curl_contains "http://${host}${path}" "$needle"
}

ex280_resources_match() {
  local ns="$1"
  local deploy="$2"
  local cpu_req="$3"
  local mem_req="$4"
  local cpu_lim="$5"
  local mem_lim="$6"
  oc get deploy "$deploy" -n "$ns" -o json | python3 -c '
import json, sys
want = sys.argv[1:]
def cpu(v):
    if not v:
        return None
    v = str(v)
    return float(v[:-1]) if v.endswith("m") else float(v) * 1000
def mem(v):
    if not v:
        return None
    v = str(v)
    for suf, mul in (("Ki", 1024), ("Mi", 1024**2), ("Gi", 1024**3)):
        if v.endswith(suf):
            return float(v[:-len(suf)]) * mul
    return float(v)
doc = json.load(sys.stdin)
container = doc["spec"]["template"]["spec"]["containers"][0]
res = container.get("resources") or {}
req = res.get("requests") or {}
lim = res.get("limits") or {}
got = [cpu(req.get("cpu")), mem(req.get("memory")), cpu(lim.get("cpu")), mem(lim.get("memory"))]
expected = [cpu(want[0]), mem(want[1]), cpu(want[2]), mem(want[3])]
sys.exit(0 if got == expected else 1)
' "$cpu_req" "$mem_req" "$cpu_lim" "$mem_lim"
}

ex280_deployment_ready() {
  local ns="$1"
  local name="$2"
  local want="$3"
  local ready
  ready="$(oc get deploy "$name" -n "$ns" -o jsonpath='{.status.readyReplicas}' 2>/dev/null || true)"
  [[ "$ready" == "$want" ]]
}

ex280_wait_deployment() {
  local ns="$1"
  local name="$2"
  local timeout="${3:-180}"
  if ! oc rollout status "deployment/${name}" -n "$ns" --timeout="${timeout}s" >/dev/null; then
    echo "FAIL: deployment ${ns}/${name} did not become available"
    exit 1
  fi
}

ex280_apply_web() {
  local ns="$1"
  local name="$2"
  local html="$3"
  local replicas="${4:-1}"
  local image="${5:-$EX280_HTTPD_IMAGE}"
  local alias_path="${6:-}"
  local extra_mounts=""
  local extra_volumes=""
  if [[ -n "$alias_path" ]]; then
    extra_mounts="        - name: httpd-conf
          mountPath: /etc/httpd/conf.d/alias.conf
          subPath: alias.conf"
    extra_volumes="      - name: httpd-conf
        configMap:
          name: ${name}-httpd"
    oc apply -f - >/dev/null <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${name}-httpd
  namespace: ${ns}
  labels:
    ex280.lab: ${EX280_LAB}
data:
  alias.conf: |
    RedirectMatch 302 ^${alias_path}$ ${alias_path}/
    Alias ${alias_path}/ /var/www/html/
    <Directory "/var/www/html">
      Require all granted
      DirectoryIndex index.html
    </Directory>
EOF
  fi
  oc apply -f - >/dev/null <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: ${name}-html
  namespace: ${ns}
  labels:
    ex280.lab: ${EX280_LAB}
data:
  index.html: |
    ${html}
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: ${ns}
  labels:
    app: ${name}
    ex280.lab: ${EX280_LAB}
spec:
  replicas: ${replicas}
  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}
    spec:
      containers:
      - name: app
        image: ${image}
        ports:
        - name: http
          containerPort: 8080
        readinessProbe:
          httpGet:
            path: /
            port: http
          initialDelaySeconds: 2
          periodSeconds: 5
        resources:
          requests:
            cpu: 20m
            memory: 16Mi
          limits:
            cpu: 100m
            memory: 64Mi
        volumeMounts:
        - name: html
          mountPath: /var/www/html/index.html
          subPath: index.html
${extra_mounts}
      volumes:
      - name: html
        configMap:
          name: ${name}-html
${extra_volumes}
EOF
  oc apply -f - >/dev/null <<EOF
apiVersion: v1
kind: Service
metadata:
  name: ${name}
  namespace: ${ns}
  labels:
    ex280.lab: ${EX280_LAB}
spec:
  selector:
    app: ${name}
  ports:
  - name: http
    port: 8080
    targetPort: http
EOF
}

ex280_apply_client() {
  local ns="$1"
  local name="${2:-client}"
  oc apply -f - >/dev/null <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: ${ns}
  labels:
    app: ${name}
    ex280.lab: ${EX280_LAB}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}
    spec:
      containers:
      - name: client
        image: ${EX280_UBI_IMAGE}
        command: ["sleep", "infinity"]
        resources:
          requests:
            cpu: 10m
            memory: 32Mi
          limits:
            cpu: 100m
            memory: 128Mi
EOF
}

ex280_apply_route() {
  local ns="$1"
  local name="$2"
  local service="$3"
  local host="$4"
  local path="${5:-}"
  local path_line=""
  if [[ -n "$path" ]]; then
    path_line="  path: ${path}"
  fi
  oc apply -f - >/dev/null <<EOF
apiVersion: route.openshift.io/v1
kind: Route
metadata:
  name: ${name}
  namespace: ${ns}
  labels:
    ex280.lab: ${EX280_LAB}
spec:
  host: ${host}
${path_line}
  to:
    kind: Service
    name: ${service}
  port:
    targetPort: http
EOF
}

ex280_exec_ok() {
  local ns="$1"
  local deploy="$2"
  shift 2
  local i
  for i in $(seq 1 8); do
    if oc exec -n "$ns" "deploy/${deploy}" -- "$@" >/dev/null 2>&1; then
      return 0
    fi
    sleep 3
  done
  return 1
}

ex280_exec_fail() {
  local ns="$1"
  local deploy="$2"
  shift 2
  if oc exec -n "$ns" "deploy/${deploy}" -- "$@" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

ex280_groups_of() {
  local user="$1"
  oc get groups -o json | python3 -c '
import json, sys
user = sys.argv[1]
doc = json.load(sys.stdin)
for group in doc.get("items") or []:
    if user in (group.get("users") or []):
        print(group["metadata"]["name"])
' "$user"
}

ex280_user_can() {
  local user="$1"
  local ns="$2"
  shift 2
  if oc auth can-i "$@" -n "$ns" --as="$user" >/dev/null 2>&1; then
    return 0
  fi
  local group
  while IFS= read -r group; do
    [[ -z "$group" ]] && continue
    if oc auth can-i "$@" -n "$ns" --as="$user" --as-group="$group" >/dev/null 2>&1; then
      return 0
    fi
  done < <(ex280_groups_of "$user")
  return 1
}

ex280_sync_htpasswd() {
  local file="${EX280_STATE}/htpasswd"
  mkdir -p "${EX280_STATE}/users"
  : >"$file"
  local user_file user hash
  for user_file in "${EX280_STATE}/users"/*; do
    [[ -e "$user_file" ]] || continue
    user="$(basename "$user_file")"
    hash="$(openssl passwd -apr1 "$(cat "$user_file")")"
    printf '%s:%s\n' "$user" "$hash" >>"$file"
  done
  if [[ ! -s "$file" ]]; then
    echo "FAIL: no lab users to publish"
    exit 1
  fi
  oc create secret generic ex280-labs-htpasswd \
    --from-file=htpasswd="$file" \
    -n openshift-config \
    --dry-run=client -o yaml | oc apply -f - >/dev/null
  python3 - <<'PY'
import json, subprocess
doc = json.loads(subprocess.check_output(["oc", "get", "oauth", "cluster", "-o", "json"]))
idps = (doc.get("spec") or {}).get("identityProviders") or []
idps = [item for item in idps if item.get("name") != "ex280-labs"]
idps.append({
    "name": "ex280-labs",
    "mappingMethod": "claim",
    "type": "HTPasswd",
    "htpasswd": {"fileData": {"name": "ex280-labs-htpasswd"}},
})
patch = json.dumps({"spec": {"identityProviders": idps}})
subprocess.check_call(["oc", "patch", "oauth", "cluster", "--type", "merge", "-p", patch])
PY
}

ex280_ensure_user() {
  local user="$1"
  local password="$2"
  case "$user" in
    ex280-*) ;;
    *)
      echo "FAIL: lab users must use the ex280- prefix"
      exit 1
      ;;
  esac
  mkdir -p "${EX280_STATE}/users"
  printf '%s\n' "$password" >"${EX280_STATE}/users/${user}"
  oc get user "$user" >/dev/null 2>&1 || oc create user "$user" >/dev/null
}

ex280_remove_lab_idp() {
  python3 - <<'PY'
import json, subprocess
doc = json.loads(subprocess.check_output(["oc", "get", "oauth", "cluster", "-o", "json"]))
spec = doc.get("spec") or {}
idps = spec.get("identityProviders") or []
filtered = [item for item in idps if item.get("name") != "ex280-labs"]
if len(filtered) == len(idps):
    raise SystemExit(0)
patch = json.dumps({"spec": {"identityProviders": filtered}})
subprocess.check_call(["oc", "patch", "oauth", "cluster", "--type", "merge", "-p", patch])
PY
  oc delete secret ex280-labs-htpasswd -n openshift-config --ignore-not-found >/dev/null
  if [[ -d "${EX280_STATE}/users" ]]; then
    local user_file user
    for user_file in "${EX280_STATE}/users"/*; do
      [[ -e "$user_file" ]] || continue
      user="$(basename "$user_file")"
      oc delete "identity/ex280-labs:${user}" --ignore-not-found >/dev/null
      oc delete "user/${user}" --ignore-not-found >/dev/null
    done
  fi
}

ex280_backup_project_template() {
  local file="${EX280_STATE}/project-request-template-name"
  if [[ -f "$file" ]]; then
    return 0
  fi
  oc get project.config.openshift.io cluster -o jsonpath='{.spec.projectRequestTemplate.name}' >"$file" || true
}

ex280_restore_project_template() {
  local file="${EX280_STATE}/project-request-template-name"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  local name
  name="$(cat "$file")"
  if [[ -z "$name" ]]; then
    oc patch project.config.openshift.io cluster --type=json \
      -p='[{"op":"remove","path":"/spec/projectRequestTemplate"}]' >/dev/null 2>&1 || true
  else
    oc patch project.config.openshift.io cluster --type=merge \
      -p "{\"spec\":{\"projectRequestTemplate\":{\"name\":\"${name}\"}}}" >/dev/null
  fi
}

ex280_cert_manager_present() {
  oc get crd certificates.cert-manager.io >/dev/null 2>&1
}

ex280_wait_authentication() {
  local i available progressing
  for i in $(seq 1 36); do
    available="$(oc get co authentication -o jsonpath='{.status.conditions[?(@.type=="Available")].status}' 2>/dev/null || true)"
    progressing="$(oc get co authentication -o jsonpath='{.status.conditions[?(@.type=="Progressing")].status}' 2>/dev/null || true)"
    if [[ "$available" == "True" && "$progressing" == "False" ]]; then
      return 0
    fi
    sleep 5
  done
  echo "FAIL: authentication operator did not settle"
  exit 1
}

ex280_mark_cert_manager() {
  mkdir -p "$EX280_STATE"
  printf 'owned\n' >"${EX280_STATE}/cert-manager-owned"
}

ex280_remove_cert_manager() {
  if [[ ! -f "${EX280_STATE}/cert-manager-owned" ]]; then
    return 0
  fi
  local ns
  for ns in ex280-lab11 ex280-mock03-operators; do
    if oc get ns "$ns" >/dev/null 2>&1; then
      oc delete subscription,csv,operatorgroup --all -n "$ns" --ignore-not-found >/dev/null 2>&1 || true
      ex280_delete_project "$ns"
    fi
  done
  local crd i
  for crd in \
    certificates.cert-manager.io \
    certificaterequests.cert-manager.io \
    issuers.cert-manager.io \
    clusterissuers.cert-manager.io \
    challenges.acme.cert-manager.io \
    orders.acme.cert-manager.io
  do
    oc delete "crd/${crd}" --ignore-not-found --wait=false >/dev/null 2>&1 || true
  done
  local _attempt
  for _attempt in $(seq 1 60); do
    if ! oc get crd certificates.cert-manager.io >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  local name
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    oc delete "clusterrole/${name}" --ignore-not-found >/dev/null 2>&1 || true
  done < <(oc get clusterrole -o jsonpath='{range .items[*]}{.metadata.name}{"\n"}{end}' | grep '^cert-manager' || true)
  while IFS= read -r name; do
    [[ -z "$name" ]] && continue
    oc delete "${name}" --ignore-not-found >/dev/null 2>&1 || true
  done < <(oc get apiservice,validatingwebhookconfiguration,mutatingwebhookconfiguration -o name | grep 'cert-manager' || true)
  rm -f "${EX280_STATE}/cert-manager-owned"
}
