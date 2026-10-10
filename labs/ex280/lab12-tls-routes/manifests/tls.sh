#!/usr/bin/env bash
# Certificate helpers used by setup and the answer applicator.

ex280_tls_ca() {
  local dir="$1"
  local cn="$2"
  openssl req -x509 -newkey rsa:2048 -keyout "${dir}/ca.key" -out "${dir}/ca.crt" \
    -days 365 -nodes -subj "/CN=${cn}" >/dev/null 2>&1
}

ex280_tls_cert() {
  local dir="$1"
  local name="$2"
  local cn="$3"
  local ca_dir="$4"
  openssl genrsa -out "${dir}/${name}.key" 2048 >/dev/null 2>&1
  openssl req -new -key "${dir}/${name}.key" -out "${dir}/${name}.csr" -subj "/CN=${cn}" >/dev/null 2>&1
  cat >"${dir}/${name}.ext" <<EOF
subjectAltName=DNS:${cn}
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
basicConstraints=CA:FALSE
EOF
  openssl x509 -req -in "${dir}/${name}.csr" -CA "${ca_dir}/ca.crt" -CAkey "${ca_dir}/ca.key" \
    -CAcreateserial -out "${dir}/${name}.crt" -days 365 -extfile "${dir}/${name}.ext" >/dev/null 2>&1
}

ex280_tls_secret() {
  local ns="$1"
  local name="$2"
  local crt="$3"
  local key="$4"
  oc create secret tls "$name" -n "$ns" --cert="$crt" --key="$key" --dry-run=client -o yaml | oc apply -f - >/dev/null
}

ex280_tls_apply_route() {
  local ns="$1"
  local name="$2"
  local service="$3"
  local host="$4"
  local termination="$5"
  local crt="${6:-}"
  local key="${7:-}"
  local dest_ca="${8:-}"
  NS="$ns" NAME="$name" SERVICE="$service" HOST="$host" TERM="$termination" \
    CRT="$crt" KEY="$key" DEST="$dest_ca" python3 - <<'PY'
import os, pathlib, subprocess
def block(path, spaces):
    if not path:
        return ""
    text = pathlib.Path(path).read_text().strip()
    pad = " " * spaces
    return "\n".join(pad + line for line in text.splitlines())
term = os.environ["TERM"]
lines = [
    "apiVersion: route.openshift.io/v1",
    "kind: Route",
    "metadata:",
    f"  name: {os.environ['NAME']}",
    f"  namespace: {os.environ['NS']}",
    "spec:",
    f"  host: {os.environ['HOST']}",
    "  to:",
    "    kind: Service",
    f"    name: {os.environ['SERVICE']}",
    "  port:",
    "    targetPort: https" if term != "edge" else "    targetPort: http",
    "  tls:",
    f"    termination: {term}",
    "    insecureEdgeTerminationPolicy: None",
]
if term != "passthrough":
    lines.append("    certificate: |")
    lines.append(block(os.environ["CRT"], 6))
    lines.append("    key: |")
    lines.append(block(os.environ["KEY"], 6))
if term == "reencrypt":
    lines.append("    destinationCACertificate: |")
    lines.append(block(os.environ["DEST"], 6))
yaml = "\n".join(lines) + "\n"
subprocess.run(["oc", "apply", "-f", "-"], input=yaml.encode(), check=True, stdout=subprocess.DEVNULL)
PY
}
