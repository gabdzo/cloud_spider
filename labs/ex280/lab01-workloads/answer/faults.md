# Faults

## catalog

`setup.sh` waits until a healthy revision is available, then changes the container image to a tag that does not exist (`ex280-missing`).

That produces a new ReplicaSet that cannot pull. With the default rolling strategy the previous pods can remain up, so a route may still answer while `oc rollout status` and the newest pods fail. The replica count is also 2 rather than the required 3, and the requests are not the required values.

`oc rollout history` shows the previous good revision. `oc rollout undo` returns to it, after which the replica count, resources, and image still need to match the requirement. Replacing the pod template with a known-good image is equivalent.

## inventory

ImageStream `inventory:current` is imported from the same httpd image and is healthy. Deployment `inventory` ignores it and points at the missing tag, so no pod becomes ready.

A Deployment does not use a DeploymentConfig image-change trigger. On this cluster a bare `inventory:current` is pulled from Docker Hub and fails. Point the container at the image stream's local pull spec:

`image-registry.openshift-image-registry.svc:5000/ex280-lab01/inventory:current`

`oc get imagestream inventory` shows that repository. The tag `current` must already have an imported image. `oc describe istag inventory:current` shows the digest.
