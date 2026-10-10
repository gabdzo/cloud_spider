# Lab 06 — ConfigMaps and Secrets

## Scenario

Project `ex280-lab06` has two applications. `config-app` does not stay up. `secret-app` is running, but it does not follow credential rotation.

## Objective

Make configuration and credentials available to the processes in the form they actually read, including a rotation that must show up without a new pod.

## Requirements

Project: `ex280-lab06`

- Deployment `config-app` is Ready
- ConfigMap `app-config` key `message` is visible in the container at `/etc/app/message`
- Secret `app-secret` key `password` is visible at `/etc/secret/password`
- After `app-secret` changes, `/etc/secret/password` shows the new value and the `secret-app` pod is the same pod

## Success criteria

- `config-app` is available and the file matches the ConfigMap
- `secret-app` is available
- A secret change is visible in the file without replacing the pod
