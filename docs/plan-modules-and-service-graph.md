# Plan: modules, and a service graph with incident review

Status: plan + SAMPLE-only prototype (Cluster › SERVICES, sample mode only). Nothing real is built yet.
Written 2026-10-12. Process: gstack (office-hours → CEO review → eng review → design review), run by hand from `/workspace/gstack/*/SKILL.md`. There was no one to ask live, so each review's questions are answered here with the recommended option and marked **Decision**. Anything that needs Gabriel or his brother is listed under **Open questions**.

---

## 1. Office hours: the problem

**Who.** Gabriel's brother manages developers at a company that builds Kubernetes operators. His team spins up its own test clusters:
1. **Bare:** plain Kubernetes plus cert-manager, used to test one operator.
2. **Bundle:** a large vendor bundle install with dozens of operators, hundreds of CRDs and 200+ namespaces.

Clusters are work clusters or small sandboxes. They are not always EKS: kind/k3d, OpenShift and managed clusters elsewhere all count.

**What he wants, in his order.**
1. A picture of the cluster (above all).
2. Which services and APIs talk to which.
3. When something broke: what happened, in what order, and where (incident review).

**Status quo.** `kubectl get` plus k9s, sometimes Lens or OpenShift's topology view. None of these answers "who calls whom" without a mesh. None of them survives 40 operators on one screen. And Kubernetes Events expire after about an hour, so the incident is gone by the time anyone looks.

**Narrowest wedge.** A read-only, single-binary view of one cluster: the ownership graph (operator → CR → what it owns) plus static service wiring, grouped by operator, with an event timeline that Cloud Spider records itself. It needs no AWS credentials, no mesh and no installs in the cluster.

**What makes this ours.** The Pip-Boy view of a cluster (already loved), the scorecard, and the fact that it runs locally on the kubeconfig you already have.

**Forcing-question answers (our best read; to confirm with him):**
- Demand: he asked for the visualization himself, and the incident view is the question his team asks after a broken test cluster.
- Observation: the bundle case breaks every tool we know. That is our proof point.
- Future fit: the module system lets the same codebase ship a "k8s monitoring + scorecard" product without the AWS half.

## 2. CEO review: scope

Mode: **selective expansion**. We keep the wedge and add only what makes the bundle case shine.

| In (phases 1–4) | Later (phase 5+) | Out |
|---|---|---|
| Module registry + profiles + UI gating, boots with no AWS credentials | Live edges from Hubble, VPC CNI flow logs | Any write to a cluster |
| Static + ownership graph from the Kubernetes API (EKS, vanilla, OpenShift) | Live edges from OTel/Istio Prometheus metrics | Running a mesh or agent for the user |
| Grouping, collapse, search, focus, edge budget (bundle scale) | Diff of two windows ("what changed") | Multi-cluster graph |
| Incident timeline: recorded events, restarts, rollouts, CR conditions, alarms | X-Ray service map | Tracing backend of our own |

**Decision.** Ship "k8s monitoring + scorecard" as a **profile**, not a fork. It is one codebase and one test suite; the config picks what loads.

## 3. Modules (part A)

### 3.1 Registry

A new `src/modules.js` declares every module once. The server, the browser and the scorecard all read it.

