# Lab 02 — Services and Routes

## Scenario

The shop application in project `ex280-lab02` should publish a web page and an API on one hostname. Callers cannot rely on it. The environment may differ between runs.

## Objective

Make the public hostname serve the web application and the API. Trace the path from the route to the service, to endpoints, to pods.

## Requirements

Project: `ex280-lab02`

Hostname: `http://shop-lab02.<apps-domain>`

- `GET /` returns a body that contains `WEB-OK`
- `GET /api` returns a body that contains `API-OK`
- Service `web` has ready endpoints for the web pods
- Service `api` has ready endpoints for the API pods

`setup.sh` prints the hostname. Optional: `VARIANT=1|2|3|4` or `SHUFFLE=1` selects a different starting state. The success criteria stay the same.

## Success criteria

- Both URLs return their own body
- Both services have at least one ready endpoint
