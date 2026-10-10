# Mock 03

## Scenario

This paper mixes a Helm release, two broken HTTP paths, an edge route, a stale operator install, and cert-manager.

## Objective

Leave every item below healthy.

## Requirements

Project `ex280-mock03`:

- `http://shop-mock03.<apps-domain>/` returns a body that contains `SHOP-OK`
- `http://billing-mock03.<apps-domain>/` returns a body that contains `BILLING-OK`
- Helm release `store` is deployed with 2 ready replicas, image `registry.access.redhat.com/ubi9/httpd-24:latest`, and history of more than one revision
- `http://store-mock03.<apps-domain>/` returns a body that contains `HELM-OK`
- `https://edge-mock03.<apps-domain>/` returns a body that contains `EDGE-OK`, termination is edge, and the certificate is valid for that hostname

Namespace `ex280-mock03-stale` is removed.

Namespace `ex280-mock03-operators` runs community cert-manager from channel `stable` with automatic approval. Issuer `selfsigned` in that namespace is Ready.

`setup.sh` refuses to continue if cert-manager is installed and this repository did not install it.

## Success criteria

- Both HTTP applications and the Helm release respond
- Edge TLS succeeds
- The stale namespace is gone
- cert-manager and the self-signed issuer are ready
