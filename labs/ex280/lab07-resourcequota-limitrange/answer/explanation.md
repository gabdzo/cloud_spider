# ResourceQuota and LimitRange

Quota is a project total. LimitRange is a per-container policy. They interact.

If a container has no request, LimitRange inserts `defaultRequest` before quota is evaluated. A default that looks modest on one pod is multiplied by every replica. The failure is `Forbidden: exceeded quota`, even though the manifest you wrote never mentioned CPU.

Read the quota in used/hard form. A pod count under the cap does not mean CPU is under the cap. Requests and limits are separate quota keys. A pod needs both a request and a limit when the quota tracks both. A LimitRange `default` supplies the limit, and `defaultRequest` supplies the request.

Minimums reject a container that asks for less than `min`. Maximums reject one that asks for more than `max`. Defaults apply only when the field is absent. An explicit request replaces the default. That is why fixing the deployments is enough to get them admitted, and why fixing the defaults matters for the next workload.

Changing a LimitRange does not rewrite existing pods. Roll the deployments after you set explicit resources.
