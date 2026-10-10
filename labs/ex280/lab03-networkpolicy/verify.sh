#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

BACK=ex280-lab03-back
FRONT=ex280-lab03-front
OTHER=ex280-lab03-other
ex280_require_admin

backend_ready=no
for _ in $(seq 1 12); do
  if ex280_deployment_ready "$BACK" web 1; then
    backend_ready=yes
    break
  fi
  sleep 5
done
if [[ "$backend_ready" == "yes" ]]; then
  ex280_pass "backend pods are available"
else
  ex280_fail "backend pods are not available"
fi

if ex280_exec_ok "$FRONT" client curl -fsS --max-time 8 http://web.ex280-lab03-back.svc:8080/; then
  ex280_pass "allowed client can reach the backend"
else
  ex280_fail "allowed client cannot reach the backend"
fi

if ! ex280_deployment_ready "$OTHER" client 1; then
  ex280_fail "denied client is not ready"
elif ex280_exec_fail "$OTHER" client curl -fsS --max-time 5 http://web.ex280-lab03-back.svc:8080/; then
  ex280_pass "unrelated projects cannot reach the backend"
else
  ex280_fail "an unrelated project can reach the backend"
fi

if ex280_route_http_ok "$(ex280_host back-lab03)" WEB-OK; then
  ex280_pass "route responds successfully"
else
  ex280_fail "route is still unavailable"
fi

if ex280_exec_ok "$BACK" client getent hosts kubernetes.default.svc.cluster.local; then
  ex280_pass "backend DNS resolution succeeds"
else
  ex280_fail "backend DNS resolution fails"
fi

ex280_finish
