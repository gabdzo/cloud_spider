# Mock 02

Do the quota math before you grant SCC or open the network. A privileged pod that cannot be admitted does not consume quota. Once it can, its requests count. The web defaults count as soon as the pods are created.

`oc describe quota` and `oc describe limitrange` explain a rejected replica. Explicit resources replace defaults. They do not rewrite pods that are already running, and a rolling update can get stuck if the old pods still hold the quota. Scale down or delete, then create the corrected deployment.

Group bindings and SCC grants are independent. Maya's `view` binding does not let the `batch` ServiceAccount run privileged. Test maya with `--as` and `--as-group`. Test the ServiceAccount with `oc auth can-i use scc/privileged --as=system:serviceaccount:ex280-mock02:batch`.

For the network, prove three paths: peer succeeds, stranger fails, and the route from your workstation succeeds.
