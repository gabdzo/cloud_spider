// Policy objects: NetworkPolicies, PodDisruptionBudgets, HPAs and Kyverno
// policy reports. CRD lists (policy reports) answer 404 when Kyverno is not
// installed: that is "absent", which controls read as "no reports".
import { evidence } from "../evidence.js";
import { kubeStatus } from "./kube-workloads.js";

const ns = (item) => item?.metadata?.namespace || "";
const name = (item) => item?.metadata?.name || "";
// The resource a failed result is about. Kyverno 1.10+ writes one report per
// resource and names it in the report's `scope`, leaving results[].resources
// empty (cloudspider-up 2026-10-11: every finding read "demo/" and the
// old-ReplicaSet filter of K8S-SEC-009 never matched).
const subject = (result, report) => {
  const r = result?.resources?.[0] || report?.scope;
  return r?.kind && r?.name ? `${r.kind}/${r.name}` : "";
};
const SHAPE = {
  networkPolicies: (i) => ({ namespace: ns(i), name: name(i), podSelector: i?.spec?.podSelector || {}, policyTypes: i?.spec?.policyTypes || [], ingress: (i?.spec?.ingress || []).length, egress: (i?.spec?.egress || []).length }),
  pdbs: (i) => ({ namespace: ns(i), name: name(i), selector: i?.spec?.selector?.matchLabels || {}, expressions: i?.spec?.selector?.matchExpressions || [] }),
  hpas: (i) => ({ namespace: ns(i), name: name(i), target: i?.spec?.scaleTargetRef?.name || "", kind: i?.spec?.scaleTargetRef?.kind || "" }),
  policyReports: (i) => ({ namespace: ns(i), name: name(i), fails: (i?.results || []).filter((r) => r.result === "fail").map((r) => ({ policy: r.policy || "", rule: r.rule || "", severity: r.severity || "", resource: subject(r, i) })) }),
};
SHAPE.clusterPolicyReports = SHAPE.policyReports;
// Kyverno ClusterPolicies: their generate rules (K8S-SEC-010) and readiness.
SHAPE.clusterPolicies = (i) => ({
  name: name(i),
  ready: (i?.status?.conditions || []).some((c) => c.type === "Ready" && c.status === "True") || i?.status?.ready === true,
  generates: (i?.spec?.rules || []).filter((r) => r?.generate).map((r) => ({
    rule: r.name || "",
    kind: r.generate.kind || "",
    synchronize: r.generate.synchronize === true,
    triggers: [...new Set((r.match?.any || r.match?.all || [r.match]).flatMap((m) => m?.resources?.kinds || []))],
    egress: (r.generate.data?.spec?.policyTypes || []).includes("Egress"),
    ingress: (r.generate.data?.spec?.policyTypes || []).includes("Ingress"),
    allowsIngress: (r.generate.data?.spec?.ingress || []).length > 0,
  })),
});
const LISTS = Object.keys(SHAPE);
// Reports also come as OpenReports (openreports.io, Kyverno with
// --openreportsEnabled; same results shape): read both formats and fold
// each into its wgpolicyk8s.io list, so K8S-SEC-009 counts either.
const OPEN = { policyReports: "openReports", clusterPolicyReports: "openClusterReports" };
const RANK = { ok: 0, denied: 1, error: 2, absent: 3 };

export const kubePolicy = {
  key: "kube-policy",
  target: "kubernetes",
  reads: [...LISTS, ...Object.values(OPEN)].map((n) => `GET ${n}`),
  async collect({ kube }) {
    const answers = await Promise.all(LISTS.map((n) => kube.read(n)));
    const open = Object.fromEntries(await Promise.all(Object.entries(OPEN).map(async ([n, o]) => [n, await kube.read(o)])));
    return LISTS.map((n, i) => {
      let { status, error } = kubeStatus(answers[i]);
      let items = answers[i]?.json?.items || [];
      if (open[n]) {
        // Either format present is enough; the better status of the two wins.
        const other = kubeStatus(open[n]);
        items = [...items, ...(open[n]?.json?.items || [])];
        if ((RANK[other.status] ?? 9) < (RANK[status] ?? 9)) ({ status, error } = other);
      }
      const crd = n.endsWith("olicyReports") || n === "clusterPolicies";
      // A core list that 404s is an error; a CRD list that 404s is absent.
      const final = status === "absent" && !crd ? "error" : status;
      return evidence({ key: `kube-${n}`, collector: "kube-policy", read: `GET ${n}`, target: "kubernetes", status: final, fields: { items: items.map(SHAPE[n]) }, error: final === "error" && !error ? { code: "404", message: `${n} is not served` } : error });
    });
  },
};
