# Cloud Spider on plain Kubernetes (no AWS)

For a bare cluster: kind, k3s, kubeadm, or any cluster with ingress-nginx and
cert-manager. You don't need an AWS account, AWS credentials or `~/.aws`.
Every cluster read is a GET (read-only).

## Run it

```bash
git clone https://github.com/gabdzo/cloud_spider && cd cloud_spider
npm ci
cat > cloudspider.yaml <<'YAML'
modules:
  profile: k8s-only        # no AWS client is ever created
kube:
  context: my-cluster      # a context in your kubeconfig (kubectl config get-contexts)
YAML
npm start                  # open the address it prints (default http://127.0.0.1:9241)
```

It uses your normal kubeconfig, or `$KUBECONFIG`, and never changes your
current context. Read-only RBAC (a `view`-style role) is enough.

## What INVESTIGATE / DIAGNOSE does here

Give it a namespace and a Service. You can open it from a Cluster topology
card, from SNIFF's **INVESTIGATE** button (it picks up the Service SNIFF is
showing), or by typing the names into DIAGNOSE.

It reads the Service, its EndpointSlices, its pods and their events, the
admission webhooks, and cert-manager Certificates. The findings are the same
as on EKS, for example:

- **K8S-001** pods Running but not Ready: names the failing probe, e.g.
  "readiness probe GET :8080/healthz returns 404".
- **NET-001** the Service has 0 ready endpoints.
- **OPS-001** a webhook whose backing Service has no endpoints.
- **CERT-001** a cert-manager Certificate that is not Ready.

The ALB check (`aws-elbv2`) shows **N/A**. It does not apply on plain
Kubernetes, so it is not counted as missing coverage. `observe-bundle` and
`prometheus` are optional add-ons and show as not set up until you install
them.

## What SNIFF accepts here

Type any of these into SNIFF's box:

| You type | It traces |
|---|---|
| `shop/api` | Service → EndpointSlices → pods |
| `api.shop.svc.cluster.local` (or `api.shop.svc`) | the same |
| `shop/api-7d9f-x2k` (a pod) | the Service that selects that pod; if none does, the pod alone |
| `shop.example.lab` or `https://shop.example.lab/api` | the Ingress that serves that host and path (ingress-nginx, Traefik, any class), then its backend Service, endpoints and pods |

An nginx pod that proxies to another Service (`proxy_pass` in a mounted
ConfigMap) is followed to that Service.

On a NodePort or LoadBalancer Service, the card shows the node port and the
load-balancer IP (for example from MetalLB).

SNIFF only reads here; it sends no request. A red hop is the first thing to
fix, and its card says why (for example "0/1 ready: Readiness probe failed …
404").

DEBUG ▸ RUN still does LOCAL checks (DNS, TCP, TLS, HTTP from your machine)
against any URL you type. The AWS chip stays off.

## Tested on

`test/fixtures/bare-k8s.js` is a bare `bro-lab` cluster with ingress-nginx,
cert-manager, a NodePort Service, a LoadBalancer Service, an nginx proxy and a
pod failing readiness. `test/k8s-only-noaws.test.js` covers Diagnose and SNIFF
on it with the AWS module off.
