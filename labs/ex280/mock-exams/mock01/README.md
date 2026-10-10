# Mock 01

## Scenario

Project `ex280-mock01` runs `shop`. The current rollout is unhealthy, and the application is not meeting its release requirements.

## Objective

Leave `shop` available and matching the requirements.

## Requirements

Deployment `shop` in `ex280-mock01`:

- 2 ready replicas
- requests: cpu `50m`, memory `64Mi`
- limits: cpu `200m`, memory `256Mi`
- readiness probe on `/`
- environment variable `TITLE` comes from ConfigMap `shop-config` key `title`
- ConfigMap `shop-config` key `title` is `summer`
- `http://shop-mock01.<apps-domain>/` returns a body that contains `SHOP-OK`

Keep the deployment recoverable from rollout history. Do not delete it.

## Success criteria

- The route returns `SHOP-OK`
- Replica count, resources, probe, and `TITLE` match the requirement
