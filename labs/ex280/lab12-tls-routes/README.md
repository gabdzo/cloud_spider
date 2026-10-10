# Lab 12 — TLS and Routes

## Scenario

Project `ex280-lab12` publishes three hostnames. TLS is not working on them. No public DNS is required. The cluster apps domain already resolves.

## Objective

Make each route terminate TLS in the required mode and reach its own application.

## Requirements

- `https://edge-lab12.<apps-domain>/` returns a body that contains `EDGE-OK`. Termination is edge. The certificate presented to the client is valid for that hostname.
- `https://passthrough-lab12.<apps-domain>/` returns a body that contains `PASSTHROUGH-OK`. Termination is passthrough. The certificate presented to the client is valid for that hostname.
- `https://reencrypt-lab12.<apps-domain>/` returns a body that contains `REENCRYPT-OK`. Termination is reencrypt. The router must trust the backend certificate.

`setup.sh` prints the hostnames.

## Success criteria

- Each URL returns its own body over TLS
- The edge and passthrough certificates match their hostnames
- The reencrypt route reaches the backend