```js
{ id: "cluster", label: "Cluster", needs: ["kube"], deps: [],        ui: { tabs: ["cluster"], keys: [] },           routes: ["/api/cluster", "/api/kube"], packs: ["kubernetes"] }
{ id: "graph",   label: "Services", needs: ["kube"], deps: ["cluster"], ui: { screens: ["graph"] },              routes: ["/api/cluster/graph"] }
{ id: "events",  label: "Incident review", needs: ["kube"], deps: ["cluster"], ui: { screens: ["graph"], radio: true }, routes: ["/api/cluster/timeline"] }
{ id: "score",   label: "Score", needs: [], deps: [], ui: { keys: ["score-key"] }, routes: ["/api/score"] }  // packs come from the enabled modules
{ id: "map",     label: "Map", needs: ["aws"], deps: [],          ui: { tabs: ["tab-map"] },  routes: ["/api/map", "/api/place"], packs: ["aws"] }
{ id: "network", label: "Network (SNIFF, DEBUG)", needs: ["aws"], deps: ["map"], ui: { tabs: ["path"] }, routes: ["/api/path", "/api/netdebug"] }
{ id: "vaults",  label: "Vaults", needs: [], deps: [], ui: { tabs: ["tab-vaults"] } }
{ id: "stacks",  label: "Stacks", needs: ["aws", "pulumi"], deps: ["vaults"], ui: { keys: ["upgrade"] } }
{ id: "cost",    label: "Cost (CAPS)", needs: ["aws"], deps: [], ui: { gauges: ["spend"] } }
{ id: "radio",   label: "Activity", needs: [], deps: [], ui: { keys: ["tab-radio"] } }   // takes feeds from cluster/events/map
{ id: "learn",   label: "Learn", needs: ["kube"], deps: [], ui: { keys: ["learn-key"] } }
{ id: "ask",     label: "Ask", needs: ["agent"], deps: [], ui: { keys: ["ask"] } }
```

- **needs** are capabilities checked at boot: `aws` (credentials resolve), `kube` (a context answers), `pulumi`, `agent`. A module whose need is missing stays registered but shows "needs AWS credentials", and it never calls the SDK.
- **deps** are other modules. Turning on `network` turns on `map`. Turning off `cluster` turns off `graph` and `events`, and the settings drawer says why.
- **Decision.** Gate **creation, not just display**. With `aws` off, `main.js` builds no AWS clients and the routes return 404 "module off". An acceptance test boots with an empty environment and asserts that no AWS SDK module was imported.

### 3.2 Config

```yaml
modules:
  profile: k8s-only        # full | k8s-only | aws-only | custom
  enable: [learn]          # added to the profile
  disable: [ask]           # removed from the profile
```

- Env: `CLOUDSPIDER_PROFILE`, `CLOUDSPIDER_MODULES=+learn,-ask`.
- The existing `features.ask / learn / scorecard / stacksRun` and `network.enabled` keep working as aliases. The settings drawer shows "set by features.ask (deprecated)".
- **UI.** The settings drawer gets a MODULES list with a toggle each, dependencies and missing needs shown inline. A toggle changes the browser's view only (stored in localStorage, like the theme) until it is written to `cloudspider.yaml`. The server never writes the file itself; it prints the YAML to paste.

### 3.3 Profiles

| profile | modules | needs |
|---|---|---|
| **full** (default) | all | AWS + kube as today |
| **k8s-only** | cluster, graph, events, score (kubernetes pack), radio, learn, ask | a kubeconfig only, no AWS credentials |
| **aws-only** | map, network, vaults, stacks, cost, score (aws pack), radio, ask | AWS credentials only |

"k8s monitoring + scorecard" = `k8s-only` minus learn/ask. It is a one-line `disable`.

### 3.4 Score categories × modules

The categories stay the same (security, reliability, observability, platform, networking). What changes is which **packs** run:
- The `kubernetes` pack needs `cluster`; the `aws` pack needs `map`. `scorecard.packs` becomes "packs ∩ enabled modules".
- A category with no enabled pack shows **"not assessed (module off)"**, never 0. Coverage is computed over enabled packs only, so a k8s-only score is not punished for missing AWS controls. The report says which modules were off.
- Mapping today:
  - networking = k8s NetworkPolicy + AWS SG/NACL/peering;
  - observability = k8s metrics/logging + CloudWatch;
  - security, reliability and platform have controls in both packs.
- With one pack, the category weight is re-normalized over the assessed controls; this is already how `scorer.js` treats `insufficient`.

## 4. Service graph and incident review (part B)

### 4.1 Data sources, in build order

