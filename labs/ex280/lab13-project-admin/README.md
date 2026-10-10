# Lab 13 — Project administration

## Scenario

New projects are supposed to come from template `ex280-project-request`, and project `ex280-lab13-app` does not meet the platform rules. A volume in that project is not usable.

## Objective

Make the template and the existing project enforce the same governance, and make the volume bind.

## Requirements

Template `ex280-project-request` in namespace `openshift-config` is the cluster project request template.

The template and project `ex280-lab13-app` must both produce:

- label `ex280.governance=enforced`
- annotation `ex280.owner=platform`
- ResourceQuota `project-quota` with `pods: "10"`
- LimitRange `default-limits`
- NetworkPolicy `default-deny` that denies all ingress
- user `ex280-dev` bound to the `admin` role

PersistentVolumeClaim `data` in `ex280-lab13-app` is Bound on the default StorageClass. `1Gi` and `ReadWriteOnce` are enough.

Do not leave the cluster project request template pointing at a template other than `ex280-project-request` while this lab is in progress. `reset.sh` returns the lab to its starting point. `common/cleanup-all.sh` restores the template that was configured before the lab.

## Success criteria

- The cluster uses template `ex280-project-request`
- `ex280-lab13-app` has the label, annotation, quota, limit range, network policy, and admin binding
- PVC `data` is Bound
