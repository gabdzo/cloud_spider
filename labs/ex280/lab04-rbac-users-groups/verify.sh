#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

NS=ex280-lab04
ex280_require_admin

direct_denied() {
  local user="$1"
  shift
  if oc auth can-i "$@" -n "$NS" --as="$user" >/dev/null 2>&1; then
    return 1
  fi
  return 0
}

if direct_denied ex280-alice get pods \
  && ex280_user_can ex280-alice "$NS" get pods \
  && ex280_user_can ex280-alice "$NS" list pods \
  && ex280_user_can ex280-alice "$NS" get pods/log \
  && ! ex280_user_can ex280-alice "$NS" delete pods
then
  ex280_pass "alice has the required pod access"
else
  ex280_fail "alice pod access is not correct"
fi

if direct_denied ex280-bob create deployments.apps \
  && ex280_user_can ex280-bob "$NS" create deployments.apps \
  && ex280_user_can ex280-bob "$NS" delete deployments.apps \
  && ! ex280_user_can ex280-bob "$NS" create rolebindings
then
  ex280_pass "bob has the required deployment access"
else
  ex280_fail "bob deployment access is not correct"
fi

if ! ex280_user_can ex280-carol "$NS" get pods \
  && ! ex280_user_can ex280-carol "$NS" get secrets
then
  ex280_pass "carol remains restricted"
else
  ex280_fail "carol can still read project data"
fi

ex280_finish
