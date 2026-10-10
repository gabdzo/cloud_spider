# Mixed tasks

Build the happy path first, then the two traps.

The application is a normal Deployment, Service, and Route. The body comes from the httpd document root. The greeting is an environment variable from ConfigMap key `greeting`. A readiness probe on `/` is what puts pods into the Service endpoints. Set a CPU request of at least `50m` before you create the quota, or create the quota with enough headroom and then the deployment. Quota key `requests.cpu` rejects pods that do not request CPU.

Task 7 is the lab 04 impersonation trap on a smaller scale. Look up the user's groups. Bind the group that actually contains `ex280-reader`. Test with `--as` and with `--as-group`. The direct check must stay denied.

Task 8 is the lab 03 router trap. Default deny is already installed. The route fails until the ingress policy group is allowed. The peer project must still fail. Two `from` entries are OR. One entry with both a namespace selector and a pod selector is AND.

Check all eight tasks after the last change. A quota added at the end can reject the pods you already started if their requests sum above `1` CPU.
