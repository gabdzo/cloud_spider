// Policy objects: NetworkPolicies, PodDisruptionBudgets, HPAs and Kyverno
// policy reports. CRD lists (policy reports) answer 404 when Kyverno is not
// installed: that is "absent", which controls read as "no reports".
import { evidence } from "../evidence.js";
import { kubeStatus } from "./kube-workloads.js";

const ns = (item) => item?.metadata?.namespace || "";
const name = (item) => item?.metadata?.name || "";
const SHAPE = {
  networkPolicies: (i) => ({ namespace: ns(i), name: name(i), podSelector: i?.spec?.podSelector || {}, policyTypes: i?.spec?.policyTypes || [], ingress: (i?.spec?.ingress || []).length, egress: (i?.spec?.egress || []).length }),
  pdbs: (i) => ({ namespace: ns(i), name: name(i), selector: i?.spec?.selector?.matchLabels || {}, expressions: i?.spec?.selector?.matchExpressions || [] }),
  hpas: (i) => ({ namespace: ns(i), name: name(i), target: i?.spec?.scaleTargetRef?.name || "", kind: i?.spec?.scaleTargetRef?.kind || "" }),
  policyReports: (i) => ({ namespace: ns(i), name: name(i), fails: (i?.results || []).filter((r) => r.result === "fail").map((r) => ({ policy: r.policy || "", rule: r.rule || "", severity: r.severity || "", resource: r.resources?.[0] ? `${r.resources[0].kind}/${r.resources[0].name}` : "" })) }),
};
SHAPE.clusterPolicyReports = SHAPE.policyReports;
const LISTS = Object.keys(SHAPE);

export const kubePolicy = {
  key: "kube-policy",
  target: "kubernetes",
  reads: LISTS.map((n) => `GET ${n}`),
  async collect({ kube }) {
    const answers = await Promise.all(LISTS.map((n) => kube.read(n)));
    return LISTS.map((n, i) => {
      const { status, error } = kubeStatus(answers[i]);
      const crd = n.endsWith("olicyReports");
      // A core list that 404s is an error; a CRD list that 404s is absent.
      const final = status === "absent" && !crd ? "error" : status;
      return evidence({ key: `kube-${n}`, collector: "kube-policy", read: `GET ${n}`, target: "kubernetes", status: final, fields: { items: (answers[i]?.json?.items || []).map(SHAPE[n]) }, error: final === "error" && !error ? { code: "404", message: `${n} is not served` } : error });
    });
  },
};
