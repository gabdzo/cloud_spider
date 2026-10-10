# Lab 03 — NetworkPolicy

## Scenario

Project `ex280-lab03-back` runs the `web` application. Projects `ex280-lab03-front` and `ex280-lab03-other` each run a client pod. The backend is locked down, and the published route is not reliable. The environment may differ between runs.

## Objective

Allow only the intended traffic. Confirm both positive and negative paths, including DNS from inside the backend project and HTTP from outside the cluster.

## Requirements

- From the client in `ex280-lab03-front`, `http://web.ex280-lab03-back.svc:8080/` returns a body that contains `WEB-OK`
- From the client in `ex280-lab03-other`, that same URL does not connect
- `http://back-lab03.<apps-domain>/` returns a body that contains `WEB-OK`
- A pod in `ex280-lab03-back` can resolve `kubernetes.default.svc.cluster.local`
- Backend pods stay ready

Optional: `VARIANT=1|2|3` or `SHUFFLE=1`. The success criteria stay the same.

## Success criteria

- The allowed client succeeds and the other client fails
- The route responds from the workstation
- In-cluster DNS resolution from the backend project succeeds
