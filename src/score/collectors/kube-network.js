// N10 (docs/design/network-debugging.md §8): what the cluster-side NET-*
// controls read. CoreDNS pods and metrics, the kube-system DaemonSets (who
// enforces NetworkPolicy), Services, Ingress backends and EndpointSlices.
// Named GETs only; the shaping reuses the netdebug evaluators' helpers.
import { cniEnforcer, parseCorednsMetrics } from "../../netdebug/kube-checks.js";
import { evidence } from "../evidence.js";
import { kubeStatus } from "./kube-workloads.js";

const ns = (i) => i?.metadata?.namespace || "";
const name = (i) => i?.metadata?.name || "";
const isReady = (pod) => (pod?.status?.conditions || []).some((c) => c.type === "Ready" && c.status === "True");
const backendsOf = (ing) => {
  const spec = ing?.spec || {};
  const names = [...(spec.rules || []).flatMap((r) => (r.http?.paths || []).map((p) => p.backend?.service?.name)), spec.defaultBackend?.service?.name].filter(Boolean);
  return [...new Set(names)];
};

// read name → evidence key and how its answer becomes fields.
const READS = [
  ["corednsPods", "kube-coredns", (res) => ({ pods: (res.json.items || []).map((p) => ({ name: name(p), node: p?.spec?.nodeName || "", ready: isReady(p), labels: p?.metadata?.labels || {} })) })],
  ["corednsMetrics", "kube-coredns-metrics", (res) => {
    const m = parseCorednsMetrics(res.text);
    return { total: m.total, servfail: m.servfail, nxdomain: m.nxdomain, panics: m.panics };
  }],
  // kube-system only: the CNI and its policy agent live there.
  ["nsDaemonsets", "kube-cni", (res) => {
    const items = res.json.items || [];
    return { enforcer: cniEnforcer(items), daemonsets: items.map(name) };
  }],
  ["services", "kube-services", (res) => ({ items: (res.json.items || []).map((s) => ({ namespace: ns(s), name: name(s), type: s?.spec?.type || "ClusterIP", selector: Object.keys(s?.spec?.selector || {}).length > 0 })) })],
  ["ingresses", "kube-ingresses", (res) => ({ items: (res.json.items || []).map((i) => ({ namespace: ns(i), name: name(i), services: backendsOf(i) })) })],
  ["endpointSlicesAll", "kube-endpointslices", (res) => ({
    items: (res.json.items || []).map((s) => ({
      namespace: ns(s),
      service: s?.metadata?.labels?.["kubernetes.io/service-name"] || "",
      endpoints: (s.endpoints || []).map((e) => ({ zone: e.zone || "", ready: e.conditions?.ready !== false && !e.conditions?.terminating })),
    })),
  })],
];

const answer = (kube, read) => {
  if (read === "corednsMetrics") return kube.readText ? kube.readText(read) : kube.read(read);
  if (read === "nsDaemonsets") return kube.read(read, "kube-system");
  return kube.read(read);
};

export const kubeNetwork = {
  key: "kube-network",
  target: "kubernetes",
  reads: READS.map(([read]) => `GET ${read}`),
  async collect({ kube }) {
    const answers = await Promise.all(READS.map(([read]) => answer(kube, read)));
    return READS.map(([read, key, shape], i) => {
      const res = answers[i] || {};
      // The scanner role does not grant the CoreDNS metrics proxy (an extra,
      // opt-in rule): a 403 there is a known gap, read as such by NET-DNS-004,
      // not a scanner permission to fix.
      if (read === "corednsMetrics" && res.forbidden) return evidence({ key, collector: "kube-network", read: `GET ${read}`, target: "kubernetes", status: "ok", fields: { forbidden: true } });
      const { status, error } = res.text != null ? { status: "ok", error: null } : kubeStatus(res);
      // Core lists and CoreDNS always exist: a 404 there is an error.
      const final = status === "absent" ? "error" : status;
      let fields = {};
      if (final === "ok") fields = shape(res);
      return evidence({ key, collector: "kube-network", read: `GET ${read}`, target: "kubernetes", status: final, fields, error: final === "error" && !error ? { code: "404", message: `${read} is not served` } : error });
    });
  },
};
