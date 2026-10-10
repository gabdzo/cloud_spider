# Faults

## catalog

Revision 1 installs the chart with 1 replica and the default image and ports. Revision 2 sets `image.tag=ex280-missing` and `service.targetPort=9090`. The new pods cannot pull, and the service named port points at 9090 while httpd listens on 8080.

`helm history catalog -n ex280-lab10` shows both revisions. `helm rollback catalog 1` returns to a pullable image and port 8080, still at 1 replica. A further `helm upgrade` with the answer values sets 3 replicas, the httpd image tag `latest`, and port 8080. Upgrading straight to those values also works. Uninstalling the release deletes the history.

The route already targets Service `catalog`.

## notice

`oc apply -k manifests/base` is what is running: image `notice-image:1`, 1 replica. `manifests/overlays/prod` still sets 1 replica and tag `ex280-missing`.

The prod overlay has to set 2 replicas and `registry.access.redhat.com/ubi9/httpd-24:latest`, then be applied with `oc apply -k`. The image name in the base is `notice-image`, which is what the `images:` transformer matches.
