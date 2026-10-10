# ConfigMaps and Secrets

`env` and `envFrom` are copied into the container at start. Changing the ConfigMap or Secret does not change the process environment. You have to replace the pod. A missing key is not a crash inside the app. The container is never created, which is why `oc logs` is empty and `oc describe pod` shows `CreateContainerConfigError`.

A volume mount projects the object into the filesystem. The kubelet refreshes secret and configMap volumes on its sync period. `subPath` opts out of that refresh because it bind-mounts a single file. Use a directory mount when the task says rotation must be visible without a new pod.

Compare the three views when something is wrong:

- object data: `oc get configmap` or `oc extract secret`
- pod spec: env refs versus volume mounts
- live container: `oc exec -- cat` the path the requirement names

Optional versus required keys matter. `optional: true` lets the pod start with an empty value. The default is required, and a typo in the key name blocks startup.
