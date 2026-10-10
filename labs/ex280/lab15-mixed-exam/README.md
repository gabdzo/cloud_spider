# Lab 15 — Mixed exam

## Scenario

Project `ex280-lab15` is only partly prepared. Build the application described below, and correct access and network behavior that are already wrong.

## Objective

Complete every numbered task.

## Requirements

1. Project `ex280-lab15` exists and is labeled `env=lab15`
2. ConfigMap `web-config` contains key `greeting` with value `hello`. Deployment `web` exposes it as environment variable `GREETING`
3. Deployment `web` has 2 ready replicas, a readiness probe on `/`, and cpu request of at least `50m` on the application container
4. Service `web` publishes port `8080` to the application
5. `http://web-lab15.<apps-domain>/` returns a body that contains `WEB-OK`
6. ResourceQuota `project-quota` sets `pods: "5"` and `requests.cpu: "1"`
7. User `ex280-reader` can list pods in the project through a group that user already belongs to. A binding on the user alone does not meet the requirement. The user must not be able to delete pods.
8. Pods in `ex280-lab15-peer` cannot open `http://web.ex280-lab15.svc:8080/`. The route in task 5 still works.

## Success criteria

- Every numbered task is true at the same time
