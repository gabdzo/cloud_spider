# Troubleshooting order

Use the same ladder on every ticket. Stop at the first layer that is wrong.

1. Route host, path, and service name. An admitted route can still show the application-unavailable page.
2. Service selector and `targetPort`.
3. Endpoints. Empty means no Ready pod matched. Populated means the packet has a destination, not that the destination port is correct.
4. Pod phase versus Ready. Readiness removes endpoints without stopping the process. A missing ConfigMap key never creates the container. An SCC rejection never creates the pod. An image pull error creates a pod that is not Ready.
5. NetworkPolicy, if endpoints exist and a route or a client still cannot connect. The router is not in the application namespace.

`oc describe` on the object that is failing is more useful than changing YAML at random. Events name the missing key, the forbidden SCC, the pull error, and the quota. This lab's tickets are one cause each so you can practice that isolation.

Do not fix a later ticket by changing a healthy layer in an earlier project. The projects do not share Services or policies.
