# Lab 14 — Troubleshooting

## Scenario

Eight projects are failing. Each ticket is independent. Find the failed layer and restore the behavior below.

## Objective

Clear every ticket.

## Requirements

1. `http://storefront-lab14.<apps-domain>/` returns a body that contains `STORE-OK`
2. `http://payments-lab14.<apps-domain>/` returns a body that contains `PAY-OK`
3. `http://catalog-lab14.<apps-domain>/` returns a body that contains `CATALOG-OK`
4. `http://inventory-lab14.<apps-domain>/` returns a body that contains `INV-OK`
5. `http://reports-lab14.<apps-domain>/` returns a body that contains `REPORT-OK`
6. Deployment `checkout` in `ex280-lab14-checkout` is available
7. Deployment `audit` in `ex280-lab14-audit` is available
8. `http://search-lab14.<apps-domain>/` returns a body that contains `SEARCH-OK`

## Success criteria

- Each URL above returns its own body
- `checkout` and `audit` are available
