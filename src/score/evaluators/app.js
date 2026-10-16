// Evaluators for APP controls (scorecard/app/controls). Each gets
// data.app (one grouped app, src/score/app/group.js) and data["app-ctx"]
// (cluster facts: node count, agents) and returns { items, unknown,
// notApplicable } like every evaluator. Pure. Never sees env or ConfigMap
// values (the collector dropped them) and never a Secret.
const SECRETY = /(pass(word)?|passwd|secret|token|api[_-]?key|private[_-]?key|credential|auth)/i;
const NOT_SECRETY = /(_path|_file|_url|_endpoint|_name|_user(name)?|_header|_ttl|_enabled)$/i;
const BAD_WAITING = new Set(["CrashLoopBackOff", "ImagePullBackOff", "ErrImagePull", "CreateContainerConfigError", "CreateContainerError", "InvalidImageName"]);

const ctrs = (a) => a.workload.pod.containers;
const cid = (a, c) => `${a.id}:${c.name}`;
const serving = (a) => a.services.length > 0;
const exposed = (a) => a.ingresses.length > 0 || a.services.some((s) => s.type === "LoadBalancer" || s.type === "NodePort");
const replicasOf = (a) => Math.max(a.workload.replicas ?? 1, a.hpa?.min ?? 0);
const singleton = (a) => a.workload.annotations?.["cloudspider.io/singleton"] === "true";
const lrDefault = (a, kind, res) => a.limitRanges.some((l) => l.defaults.some((d) => d[kind]?.[res]));
const sc = (a, c, key) => c.securityContext?.[key] ?? a.workload.pod.securityContext?.[key];
const one = (a, pass, detail, extra = {}) => ({ items: [{ id: a.id, pass, detail, ...extra }] });

