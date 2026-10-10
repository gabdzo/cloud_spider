# Project administration

`oc get project.config.openshift.io cluster -o yaml` shows `spec.projectRequestTemplate.name`. The Template object must live in `openshift-config`. `oc new-project` instantiates it. Objects inside the template can use `${PROJECT_NAME}` and `${PROJECT_ADMIN_USER}`. A template change does not edit projects that already exist. Fix those namespaces yourself, or delete them and create them again through the template.

Governance that belongs on every new project is a label, an annotation, a ResourceQuota, a LimitRange, a default-deny NetworkPolicy, and a RoleBinding for the project admin. Check each with `oc get` in the project. A missing object is not implied by the template existing.

A Pending PVC is a storage-class problem more often than a quota problem. `oc describe pvc` names the class it is waiting for. `oc get storageclass` shows which one is default. An empty `storageClassName` selects the default. A wrong name does not fall back. Because the field cannot be updated, replace the claim.

This lab saves and restores only the template pointer. It does not change storage classes, the router, or identity providers.
