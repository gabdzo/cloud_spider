# Faults

## Access

`ex280-maya` is in group `ex280-mock02-ops`. RoleBinding `ops` grants `view` to the empty group `ex280-mock02-empty`. `ex280-liam` has no group grant. `view` cannot delete pods and cannot read secrets, so it is enough for maya and does not help liam.

## batch

The container sets `privileged: true` and ServiceAccount `batch` cannot use the `privileged` SCC. Grant it with `oc adm policy add-scc-to-user privileged -z batch -n ex280-mock02` and restart the deployment.

## web and quota

LimitRange defaults request `400m` CPU and `256Mi`. The web deployment has 2 replicas and no explicit resources. Two pods already ask for `800m`, and the quota allows `500m` of CPU requests. The batch pod requests `50m` explicitly. Set web requests to `50m` CPU and `64Mi` memory, with limits that fit under `1` CPU and `1Gi`. Lower the LimitRange defaults so the next empty pod does not blow the quota. Delete the web deployment before rolling it if old pods are holding the quota.

## Network

`default-deny` blocks the peer and the router. Add one policy that allows `ex280-mock02-peer` and `network.openshift.io/policy-group=ingress` as separate `from` entries. Leave the stranger with no allow.
