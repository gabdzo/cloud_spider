# Faults

Every variant installs a default deny for both ingress and egress on `ex280-lab03-back`. The pods stay Running because policy does not stop the container. It stops packets.

The active variant is stored in `.state/lab03.variant`.

## Variant 1

`allow-frontend` puts `namespaceSelector` and `podSelector` on the same `from` item. That is AND. The source pod must be in `ex280-lab03-front` and carry `app=not-the-client`. The real client is `app=client`, so it is denied. There is no router allow and no DNS egress allow.

## Variant 2

Frontend and DNS are allowed. There is no allow from `network.openshift.io/policy-group=ingress`, so the route stays on the application-unavailable page while `oc get endpoints` shows addresses.

## Variant 3

Frontend and the router are allowed. Egress remains deny-all, so DNS lookups from the backend project fail.

## Fix shape

Separate `from` items are OR. A namespace-only selector allows every pod in that namespace. Router traffic comes from namespace `openshift-ingress`. DNS on this cluster is in `openshift-dns` on UDP and TCP 5353.
