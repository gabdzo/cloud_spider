# Faults

The project starts without the application, the quota, or the label. Two objects are already wrong.

## NetworkPolicy

`default-deny` selects every pod and allows no ingress. A route you add later stays on the application-unavailable page. Pods in `ex280-lab15-peer` are also denied, which is what task 8 requires. Add an allow for the router and, if you want in-project traffic, a separate `from` entry for `ex280-lab15`. Do not delete the only policy and leave the project open, or the peer client will succeed.

## RBAC

Group `ex280-lab15-readers` contains `ex280-reader`. Group `ex280-lab15-other` is empty. RoleBinding `readers` grants `view` to `ex280-lab15-other`.

`oc auth can-i list pods --as=ex280-reader` is no. `--as-group=ex280-lab15-readers` is also no until you bind that group. `view` can list pods and cannot delete them.

Change the binding subject to `ex280-lab15-readers`, or add a new binding. A binding on the user makes `--as` succeed without a group, which does not meet task 7.