export const appEvaluators = {
  "app-replicas"({ data }) {
    const a = data.app;
    if (singleton(a)) return { notApplicable: "marked cloudspider.io/singleton" };
    const n = replicasOf(a);
    return one(a, n >= 2, n >= 2 ? `${n} replicas${a.hpa ? ` (HPA min ${a.hpa.min})` : ""}` : `${a.workload.replicas ?? 1} replica: a node drain or crash is an outage`);
  },
  "app-pdb"({ data }) {
    const a = data.app;
    if (replicasOf(a) < 2) return { notApplicable: "one replica: a PDB would only block node drains" };
    if (!a.pdbs.length) return one(a, false, "no PodDisruptionBudget selects its pods");
    const p = a.pdbs[0];
    if (p.disruptionsAllowed === 0) return one(a, false, `${p.name} allows 0 disruptions now: node drains hang`);
    const min = typeof p.minAvailable === "number" ? p.minAvailable : null;
    if (min !== null && min >= replicasOf(a)) return one(a, false, `${p.name} minAvailable ${min} ≥ replicas ${replicasOf(a)}`);
    if (min !== null && a.hpa && min > a.hpa.min) return one(a, false, `${p.name} minAvailable ${min} > HPA minReplicas ${a.hpa.min}`);
    return one(a, true, `${p.name}`);
  },
  "app-spread"({ data }) {
    const a = data.app;
    if (replicasOf(a) < 2) return { notApplicable: "one replica" };
    if ((data["app-ctx"]?.nodes ?? 0) === 1) return { notApplicable: "a one-node cluster" };
    const p = a.workload.pod;
    if (p.topologySpreadConstraints || p.podAntiAffinity) return one(a, true, p.topologySpreadConstraints ? "topologySpreadConstraints" : "podAntiAffinity");
    const nodes = new Set(a.pods.map((x) => x.node).filter(Boolean));
    if (nodes.size >= 2) return one(a, true, `no spread rule, but its pods run on ${nodes.size} nodes today`, { warn: true });
    return one(a, false, nodes.size === 1 ? "all pods on one node, no spread rule" : "no topologySpreadConstraints or podAntiAffinity");
  },
  "app-readiness"({ data }) {
    const a = data.app;
    if (!serving(a)) return { notApplicable: "no Service selects it (a worker)" };
    return { items: ctrs(a).filter((c) => c.restartPolicy !== "Always").map((c) => ({ id: cid(a, c), pass: Boolean(c.readinessProbe), detail: c.readinessProbe ? "" : "no readinessProbe" })) };
  },
  "app-liveness"({ data }) {
    const a = data.app;
    return { items: ctrs(a).map((c) => ({ id: cid(a, c), pass: Boolean(c.livenessProbe) && !(c.readinessProbe && c.readinessProbe.handler === c.livenessProbe.handler), detail: !c.livenessProbe ? "no livenessProbe" : c.readinessProbe?.handler === c.livenessProbe.handler ? "liveness is the same check as readiness: a slow dependency restarts every pod" : "" })) };
  },
  "app-startup"({ data }) {
    const a = data.app;
    const slow = ctrs(a).filter((c) => (c.livenessProbe?.initialDelaySeconds ?? 0) > 30);
    if (!slow.length) return { notApplicable: "no slow-starting liveness probe" };
    return { items: slow.map((c) => ({ id: cid(a, c), pass: Boolean(c.startupProbe), detail: c.startupProbe ? "" : `liveness waits ${c.livenessProbe.initialDelaySeconds}s; a startupProbe is the safer way` })) };
  },
  "app-requests"({ data }) {
    const a = data.app;
    return { items: ctrs(a).map((c) => {
      const miss = ["cpu", "memory"].filter((r) => !c.resources.requests[r] && !lrDefault(a, "request", r));
      return { id: cid(a, c), pass: !miss.length, detail: miss.length ? `no ${miss.join(" or ")} request` : "" };
    }) };
  },
  "app-memory-limit"({ data }) {
    const a = data.app;
    return { items: ctrs(a).map((c) => ({ id: cid(a, c), pass: Boolean(c.resources.limits.memory || lrDefault(a, "limit", "memory")), detail: "no memory limit: one leak can starve the node" })) };
  },
  "app-hpa"({ data }) {
    const a = data.app;
    if (!a.hpa) return { notApplicable: "no HPA" };
    const h = a.hpa;
    const bad = [h.min >= h.max ? `min ${h.min} ≥ max ${h.max}` : "", h.min < 2 ? `minReplicas ${h.min}` : "", h.ableToScale ? "" : "ScalingActive is False (no metrics?)"].filter(Boolean);
    return one(a, !bad.length, bad.join(", ") || `${h.min}–${h.max}`);
  },
  "app-rollout"({ data }) {
    const a = data.app;
    const w = a.workload;
    if (w.kind === "StatefulSet") return one(a, w.strategy.type !== "OnDelete", w.strategy.type === "OnDelete" ? "OnDelete: changes wait until someone deletes pods" : w.strategy.type);
    if (w.strategy.type === "Recreate") {
      if (w.pod.volumes.some((v) => v.pvc)) return { notApplicable: "Recreate with a volume claim (single writer)" };
      return one(a, false, "Recreate: every rollout is downtime");
    }
    const mu = String(w.strategy.maxUnavailable);
    const all = mu === "100%" || Number(mu) >= (w.replicas ?? 1);
    return one(a, !all, all ? `maxUnavailable ${mu} takes every pod down at once` : `RollingUpdate, maxUnavailable ${mu}`);
  },
  "app-graceful"({ data }) {
    const a = data.app;
    if (!serving(a)) return { notApplicable: "no Service" };
    const pre = ctrs(a).some((c) => c.preStop);
    const grace = a.workload.pod.terminationGracePeriodSeconds;
    if (pre) return one(a, true, `preStop hook, grace ${grace}s`);
    if (!exposed(a)) return one(a, true, "no preStop; in-cluster only, endpoints update fast", { warn: true });
    return one(a, false, `behind an Ingress or load balancer without a preStop delay: in-flight requests drop while the LB deregisters (grace ${grace}s)`);
  },
  "app-healthy"({ data, now = Date.now() }) {
    const a = data.app;
    const items = a.pods.map((p) => {
      const bad = p.waiting.find((r) => BAD_WAITING.has(r));
      const recent = p.lastRestart && now - Date.parse(p.lastRestart) < 15 * 60_000 && p.restarts >= 3;
      const pass = !bad && !recent && p.phase !== "Failed" && (p.ready || p.phase === "Succeeded");
      return { id: `${p.namespace}/${p.name}`, pass, detail: bad || (recent ? `${p.restarts} restarts, last within 15 min` : p.ready ? "" : `not ready (${p.phase || "?"})`) };
    });
    const prog = a.workload.status?.progressing;
    if (prog?.reason === "ProgressDeadlineExceeded") items.push({ id: a.id, pass: false, detail: "rollout stuck: ProgressDeadlineExceeded" });
    return { items };
  },
  "app-history"({ data }) {
    const a = data.app;
    return one(a, (a.workload.revisionHistoryLimit ?? 10) > 0, "revisionHistoryLimit 0: no rollback");
  },
  "app-privileged"({ data }) {
    const a = data.app;
    const p = a.workload.pod;
    const bad = [p.hostNetwork ? "hostNetwork" : "", p.hostPID ? "hostPID" : "", p.hostIPC ? "hostIPC" : "", p.volumes.some((v) => v.hostPath) ? "hostPath volume" : "", ...[...p.containers, ...p.initContainers].filter((c) => c.securityContext?.privileged).map((c) => `privileged ${c.name}`)].filter(Boolean);
    return one(a, !bad.length, bad.join(", "));
  },
  "app-escalation"({ data }) {
    const a = data.app;
    return { items: ctrs(a).map((c) => ({ id: cid(a, c), pass: c.securityContext?.allowPrivilegeEscalation === false, detail: "allowPrivilegeEscalation is not false (it defaults to true)" })) };
  },
  "app-non-root"({ data }) {
    const a = data.app;
    return { items: ctrs(a).map((c) => ({ id: cid(a, c), pass: sc(a, c, "runAsNonRoot") === true || (sc(a, c, "runAsUser") ?? 0) > 0, detail: "runAsNonRoot not set (the image's USER cannot be checked from the API)" })) };
  },
  "app-capabilities"({ data }) {
    const a = data.app;
    return { items: ctrs(a).map((c) => {
      const cap = c.securityContext?.capabilities || {};
      const drop = (cap.drop || []).map((x) => String(x).toUpperCase());
      const add = (cap.add || []).map((x) => String(x).toUpperCase()).filter((x) => x !== "NET_BIND_SERVICE");
      return { id: cid(a, c), pass: drop.includes("ALL") && !add.length, detail: !drop.includes("ALL") ? "capabilities not dropped (drop: [ALL])" : `adds ${add.join(", ")}` };
    }) };
  },
  "app-readonly-fs"({ data }) {
    const a = data.app;
    return { items: ctrs(a).map((c) => ({ id: cid(a, c), pass: c.securityContext?.readOnlyRootFilesystem === true, detail: "root filesystem is writable (mount an emptyDir for /tmp and set readOnlyRootFilesystem)" })) };
  },
  "app-seccomp"({ data }) {
    const a = data.app;
    return { items: ctrs(a).map((c) => {
      const t = sc(a, c, "seccompProfile")?.type;
      return { id: cid(a, c), pass: t === "RuntimeDefault" || t === "Localhost", detail: "no seccompProfile (RuntimeDefault)" };
    }) };
  },
  "app-secret-env"({ data }) {
    const a = data.app;
    return { items: ctrs(a).map((c) => {
      const names = [...c.env.filter((e) => e.fromSecret).map((e) => e.name), ...c.envFrom.filter((f) => f.secret).map((f) => `envFrom ${f.secret}`)];
      return { id: cid(a, c), pass: !names.length, detail: names.length ? `Secrets as env: ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` +${names.length - 3}` : ""}` : "" };
    }) };
  },
  "app-secret-literals"({ data }) {
    const a = data.app;
    const items = ctrs(a).map((c) => {
      const hits = c.env.filter((e) => e.literal && SECRETY.test(e.name) && !NOT_SECRETY.test(e.name)).map((e) => e.name);
      return { id: cid(a, c), pass: !hits.length, detail: hits.length ? `literal value in env ${hits.join(", ")} (names only shown; move to a Secret)` : "" };
    });
    for (const cm of a.configMaps.filter((x) => x.found)) {
      const hits = cm.found.keys.filter((k) => SECRETY.test(k) && !NOT_SECRETY.test(k));
      items.push({ id: `${a.namespace}/configmap/${cm.name}`, pass: !hits.length, detail: hits.length ? `secret-looking keys ${hits.join(", ")} in a ConfigMap (values not read)` : "" });
    }
    return { items };
  },
  "app-service-account"({ data }) {
    const a = data.app;
    const s = a.serviceAccount;
    const usesApi = s.roleBindings.length > 0;
    const automount = a.workload.pod.automountServiceAccountToken ?? s.found?.automount ?? true;
    return { items: [
      { id: `${a.id}:dedicated`, pass: s.name !== "default", detail: s.name === "default" ? "runs as the namespace's default ServiceAccount" : s.name },
      { id: `${a.id}:token`, pass: !automount || usesApi, detail: automount && !usesApi ? "mounts an API token it has no RoleBinding to use (automountServiceAccountToken: false)" : "" },
    ] };
  },
  "app-rbac"({ data }) {
    const a = data.app;
    const s = a.serviceAccount;
    if (!s.roleBindings.length) return { notApplicable: "its ServiceAccount has no RoleBindings" };
    const items = [];
    for (const b of s.roleBindings) {
      if (b.role.kind === "ClusterRole") {
        const wide = ["cluster-admin", "admin", "edit"].includes(b.role.name);
        items.push({ id: `${a.namespace}/rolebinding/${b.name}`, pass: !wide, detail: wide ? `binds the ${b.role.name} ClusterRole` : `ClusterRole ${b.role.name} (rules not read)`, warn: !wide });
        continue;
      }
      const r = a.serviceAccount.roles.find((x) => x.name === b.role.name);
      if (!r) continue;
      const bad = r.rules.flatMap((rule) => [rule.verbs.includes("*") ? "verbs *" : "", rule.resources.includes("*") ? "resources *" : "", rule.resources.includes("secrets") && rule.verbs.some((v) => ["list", "watch", "*"].includes(v)) ? "lists secrets" : "", rule.resources.some((x) => x === "pods/exec" || x === "pods/attach") ? "pods/exec" : ""]).filter(Boolean);
      items.push({ id: `${a.namespace}/role/${r.name}`, pass: !bad.length, detail: [...new Set(bad)].join(", ") });
    }
    return { items };
  },
  "app-netpol"({ data }) {
    const a = data.app;
    const n = a.netpols;
    return one(a, n.length > 0, n.length ? `selected by ${n.map((x) => x.name).slice(0, 3).join(", ")}${n.some((x) => x.types.includes("Egress")) ? "" : " (ingress only)"}` : "no NetworkPolicy selects its pods: any pod can reach it");
  },
  "app-image-tag"({ data }) {
    const a = data.app;
    return { items: ctrs(a).map((c) => {
      const img = c.image;
      const digest = img.includes("@sha256:");
      const tag = digest ? "" : (img.split("/").pop().split(":")[1] || "");
      return { id: cid(a, c), pass: digest || (tag && tag !== "latest"), detail: digest ? "pinned by digest" : tag && tag !== "latest" ? `${tag}` : `${img} has no fixed tag` };
    }) };
  },
  "app-pull-policy"({ data }) {
    const a = data.app;
    return { items: ctrs(a).map((c) => ({ id: cid(a, c), pass: c.imagePullPolicy !== "Never", detail: c.imagePullPolicy || "default" })) };
  },
  "app-endpoints"({ data }) {
    const a = data.app;
    if (!serving(a)) return { notApplicable: "no Service" };
    const st = data["app-ctx"]?.listed?.endpointSlicesAll;
    if (st && st !== "ok") return { items: [], unknown: [{ id: a.id, reason: `EndpointSlices ${st}` }] };
    return { items: a.services.map((s) => {
      const ready = a.slices.filter((e) => e.service === s.name).reduce((n, e) => n + e.ready, 0);
      return { id: `${a.namespace}/service/${s.name}`, pass: ready > 0, detail: ready ? `${ready} ready endpoint(s)` : "no ready endpoints" };
    }) };
  },
  "app-ports"({ data }) {
    const a = data.app;
    if (!serving(a)) return { notApplicable: "no Service" };
    const ports = ctrs(a).flatMap((c) => c.ports);
    return { items: a.services.flatMap((s) => s.ports.map((p) => {
      const t = p.targetPort;
      const id = `${a.namespace}/service/${s.name}:${p.port}`;
      if (typeof t === "string" && !/^\d+$/.test(t)) return { id, pass: ports.some((x) => x.name === t), detail: ports.some((x) => x.name === t) ? `named port ${t}` : `targetPort ${t} is not a port name on the pods` };
      const declared = ports.some((x) => x.containerPort === Number(t));
      return { id, pass: true, warn: !declared, detail: declared ? `→ ${t}` : `→ ${t}, not declared as a containerPort (works, but undocumented)` };
    })) };
  },
  "app-ingress-tls"({ data }) {
    const a = data.app;
    if (!a.ingresses.length) return { notApplicable: "no Ingress" };
    return { items: a.ingresses.map((i) => ({ id: `${a.namespace}/ingress/${i.name}`, pass: i.tls || i.acm, detail: i.tls ? "spec.tls" : i.acm ? "ACM certificate on the ALB" : "plain HTTP" })) };
  },
  "app-service-type"({ data }) {
    const a = data.app;
    if (!serving(a)) return { notApplicable: "no Service" };
    return { items: a.services.map((s) => ({ id: `${a.namespace}/service/${s.name}`, pass: s.type === "ClusterIP", detail: s.type })) };
  },
  "app-metrics"({ data, status }) {
    const a = data.app;
    const ctx = data["app-ctx"] || {};
    const ann = a.workload.templateAnnotations?.["prometheus.io/scrape"] === "true" || a.services.some((s) => s.annotations?.["prometheus.io/scrape"] === "true");
    if (a.monitors.length) return one(a, true, a.monitors.map((m) => `${m.kind} ${m.ref}`).join(", "));
    if (ann) return one(a, true, "prometheus.io/scrape annotation");
    if ((ctx.agents?.beyla || []).length) return one(a, true, "RED metrics from Beyla (eBPF)", { warn: true });
    if (status?.["app-monitors"] === "denied") return { items: [], unknown: [{ id: a.id, reason: "ServiceMonitors not readable" }] };
    return one(a, false, "nothing scrapes it: no ServiceMonitor/PodMonitor, no prometheus.io/scrape, no Beyla");
  },
  "app-metrics-port"({ data }) {
    const a = data.app;
    const named = ctrs(a).flatMap((c) => c.ports).some((p) => /metrics/.test(p.name));
    return one(a, named, named ? "" : "no port named *metrics*");
  },
  "app-logs"({ data }) {
    const a = data.app;
    const ag = data["app-ctx"]?.agents || {};
    const by = ["loki", "fluentbit", "fluentd", "cwagent", "vector", "otel", "promtail"].filter((k) => (ag[k] || []).length);
    return one(a, by.length > 0, by.length ? `cluster ships logs (${by.join(", ")})` : "its logs stay on the node (no log shipper in the cluster)");
  },
  "app-traces"({ data }) {
    const a = data.app;
    const ag = data["app-ctx"]?.agents || {};
    const otelEnv = ctrs(a).some((c) => c.env.some((e) => /^OTEL_(EXPORTER_OTLP_|SERVICE_NAME)/.test(e.name)));
    if (otelEnv) return one(a, true, "OpenTelemetry SDK configured (OTEL_* env)");
    if ((ag.beyla || []).length) return one(a, true, "Beyla eBPF spans");
    return one(a, false, "no traces: no OTEL_* env and no Beyla");
  },
  "app-alerts"({ data, status }) {
    const a = data.app;
    if (a.rules.length) return one(a, true, `PrometheusRule ${a.rules.slice(0, 2).join(", ")}`);
    if (status?.["app-monitors"] === "denied") return { items: [], unknown: [{ id: a.id, reason: "PrometheusRules not readable" }] };
    return one(a, false, "no alert rule mentions it");
  },
  "app-slo"({ data }) {
    const a = data.app;
    if (!serving(a)) return { notApplicable: "no Service" };
    const slos = data["app-ctx"]?.slos || {};
    const n = slos[a.id] || 0;
    return one(a, n > 0, n ? `${n} SLO(s) in its observability file` : "no SLO (observability/<name>.yaml with workloads and slos)");
  },
  "app-labels"({ data }) {
    const a = data.app;
    const l = a.workload.labels;
    const name = l["app.kubernetes.io/name"];
    const inst = l["app.kubernetes.io/instance"];
    const bad = [!name ? "no app.kubernetes.io/name" : "", inst && inst !== a.name && !a.name.startsWith(inst) ? `instance ${inst} ≠ ${a.name}` : ""].filter(Boolean);
    return one(a, !bad.length, bad.join(", "));
  },
  "app-version"({ data }) {
    const a = data.app;
    return one(a, Boolean(a.workload.labels["app.kubernetes.io/version"]), "no app.kubernetes.io/version label");
  },
  "app-owner"({ data }) {
    const a = data.app;
    const all = { ...a.workload.labels, ...a.workload.annotations };
    const key = ["owner", "team", "app.kubernetes.io/part-of", "contact", "cloudspider.io/owner"].find((k) => all[k]);
    return one(a, Boolean(key), key ? `${key}=${all[key]}` : "no owner/team label or annotation: who gets paged?");
  },
  "app-priority"({ data }) {
    const a = data.app;
    return one(a, Boolean(a.workload.pod.priorityClassName), a.workload.pod.priorityClassName || "no priorityClassName");
  },
  "app-refs"({ data, status }) {
    const a = data.app;
    const items = [];
    if (status?.["app-configmaps"] === "ok") for (const c of a.configMaps) items.push({ id: `${a.namespace}/configmap/${c.name}`, pass: Boolean(c.found), detail: c.found ? "" : "referenced but missing" });
    if (a.serviceAccount.name !== "default" && status?.["app-serviceaccounts"] === "ok") items.push({ id: `${a.namespace}/serviceaccount/${a.serviceAccount.name}`, pass: Boolean(a.serviceAccount.found), detail: a.serviceAccount.found ? "" : "ServiceAccount missing" });
    return { items };
  },
};
