# Observe bundle (upgrades/observe)

Opt-in live data for one Kubernetes or OpenShift cluster: Grafana Beyla (eBPF)
for live HTTP/gRPC edges with RED, an OpenTelemetry node agent (container logs,
kubelet stats) and gateway (Events, cluster metrics, Prometheus out),
kube-state-metrics and Loki (single binary, PVC, 72h). Objects are rendered by
`upgrades/observe/render.js`; the stack and the PREVIEW (`GET /api/observe/plan`)
use the same list.

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
pulumi config set nodeCidr 192.168.126.0/24
pulumi preview && pulumi up
```

Plain Kubernetes: `platform=kubernetes` (the namespace is labelled
Pod Security `privileged`). Already have kube-state-metrics: `kubeStateMetrics=skip`.

## What Cloud Spider reads

`GET /api/observe/live?context=` (SAMPLE: `?sample=1`) through the API server's
service proxy with the viewer context; needs `services/proxy` `get` on
`otel-collector` and `loki` in `cloudspider-observe`. Answer: `edges`
(graph shape: `from`/`to` = `<ns>/<service>`, `source: "trace"`, `rps`,
`errors` %, `p95` ms, `observed`), `red`, `restarts`, `events`.
`mergeLive(scene, live)` in `src/observe/live.js` folds it into a SERVICES scene.

## Footprint

| profile | pods (1 node) | requests | limits |
|---|---|---|---|
| crc | 5 | 115m CPU / 384Mi | 1.4 CPU / 1.1Gi |
| standard | 5 (+2 per extra node) | 320m CPU / 896Mi | 3.2 CPU / 2.9Gi |

Plus the Loki claim (default 5Gi).

## Uninstall

TAKE IT DOWN (pulumi destroy): the namespace (pods, ConfigMaps, Loki's claim,
NetworkPolicies) and the cluster-scoped ClusterRoles, bindings and SCCs, all
labelled `app.kubernetes.io/managed-by=cloudspider-observe`. Leftover check:
`oc get clusterrole,clusterrolebinding,scc -l app.kubernetes.io/managed-by=cloudspider-observe`.
