# Lab 05 — ServiceAccounts and SCC

## Scenario

Project `ex280-lab05` has four workloads. Two of them are not admitted. One of them must keep running under the default restricted constraint. A ServiceAccount needs API access inside the project.

## Objective

Admit the workloads that have extra security requirements, without opening those requirements to the workload that must stay restricted.

## Requirements

Project: `ex280-lab05`

- Deployment `fixed-uid` is Ready and runs as UID `1000` using a purpose-built SecurityContextConstraint. The built-in `anyuid` and `privileged` constraints do not meet this requirement.
- Deployment `priv` is Ready and its container is privileged.
- Deployment `normal` is Ready and uses `restricted-v2` or `restricted-v3`.
- Deployment `collector` uses ServiceAccount `collector`, is Ready, and that ServiceAccount can get ConfigMaps in the project.

Each workload already has its own ServiceAccount.

## Success criteria

- `fixed-uid`, `priv`, `normal`, and `collector` are Ready
- `fixed-uid` is running as UID 1000 under a purpose-built constraint
- `priv` is privileged
- `normal` is still on a restricted constraint
- `collector` can get ConfigMaps
