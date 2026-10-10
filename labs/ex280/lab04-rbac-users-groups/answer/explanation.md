# RBAC, users, and groups

HTPasswd on this cluster is an extra identity provider named `ex280-labs`. The secret lives in `openshift-config` and is referenced from `oc get oauth cluster`. Existing providers stay in the list. After a change, the authentication operator rolls out `oauth-openshift`. Users appear in `oc get users` after you create them or after first login. Identities look like `ex280-labs:ex280-alice`.

Groups are OpenShift objects (`oc get groups`), not a field on the user. `oc adm groups add-users` is the usual edit. A RoleBinding subject of kind `Group` grants every member.

Impersonation:

- `oc auth can-i get pods -n ex280-lab04 --as=ex280-alice` uses no groups
- add `--as-group=ex280-viewers` to model the login groups
- if you omit the group, a group binding looks like a deny

That false deny is the usual exam mistake. Check `oc get groups` before you add a second binding on the user.

Build the smallest role that matches the task. Alice needs pod read and logs, not `admin` and not `edit`. The verbs for logs are on the subresource `pods/log`. Bob can use the built-in `edit` role. Confirm the negative case too: `oc auth can-i create rolebindings --as=ex280-bob --as-group=ex280-editors` must be no.

`view` is broader than alice needs but it cannot delete pods and cannot read secrets. The custom role is the tighter match and is already in the project.
