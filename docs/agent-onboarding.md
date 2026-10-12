# Agent onboarding: register your services as vaults

Paste the prompt below into your coding agent (Claude Code, Cursor, Codex, Aider…).
It finds the services in a repo and/or a running cluster, **read-only**, and
writes one `vaults/<service>.yaml` per service. Cloud Spider then shows them in
VAULTS, ties them to the SERVICES graph, measures their SLOs and names them in
the morning report.

Nothing is written to the cluster. The only files the agent writes are under `vaults/`.

## Before you start

- Cloud Spider running (`npm start`, http://127.0.0.1:9241), a kube context connected
  (CLUSTER → CONNECT) if you want the cluster checked.
- The format: `vaults/templates/k8s-service.yaml` (commented), the JSON schema
  `schemas/vault.schema.json` (point your editor's YAML extension at it for completion).
- The check: `npm run validate-vaults` (schema, unique names/numbers, every
  `dependsOn.vault` exists). Add `-- --graph <url-or-file>` to check workloads against
  the cluster too.

## The prompt

```text
You are onboarding services into Cloud Spider. Work READ-ONLY on the cluster and
on every repo except this one; the only files you write are vaults/<name>.yaml in
this repo. Never print or copy secrets, tokens or kubeconfigs.

1. Discover services.
   a. From code (if I gave you repos): Dockerfiles, Helm charts (Chart.yaml,
      values*.yaml, templates/), Kubernetes manifests and kustomizations,
      OpenAPI/proto files, docker-compose, CI deploy jobs. Environment variables
      and config that name other services (FOO_URL, *_HOST, DATABASE_URL hosts,
      Kafka topics, queue names) are dependencies. CODEOWNERS, README and
      maintainers files give the owner.
   b. From the cluster (if Cloud Spider runs): GET
      http://127.0.0.1:9241/api/cluster/graph?context=<ctx>   (read-only).
      nodes[] are services/workloads with ids "namespace/name"; edges[] are
      who may talk to whom (kind http|grpc|tcp|admission|watch|owns); groups[]
      are namespaces or operators. You may also use `kubectl get` (get, list
      only: deployments, statefulsets, daemonsets, services, ingresses, routes)
      with the context I name. No apply, edit, delete, exec, port-forward.
   Skip platform pieces unless I ask (kube-system, cert-manager, operators'
   own controllers, monitoring); one vault per thing a team owns and is paged for.

2. For each service write vaults/<name>.yaml following
   vaults/templates/k8s-service.yaml and schemas/vault.schema.json:
   - metadata: name (lowercase-dashes), a free number 100-999 not used by
     another vault file, title, a one-sentence description (what it does, for
     whom), owner (team from CODEOWNERS/labels; "unknown" if there is none, and
     say so in your summary), contact if you find one.
   - spec.type: api | service | worker | data | static-site | other.
   - spec.workloads: every Deployment/StatefulSet/DaemonSet/CronJob and Service
     that is this service (namespace, kind, name), exactly as in the cluster.
   - spec.dependsOn: one entry per dependency: vault: <other vault name> when we
     have (or you are writing) a vault for it, service: <graph node id> for an
     in-cluster thing without a vault, database / queue / external for the rest.
     Set protocol, and critical: true when the service cannot serve without it.
   - spec.links: repo, docs, runbook, dashboard when they exist (https URLs only).
   - spec.slos: start with a restarts SLO (sli error-rate, source
     kube:restarts:<ns>/<workload>, target 99.5%, window 30d); add availability
     via an http check (spec.checks.http with a health URL) for user-facing ones.
   Do not invent URLs, owners or dependencies: leave them out and list them as
   open questions.

3. Run `npm run validate-vaults -- --graph "http://127.0.0.1:9241/api/cluster/graph?context=<ctx>"`
   (or without --graph if there is no cluster). Fix every ERROR and loop until it
   prints "all valid". Warnings are allowed; explain each one you leave.

4. Summarize: a table of vaults (name, owner, workloads, dependencies), the open
   questions, and the validate output. Do not commit; I review first.
```

## What the check reports

| message | meaning |
|---|---|
| `metadata.number N is already VAULT N in x.yaml` | pick another free number |
| `spec.dependsOn vault X has no vault file` | write that vault too, or use `service:` / `external:` |
| `namespace X is not in the cluster graph` (ERROR, with `--graph`) | wrong namespace, or the context's allowlist hides it |
| `no graph node ns/name or ns/deployment:name` (warning) | the workload may sit behind a Service with another name; check the name |
| `spec.dependsOn service X is not in the cluster graph` (warning) | a typo in the node id, or the service is gone |

`--graph` also takes a saved JSON file (`curl -s …/api/cluster/graph?context=x > graph.json`), so an agent without
network access to the app can still check. `--json` prints the result for tools.
