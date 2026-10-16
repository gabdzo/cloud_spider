// @ts-check
// SNIFF empty state: a few clickable targets taken from the live cluster.
const SYSTEM = /^(kube-|cert-manager$|ingress-nginx$)/;

/**
 * @param {any[]} ingresses @param {any[]} services @param {any[]} pods
 * @returns {{ label: string, target: string }[]}
 */
export function pickSniffExamples(ingresses = [], services = [], pods = []) {
  /** @type {{ label: string, target: string }[]} */
  const out = [];
  const host = ingresses.flatMap((ing) => (ing?.spec?.rules || []).map((/** @type {any} */ r) => r?.host)).find(Boolean);
  if (host) out.push({ label: "Ingress host", target: String(host) });
  const apps = services.filter((s) => s?.metadata?.name && !SYSTEM.test(s.metadata.namespace || "") && s.metadata.name !== "kubernetes");
  const broken = apps.find((s) => /broken/.test(s.metadata.name));
  if (broken) out.push({ label: "broken Service", target: `${broken.metadata.namespace}/${broken.metadata.name}` });
  const svc = apps.find((s) => s !== broken);
  if (svc) {
    out.push({ label: "ns/service", target: `${svc.metadata.namespace}/${svc.metadata.name}` });
    out.push({ label: "service DNS", target: `${svc.metadata.name}.${svc.metadata.namespace}.svc.cluster.local` });
  }
  const pod = pods.find((p) => p?.metadata?.name && !SYSTEM.test(p.metadata.namespace || "") && p.status?.phase === "Running");
  if (pod) out.push({ label: "ns/pod", target: `${pod.metadata.namespace}/${pod.metadata.name}` });
  return out;
}
