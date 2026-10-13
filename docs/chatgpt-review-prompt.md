# Prompt for ChatGPT: critical product review and roadmap

Paste everything below the line into ChatGPT, then paste `docs/product-overview.md` right after it.

---

You are a senior product engineer and SRE tooling founder. Review a project called **Cloud Spider** critically. Be blunt and specific, don't flatter, and say what to delete. A factual overview of what it does today follows this prompt (the file `product-overview.md`). Treat the overview as ground truth for the current state. If something you need isn't in it, say so as an explicit assumption instead of guessing.

## The vision (from the author)

I want Cloud Spider to feel like two things:

1. **A hacker's USB stick.** You plug it into a system and it immediately audits and analyzes what's there, then drops in the tools it needs. For us that's not malware but debug tools, analytics and diagnostics, and it cleans up after itself.
2. **A mechanic's OBD diagnostic tool.** You plug it into the car's port, it reads the codes, explains what they mean and tells you what to fix.

Direction: **really lightweight, easy to integrate with existing systems, and working almost out of the box.** Targets are DevOps/SRE on AWS + EKS, and operator/platform developers on bare Kubernetes or OpenShift.

## What I want from you

1. **Gap analysis vs. the vision.** For each part of the current product, does it fit, partially fit or work against the "plug in, diagnose, leave" model? Why?
2. **Cut / simplify / keep.** Which modules, views and features to cut, merge or move to plugins. Be concrete, naming the views from the overview.
3. **Plug-in install and footprint model.** Compare the options and recommend one (or a combination): a single static binary, a kubectl plugin (krew), an ephemeral in-cluster agent with auto-cleanup (TTL, owner references, uninstall guarantees), an agentless/API-only mode, and the browser UI vs a TUI. Read-only by default, with escalation to write only when needed. Cover permissions (minimal RBAC/IAM), what runs in the cluster and for how long, eBPF/privileged requirements and fallbacks when they're not allowed (OpenShift, locked-down clusters), and the time-to-first-insight target.
4. **Diagnostic workflow.** Design the "OBD" flow: scan → findings as stable **codes** (propose a code scheme, e.g. `NET-012`, with severity) → plain-language explanation with evidence → suggested fix (copy-paste command or PR) → verify. Give 10–15 example codes that fit the current capabilities (networking/NetworkPolicy, DNS, endpoints, pod health, resource pressure, error rates, cost, IaC drift).
5. **Integration points.** Where it should plug in: kubeconfig/contexts, cloud credentials, existing Prometheus/OTel/Loki/Grafana (reuse instead of installing our own), CI (scan as a gate), Slack/PagerDuty, GitOps (Argo/Flux), Backstage, IaC (Pulumi/Terraform). Which to do first.
6. **Competitors and differentiation.** Compare against k9s, Lens/OpenLens, Komodor, Robusta, Groundcover, Coroot, Pixie, kubectl-debug / `kubectl debug`, Popeye, Polaris/kube-score, Kubescape, Datadog/New Relic, and any others you think matter. Where is the real gap, and what would make someone choose this? What should we copy and what should we avoid?
7. **Risks.** Technical (eBPF portability, privileges, cluster load, accuracy), security/trust (a tool that "drops things in" a cluster), adoption, maintenance for a solo developer building with AI agents, and business.
8. **Phased roadmap.** MVP / v1 / later, each with goals, concrete items, effort (S/M/L or person-weeks for one developer with AI coding agents), dependencies and a success metric.

## Output format

Answer in Markdown with exactly these sections, so I can paste it back into my coding agent:

```
## 1. Verdict (5 bullets max)
## 2. Gap analysis
| area/view | fit (yes/partial/no) | why | action (keep/cut/merge/rework) |
## 3. Cut / simplify list
## 4. Install & footprint recommendation
## 5. Diagnostic workflow + code scheme
| code | severity | detects | evidence source | suggested fix |
## 6. Integration points (prioritized)
## 7. Competitors & differentiation
| tool | what it does well | where we differ | copy/avoid |
## 8. Risks
| risk | likelihood | impact | mitigation |
## 9. Roadmap
| phase | item | effort | depends on | success metric |
## 10. Open questions for the author
## 11. Assumptions you made
```

Keep each table row to one line. Prefer specific, testable items over general advice.

The overview follows.
