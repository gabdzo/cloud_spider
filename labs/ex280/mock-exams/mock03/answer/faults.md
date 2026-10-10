# Faults

## shop

Service `shop` selects `app=shop-old`. Pods are labeled `app=shop`.

## billing

Deployment and Service `billing` are healthy. Route `billing` sends the hostname to Service `shop`.

## store

Helm revision 2 sets image tag `ex280-missing`. Upgrade with `answer/values.yaml`: 2 replicas, the httpd image tag `latest`, and `html: HELM-OK`.

## edge

The route certificate matches `edge-mock03.<apps-domain>`. The private key is from a different certificate. Replace both with a matching pair. The backend is HTTP.

## stale operator

Namespace `ex280-mock03-stale` holds an OperatorGroup and a Subscription for package `does-not-exist`. Delete the namespace.

## cert-manager

Subscription channel is `obsolete`. Set it to `stable`. When the CSV is Succeeded, create Issuer `selfsigned` with `spec.selfSigned: {}`.

If this repository already installed cert-manager for lab 11, setup removes that copy first and installs this one. It will not remove a cert-manager it did not mark.
