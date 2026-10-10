# Helm and Kustomize

Helm stores release state in Secrets in the release namespace. `helm list`, `helm status`, `helm history`, and `helm get values` are the exam commands. `helm upgrade` adds a revision. `helm rollback <release> <revision>` is an upgrade to an old revision, so the history grows rather than disappearing. `helm uninstall` removes that history.

When a revision will not pull, look at the pods first, then `helm get values` and `helm get manifest` for the spec that was rendered. Values and the chart templates are different. The chart in this lab reads `replicaCount`, `image.repository`, `image.tag`, `service.port`, and `service.targetPort`.

Kustomize does not keep a release object. `kustomization.yaml` names the resources and the patches. `replicas` changes a Deployment by name. `images` rewrites a container image whose current name matches `name`. `oc apply -k` renders and applies. `oc kustomize` prints the render if you want to see it before applying.

Apply the overlay, not the base, once the overlay is correct. Applying the base again puts the placeholder image back.
