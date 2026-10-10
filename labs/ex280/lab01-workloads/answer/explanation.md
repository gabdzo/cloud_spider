# Workloads

A Deployment owns ReplicaSets. Each pod-template change creates a new revision. `oc rollout history` and `oc describe deployment` show which revision is current and why the new one is not becoming ready. Image pull errors are on the new pods (`oc describe pod`, events), not on the Service.

`oc rollout undo deployment/catalog` scales the previous ReplicaSet back up and scales the failed one down. Undo does not invent the required replica count or resource values. Those are fields on the pod template. Set them with `oc set resources`, `oc scale`, or by applying a full manifest. Changing the image with `oc set image` is another revision.

Resource requests are what the scheduler uses. Limits are what the runtime enforces. This lab has no quota, so a missing request does not block admission. Later labs combine requests with LimitRange and ResourceQuota, where a missing request is filled by a default and can then exceed quota.

Image streams decouple the pull spec from a floating tag. Import with `oc import-image`. The tag stores the resolved image. A Deployment does not follow that tag by name alone. Use the image stream's docker repository from `oc get imagestream`, with the tag, as the container image. `oc describe imagestreamtag inventory:current` shows whether the import finished. A bad tag in the deployment does not mean the image stream is empty. Compare the two.

Diagnosis order for a stuck rollout:

1. `oc get deploy,rs,pods` to see which ReplicaSet is current
2. Pod status and events for the actual error
3. `oc rollout history` before deciding to undo or to roll forward
4. After the fix, `oc rollout status` and a request to the route
