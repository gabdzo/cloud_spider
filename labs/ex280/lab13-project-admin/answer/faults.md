# Faults

`manifests/project-request.yaml` is installed as `ex280-project-request` and selected on `project.config.openshift.io/cluster`. It creates a Project and does not add the label, annotation, quota, limit range, network policy, or admin binding.

Project `ex280-lab13-app` was created directly, so editing the template does not change it. The live namespace needs the same objects.

PVC `data` sets `storageClassName: ex280-missing`. No such class exists, so the claim stays Pending. Remove `storageClassName` to use the default class, or set it to the default class name. The storage class field is immutable. Delete the claim and create it again.

The CRC default class uses `WaitForFirstConsumer`. A corrected claim stays Pending until a pod mounts it. A small sleeper pod is enough.

The previous project request template name is saved in `.state/project-request-template-name` the first time setup runs. `common/cleanup-all.sh` writes that value back. Reset runs setup again and leaves the lab template in place.
