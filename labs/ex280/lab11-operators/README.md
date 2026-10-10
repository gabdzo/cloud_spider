# Lab 11 — Operators

## Scenario

Namespace `ex280-lab11` contains a cert-manager subscription that is not healthy. No issuer is ready.

## Objective

Install community cert-manager in that namespace and create a working self-signed issuer.

## Requirements

- Subscription `cert-manager` uses catalog `community-operators` in `openshift-marketplace`, channel `stable`, and automatic approval
- The install lands in namespace `ex280-lab11`
- The ClusterServiceVersion is Succeeded
- Issuer `selfsigned` in `ex280-lab11` is Ready and uses a self-signed issuer

`setup.sh` stops if cert-manager is already installed on the cluster.

## Success criteria

- A Succeeded cert-manager ClusterServiceVersion exists in `ex280-lab11`
- Issuer `selfsigned` is Ready
