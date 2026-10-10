# Faults

## web

The container is listening and the process is up, so the pod phase is Running. `readinessProbe` requests `/not-ready`, which httpd does not serve. The Ready condition stays false. The endpoint controller only publishes Ready pods, so Service `web` has no addresses. The route is admitted and returns the application-unavailable page.

The service selector and the route target are already correct.

## worker

`startupProbe` uses port `8081`. Nothing listens there, and `failureThreshold` is 3, so startup fails quickly. After startup is removed or would succeed, `livenessProbe` calls `/healthz` on port 8080 with `failureThreshold: 1`. httpd returns 404 for that path, and one failure kills the container. The pod restarts in a loop.

Point startup, liveness, and readiness at `/` on the named port `http` (8080). Give startup enough failures to cover image pull and httpd start. A liveness failure threshold of 1 will flap on a single slow response.
