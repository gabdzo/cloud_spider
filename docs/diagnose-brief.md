# Diagnose brief (copy of Gabriel's implementation brief, with amendments)

> Source: `docs/CLOUD_SPIDER_GROK_IMPLEMENTATION_PROMPT.md` in Gabriel's tree, copied 2026-10-13.
> The **Amendments** section was agreed with Gabriel on 2026-10-13 and takes precedence over the brief where they differ.

## Amendments (agreed 2026-10-13)

1. **Names.** The brief's `PATH` is now **SNIFF**: the request path, the DEBUG bar and FROM INSIDE (the debug pod). An **INCIDENT REVIEW** (SERVICES view) and the **observe bundle** (Beyla eBPF, OTel collector, Loki; `upgrades/observe`) already exist. Diagnose builds on them.
2. **Read-only, nothing installed.** The investigation itself is read-only and works with nothing installed in the cluster. The observe bundle and the debug pod are **not removed**. They are optional evidence sources and capabilities, and capability detection reports them. Investigate never starts the debug pod.
3. **Rules.** `NET-001` (a Service with 0 ready endpoints), `K8S-001` (pods running but unready, persistently), `NET-002` (ALB target group unhealthy, **only with a verified mapping**), and for Gabriel's brother (bare Kubernetes + cert-manager, builds operators) `OPS-001` (an admission webhook whose Service has no ready endpoints) and `CERT-001` (a cert-manager Certificate that is not Ready). Optional `APP-001` (error rate on calls to the Service), only when the observe bundle provides the service graph. Every rule has negative controls.
4. **Demo story.** The `brother-sandbox` db failure: db fakes about 5% `pool exhausted` errors in its code (`random.random() < 0.05`), and the real api→db error rate is about 5–6.5%. The SAMPLE fixture runs offline: incident → Investigate → evidence and missing capabilities → fix → Verify again → resolved. It uses the same schema as live mode.
5. **Docs.** This file, plus `docs/architecture/hybrid-baseline.md`.

---

# CLOUD SPIDER — GROK CODING AGENT IMPLEMENTATION BRIEF

> **Mode:** Senior product engineer + principal SRE architect + hands-on coding agent  
> **Project:** Cloud Spider  
> **Strategy:** Hybrid — **Atlas** (live operational overview) + **Diagnose** (on-demand evidence-based investigation)  
> **Priority:** Build a small, verified end-to-end feature in the existing repository. **Do not initiate a rewrite.**

---

## 0. Your assignment

You are the lead engineer responsible for turning the following agreed product direction into working, tested code in this repository.

**Inspect the actual repository first. Its current code, tests, and docs are the source of truth.** An older review described a localhost Node.js Cloud Spider with views named `MAP`, `PATH`, `CLUSTER`, `VAULTS`, `CAPS`, `STACKS`, `LEARN`, `ASK`, and `RADIO`, AWS SDK integration, Kubernetes inspection, and optional infrastructure operations. That review may now be stale. Do **not** assume a module, API, UI, integration, or test exists until you confirm it.

Do more than write a product roadmap: **implement the first usable vertical slice**, run appropriate local tests, and report exactly what changed and what remains unverified. If the repository differs materially from the assumed architecture, adapt to the real code rather than forcing an idealized directory structure.

### Product thesis

- **Cloud Spider Atlas:** Continuous or refreshable overview of infrastructure topology, live health, changes, existing observability, policy/compliance signals, and later SRE scorecards. Atlas is primarily a local/self-hosted dashboard. It connects to existing systems rather than replacing them.
- **Cloud Spider Diagnose:** On-demand investigation. Starting from an unhealthy workload, Service, or HTTP request path, assemble evidence across AWS/Kubernetes/observability/policy/GitOps, distinguish facts from hypotheses, recommend a safe next step, and **verify whether the failure was resolved**.
- **Hybrid architecture:** Shared resource/relationship/evidence/finding contracts, **independent execution modes**. Atlas must be able to display live information without Diagnose running. Diagnose should not require Atlas or a browser to perform its core work. A separate CLI may come later; a second full product is **not** an MVP requirement.
- **Strongest first use case:** EKS ingress/request-path troubleshooting: AWS ALB / target group → Ingress/controller → Kubernetes Service → EndpointSlice → Pod readiness/health, with optional metrics and policy evidence.

