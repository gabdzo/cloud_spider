# Mock 03

Treat the two HTTP failures as lab 02: one is the selector, one is the route target. The Helm release is lab 10 without the kustomize half. The edge route is lab 12: the certificate and key have to be a pair for the route host, and the pod stays on HTTP.

The stale namespace is an uninstall. Deleting the Subscription inside it is not enough if the task says the namespace is gone. `oc delete project ex280-mock03-stale` removes the OperatorGroup and the Subscription together. That package never resolves, so there is no CSV to chase.

cert-manager is the lab 11 install in a different namespace. One cert-manager CSV owns the CRDs cluster-wide. Do not install a second copy beside lab 11. This mock's setup removes a copy this repository marked, then creates the broken subscription here. After the CSV is Succeeded, the Issuer is an ordinary custom resource.
