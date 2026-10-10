#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"
# shellcheck source=manifests/tls.sh
source "$LAB_DIR/manifests/tls.sh"

EX280_LAB=lab12
NS=ex280-lab12
ex280_require_admin
ex280_recreate_project "$NS" "$EX280_LAB"

work="${EX280_STATE}/lab12"
rm -rf "$work"
mkdir -p "$work/good" "$work/bad" "$work/decoy" "$work/backend"

ex280_tls_ca "$work/good" ex280-lab12-ca
ex280_tls_ca "$work/decoy" ex280-lab12-decoy
ex280_tls_ca "$work/backend" ex280-lab12-backend

edge_host="$(ex280_host edge-lab12)"
pass_host="$(ex280_host passthrough-lab12)"
re_host="$(ex280_host reencrypt-lab12)"

ex280_tls_cert "$work/good" edge "$edge_host" "$work/good"
ex280_tls_cert "$work/bad" wrong wrong.example.com "$work/decoy"
ex280_tls_cert "$work/bad" pass "$pass_host" "$work/decoy"
ex280_tls_cert "$work/backend" re "$re_host" "$work/backend"
ex280_tls_cert "$work/good" reclient "$re_host" "$work/good"

ex280_apply_web "$NS" edge EDGE-OK 1
oc create configmap tls-server -n "$NS" --from-file=serve.py="$LAB_DIR/manifests/serve.py" --dry-run=client -o yaml | oc apply -f - >/dev/null

apply_tls_app() {
  local name="$1"
  local html="$2"
  local crt="$3"
  local key="$4"
  oc create configmap "${name}-html" -n "$NS" --from-literal=index.html="${html}" --dry-run=client -o yaml | oc apply -f - >/dev/null
  ex280_tls_secret "$NS" "${name}-tls" "$crt" "$key"
  oc apply -f - >/dev/null <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: ${NS}
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
      - name: app
        image: ${EX280_UBI_IMAGE}
        command: ["python3", "/opt/serve.py"]
        ports:
        - name: https
          containerPort: 8443
        readinessProbe:
          tcpSocket:
            port: https
          initialDelaySeconds: 2
          periodSeconds: 5
        resources:
          requests:
            cpu: 20m
            memory: 64Mi
          limits:
            cpu: 200m
            memory: 192Mi
        volumeMounts:
        - name: tls
          mountPath: /tls
          readOnly: true
        - name: html
          mountPath: /var/www/html/index.html
          subPath: index.html
        - name: server
          mountPath: /opt/serve.py
          subPath: serve.py
      volumes:
      - name: tls
        secret:
          secretName: ${name}-tls
      - name: html
        configMap:
          name: ${name}-html
      - name: server
        configMap:
          name: tls-server
---
apiVersion: v1
kind: Service
metadata:
  name: ${name}
  namespace: ${NS}
spec:
  selector:
    app: ${name}
  ports:
  - name: https
    port: 8443
    targetPort: https
EOF
}

apply_tls_app passthrough PASSTHROUGH-OK "$work/bad/wrong.crt" "$work/bad/wrong.key"
apply_tls_app reencrypt REENCRYPT-OK "$work/backend/re.crt" "$work/backend/re.key"

ex280_tls_apply_route "$NS" edge edge "$edge_host" edge "$work/good/edge.crt" "$work/bad/wrong.key"
ex280_tls_apply_route "$NS" passthrough passthrough "$pass_host" passthrough
ex280_tls_apply_route "$NS" reencrypt reencrypt "$re_host" reencrypt \
  "$work/good/reclient.crt" "$work/good/reclient.key" "$work/decoy/ca.crt"

echo
echo "Lab 12 is ready in project ${NS}"
echo "  https://${edge_host}/"
echo "  https://${pass_host}/"
echo "  https://${re_host}/"
