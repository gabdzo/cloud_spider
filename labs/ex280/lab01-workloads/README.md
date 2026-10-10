# Lab 01 — Workloads

## Scenario

Project `ex280-lab01` hosts two applications, `catalog` and `inventory`. The catalog rollout is unhealthy. The inventory application is not available.

## Objective

Restore both applications and leave them matching the requirements below. Use rollout history where it helps you understand the catalog failure.

## Requirements

Project: `ex280-lab01`

Deployment `catalog`:

- 3 ready replicas
- requests: cpu `50m`, memory `64Mi`
- limits: cpu `200m`, memory `256Mi`
- serves HTTP on `http://catalog-lab01.<apps-domain>`
- response body contains `CATALOG-OK`
- the current rollout is available

ImageStream `inventory`, tag `current`, in the same project.

Deployment `inventory`:

- 2 ready replicas
- runs from ImageStream tag `inventory:current`
- requests: cpu `50m`, memory `64Mi`
- limits: cpu `200m`, memory `256Mi`
- serves HTTP on `http://inventory-lab01.<apps-domain>`
- response body contains `INVENTORY-OK`

`setup.sh` prints the concrete hostnames for this cluster.

## Success criteria

- Both routes return their expected body
- Both deployments are available at the required replica count
- Compute requests and limits match the requirement
- `inventory` is running from the required ImageStream tag
