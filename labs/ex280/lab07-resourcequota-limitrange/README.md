# Lab 07 — ResourceQuota and LimitRange

## Scenario

Project `ex280-lab07` should run two applications, and new pods are being rejected.

## Objective

Get both applications running inside the quota below. Do not raise the quota.

## Requirements

ResourceQuota `project-quota` must stay at:

- pods: `4`
- requests.cpu: `1`
- requests.memory: `1Gi`
- limits.cpu: `2`
- limits.memory: `2Gi`

Deployment `alpha` and deployment `beta`:

- 2 ready replicas each
- every container requests at least cpu `50m` and memory `32Mi`
- every container has both requests and limits

## Success criteria

- The quota object matches the numbers above
- Both deployments are available
- Quota usage is within the quota
