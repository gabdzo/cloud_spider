# Quickstart: Cloud Spider on your own cluster (operator developers)

This guide runs Cloud Spider on your laptop against **your** cluster. That can be plain Kubernetes (with cert-manager, for example) or OpenShift. It covers three things:

- **SERVICES**: who talks to whom, live, with rate, error % and p95.
- **Logs and INCIDENT REVIEW**: Kubernetes Events and container logs kept in Loki.
- **The network debug pod** (SNIFF → FROM INSIDE): a short-lived netshoot pod that checks DNS, TCP and HTTP from inside a namespace.

Cloud Spider is a local Node app. It never sends anything except GET requests to your cluster, with two exceptions: the observe bundle you install with Pulumi, and the debug pod, which only works through a context you list as a write context.

## 1. Prerequisites

| What | Version / note |
|---|---|
| Node.js | ≥ 20 (`package.json` engines). Use **22**: the bundled AWS SDK warns on 20 and will need 22 from 2027. |
| git, npm | any recent |
| kubectl (or `oc`) | with a kubeconfig context for your cluster |
| Pulumi CLI | installs the observe bundle (`upgrades/observe`). State is a local file (`~/.cloudspider/pulumi-observe`), so no Pulumi or AWS account is needed. |
| Rights | **Install:** cluster-admin, or the right to create a namespace, ClusterRoles/ClusterRoleBindings, a privileged DaemonSet (Beyla uses eBPF), a PVC and NetworkPolicies, plus SCCs on OpenShift. **Daily use:** list/get on the namespaces you show, and `get services/proxy` on `otel-collector` and `loki` in `cloudspider-observe` (the bundle adds a Role for the `cloudspider-viewers` group, or set `viewerUser`). **Debug pod:** create/get/delete pods and get pods/log in the namespace it runs in. |

Using one admin context for everything is fine for a test. Section 3 shows how to split it.

## 2. Clone and install

```sh
git clone https://github.com/gabdzo/cloud_spider.git
cd cloud_spider
npm ci
```

## 3. A minimal `cloudspider.yaml`

`cloudspider.yaml` in the repo root is gitignored. Every key and its default is in `cloudspider.example.yaml`, and `npm start -- --help` lists them all.

```yaml
modules:
  profile: k8s-only           # no AWS surfaces
  enable: [observe, network]  # observe: live edges + Loki. network: SNIFF, which hosts the debug pod
kube:
  contexts:
    - context: my-cluster     # your kubeconfig context name
      label: OPERATOR
      namespaces: [my-operator, my-operand, cloudspider-observe]   # or "*" for the whole cluster
  writeContexts: [my-cluster] # the only contexts the debug pod may be created through
network:
  pod:
    enabled: true
    namespace: my-operator    # where the debug pod runs (default: cloudspider-debug, which must exist)
    sourceNamespaces: [my-operand]   # more namespaces you may pick as POD IN
```

Notes:
- **Why `network`:** in `k8s-only` the debug pod's API answers `module off: network` unless you add `network`. `network` pulls in the `aws` module, but nothing needs AWS credentials; see the AWS banner in section 9.
- **Namespace list vs `"*"`:** a namespace list reads only those namespaces, so a namespaced Role is enough. `"*"` needs cluster-wide list rights.
- **`kube.contexts` vs `kube.context`:** use one or the other. With both set, the start log says `kube.context` "is ignored".
- **Separate viewer and admin:** to keep a read-only viewer apart from the admin, list the viewer under `kube.contexts` and put only the admin in `writeContexts`.
- **The debug pod's namespace must exist:**
  ```sh
  kubectl --context my-cluster create namespace cloudspider-debug   # only if you keep the default
  ```
  If it is missing, the POD IN picker shows "(missing)" and the run fails with "namespace … does not exist", including the command above.

## 4. Install the observe bundle

