# Observe bundle (upgrades/observe)

Opt-in live data for one Kubernetes or OpenShift cluster: Grafana Beyla (eBPF)
for live HTTP/gRPC edges with RED, an OpenTelemetry node agent (container logs,
kubelet stats) and gateway (Events, cluster metrics, Prometheus out),
kube-state-metrics and Loki (single binary, PVC, 72h). Objects are rendered by
`upgrades/observe/render.js`; the stack and the PREVIEW (`GET /api/observe/plan`)
use the same list.

State lives in a local file backend (`~/.cloudspider/pulumi-observe`): no AWS account needed.
The module is off in every profile: turn it on with `modules.enable: [observe]` in cloudspider.yaml.

## Install (CRC / OpenShift Local)

STACKS → **Observe bundle**: `context=<write context, e.g. crc-admin>`,
`platform=openshift`, `allowPrivileged=on`, `profile=crc`,
`nodeCidr=192.168.126.0/24`, optionally `storageClass=crc-csi-hostpath-provisioner`.
Or by hand:

```
cd upgrades/observe && npm ci
pulumi stack init observe   # once
pulumi config set context crc-admin
pulumi config set platform openshift
pulumi config set allowPrivileged on
pulumi config set nodeCidr 192.168.126.0/24   # required
pulumi preview && pulumi up
```

Plain Kubernetes: `platform=kubernetes` (the namespace is labelled
Pod Security `privileged`). Already have kube-state-metrics: `kubeStateMetrics=skip`.

## What Cloud Spider reads

`GET /api/observe/live?context=` (SAMPLE: `?sample=1`) through the API server's
service proxy with the viewer context; needs `services/proxy` `get` on
`otel-collector` and `loki` in `cloudspider-observe`. Answer: `edges`
(graph shape: `from`/`to` = `<ns>/<service>`, `source: "trace"`, `rps`,
`errors` %, `p95ms`, `window`, `at`; plan §4.5), `red`, `restarts`, `events`.
`GET /api/cluster/graph` merges it (`mergeLive`) when the bundle is installed and the module is on, so the SERVICES view's TRACES layer shows live edges and `nodes[].red`; `?live=0` skips it.

## Footprint

Requests with `allowPrivileged=on`, logs on, kube-state-metrics installed
(`footprint()` in render.js; DaemonSets count once per node):

| profile | 1 node | 3 nodes | limits (1 node) |
|---|---|---|---|
| crc (laptop, single node) | 5 pods, 70m CPU / 472Mi | 9 pods, 120m / 856Mi | 1.4 CPU / 1.4Gi |
| standard (busy clusters) | 5 pods, 295m CPU / 1.1Gi | 9 pods, 445m / 2.25Gi | 3.2 CPU / 3.1Gi |

Plus the Loki claim (default 5Gi). Beyla's memory grows with the processes it
instruments (420-464Mi per node on a busy EKS node): crc requests 128Mi and
bursts to its 640Mi limit, standard requests 448Mi (CPU 25m; real use 1-21m). Beyla and the agent run at the bundle PriorityClass cloudspider-observe-node-agent (1000000), so on a full node they preempt an ordinary pod, which is rescheduled elsewhere. Use standard on a cluster
with real traffic.

The stack warns (preview and up) when `allowPrivileged` is off (no Beyla, no
live edges) and when `nodeCidr` is unset (0.0.0.0/0).

## Uninstall

TAKE IT DOWN (pulumi destroy): the namespace (pods, ConfigMaps, Loki's claim,
NetworkPolicies) and the cluster-scoped ClusterRoles, bindings and SCCs, all
labelled `app.kubernetes.io/managed-by=cloudspider-observe`. Leftover check:
`oc get clusterrole,clusterrolebinding,scc -l app.kubernetes.io/managed-by=cloudspider-observe`.

## Reduced mode (allowPrivileged=off)

No Beyla (no live edges or RED), no container logs (reading `/var/log/pods`
needs root + hostPath), no SCCs; the namespace is Pod Security `baseline`.
Installed: Events history in Loki, cluster metrics, kubelet stats (an API
call), kube-state-metrics. crc on 1 node: 4 pods, 60m CPU / 344Mi requested.

## Viewer access and LOG ERRORS

The bundle ships Role/RoleBinding `cloudspider-observe-viewer`: `get` on
`services/proxy` for `otel-collector:metrics` and `loki:http` only, bound to
the `cloudspider-viewers` group and optionally `viewerUser` (e.g. `developer`
on CRC). LOG ERRORS uses the bundle's Loki by itself when no `logs.loki.url`
/ CloudWatch groups are set (selector `{k8s_namespace_name=~".+"}`, OTLP
labels); `logs.bundle: false` turns that off. A configured Loki URL with
plain `namespace` labels still takes precedence.
