# Faults

## fixed-uid

The container sets `runAsUser: 1000`. The namespace UID range is a high block allocated to the project. `restricted-v2` and `restricted-v3` use `MustRunAsRange`, so 1000 is rejected and no pod is created. The ServiceAccount `fixed-uid` can use those restricted constraints because `system:authenticated` can. Neither constraint can admit this pod.

`anyuid` would also run UID 1000, and it is too broad. A purpose-built SCC with `runAsUser.type: MustRunAs` and `uid: 1000`, granted only to `system:serviceaccount:ex280-lab05:fixed-uid`, admits this pod and nothing else. Set `priority` above the restricted constraints. Grant it with the SCC `users` list or `oc adm policy add-scc-to-user`.

## priv

The container sets `privileged: true` and `allowPrivilegeEscalation: true`. Restricted constraints cannot admit that. Grant the built-in `privileged` SCC to ServiceAccount `priv` only:

`oc adm policy add-scc-to-user privileged -z priv -n ex280-lab05`

## collector

The workload runs, but ServiceAccount `collector` has no RoleBinding. `oc auth can-i get configmaps --as=system:serviceaccount:ex280-lab05:collector` is no.

## normal

This deployment does not request a special UID or privilege. Leave its ServiceAccount on the default restricted constraints. Granting `privileged` or `anyuid` to `default` or to `normal` can move it off `restricted-v2` / `restricted-v3`.