| layer | source | what it gives | needs in the cluster | decision |
|---|---|---|---|---|
| **static** | Services, EndpointSlices, Ingress / Gateway API / OpenShift Routes, NetworkPolicies | what *may* talk (selector → pods), entry points, what is *blocked* | read RBAC only | **phase 2** |
| **owner** | ownerReferences, CRDs, OLM ClusterServiceVersions (OpenShift / OLM bundles), Helm release labels | operator → CRs → Deployments/Services/Secrets; which operator a namespace belongs to | read RBAC only | **phase 2** (the bundle case lives here) |
| **trace (metrics)** | Prometheus: OTel collector `servicegraph` connector (`traces_service_graph_request_total`), Istio `istio_requests_total`, Linkerd `response_total` | who called whom at L7, with rate and errors | an existing Prometheus with one of these | **phase 5a**: cheapest live edges, a single PromQL query |
| **flow** | Hubble Relay (Cilium), EKS Network Flow Monitor / VPC CNI flow logs | what did talk at L3/L4, including denied flows | Cilium, or the EKS agent / flow logs (aws module) | **phase 5b/5c** |
| X-Ray | service map API | traces on AWS | aws module | later, if asked |

Edges carry `source`. The UI's layer toggles (STATIC · FLOWS · TRACES · OWNERS) filter by it, so "allowed but never used" and "used but not declared" are both visible.

### 4.2 Scale (the bundle case)

- **Group by operator first, then namespace.** The group is the OLM CSV or Helm release that owns a namespace's workloads, falling back to the namespace prefix (`<suite>-<operator>-*`) and finally to the namespace itself.
- **Collapsed by default** above 12 groups or 30 nodes. Small clusters open everything (the bare case).
- **Edge budget.** The overview draws at most 18 merged group→group links, errors first and then traffic, and says "N of M shown". **Focus** on a group shows only it and its neighbors, with every link.
- **Search** across group, service, namespace and CR names. Matches are lit and the rest dimmed.
- **Server-side aggregation.** The server sends groups, merged edges and counts; members are fetched only when a group opens. Paginated list calls (`limit=500`), with an informer-style resourceVersion cache.
- **Budget.** 2,000 pods / 300 namespaces / 250 CRDs: graph JSON under 300 KB, render under 300 ms. A synthetic perf test enforces this, like the existing layout perf test.

### 4.3 Incident review

- **Window** (default: last 60 min, or around a picked alarm), with ticks on a track and a list underneath. Clicking an event focuses its group and selects its service in the graph.
- **Sources:**
  - Kubernetes Events (**recorded by Cloud Spider**, because the API keeps them for about an hour; stored in the existing state dir, size-capped);
  - pod restarts (`restartCount` deltas + last-state reason);
  - rollouts (Deployment/StatefulSet revisions, rollback detection);
  - **CR status condition changes** (operators report through conditions, which is the key signal for his team);
  - Alertmanager alerts if Prometheus is present;
  - CloudWatch alarms (aws module).
- **Correlation, v1:** time plus graph neighborhood. Events in the window on the focused group and its neighbors are ranked first. There is no "root cause AI" claim.

### 4.4 Plain Kubernetes / OpenShift

- Everything in phases 2–4 uses the Kubernetes API through the kubeconfig. EKS-specific parts (the viewer role, the AWS Load Balancer Controller hints) are extras.
- OpenShift: Routes count as entry points, OLM CSVs drive grouping, and `oc` contexts are plain kubeconfig contexts.
- The scorecard's kubernetes pack already avoids EKS-only assumptions, except for the controls tagged `eks`, which are skipped off-EKS.

## 5. Eng review

