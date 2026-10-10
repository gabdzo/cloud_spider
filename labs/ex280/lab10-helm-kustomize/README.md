# Lab 10 — Helm and Kustomize

## Scenario

Project `ex280-lab10` has a Helm release named `catalog` and a second application, `notice`, that is meant to be delivered from the prod overlay. Neither is in the required state. The chart and the overlay are in `manifests/`.

## Objective

Recover the Helm release and publish the prod overlay.

## Requirements

Helm release `catalog` in `ex280-lab10`:

- status deployed
- 3 ready replicas
- image `registry.access.redhat.com/ubi9/httpd-24:latest`
- Service port `8080` and container port `8080`
- history contains more than one revision
- `http://catalog-lab10.<apps-domain>/` returns a body that contains `CHART-OK`
- do not delete the release

Deployment `notice`, built from `manifests/overlays/prod`:

- 2 ready replicas
- image `registry.access.redhat.com/ubi9/httpd-24:latest`
- `http://notice-lab10.<apps-domain>/` returns a body that contains `NOTICE-OK`

## Success criteria

- The catalog release is deployed at the required size and image, with history intact
- The notice route responds and the deployment matches the overlay requirement
