# Faults

Users exist in identity provider `ex280-labs`. Passwords are printed by `setup.sh` and stored under `.state/users/`.

Groups:

- `ex280-viewers` contains `ex280-alice`
- `ex280-editors` contains `ex280-bob`
- `ex280-contractors` contains `ex280-carol`
- `ex280-auditors` contains nobody

Role `pod-reader` is the right rule set, but RoleBinding `auditors-pod-reader` grants it to `ex280-auditors`. Alice is not in that group.

RoleBinding `legacy-edit` grants ClusterRole `edit` to user `ex280-legacy`, not to `ex280-editors`.

`oc auth can-i --as=ex280-alice` is false because there is no user binding. A real session adds the user's groups. `oc auth can-i --as=ex280-alice --as-group=ex280-viewers` is the check that matches login. `--as-group` replaces groups for that request. It does not look up membership for you. You still have to name the right group.

Carol must stay without pod or secret access. Do not add her to viewers or editors.

The built-in `edit` role can manage workloads and cannot create RoleBindings. `admin` can, so it is too broad for bob.
