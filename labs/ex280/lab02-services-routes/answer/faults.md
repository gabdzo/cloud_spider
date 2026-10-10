# Faults

The deployments start healthy. One of four faults is applied. The active variant is stored in `.state/lab02.variant` and is not printed.

## Variant 1

Service `web` selects `app=web-old`. The pods are labeled `app=web`, so the service has no endpoints. The route is admitted and still returns the OpenShift application-unavailable page.

## Variant 2

Service `api` `targetPort` is `9090`. The container listens on `8080`. Endpoints exist because readiness is a pod condition, but traffic to the service port is sent to the wrong container port. The route fails even though `oc get endpoints` looks populated.

## Variant 3

Route `shop-api` sends `/api` to Service `web`. The web pods do not serve that path, so the API body never appears. Service `api` itself is fine.

## Variant 4

Deployment `api` selector and pod labels are `app=api-retired`. Service `api` still selects `app=api`, so it has no addresses.

## What is not broken

Hostname, route path `/`, and the web/API bodies are already correct except where a variant points the API route at the web service.
