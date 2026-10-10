#!/usr/bin/env bash
set -euo pipefail

LAB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=../common/helpers.sh
source "$LAB_DIR/../common/helpers.sh"

ex280_require_admin

check_url() {
  local host="$1"
  local needle="$2"
  local label="$3"
  if ex280_route_http_ok "$host" "$needle"; then
    ex280_pass "${label} responds successfully"
  else
    ex280_fail "${label} is still unavailable"
  fi
}

check_url "$(ex280_host storefront-lab14)" STORE-OK "storefront"
check_url "$(ex280_host payments-lab14)" PAY-OK "payments"
check_url "$(ex280_host catalog-lab14)" CATALOG-OK "catalog"
check_url "$(ex280_host inventory-lab14)" INV-OK "inventory"
check_url "$(ex280_host reports-lab14)" REPORT-OK "reports"
check_url "$(ex280_host search-lab14)" SEARCH-OK "search"

if ex280_deployment_ready ex280-lab14-checkout checkout 1; then
  ex280_pass "checkout is available"
else
  ex280_fail "checkout is still unavailable"
fi

if ex280_deployment_ready ex280-lab14-audit audit 1; then
  ex280_pass "audit is available"
else
  ex280_fail "audit is still unavailable"
fi

ex280_finish