**North star:** Make one real production-style EKS incident easier to diagnose and verify than using AWS Console + kubectl + existing tools manually. Don't compete by producing more dashboards or generic warnings.

---

## 1. Non-negotiable principles

1. **Integrate, don't reinvent.** Reuse Kubernetes APIs, AWS APIs, Prometheus, Loki, OTel-compatible backends, Kyverno PolicyReports, K8sGPT, Cilium/Hubble, Terraform/Pulumi, and Argo/Flux when present. Do not reproduce their scanners, collectors, policy engines, tracing systems, or eBPF tooling.
2. **OpenTelemetry is not a query database.** Connect to actual queryable backends such as Prometheus, Loki, Tempo, or supported vendor APIs. Do not build a custom OTel collector or observability database.
3. **Read-only by default, genuinely.** The first end-to-end diagnostic workflow must not mutate AWS or Kubernetes; no Pods/Jobs/agents installed, no writes, no automatic remediations. Do not broaden existing credentials or IAM/RBAC grants. Never call `pulumi up/destroy`, `terraform apply/destroy`, `kubectl apply/delete/patch`, AWS start/stop/mutation APIs, or run live-cost-incurring provisioning during development unless the operator explicitly authorizes that specific action.
4. **No mandatory dependencies on Kyverno, Prometheus, Grafana, K8sGPT, OTel, Loki, Argo, AI, or external SaaS.** Capability detection must support a useful degraded mode. Missing evidence must not be called healthy.
5. **Deterministic findings.** An LLM may explain evidence later, but cannot invent evidence, determine authoritative facts, or bypass rules. The MVP must work entirely without AI credentials or a network connection to an LLM.
6. **Do not throw away the dashboard.** Preserve existing UI/view behavior where possible. Integrate changes incrementally. Isolate risky existing `STACKS`/provisioning features from the new diagnostic execution paths; do not silently delete them.
7. **Avoid premature Rust.** Do not port the Node.js application to Rust or start a second language runtime now. Only propose a future Rust CLI after the shared evidence contract and end-to-end workflow are proven and cross-process needs are identified.
8. **No hidden cluster footprint.** The MVP is agentless and does not install Kyverno, OTel, Cilium, K8sGPT, netshoot, or other tooling.
9. **Respect existing work.** Check `git status` before editing. Never reset, force-clean, overwrite unrelated uncommitted changes, or change credentials. Make narrowly scoped changes, compatible with existing tests and conventions.
10. **Evidence provenance and security.** Treat logs and API metadata as sensitive. Do not retrieve Kubernetes Secrets, leak tokens or kubeconfig, log cloud credentials, or send environment data to third-party systems. Evidence must identify its source, timestamp, scope, and collection limitations.

---

## 2. Competitive reality — explicit build/buy boundaries

| Existing tool | What it does | Our allowed addition | What NOT to build |
|---|---|---|---|
| OpenTelemetry + Prometheus/Grafana | Telemetry collection, queries, dashboards | Read existing metrics and correlate to resources | Metrics collector, TSDB, generic monitoring platform |
| Loki / Tempo / APM | Logs and tracing | Time-bounded, targeted evidence links/queries | Log pipeline, distributed tracing platform |
| Kyverno / Kubernetes ValidatingAdmissionPolicy / Gatekeeper | Admission and policy evaluation | Read actual available policy evidence, associate it with affected workloads and incidents | New admission/policy/scoring engine duplicating controls |
| K8sGPT / Popeye / Polaris / kube-score | Kubernetes analysis and linting | Optional imports, side-by-side comparisons, deeper cross-system context | Huge generic Pod/config linter catalog |
| Cilium/Hubble, kubectl debug, Inspektor Gadget | Network telemetry and debug execution | Use existing output; optional future approved targeted tests | eBPF collector, packet tracer, privileged daemon |
| Terraform / Pulumi / Argo CD / Flux | Desired state, deployment and drift evidence | Correlate known changes and optionally propose declarative fix in future | IaC engine, `apply`/`destroy`, custom GitOps controller |
| Datadog / New Relic / Komodor / Robusta / Coroot | Monitoring, incident context and RCA | Local-first cloud-to-cluster path investigation + explicit verification | Full SaaS observability or generic autonomous RCA claims |

**Core proprietary value to prove:**
- A reliable **cross-boundary resource relationship model**.
- An **investigation record** with evidence, unresolved questions, and confidence/coverage.
- A **before/after verification workflow** tied to the original failure, not just a fresh green dashboard.
- An Atlas view that makes the investigation and history understandable.

