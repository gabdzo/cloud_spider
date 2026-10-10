# OpenShift EX280 labs

Hands-on labs for the Red Hat Certified OpenShift Administrator exam (EX280), written for a cluster you already administer. The exercises assume you can use pods, deployments, services, projects, and `oc get`, `oc describe`, and `oc logs`.

These labs target OpenShift 4.22 on OpenShift Local (CRC). They were checked against a cluster whose apps domain is `apps-crc.testing`.

## How a lab works

```bash
./common/cluster-check.sh
cd lab02-services-routes
./setup.sh
# work in the cluster
./verify.sh
./reset.sh
```

`setup.sh` builds the project and, when the lab is a troubleshooting exercise, leaves it unhealthy. `verify.sh` prints `PASS` or `FAIL` for observable behavior. It does not print the remaining fault or the manifest that would clear it. `reset.sh` deletes that lab's objects and runs `setup.sh` again.

`common/cleanup-all.sh` deletes projects named `ex280-lab*` and `ex280-mock*`, plus the cluster objects these labs create. It leaves other `ex280-*` projects alone.

## Do not open `answer/` until you want the solution

Each lab has an `answer/` directory with the healthy manifests, `faults.md`, and `explanation.md`. Reading those files skips the work. Ask for a hint or a solution before you use them.

`setup.sh` is the environment builder. Debugging the live objects teaches more than reading that script.

## Replay

Labs 02 and 03 accept a starting variant:

```bash
VARIANT=2 ./setup.sh
SHUFFLE=1 ./setup.sh
```

The choice is stored in `.state/` so `reset.sh` repeats it. The success criteria do not change. The root of this repository is the only place those switches are documented.

## What these labs change on the cluster

Lab objects use the prefix `ex280-` and the label `ex280.lab`.

The labs may also:

- Add an HTPasswd identity provider named `ex280-labs`, with its own secret. They do not edit `local_htpasswd`, `developer`, or `htpass-secret`.
- Create users, groups, roles, and SCCs whose names start with `ex280-`.
- Install community cert-manager into an `ex280-*` namespace. Lab 11 and mock 03 stop if cert-manager is already installed and this repository did not install it.
- Point `project.config.openshift.io/cluster` at template `ex280-project-request` during lab 13. The previous template name is saved under `.state/` and restored by `common/cleanup-all.sh`.

They do not upgrade the cluster, replace the router, or delete projects other than `ex280-lab*` and `ex280-mock*`.

## Layout

| Directory | Focus |
| --- | --- |
| `lab01-workloads` | Deployments, rollouts, resources, image streams |
| `lab02-services-routes` | Selector, target port, route path, endpoints |
| `lab03-networkpolicy` | Default deny, selectors, router, DNS |
| `lab04-rbac-users-groups` | HTPasswd, groups, roles, impersonation |
| `lab05-serviceaccounts-scc` | ServiceAccounts, restricted SCC, privileged, API access |
| `lab06-configmaps-secrets` | Env, volumes, missing keys, secret rotation |
| `lab07-resourcequota-limitrange` | Quota ceilings and LimitRange defaults |
| `lab08-probes-health` | Ready versus Running, restarts |
| `lab09-jobs-cronjobs` | Completions, schedules, suspend, history |
| `lab10-helm-kustomize` | Local chart, release history, overlays |
| `lab11-operators` | Subscription, CSV, issuer |
| `lab12-tls-routes` | Edge, passthrough, reencrypt |
| `lab13-project-admin` | Project template, governance, PVC |
| `lab14-troubleshooting` | Eight separate failures |
| `lab15-mixed-exam` | Build and repair in one project |
| `mock-exams/mock01` | Workloads, config, probes |
| `mock-exams/mock02` | RBAC, SCC, quota, network policy |
| `mock-exams/mock03` | Helm, TLS, operator removal and install, routes |

## EX280 objectives these labs practice

- Projects, manifests, logs, and rollout recovery
- Image streams, tags, and deployment updates
- Services, routes, and path-based exposure
- Kustomize overlays and Helm releases
- ConfigMaps, Secrets, and rotation behavior
- Health probes, requests, limits, quotas, and limit ranges
- Jobs and CronJobs
- HTPasswd users, groups, and RBAC, including group impersonation
- NetworkPolicy, the router, and DNS
- Edge, passthrough, and reencrypt routes on the cluster apps domain
- Project templates, labels, annotations, and a bound PVC
- Operator subscription, CSV, custom resource, and removal
- ServiceAccounts, SCC admission, and API access from a ServiceAccount

## Out of scope

Cluster upgrade, deprecated API migration, and graded web console tasks are not in these scripts. Use the console on the same projects when you want that practice. The console and `oc` show the same objects.

## Prerequisites

- `oc` logged in as a cluster admin
- `python3`, `openssl`, `curl`
- `helm` for lab 10 and mock 03
- `./common/cluster-check.sh` succeeds
- A few gigabytes free on the node before lab 11 or mock 03. Those labs pull cert-manager images. `oc describe node` showing `DiskPressure` stalls the install.

The client used while writing these labs was 4.17 against a 4.22 API. The commands stick to stable `oc` and `helm` behavior.
