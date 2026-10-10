# Faults

Each ticket is one broken layer. The route host is `<ticket>-lab14.<apps-domain>` except checkout and audit, which have no route.

## storefront

Service selector is `app=storefront-old`. Pods are `app=storefront`. Endpoints are empty.

## payments

Service `targetPort` is `9090`. The container port is `8080`. Endpoints can still be populated.

## catalog

Route `catalog` sends traffic to Service `decoy`, which returns `DECOY`. Service `catalog` is the one that returns `CATALOG-OK`.

## inventory

Readiness probe path is `/not-ready`. Pods stay Running and drop out of the endpoints.

## reports

NetworkPolicy `default-deny` blocks ingress, including the router. Pods are Ready and the Service has endpoints. Add an allow from `network.openshift.io/policy-group=ingress`.

## checkout

ConfigMap `checkout-config` has `profile`. The container requires key `mode`. The pod stays in `CreateContainerConfigError`.

## audit

The container sets `runAsUser: 0`. The restricted constraints reject it and no pod is created. This process does not need root. Remove the `securityContext`. Granting `anyuid` also admits it and is broader than the process needs.

## search

The deployment image tag is `ex280-missing`. The rollout cannot pull. The Service, route, and ConfigMap are already correct. Point the container at `registry.access.redhat.com/ubi9/httpd-24:latest`.
