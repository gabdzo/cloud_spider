# Faults

Subscription `cert-manager` points at channel `obsolete`. The community catalog has `stable` and `candidate`. OLM cannot resolve `obsolete`, so no InstallPlan or CSV becomes Succeeded.

The OperatorGroup and the catalog source name are already correct. Approval is already Automatic.

## Fix

Set `spec.channel` to `stable`. Watch `oc get sub,installplan,csv -n ex280-lab11`. When the CSV is Succeeded, create:

```yaml
apiVersion: cert-manager.io/v1
kind: Issuer
metadata:
  name: selfsigned
  namespace: ex280-lab11
spec:
  selfSigned: {}
```

`oc get issuer selfsigned -o yaml` shows a Ready condition.

## Removal

Deleting the Subscription does not delete the CSV or the CRDs. Delete the Subscription, the CSV, the OperatorGroup, and the namespace. CRDs remain cluster-scoped. This lab's cleanup removes the cert-manager CRDs only when `.state/cert-manager-owned` is present, which setup writes. Do not remove cert-manager that you did not install.
