# Lab 04 — RBAC, users, and groups

## Scenario

Project `ex280-lab04` needs three users with different access. Accounts are created in the `ex280-labs` identity provider. Group membership is already part of the cluster state. Impersonation that ignores groups will not match a real login.

## Objective

Give each user the access described below and nothing broader in this project.

## Requirements

`setup.sh` prints the usernames and passwords. Determine group membership yourself.

In project `ex280-lab04`:

- `ex280-alice` can get, list, and watch pods, and can read pod logs. She cannot delete pods.
- `ex280-bob` can create and delete deployments. He cannot create RoleBindings.
- `ex280-carol` cannot get pods and cannot get secrets.

Grant alice and bob through the groups they already belong to. A binding on the user alone does not meet the requirement.

A healthy application is already running so you can test log access. Do not remove the existing `local_htpasswd` or `developer` identity providers.

## Success criteria

- Each user can do the listed actions when group membership is taken into account
- Each user is denied the listed actions