---

## 3. Concrete product boundaries

### Atlas owns
- Existing `MAP`, `PATH`, `CLUSTER` and relevant other UI surfaces, with as much reuse as practical.
- Read-only live queries or bounded refreshes to authorized AWS/Kubernetes and existing observability systems.
- Topology/resource relationship visualization.
- Findings, investigation history and before/after comparisons (local-only storage initially, using existing local persistence patterns if adequate).
- Capability/discovery status: what tools/data sources are available, unavailable, stale, or inaccessible.
- Later: SRE/diagnostic-readiness scorecards, costs, history, multi-cluster/team functionality.

### Diagnose owns
- Selecting one failing workload, Service, Ingress, or known path (initially, the existing `PATH` scope is preferred).
- Targeted evidence gathering using already-authorized read-only APIs, reusing collectors/adapters already present.
- Evaluating a **small** catalog of deterministic, high-confidence rules.
- Reporting observed facts separately from causal hypotheses.
- Returning concrete next inspection steps and safe read-only commands.
- Re-running relevant checks to verify whether the specific original failure cleared.
- Producing versioned JSON output usable by Atlas and future CLI/CI integrations.

### Shared packages/interfaces own
- Entity identities (account, region, cluster, namespace, kind, name, UID when appropriate).
- Resources and typed relationships with observed provenance.
- Evidence, findings, scan coverage, severity, confidence, investigation lifecycle and verification result.
- Compatible serialized contracts, adapters, and fixtures.

Atlas must not be a thin skin over the Diagnose CLI; it must continue to work without it. Diagnose must not know about Atlas view components.

---

## 4. First implementation: a thin vertical slice (build this before expanding)

The initial workflow is **`Investigate an unhealthy request path`**. Scope to what the actual code supports and only extend enough to demonstrate a real end-to-end diagnosis.

### Step A — Repository reconnaissance (short, factual)

Inspect:
- README and `docs/`, especially any product overview, design or architecture notes.
- Actual UI navigation/routes, `PATH` implementation, Kubernetes collectors, AWS adapters, tests, config and persistence.
- Which calls are read-only vs mutating.
- Current direct dependencies and test commands.
- Current fixtures/demo mode, if any.

Produce a brief `docs/architecture/hybrid-baseline.md` (or an existing appropriate docs location) with:
1. Confirmed current architecture and reusable code.
2. Small, explicit gaps to the target workflow.
3. Proposed changed files/interfaces.
4. Risks/assumptions, especially ALB→Kubernetes mapping correctness and existing credentials.
5. What is intentionally postponed.

Keep this report concise. **Then proceed to implementation without waiting for approval for safe, local, read-only changes.** Ask only if a destructive operation, new privilege, external deployment, or irreversible design decision is unavoidable.

### Step B — Shared evidence contract

Design a minimal versioned schema / types with structures similar to:

```json
{
  "schema_version": "1.0",
  "investigation_id": "example-001",
  "started_at": "2026-10-13T16:00:00Z",
  "scope": { "cluster": "prod-eks", "namespace": "checkout", "service": "checkout-api" },
  "capabilities": [
    { "name": "kubernetes-api", "status": "available" },
    { "name": "prometheus", "status": "not-configured" }
  ],
  "resources": [],
  "relationships": [],
  "evidence": [],
  "findings": [
    {
      "id": "stable-fingerprint",
      "code": "NET-001",
      "severity": "high",
      "confidence": "high",
      "status": "confirmed",
      "resource_ref": "k8s://prod-eks/checkout/service/checkout-api",
      "evidence_refs": ["evidence-001"],
      "summary": "Service has zero ready endpoints"
    }
  ],
  "coverage": { "complete": false, "missing": ["prometheus"] },
  "verification": { "status": "not_run" }
}
```

This is a **shape example**, not a strict final schema. Refine to match the repository. Require:
- Schema version and tested JSON serialization.
- Stable finding code and issue fingerprint (not based only on ephemeral Pod UID).
- Severity separate from confidence and diagnostic status (`confirmed`, `suspected`, `insufficient_evidence`).
- Source, observed-at timestamp, bounded/raw-vs-normalized evidence and provenance.
- Missing/stale/inaccessible capability reporting.
- Investigations distinguish verified resolution from inconclusive results.
- Safe output redaction and size limits.

