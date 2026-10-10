# ServiceAccounts and SCC

Admission picks a SecurityContextConstraint in priority order. The ServiceAccount must be allowed to use it, and the pod must fit it. On this cluster both `restricted-v2` and `restricted-v3` are granted to `system:authenticated`. For a normal pod the most restrictive match wins, which is why a healthy httpd pod shows one of those names in `openshift.io/scc`.

`oc describe replicaset` is where an SCC rejection shows up when no pod object exists. The event says which constraint was considered and why the UID or privileged flag was rejected. `oc get pod` stays empty, so `oc logs` has nothing to say.

Check the ServiceAccount before you grant anything:

`oc auth can-i use scc/privileged --as=system:serviceaccount:ex280-lab05:priv`

`oc adm policy add-scc-to-user` writes a RoleBinding to the ClusterRole `system:openshift:scc:<name>` in the namespace when you pass `-z`. Putting the ServiceAccount on the SCC `users` list is the older equivalent. Both are scoped to that account only if you do not grant the default account.

A custom SCC should copy the restrictive defaults (`allowPrivilegeEscalation: false`, drop `ALL`, `seccompProfiles: runtime/default`, no host namespaces) and change only the field you need. `MustRunAs` with a single UID is narrower than `RunAsAny`. After the SCC exists, restart the deployment so admission runs again. Existing failed ReplicaSets do not retry forever on their own if the pod was never created; a restart or a template change creates a new one.

API access is separate from SCC. A ServiceAccount token is a user named `system:serviceaccount:<namespace>:<name>`. A RoleBinding in the project is enough for `get configmaps`. Cluster-admin is not.
