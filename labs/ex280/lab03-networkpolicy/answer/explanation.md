# NetworkPolicy

Policies are additive. A default deny selects every pod and lists no allow rules. A second policy can allow a slice of traffic. Nothing in a deny policy is overridden by deleting a field. You add an allow.

`from` semantics:

- Two entries under one `from` list are OR
- `namespaceSelector` and `podSelector` on the same entry are AND
- AND means one source pod must satisfy both selectors

A policy that ANDs the frontend namespace with the wrong pod label denies the real client. Splitting them into two `from` entries would allow either match. For this lab the namespace selector alone is the right allow.

The OpenShift router does not live in the application project. Its namespace carries `network.openshift.io/policy-group=ingress`. Without an allow from that namespace, endpoints can be populated and the route still fails. Test from the workstation, not only with `oc exec` inside the project. In-cluster traffic never crosses the router.

Egress deny also drops DNS. Pods resolve through the `openshift-dns` namespace, ports UDP/TCP 5353. `getent hosts kubernetes.default.svc.cluster.local` from a backend pod is the check. A failing lookup after you open ingress usually means egress is still closed.

Test both directions before you finish:

- allowed source succeeds
- a third project fails
- the route succeeds from outside
- DNS succeeds inside
