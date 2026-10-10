# Faults

ResourceQuota `project-quota` is already the required ceiling. It is not the thing to raise.

LimitRange `default-limits` sets a default request of `500m` CPU and `512Mi` memory, and a default limit of `1` CPU and `1Gi`. The deployments omit `resources`, so every container inherits those defaults.

Two replicas of two deployments is four pods. Four times `500m` is `2` CPU of requests. The quota allows `1` CPU of requests, so admission accepts the first two pods and rejects the rest with `exceeded quota`.

`oc describe quota project-quota` shows `used` against `hard`. `oc describe replicaset` shows the quota error. `oc describe limitrange` shows the defaults that filled in the missing requests.

Set explicit requests and limits that fit four pods under the ceiling. `100m` / `32Mi` requests and `200m` / `64Mi` limits do. Also lower the LimitRange defaults so the next pod created without resources does not consume the whole quota. The minimum in the LimitRange stays at `50m` and `32Mi`.