### Step C — Reuse `PATH`, normalize real evidence

Reuse the current AWS/Kubernetes relationships **where their correctness can be established**. The graph may include ALB listener/rule → target group → targets → Ingress/controller → Service → EndpointSlice → Pod, but **do not claim these links are universal**. EKS ALB controller configurations differ (instance vs IP targets, gateway patterns, annotations and ownership, node targets, etc.).

Implement defensible paths with clear unsupported/unknown relationships instead of guessing. Preserve the existing visual PATH behavior unless there is a demonstrable correctness problem.

Target initial deterministic cases:
- `NET-001`: Service has zero ready endpoints when backends are expected.
- `NET-002`: Related ALB target group reports unhealthy or missing expected targets (only with verified mapping).
- `K8S-001`: Related application Pods report persistent readiness problems.
- Optional fourth rule if already supported by reliable evidence: a broken backend reference/port.

A missing ready endpoint is a **symptom**; do not claim deployment/configuration is the root cause without additional evidence.

### Step D — Investigation + verification

Implement an API/module that:
1. Takes an explicit scope (service/path/context/account as supported).
2. Collects the minimal necessary evidence, with timeouts and limited API requests.
3. Produces the common result contract.
4. Shows evidence and unresolved questions.
5. Saves or returns an investigation snapshot.
6. Accepts a prior investigation result and reruns relevant read-only checks.
7. Compares before/after conditions: `resolved`, `still_failing`, or `inconclusive`.

Do not infer recovery solely because errors disappeared from a missing metrics query. Verification should reuse the same resource/path semantics and explicitly check evidence freshness.

### Step E — Atlas integration

Integrate one investigation experience into the current dashboard, ideally reusing `PATH` instead of inventing a separate application shell:
- `Investigate` action on a supported failing service/path.
- Summary with finding code, severity, evidence and confidence.
- Drilldown for observed path and missing capability explanations.
- `Verify again` action with before/after result.
- Demo mode showing one known incident and its verified resolution, powered by the same structured schema as real mode.

If the UI already has an appropriate pattern, use it. Do not create nine new tabs or an unrelated dashboard.

### Step F — Test realistically

At minimum, include deterministic fixtures for:
- Healthy Service with ready endpoints (no erroneous NET-001).
- Service with zero ready endpoints (NET-001).
- Running but unready Pods (distinguish running from ready).
- Unhealthy ALB targets with a **verified** relationship (NET-002).
- Unhealthy targets without a provable relationship (report unknown; no invented causal link).
- Restricted RBAC/forbidden or missing AWS permissions (partial coverage, not all-green).
- Missing Prometheus/Kyverno (core still works).
- Fix verification: failure persists, genuinely resolves, and evidence becomes unavailable (inconclusive).
- Redaction of sensitive log/metadata examples.

Use unit tests plus existing application integration tests. Where live infrastructure is unavailable, use fixtures and clearly say so. **Never fake a live EKS result.**

---

## 5. Optional integrations — in priority order

**Tier 0: required for initial verified path**
1. Existing kubeconfig/current context and Kubernetes API access.
2. Existing AWS credential chain and bounded ALB/target group queries, when relevant.
3. Existing Cloud Spider PATH/topology resources.

**Tier 1: add only after initial vertical slice passes tests**
4. Prometheus: bounded read-only queries for application/ingress errors and workload trends; explicit mapping of metrics to resources.
5. Kyverno: discover PolicyReport/ClusterPolicyReport APIs when available and import relevant results. Do not treat absence of violations as proof of application health. Do not assume PolicyReports expose all historical admission rejections.
6. Existing log backend: bounded, opt-in Loki/CloudWatch queries; redact and limit payloads.

**Tier 2: defer**
7. K8sGPT structured finding import (only when actually available; no installation).
8. Argo/Flux deployment-change evidence.
9. Cilium/Hubble flow evidence.
10. Terraform/Pulumi drift results, Slack/PagerDuty, Backstage, MCP, CI SARIF, remote Atlas ingest.

Build no abstract plugin marketplace. Use a minimal adapter contract that can support one additional provider without core changes.

---

## 6. What NOT to build or change now