The bundle installs into its own namespace `cloudspider-observe`:
- Grafana Beyla (eBPF: live HTTP/gRPC edges and RED)
- an OpenTelemetry node agent and gateway collector
- kube-state-metrics
- Loki (single binary, PVC, 72h)

It also adds least-privilege NetworkPolicies and, on OpenShift only, two SCCs. Beyla skips `kube-system`, `openshift-*` and its own namespace.

```sh
cd upgrades/observe
npm ci
export PULUMI_CONFIG_PASSPHRASE=          # empty passphrase for the local state; pick one if you prefer, but keep it
pulumi stack init observe-my-cluster      # once; the backend is the file URL in Pulumi.yaml
pulumi config set context my-cluster      # a WRITE context (the name "cloudspider-viewer" is refused)
pulumi config set allowPrivileged on      # off = reduced bundle: no Beyla (no live edges), no container logs
pulumi config set nodeCidr 10.0.0.0/16    # your node network; unset = those ports open from 0.0.0.0/0
# optional:
pulumi config set kubeStateMetrics skip   # if the cluster already runs one
pulumi config set storageClass <name>     # Loki's PVC; default = cluster default
pulumi config set profile standard        # bigger requests (default crc); see the table
pulumi preview
pulumi up
cd ../..
```

**OpenShift:** add `pulumi config set platform openshift`. That creates the SCCs `cloudspider-observe-beyla` (privileged + hostPID) and `cloudspider-observe-agent` (read-only `/var/log/pods`), bound only to those two ServiceAccounts. On plain Kubernetes the namespace gets Pod Security `privileged` instead. If your cluster enforces policies (Kyverno, Gatekeeper, the IBM stack's admission webhooks), allow privileged pods in `cloudspider-observe`.

Instead of the commands above, you can use the app: start Cloud Spider, then STACKS → **Observe bundle** with the same fields. The PREVIEW there lists the same objects.

**Requests, `allowPrivileged=on`, logs on** (computed by `footprint()` in `upgrades/observe/render.js`), plus Loki's 5Gi claim:

| profile | 1 node | 3 nodes |
|---|---|---|
| crc (default) | 5 pods, 70m CPU / 728Mi | 9 pods, 120m / 1.6Gi |
| standard | 5 pods, 320m / 896Mi | 9 pods, 520m / 1.5Gi |

Beyla's memory grows with the number of processes it instruments: 420–464Mi on busy nodes.

Check it:
```sh
kubectl --context my-cluster -n cloudspider-observe get pods      # beyla + otel-agent per node, otel-collector, kube-state-metrics, loki-0
```

## 5. Optional: a vault per service

A vault is one YAML file per service: who owns it, its workloads, what it depends on and its SLOs. VAULTS shows them, and SERVICES draws their `dependsOn` lines.

```sh
npm run vaults:new -- k8s-service my-operator     # writes vaults/my-operator.yaml from vaults/templates/k8s-service.yaml
# edit workloads / dependsOn, then:
npm run validate-vaults
```

## 6. Run

```sh
npm start            # http://127.0.0.1:9241   (another port: npm start -- --port 9300)
```

The start log prints the config file and the modules, for example:
`modules: k8s-only (aws, network, stacks, kubernetes, graph, timeline, observe, score, learn, ask)`.
To see the effective config, with where each value came from, open `http://127.0.0.1:9241/api/config`.

## 7. What to expect

- **CLUSTER → SERVICES:** pick your context. On the first load, live lines show as **measuring**, because a rate needs two collector reads. After about **30 s** they show `rps`, error % and p95. The window then grows to up to 5 min, so a few failures don't swing the %. Static/config lines (Services, selectors) and owner lines are separate layers; the legend says which is which. To try it without a cluster, use **SAMPLE**.
- **Errors in red:** an edge's error % counts 5xx (HTTP) or non-OK (gRPC) as seen by Beyla. A service that logs only its failures will look "all errors" in its logs; the edge % is the true rate.
- **INCIDENT REVIEW:** Kubernetes Events from Loki, kept 72h (longer than the API server's hour), with restarts and rollouts on a timeline.
- **Morning report → LOG ERRORS:** container log errors from the bundle's Loki, grouped by service. Windows: 1H, 24H, NIGHT.
- **SNIFF → FROM INSIDE:**
  1. Pick POD IN (a namespace), the labels to run as (so NetworkPolicies apply as for your pod) and a target: a Service from the picker, a URL, or `tcp://host:port`.
  2. RUN creates a netshoot pod (TTL 300 s), checks DNS → TCP → HTTP, and deletes the pod.
  3. The report says which NetworkPolicy allowed or blocked the call, and whether the Service has endpoints.

## 8. Uninstall

```sh
cd upgrades/observe
PULUMI_CONFIG_PASSPHRASE= pulumi destroy -s observe-my-cluster
pulumi stack rm observe-my-cluster        # optional: drops the local state
kubectl --context my-cluster get clusterrole,clusterrolebinding -l app.kubernetes.io/managed-by=cloudspider-observe   # should be empty
oc get scc -l app.kubernetes.io/managed-by=cloudspider-observe                                                        # OpenShift
kubectl --context my-cluster delete namespace cloudspider-debug   # only if you created it for the debug pod
```

`destroy` deletes the namespace (pods, ConfigMaps, Loki's claim, NetworkPolicies) and the cluster-scoped objects. Debug pods remove themselves through their TTL. To stop the app, use Ctrl-C.

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| macOS: kubectl works but the app (or anything started from tmux/screen) cannot reach a cluster on your **LAN** (`EHOSTUNREACH`, timeouts) | macOS Local Network privacy blocks non-Apple binaries in apps that were never granted it, and tmux servers never get it. Start `npm start` from Terminal/iTerm directly and allow "Local Network" when asked, or reach the API through a port-forward/SSH tunnel on 127.0.0.1 (localhost is exempt). |
| A red **AWS** banner | The `network` module loads the AWS client and your shell's `AWS_PROFILE` has no working credentials. The banner names the profile and what to set. For a cluster-only setup you can ignore it, or start with a profile that works (`AWS_PROFILE=default npm start`). |
| FROM INSIDE: **NOT FOUND** / "namespace … does not exist", or POD IN shows "(missing)" | The debug pod's namespace isn't there. Create it (`kubectl --context <ctx> create namespace <ns>`) or set `network.pod.namespace` to one you have. |
| FROM INSIDE says the pod is off / the context isn't a write context | Check `network.pod.enabled: true`, add `network` to `modules.enable`, and put the context in `kube.writeContexts`. |
| FROM INSIDE: the pod is rejected (PodSecurity / SCC / Kyverno) | The pod runs unprivileged by default. `allowRawTrace: true` (tcptraceroute) needs NET_RAW, and on OpenShift `openshiftScc: true` as well. Admission policies on your cluster may still need an exception for the namespace. |
| SERVICES shows the namespace as **idle / no traffic seen** although traffic flows | (1) The bundle isn't installed or the observe module is off. (2) The viewer can't `get services/proxy` on `otel-collector` (bind it to `cloudspider-viewers` or set `viewerUser`). (3) The collector is slow: its metrics page grows with traffic (23 MB on a small test cluster before the unused Beyla series were dropped). The app asks for gzip and keeps the last good read when one takes longer than 4 s, but check `kubectl -n cloudspider-observe logs deploy/otel-collector` and its restarts. |
| Live lines stay **measuring** | The first read has no baseline. Wait about 30 s; if it stays, the collector receives no Beyla data (check the `beyla` pods' logs, which need privileged/eBPF). |
| `pulumi` asks for a passphrase / "failed to decrypt" | Use the same `PULUMI_CONFIG_PASSPHRASE` you created the stack with (empty above). |
| `loki-0` Pending (Insufficient cpu / no storage class) | Free room on a node, or set `storageClass` to one that exists and `pulumi up` again. |
