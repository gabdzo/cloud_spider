# Operators

OLM objects, in the order you read them when an install is stuck:

- CatalogSource in `openshift-marketplace` lists packages and channels. `oc get packagemanifest cert-manager -o jsonpath='{.status.channels[*].name}'` shows what you can request.
- Subscription asks for a package, a channel, and a catalog. A channel that does not exist stays unresolved. `oc describe sub` says so.
- InstallPlan is the set of resources for that resolution. `Manual` approval leaves it in `RequiresApproval`. `Automatic` approves it. `oc get installplan` shows the phase.
- ClusterServiceVersion is the installed operator. Phase `Succeeded` means the deployment is up. `Pending`, `InstallReady`, and `Failed` are the phases to describe.
- A CRD arrives with the CSV. The custom resource, here an Issuer, is yours to create after the CRD exists. Applying it earlier returns an error that the kind is unknown.

OperatorGroup `targetNamespaces` decides where the operator watches. Community cert-manager supports only `AllNamespaces`, so this lab's group has an empty spec. The Subscription and CSV still live in `ex280-lab11`. A missing OperatorGroup, a second group in the same namespace, or an OwnNamespace group makes the CSV fail.

Uninstall is not the reverse of deleting one object. Subscription, CSV, and CRDs are separate. CRDs outlive the namespace.
