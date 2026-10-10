# Probes

Running and Ready are different. The kubelet sets Ready only after the readiness probe succeeds. EndpointSlices drop pods that are not Ready. The router uses those endpoints. A route can look correct in `oc get route` and still show the application-unavailable page.

Check this order when the page is unavailable and the pods look alive:

1. `oc get pods` and the READY column, not only STATUS
2. `oc describe pod` probe failures
3. `oc get endpoints` or `oc get endpointslice`
4. Service selector and `targetPort`
5. Route backend

Liveness restarts a container that fails. That hides a bad probe behind a restart count. Startup delays liveness until the app has booted. A startup probe aimed at the wrong port burns its failure budget and the pod never becomes live. Readiness does not restart the container. It only removes it from service.

`failureThreshold: 1` on liveness means a single miss kills the process. Use it only when that is what you want. Match the probe path and port to something the process actually serves. For this httpd image, `/` on port 8080 returns 200.
