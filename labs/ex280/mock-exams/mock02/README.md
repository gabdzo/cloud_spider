# Mock 02

## Scenario

Project `ex280-mock02` needs tighter access, a privileged workload, room for a normal web deployment, and a network policy that still allows the route. Two other projects, `ex280-mock02-peer` and `ex280-mock02-stranger`, are clients.

## Objective

Meet every requirement below at the same time.

## Requirements

`setup.sh` prints passwords for `ex280-maya` and `ex280-liam`. Discover their groups yourself.

- `ex280-maya` can list pods in `ex280-mock02` through a group she already belongs to, and cannot delete pods. A binding on the user alone does not meet the requirement.
- `ex280-liam` cannot get secrets in the project.
- Deployment `batch` is Ready and its container is privileged.
- Deployment `web` has 2 ready replicas.
- ResourceQuota `project-quota` stays at pods `4`, requests.cpu `500m`, requests.memory `512Mi`, limits.cpu `1`, limits.memory `1Gi`.
- The client in `ex280-mock02-peer` can GET `http://web.ex280-mock02.svc:8080/` and receive `WEB-OK`.
- The client in `ex280-mock02-stranger` cannot.
- `http://web-mock02.<apps-domain>/` returns a body that contains `WEB-OK`.

## Success criteria

- Access, the privileged workload, the web deployment, the quota, and both connectivity checks match the requirements