- **Architecture.**
  - `src/graph/read.js` (list + cache) → `src/graph/build.js` (pure: objects → nodes/edges/groups; shape = prototype's `graph-sample.js`) → `src/graph-model.js` (already written: visibility, focus, budget, search) → `graph-view.js`.
  - Timeline: `src/events/recorder.js` (watch → ring buffer on disk) → `/api/cluster/timeline?from&to`.
- **Data contract.** The prototype's scenario shape *is* the API shape, so the view will not change when real data lands.
- **Failure modes.**
  - Partial RBAC (namespaced only): show "namespaces you can read: N"; groups never guess.
  - A missing CRD read: the ownership edge falls back to a label.
  - Prometheus down: hide the trace layer with a reason.
  - A 5k-object cluster: paginate, and time out per kind with "partial".
- **Security.** Read-only verbs only (`get/list/watch`). Secrets are never read; ownership stops at "Secret name". Viewer RBAC manifests get the new kinds.
- **Tests.** Pure builders get fixture tests (bare / bundle / OpenShift CSV). Plus a perf test at 2k pods, the "boots with no AWS" acceptance test, and a module dependency-resolution table test. The prototype ships with `test/graph-prototype.test.js` (6 tests).

## 6. Design review

Ratings from the prototype shots, 0–10:

| dimension | prototype | target | how |
|---|---|---|---|
| information hierarchy | 7 | 9 | bands (edge → foundation → integration → data → apps) read top-down like a request |
| scale legibility | 7 | 9 | grouping + edge budget + focus work; next: mini-map, group size by pods |
| Pip-Boy fidelity | 8 | 9 | phosphor cards, corner brackets, glow on focus, amber CRs; next: CRT edge animation along traffic |
| pro theme | 8 | 9 | flat cards, accent focus, colored source lines |
| edge clarity in open groups | 6 | 8 | chip-to-chip arcs overlap labels; route around cards (orthogonal edges) in the real build |
| incident flow | 8 | 9 | clicking an event focuses its group; next: scrub the window and replay edge colors over time |

**Decision.** HTML cards plus an SVG edge overlay, not canvas, for this view. Text, search highlight, focus and both themes come from CSS, and accessibility comes free (buttons, aria labels). The topology canvas stays as is.

## 7. Phases and effort (my build time)

| phase | what | effort |
|---|---|---|
| 0 | this plan + SAMPLE prototype (done) | ~2 h |
| 1 | module registry, profiles, config + aliases, settings MODULES drawer, gated creation, boots with no AWS | 5–6 h |
| 2 | real static + ownership graph (Services/EndpointSlices/Ingress/Routes/NetworkPolicy, ownerRefs, CRDs, OLM CSV) | 6–8 h |
| 3 | scale: grouping heuristics, server aggregation, lazy members, 2k-pod perf test | 3–4 h |
| 4 | incident review: event recorder, restarts, rollouts, CR conditions, Alertmanager/CloudWatch alarms, window picker | 6–7 h |
| 5a | live edges from Prometheus (OTel servicegraph / Istio / Linkerd) | 3–4 h |
| 5b | Hubble Relay edges (Cilium) | 3–4 h |
| 5c | EKS flow monitor / VPC flow logs → pod edges (aws module) | 5–6 h |

**Recommended order:** 1 → 2 → 3 → 4 (a usable product for his team at about 22 h), then 5a. Phase 5b/5c only if his clusters run Cilium or he wants AWS flows.

## 8. Open questions

1. Are the team's clusters mostly OpenShift, vanilla (kind/k3d) or EKS? This sets the priority of OLM CSV grouping and Routes.
2. Is there a Prometheus with OTel, Istio or Linkerd metrics in those clusters? If yes, live edges come cheap (5a); if no, static + ownership is the product.
3. Is RBAC cluster-wide read, or namespaced? This affects grouping and the "partial" UX.
4. How long should incident history be kept (hours, days)? This decides the size of the recorder.
5. Should the minimal product be a separately branded build, or just `profile: k8s-only`?
6. Is it OK to record cluster events on the user's disk (state dir)? Is any data ever shared off the machine? (It is not today.)

## 9. The prototype (SAMPLE only)

- **Where:** Cluster › **SERVICES** tab, shown only in sample mode (`#?sample=1`). It leaves with sample mode.
- **Scenarios** (made-up names):
  - `sandbox-bare`: ingress-nginx, a demo app, cert-manager (controller, webhook, cainjector, ClusterIssuer), kube-system. Incident: a cert-manager upgrade leaves the webhook unready, the api rollout is blocked, web 5xx.
  - `sandbox-nimbus`: "Nimbus Suite", a fictional bundle of 40 operators in four tiers, 225 namespaces, 160+ CRDs, ~660 pods. Incident: a ledgerdb operator upgrade, store restarts, event-bus lag, billing 5xx, workflow CrashLoop, rollback.
- **Controls:** scenario switch, search, layer toggles, FOLD ALL; click a group to focus it, + to open it, a service for its calls, an event to jump to it; Esc leaves focus.
- **Files:** `src/graph-sample.js`, `src/graph-model.js`, `src/graph-view.js`; CSS in `server.js` (pip + pro); `test/graph-prototype.test.js`.
