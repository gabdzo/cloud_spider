# Observe bundle (upgrades/observe)

Opt-in live data for the SERVICES graph on any Kubernetes or OpenShift
cluster. Plan: `docs/plan-modules-and-service-graph.md` §7.2.

| piece | what | privilege |
|---|---|---|
| Grafana Beyla (DaemonSet) | eBPF: HTTP/gRPC calls between pods, rate, errors, p95; OTLP metrics (application + service graph) to the gateway | privileged + hostPID (allowPrivileged=on) |
| otel-agent (DaemonSet) | filelog `/var/log/pods` + kubeletstats (10250) → gateway | hostPath read-only, root, no caps (allowPrivileged=on) |
| otel-gateway (Deployment) | OTLP in, `k8s_cluster`, `k8sobjects` Events watch; metrics → Prometheus :8889, logs + Events → Loki OTLP | restricted |
| Loki (StatefulSet) | single binary, filesystem on a PVC, retention 24 h (crc) / 72 h | restricted |
| kube-state-metrics | opt-in (`kubeStateMetrics=on`); `k8s_cluster` already covers restarts and rollouts | restricted |

Namespace `cloudspider-observe`, NetworkPolicies from `upgrades/netpol.js`
(OpenShift DNS and host-network rules swapped in), ClusterRoles
`cloudspider-observe-*` with get/list/watch only, no Secrets. OpenShift +
allowPrivileged=on: SCCs `cloudspider-observe-beyla` (privileged, hostPID,
no hostNetwork) and `cloudspider-observe-agent` (hostPath, not privileged),
each granted to one ServiceAccount via a `use` ClusterRole + RoleBinding.

## Install

STACKS → Observe bundle, or by hand (state is local: `~/.cloudspider/pulumi-observe`):

```sh
mkdir -p ~/.cloudspider/pulumi-observe
cd upgrades/observe && npm ci
export PULUMI_CONFIG_PASSPHRASE=""
pulumi stack select observe --create
pulumi config set kubeContext <context>      # e.g. crc-admin; never the current context by default
pulumi config set nodeCidr 192.168.126.0/24  # kubectl get nodes -o wide
pulumi config set platform openshift         # or kubernetes
pulumi config set allowPrivileged on         # Beyla + log agent; read the warning
pulumi preview && pulumi up
```

Uninstall: `pulumi destroy --stack observe` (TAKE IT DOWN on the card).
Leftovers: `kubectl get all,cm,pvc,netpol,sa,rolebinding -A -l app.kubernetes.io/managed-by=cloudspider-observe` plus
`kubectl get clusterrole,clusterrolebinding,scc -l app.kubernetes.io/managed-by=cloudspider-observe`.

## Footprint (requests; limits in brackets)

| profile | 1 node | each extra node | disk |
|---|---|---|---|
| crc | 175m CPU, 416Mi (1056Mi) | 75m, 160Mi (416Mi) | 2 Gi |
| standard | 350m CPU, 800Mi (2048Mi) | 150m, 288Mi (768Mi) | 5 Gi |

## Reading it

`GET /api/observe/live?context=<ctx>[&merge=1]` (`&sample=1` in SAMPLE):
the gateway's Prometheus text and Loki through the API server's service
proxy (`services/proxy` on `cloudspider-observe-metrics` and `loki` only).
Live edges get `source: "trace"`; with `merge=1` they are laid over the
context's graph: unseen static calls `dim`, observed calls with no static
path `undeclared`, RED on nodes, Events appended to `events`.