**DO NOT:**
- Rewrite Cloud Spider in Rust, Go, Python, or a new frontend framework.
- Start a `spider-probe` service, operator, privileged DaemonSet or permanent in-cluster collector.
- Automatically install OTel, Prometheus, Loki, Kyverno, Cilium or K8sGPT.
- Build a new policy engine, security scanner, packet tracer, eBPF collector, time-series database, log store, or AI agent framework.
- Duplicate k9s/Lens cluster management views, or create a generic Kubernetes linter with dozens of rules.
- Add multi-cloud, multi-tenant SaaS auth, billing, subscriptions, enterprise licensing or managed cloud infrastructure.
- Introduce a full SRE scorecard system before the investigation-to-verification path works.
- Remove or rewrite existing MAP/CAPS/VAULTS/LEARN/STACKS features as collateral damage.
- Execute existing infrastructure-provisioning or destructive workflows to test Diagnose.
- Trust AI explanations as primary evidence.

Rust CLI is a **future architecture option**, contingent on proving independent use and distribution requirements. If proposed, document expected binary size, build/CI burden, Kubernetes/AWS auth parity, and how it consumes the shared schema; do not implement it now.

---

## 7. Quality, security and performance gates

Acceptance criteria for this MVP slice:

- [ ] Atlas still launches with documented existing commands, sample mode still functions, and existing tests pass (or regressions are identified and fixed).
- [ ] A user can investigate one supported EKS/Kubernetes service/path and see actionable, source-linked findings.
- [ ] `NET-001`, `NET-002` (where relationship is verified) and a readiness finding have deterministic tests and negative controls.
- [ ] No Kubernetes/AWS mutations are performed by the new investigation path.
- [ ] Missing optional systems and forbidden API calls produce `unknown`/`insufficient_evidence`, not false healthy states.
- [ ] Repeat/verify compares the original failure conditions and produces one of `resolved`, `still_failing`, `inconclusive`.
- [ ] No credentials, Secrets or tokens appear in recorded evidence or debug logs.
- [ ] Only required APIs are called; bounded timeouts/concurrency and non-disruptive behavior are documented.
- [ ] One fixture-backed demo can be explored entirely offline.
- [ ] Architectural docs explain Atlas vs Diagnose ownership and future CLI boundary.

Performance targets to measure, not blindly claim:
- First useful local investigation summary: < 30 seconds for a small test cluster when API access is healthy.
- No default in-cluster deployment or installation.
- Zero additional broad privileges.

---

## 8. Working method / agent workflow

Use the repository's established coding standards, tests and contribution conventions. If **Superpowers** or equivalent agent skills exist, prefer the sequence:

```text
inspect repository
   ↓
brief /brainstorming or /office-hours — challenge assumptions, do not expand scope
   ↓
minimal design + implementation plan
   ↓
implement one vertical slice
   ↓
tests and negative cases
   ↓
review for correctness and security
   ↓
update docs and report results
```

Do not spend the entire session creating speculative plans, agents, plugin scaffolding, or demos. **Ship a working, tested increment.** Use small commits only if the environment and user's workflow permit; do not commit unrelated changes.

Before finalizing, check that every new rule is backed by source evidence, that optional integrations really are optional, and that the current dashboard was not broken.

### Required final response from you

Give the human owner:

1. **What you discovered:** confirmed current architecture, key gaps and any mistaken assumptions in this brief.
2. **What you implemented:** precise files/modules and user-visible behavior.
3. **How to run it:** exact commands appropriate to this repository.
4. **Tests executed:** commands and pass/fail results; explicitly identify unrun live-cluster checks.
5. **Security/permissions:** APIs used, data retained, what is read-only and what remains unchanged.
6. **What you deliberately did NOT build** and why.
7. **Next three highest-value tasks**, ordered, with estimates and dependencies.
8. **Go/no-go recommendation** for a standalone Diagnose CLI/Rust rewrite based on evidence collected so far, not personal preference.

---

## 9. First action — do this now

1. Print `git status` and inspect the README, current docs, PATH implementation, Kubernetes/AWS adapters, tests, and existing sample fixtures.
2. Write a concise factual gap assessment and implementation checklist grounded in actual files.
3. Start implementing **the shared finding/evidence contract plus one end-to-end `PATH` investigation and verification loop**, with tests and minimal UI integration.
4. Stop before destructive actions, new privilege grants, third-party data transmission, major rewrites, or production deployments. For other safe/local code changes, proceed autonomously.

**Success is not a bigger Cloud Spider. Success is one incident whose cause can be investigated and whose fix can be verified, using evidence from systems that already exist.**
