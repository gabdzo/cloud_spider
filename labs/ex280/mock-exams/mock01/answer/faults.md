# Faults

Setup waits for a healthy revision, then sets the container image to tag `ex280-missing`. Rollout history still has the working revision. The replica count is 1, resources are not the required values, and ConfigMap `shop-config` does not exist, so `TITLE` is unset.

`oc rollout undo deployment/shop` restores the previous image. You still have to scale to 2, set resources, create the ConfigMap, and add the environment variable. Applying the answer manifest does all of that in one revision.
