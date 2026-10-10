"""Read-only NetworkPolicy evaluation for the lab checks.

Reads `kubectl get netpol -n <ns> -o json` on stdin and answers, from the
policy objects alone (no traffic is sent):
  allows <front-ns> <other-ns> <port>  front may reach app=web on port, other may not
  dns                                  pods may send UDP+TCP 53 to kube-system
  denies <ns>                          nothing admits traffic from namespace ns
Namespaces are matched by their automatic label kubernetes.io/metadata.name.
"""
import json
import sys

NAME = "kubernetes.io/metadata.name"


def selects_ns(peer, ns):
    sel = peer.get("namespaceSelector")
    if sel is None:
        return False  # a podSelector-only peer means "this namespace"
    labels = sel.get("matchLabels") or {}
    exprs = sel.get("matchExpressions") or []
    if not labels and not exprs:
        return True  # {} selects every namespace
    if labels and labels != {NAME: ns}:
        return False
    for expr in exprs:
        values = expr.get("values") or []
        if expr.get("key") != NAME:
            return False
        if expr.get("operator") == "In" and ns not in values:
            return False
        if expr.get("operator") == "NotIn" and ns in values:
            return False
    return True


def port_ok(rule, port):
    ports = rule.get("ports")
    if not ports:
        return True
    return any(str(p.get("port")) in (str(port), "http") for p in ports)


def admits(policies, ns, port, pod_labels):
    for pol in policies:
        spec = pol.get("spec") or {}
        if "Ingress" not in (spec.get("policyTypes") or ["Ingress"]):
            continue
        sel = (spec.get("podSelector") or {}).get("matchLabels") or {}
        if any(pod_labels.get(k) != v for k, v in sel.items()):
            continue
        for rule in spec.get("ingress") or []:
            peers = rule.get("from")
            if peers is None:
                if port_ok(rule, port):
                    return True
                continue
            if any(selects_ns(p, ns) for p in peers) and port_ok(rule, port):
                return True
    return False


def main():
    policies = json.load(sys.stdin).get("items") or []
    mode = sys.argv[1]
    web = {"app": "web"}
    if mode == "allows":
        front, other, port = sys.argv[2], sys.argv[3], sys.argv[4]
        ok = admits(policies, front, port, web) and not admits(policies, other, port, web)
    elif mode == "denies":
        ok = not admits(policies, sys.argv[2], "8080", web)
    elif mode == "dns":
        ok = False
        for pol in policies:
            spec = pol.get("spec") or {}
            if "Egress" not in (spec.get("policyTypes") or []):
                continue
            for rule in spec.get("egress") or []:
                peers = rule.get("to")
                to_dns = peers is None or any(selects_ns(p, "kube-system") for p in peers)
                ports = rule.get("ports") or []
                protos = {(p.get("protocol") or "TCP") for p in ports if str(p.get("port")) in ("53", "dns")}
                if to_dns and (not ports or {"UDP", "TCP"} <= protos):
                    ok = True
    else:
        sys.exit(2)
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
