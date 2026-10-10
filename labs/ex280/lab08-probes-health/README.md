# Lab 08 — Probes and health

## Scenario

In project `ex280-lab08`, deployment `web` has pods that stay Running, and its route does not serve the application. Deployment `worker` keeps restarting.

## Objective

Make `web` ready and reachable, and make `worker` stay ready.

## Requirements

- Deployment `web` has 2 ready replicas
- Service `web` has ready endpoints
- `http://web-lab08.<apps-domain>/` returns a body that contains `WEB-OK`
- Deployment `worker` has 1 ready replica
- `worker` does not keep restarting after it is ready

## Success criteria

- The web route responds
- Web endpoints are populated
- Worker remains ready across a short observation window
