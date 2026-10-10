"""Read-only: the TLS Secret named by Ingress <name> in <ns> holds a
certificate valid for <host>. Usage: cert.py <ns> <ingress> <host>"""
import base64
import json
import subprocess
import sys
import tempfile

ns, name, host = sys.argv[1:4]


def get(*args):
    out = subprocess.run(["kubectl", "get", *args, "-n", ns, "-o", "json"], capture_output=True, text=True)
    if out.returncode:
        sys.exit(1)
    return json.loads(out.stdout)


ingress = get("ingress", name)
tls = (ingress["spec"].get("tls") or [{}])[0]
if host not in (tls.get("hosts") or []) or not tls.get("secretName"):
    sys.exit(1)
secret = get("secret", tls["secretName"])
pem = base64.b64decode((secret.get("data") or {}).get("tls.crt", ""))
if not pem:
    sys.exit(1)
with tempfile.NamedTemporaryFile(suffix=".pem") as f:
    f.write(pem)
    f.flush()
    out = subprocess.run(["openssl", "x509", "-in", f.name, "-noout", "-checkhost", host], capture_output=True, text=True)
sys.exit(0 if "does match" in out.stdout and "NOT" not in out.stdout else 1)
