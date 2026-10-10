# Faults

## config-app

The container reads ConfigMap `app-config` key `mesage`. The ConfigMap only has `message`. The kubelet cannot build the environment, so the pod stays in `CreateContainerConfigError` and never starts. Events name the missing key.

The required file is `/etc/app/message`. An environment variable would not create that file even if the key were spelled correctly. Mount the ConfigMap key onto that path.

## secret-app

The password is injected with `secretKeyRef` into `SECRET_PASSWORD`. That value is fixed when the container starts. The required path `/etc/secret/password` does not exist.

Mount the Secret as a directory at `/etc/secret`. Do not use `subPath`. A subPath mount is also stuck at the value from pod start. A normal secret volume is updated by the kubelet. The verifier changes `app-secret` and reads the file back. The pod UID must stay the same.
