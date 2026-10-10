# Mock 01

This is the workload, configuration, and probe path from the earlier labs in one object.

Undo or replace the image first so pods can start. Then set replicas and resources on that same template. Add the ConfigMap before the environment reference, or the new pod stays in `CreateContainerConfigError`.

The readiness path `/` matches the httpd document root that contains `SHOP-OK`. A probe on another path would leave the route unavailable even after the image pull succeeds.

`oc rollout history` should still list the earlier revision if you upgraded in place. Deleting the deployment removes that history.
