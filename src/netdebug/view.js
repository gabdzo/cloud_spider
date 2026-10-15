// DEBUG panel in PATH (browser): the network debugging bar, the client-side
// chain (CLIENT → DNS → TCP → TLS → HTTP → who answered), the timing strip,
// the checks (facts), the findings (inferences) and "you know the drill".
// ndModel turns a run (GET /api/netdebug/<id>) into what the panel shows
// (pure, tested in node); createNetdebugView draws it with DOM nodes and
// textContent only. A probe starts only from a press of RUN (or Enter in
// the field): POST /api/netdebug. WHY? on an ALB 503 finding opens the
// walkthrough (walkthrough.js) over the same report; its VERIFY re-runs
// the debug (every 60 s, 10 times at most, while it is open).
import { albWalkthrough, verifyState } from "./walkthrough.js";
import { openDiagnose } from "../diagnose-view.js";

export const ORDER = { FAIL: 0, UNKNOWN: 1, PASS: 2, NOT_ASSESSED: 3, NOT_APPLICABLE: 4 };
export const STATE_TEXT = { FAIL: "FAIL", PASS: "PASS", UNKNOWN: "UNKNOWN", NOT_ASSESSED: "NOT ASSESSED", NOT_APPLICABLE: "N/A" };
const GLYPH = { FAIL: "✗", PASS: "✓", UNKNOWN: "?", NOT_ASSESSED: "○", NOT_APPLICABLE: "–" };
const WHO = { alb: "ALB", cloudfront: "CLOUDFRONT", "cloudfront-error": "CLOUDFRONT", cloudflare: "CLOUDFLARE", origin: "ORIGIN", unknown: "SERVER" };
// The chain, left to right. Later phases add their layers after HTTP.
export const CHAIN = [
  { layer: "client", label: "CLIENT" },
  { layer: "dns", label: "DNS", ids: ["L-DNS-01", "L-DNS-02", "L-DNS-03"] },
  { layer: "transport", label: "TCP", ids: ["L-TCP-01"] },
  { layer: "tls", label: "TLS", ids: ["L-TLS-01", "L-TLS-02", "L-TLS-03"] },
  { layer: "http", label: "HTTP", ids: ["L-HTTP-01", "L-HTTP-02", "L-HTTP-03"] },
  { layer: "cdn", label: "CLOUDFRONT" },
  { layer: "lb", label: "ALB" },
  { layer: "network", label: "VPC" },
  { layer: "cluster", label: "CLUSTER" },
];

const worst = (states) => {
  const real = states.filter((s) => s !== "NOT_APPLICABLE" && s !== "NOT_ASSESSED");
  if (!real.length) return states.includes("NOT_ASSESSED") ? "NOT_ASSESSED" : "NOT_APPLICABLE";
  return real.sort((a, b) => ORDER[a] - ORDER[b])[0];
};

const short = (text, n = 34) => (String(text || "").length > n ? `${String(text).slice(0, n - 1)}…` : String(text || ""));

function nodeFact(layer, checks) {
  const get = (id) => checks.find((c) => c.id === id);
  if (layer === "dns") {
    const d = get("L-DNS-01");
    const ips = d?.observed?.addresses || [];
    if (d?.status === "FAIL") return d.observed?.error || "no answer";
    if (d?.status === "NOT_APPLICABLE") return "IP literal";
    const r53 = get("A-R53-01");
    return `${ips.length} IP${ips.length === 1 ? "" : "s"}${d?.observed?.cnames?.length ? " · CNAME" : ""}${get("L-DNS-02")?.observed?.splitHorizon ? " · split" : ""}${r53?.status === "PASS" ? " · R53" : r53?.status === "FAIL" ? " · R53 ✗" : ""}`;
  }
  if (layer === "transport") {
    const t = get("L-TCP-01");
    const ok = (t?.observed?.connects || []).filter((c) => c.ok);
    if (t?.status === "FAIL") return (t.observed?.connects || [])[0]?.error || "no connect";
    if (t?.status === "NOT_ASSESSED") return "not tried";
    return `${ok.length} open · ${t?.durationMs ?? "?"} ms`;
  }
  if (layer === "tls") {
    const a = get("L-TLS-01");
    const e = get("L-TLS-03");
    if (a?.status === "NOT_APPLICABLE") return "plain http";
    if (a?.status === "FAIL") return "handshake failed";
    if (a?.status === "NOT_ASSESSED") return "not tried";
    const days = Math.min(...(e?.observed?.chain || []).map((c) => c.daysLeft));
    return `${String(a?.observed?.protocol || "").replace("TLSv", "v")}${Number.isFinite(days) ? ` · ${days} d` : ""}`;
  }
  if (layer === "http") {
    const h = get("L-HTTP-01");
    if (!h || h.status === "NOT_ASSESSED") return "not tried";
    if (h.observed?.error) return h.observed.error;
    const r = get("L-HTTP-02")?.observed?.redirects || 0;
    return `${h.observed?.status} · ${h.observed?.finalTiming?.total ?? h.durationMs ?? "?"} ms${r ? ` · ${r}↪` : ""}`;
  }
  if (layer === "cdn") {
    const d = get("A-CF-01");
    const b = get("A-CF-02");
    if (d?.status === "UNKNOWN") return "not readable";
    const pattern = b?.observed?.behavior?.pathPattern;
    return `${d?.observed?.id || "?"}${pattern ? ` · ${pattern === "*" ? "default" : pattern}` : ""}${b?.status === "FAIL" ? " · origin ✗" : ""}`;
  }
  if (layer === "lb") {
    const r = get("A-ELB-01");
    const hs = get("A-ELB-02");
    if (r?.status === "UNKNOWN") return "not readable";
    const tgs = hs?.observed?.targetGroups || [];
    if (tgs.length) return short(`${r?.observed?.lb?.name || "ALB"} · ${tgs.map((t) => `${t.healthy}/${t.total}`).join(" ")} healthy`, 30);
    if (r?.observed?.action === "fixed-response") return `${r.observed.lb?.name || "ALB"} · fixed ${r.observed.statusCode}`;
  }
  if (layer === "network") {
    const mark = (id, label) => {
      const x = get(id);
      return x && x.status !== "NOT_APPLICABLE" && x.status !== "NOT_ASSESSED" ? `${label} ${x.status === "PASS" ? "✓" : x.status === "FAIL" ? "✗" : "?"}` : "";
    };
    const hits = (get("A-VPC-05")?.observed?.hits || []).reduce((n, x) => n + x.count, 0);
    return [mark("A-VPC-01", "SG"), mark("A-VPC-02", "NACL"), mark("A-VPC-03", "RT"), hits ? `${hits} REJECT` : ""].filter(Boolean).join(" · ");
  }
  if (layer === "cluster") {
    const svc = get("K-SVC-01");
    const eps = get("K-SVC-02")?.observed;
    const name = /Service (\S+)/.exec(svc?.text || "")?.[1] || "";
    if (eps) return short(`${name ? `${name} · ` : ""}${eps.ready}/${eps.ready + eps.notReady + eps.terminating} ready`, 30);
  }
  const mine = checks.filter((c) => c.layer === layer);
  const bad = mine.find((c) => c.status === "FAIL") || mine.find((c) => c.status === "UNKNOWN") || mine[0];
  return short(bad?.text || bad?.reason || "", 30);
}

// The timing strip, in curl -w terms: dns, connect, tls, wait (ttfb),
// transfer. Widths are shares of the total.
export function timingOf(checks) {
  const h = checks.find((c) => c.id === "L-HTTP-01")?.observed?.timing;
  if (!h || h.total == null) return null;
  const dns = checks.find((c) => c.id === "L-DNS-01")?.durationMs || 0;
  const connect = h.connect ?? 0;
  const tls = h.tls != null ? h.tls - connect : 0;
  const ready = h.tls ?? h.connect ?? 0;
  const wait = h.ttfb != null ? Math.max(0, h.ttfb - ready) : 0;
  const transfer = h.ttfb != null ? Math.max(0, h.total - h.ttfb) : 0;
  const parts = [
    { key: "dns", label: "dns", ms: dns },
    { key: "connect", label: "connect", ms: connect },
    { key: "tls", label: "tls", ms: tls },
    { key: "wait", label: "ttfb", ms: wait },
    { key: "transfer", label: "transfer", ms: transfer },
  ].filter((p) => p.ms > 0 || p.key === "wait");
  const total = parts.reduce((sum, p) => sum + p.ms, 0) || 1;
  return { total: dns + h.total, parts: parts.map((p) => ({ ...p, share: p.ms / total })) };
}

// The DEBUG bar docks in the SNIFF tab (internal mode "path") and nowhere else.
export function debugBarShown(mode) {
  return mode === "path";
}

export function ndModel(run, { filter = "all" } = {}) {
  if (!run) return { state: "empty" };
  if (run.error && !run.report) return { state: "error", text: run.error, hint: run.hint || "" };
  if (!run.report) return { state: "running", target: run.target?.input || "", steps: run.steps || [] };
  const r = run.report;
  const checks = r.checks || [];
  const who = checks.find((c) => c.id === "L-HTTP-03")?.observed?.answeredBy;
  const chain = [];
  // A FROM INSIDE run brings its own hop-by-hop path (pod-result.js podPath).
  if (Array.isArray(r.path)) chain.push(...r.path.map((n) => ({ ...n })));
  else for (const step of CHAIN) {
    if (step.layer === "client") {
      chain.push({ layer: "client", label: "CLIENT", status: "PASS", fact: r.context?.sample ? "sample run" : "this machine" });
      continue;
    }
    // offPath: a fact about the zone, not this request (another name's
    // dangling record); it is listed, but does not colour the hop.
    const mine = checks.filter((c) => c.layer === step.layer && !c.offPath);
    // A layer with nothing that ran is not a hop (yet).
    if (!mine.some((c) => c.status !== "NOT_ASSESSED" && c.status !== "NOT_APPLICABLE") && step.layer !== "tls") continue;
    chain.push({ layer: step.layer, label: step.label, status: worst(mine.map((c) => c.status)), fact: nodeFact(step.layer, checks) });
    if (step.layer === "http" && who && !checks.some((c) => (c.layer === "cdn" || c.layer === "lb") && c.status !== "NOT_APPLICABLE" && c.status !== "NOT_ASSESSED")) {
      const status = checks.find((c) => c.id === "L-HTTP-01")?.observed?.status;
      chain.push({ layer: "answer", label: WHO[who] || "SERVER", status: status >= 500 ? "FAIL" : "PASS", fact: `answered ${status ?? "?"}`, who });
    }
  }
  // The first failing hop breaks the edge into it.
  // An answer node that failed (an ALB 503) is where the request broke,
  // even though the HTTP check failed too.
  const answer = chain.findIndex((n) => ["answer", "cdn", "lb", "network", "cluster"].includes(n.layer) && n.status === "FAIL");
  const broken = answer >= 0 ? answer : chain.findIndex((n) => n.status === "FAIL");
  chain.forEach((n, i) => {
    n.edgeIn = i === 0 ? "" : broken >= 0 && i === broken ? "broken" : broken >= 0 && i > broken ? "after" : "ok";
  });
  const counts = { all: checks.length, FAIL: 0, UNKNOWN: 0, PASS: 0, NOT_ASSESSED: 0, NOT_APPLICABLE: 0 };
  for (const c of checks) counts[c.status] += 1;
  const shown = checks
    .filter((c) => filter === "all" || c.status === filter || (filter === "layer" ? false : c.layer === filter))
    .slice()
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.id.localeCompare(b.id))
    .map((c) => ({ id: c.id, status: c.status, statusText: STATE_TEXT[c.status], glyph: GLYPH[c.status], layer: c.layer, text: c.text || c.reason || "", tool: c.tool, command: c.command || "", severity: c.severity, kind: c.kind }));
  const drill = [...new Set(checks.filter((c) => c.command && c.status !== "NOT_APPLICABLE" && c.status !== "NOT_ASSESSED").map((c) => c.command))];
  return {
    state: "done",
    id: r.id,
    target: r.target?.input || "",
    sample: Boolean(r.context?.sample),
    from: r.from || ["local"],
    verdict: r.summary.verdict,
    summary: r.summary,
    inside: Array.isArray(r.path),
    pod: r.pod || null,
    meta: `${r.context?.sample ? "sample · " : ""}${r.pod ? `pod ${r.context?.namespace}${r.context?.node ? ` on ${r.context.node}` : ""} · ` : ""}${r.from.join(" + ")} · ${(r.durationMs / 1000).toFixed(1)} s · ${r.id}`,
    chain,
    timing: timingOf(checks),
    counts,
    filter,
    checks: shown,
    findings: (r.findings || []).map((f) => ({ ...f, confidenceText: String(f.confidence || "").toUpperCase() })),
    drill,
  };
}

// ---- DOM ----
function h(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "className") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) node.append(kid);
  return node;
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    if (button) {
      const was = button.textContent;
      button.textContent = "COPIED";
      setTimeout(() => {
        button.textContent = was;
      }, 1200);
    }
  } catch {
    window.prompt("Copy:", text);
  }
}

export function createNetdebugView({ root, hostInput = null, sample = () => false, context = () => "", onDone = () => {}, fetchJson = (url, opts) => fetch(url, opts).then((r) => r.json()) }) {
  // The DEBUG panel floats over the bottom of the stage. Reserve its height
  // on the stage (--nd-h, read by .mapwrap) so the PATH above stays visible
  // and scrolls instead of hiding behind the panel (UX overlaps B).
  const stage = root?.parentElement;
  const reserve = () => {
    if (!stage?.style) return;
    const h = root.hidden ? 0 : Math.ceil(root.getBoundingClientRect().height) + 12;
    if (stage.style.getPropertyValue("--nd-h") === `${h}px`) return;
    stage.style.setProperty("--nd-h", `${h}px`);
    if (typeof window !== "undefined" && typeof Event === "function") window.dispatchEvent(new Event("resize"));
  };
  if (typeof ResizeObserver === "function" && root) new ResizeObserver(reserve).observe(root);
  let run = null;
  let filter = "all";
  let polling = 0;
  // Starts as a slim bar so the map gets the screen; RUN (or ▴) opens it.
  let open = false;
  let shown = false;
  // The ALB 503 walkthrough: open, and the VERIFY re-checks left.
  let why = false;
  let rechecks = 0;
  let recheckTimer = 0;
  const RECHECK_MS = 60_000;
  const RECHECKS = 10;
  const field = h("input", { className: "nd-url", type: "text", "aria-label": "URL to debug", placeholder: "https://… or a host: only what you type is probed", spellcheck: "false", autocomplete: "off" });
  const runBtn = h("button", { className: "nd-btn nd-primary", type: "button", text: "RUN" });
  const meta = h("span", { className: "nd-meta" });
  const exports = h("span", { className: "nd-exports" });
  const fold = h("button", { className: "nd-fold", type: "button", "aria-expanded": "true", title: "fold the DEBUG panel", text: "▾" });
  const modes = h("span", { className: "nd-modes", role: "group", "aria-label": "where the checks run from" });
  const body = h("div", { className: "nd-body" });
  // FROM INSIDE (N9): a debug pod in a namespace (and node) you pick.
  let inside = false;
  let podCfg = null;
  let confirmPlan = null;
  const insideBtn = h("button", { className: "nd-btn nd-insidebtn", type: "button", "aria-pressed": "false", hidden: true, text: "FROM INSIDE", title: "probe from a short-lived debug pod in the cluster: DNS, TCP, HTTP, hops, MTU and NetworkPolicy" });
  const nsSel = h("select", { className: "nd-ns", "aria-label": "namespace the debug pod runs in" });
  const nodeIn = h("input", { className: "nd-node-in", type: "text", placeholder: "node (any)", "aria-label": "node to run on", spellcheck: "false", autocomplete: "off" });
  const asIn = h("input", { className: "nd-as", type: "text", placeholder: "as labels: app=web", "aria-label": "labels the debug pod carries (NetworkPolicy source)", spellcheck: "false", autocomplete: "off" });
  const httpIn = h("input", { type: "checkbox", "aria-label": "HTTP GET too" });
  const rawIn = h("input", { type: "checkbox", "aria-label": "tcptraceroute (NET_RAW)" });
  const rawLabel = h("label", { className: "nd-check", hidden: true }, rawIn, "TCP TRACE");
  const tlsIn = h("input", { type: "checkbox", "aria-label": "TLS handshake for a tcp:// target" });
  const tlsLabel = h("label", { className: "nd-check", title: "tcp:// only: after the connect, a bare TLS handshake (STARTTLS for Postgres on 5432). No payload is sent." }, tlsIn, "TLS");
  // The Service picker: Services with ready endpoints, filling the field
  // with http(s)://svc.ns:port or tcp://svc.ns:port.
  const svcSel = h("select", { className: "nd-svc", "aria-label": "pick a Service as the target", title: "pick a Service: fills the target with the right scheme and port" });
  let svcFor = "";
  const loadServices = async () => {
    const key = sample() ? "sample" : "live";
    if (svcFor === key) return;
    svcFor = key;
    svcSel.replaceChildren(h("option", { value: "", text: "SERVICE… (loading)" }));
    const out = await fetchJson(`/api/netdebug/pod/services${sample() ? "?sample=1" : ""}`).catch(() => null);
    const list = out?.services || [];
    const opts = [h("option", { value: "", text: out?.error ? "SERVICE… (none: " + out.error + ")" : list.length ? `SERVICE… (${list.length})` : "SERVICE… (none)" })];
    for (const svc of list) for (const t of svc.targets || []) opts.push(h("option", { value: t, text: `${svc.namespace}/${svc.name} ${t.replace(/^.*:/, ":")} ${t.split(":")[0]} · ${svc.ready}/${svc.total} ready${svc.total && !svc.ready ? " · NO ENDPOINTS" : ""}` }));
    svcSel.replaceChildren(...opts);
    // Namespaces the cluster does not have stay listed but disabled, so the
    // pod is never sent to a namespace the API would 404.
    nsMissing = new Set((out?.namespaces || []).filter((n) => n.exists === false).map((n) => n.name));
    markNamespaces();
  };
  let nsMissing = new Set();
  function markNamespaces() {
    for (const o of nsSel.options) {
      const gone = nsMissing.has(o.value);
      o.disabled = gone;
      o.text = gone ? `${o.value} (missing)` : o.value;
      o.title = gone ? `namespace ${o.value} does not exist on the cluster` : "";
    }
    if (nsSel.selectedOptions[0]?.disabled) {
      const ok = [...nsSel.options].find((o) => !o.disabled);
      if (ok) nsSel.value = ok.value;
    }
  }
  svcSel.addEventListener("change", () => {
    if (!svcSel.value) return;
    field.value = svcSel.value;
    confirmPlan = null;
    field.focus();
  });
  const insideRow = h("div", { className: "nd-insiderow", hidden: true },
    h("span", { className: "nd-label", text: "POD IN" }), nsSel, nodeIn, asIn, svcSel,
    h("label", { className: "nd-check" }, httpIn, "HTTP"), tlsLabel, rawLabel,
    h("span", { className: "nd-quiet", text: "read-only otherwise · deleted after the run · TTL" }));
  // DIAGNOSE: investigate the Service the target names (svc.ns), read-only.
  const dxBtn = h("button", { className: "nd-btn nd-dx", type: "button", text: "INVESTIGATE", title: "DIAGNOSE a Service: read-only evidence, findings, VERIFY AGAIN after a fix" });
  dxBtn.addEventListener("click", () => {
    if (sample()) return openDiagnose({ sample: true });
    const host = (/^[a-z]+:\/\/([^/:]+)/i.exec(field.value.trim()) || [null, field.value.trim().split(/[/:]/)[0]])[1] || "";
    const [svc, ns] = host.split(".");
    const dns = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;
    // The cluster context the rest of the UI is on (CLUSTER's switcher), not
    // the server's first context.
    const ctx = context() || "";
    openDiagnose({ ...(ctx ? { context: ctx } : {}), ...(ns && dns.test(svc) && dns.test(ns) && !/\.(com|net|org|io|aws|amazonaws)$/.test(host) ? { namespace: ns, service: svc } : {}) });
  });
  const bar = h("div", { className: "nd-bar" }, h("b", { className: "nd-title", text: "DEBUG" }), field, insideBtn, modes, runBtn, dxBtn, meta, exports, fold);
  root.replaceChildren(bar, insideRow, body);
  const loadPodCfg = async () => {
    podCfg = await fetchJson("/api/netdebug/pod/config").catch(() => null);
    syncInside();
  };
  function syncInside() {
    const can = Boolean(podCfg?.enabled) || sample();
    insideBtn.hidden = !can;
    if (!can) inside = false;
    insideBtn.setAttribute("aria-pressed", String(inside));
    insideRow.hidden = !inside;
    rawLabel.hidden = !(podCfg?.allowRawTrace || sample());
    if (inside) loadServices();
    field.placeholder = inside ? "shopapi.shop:3000 · tcp://shopdb.shop:5432 · https://api.example.com — from inside the cluster" : "https://… or a host: only what you type is probed";
    const want = sample() ? ["cloudspider-debug", "web", "shop"] : [podCfg?.namespace || "cloudspider-debug", ...(podCfg?.sourceNamespaces || [])];
    if ([...nsSel.options].map((o) => o.value).join() !== want.join()) {
      nsSel.replaceChildren(...want.map((n) => h("option", { value: n, text: n })));
      markNamespaces();
    }
  }
  insideBtn.addEventListener("click", () => {
    inside = !inside;
    confirmPlan = null;
    syncInside();
    draw();
  });
  const podBody = (extra = {}) => {
    const asLabels = Object.fromEntries(asIn.value.split(/[,\s]+/).filter((x) => x.includes("=")).map((x) => x.split("=")));
    return { target: field.value.trim(), namespace: nsSel.value, node: nodeIn.value.trim(), asLabels, http: httpIn.checked, tls: tlsIn.checked, rawTrace: rawIn.checked, sample: sample() === true, ...extra };
  };
  const planInside = async () => {
    open = true;
    if (!field.value.trim()) return field.focus();
    runBtn.disabled = true;
    const out = await fetchJson("/api/netdebug/pod/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(podBody()) }).catch((err) => ({ error: err?.message || "the server did not answer" }));
    runBtn.disabled = false;
    if (out.error) {
      run = { error: out.error, hint: out.hint || "" };
      confirmPlan = null;
    } else {
      confirmPlan = out;
      run = null;
    }
    draw();
  };
  const startInside = async (confirm) => {
    open = true;
    runBtn.disabled = true;
    run = { target: { input: field.value.trim() }, steps: [{ text: "starting the debug pod", state: "running" }] };
    confirmPlan = null;
    filter = "all";
    draw();
    const out = await fetchJson("/api/netdebug/pod", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(podBody({ confirm })) }).catch((err) => ({ error: err?.message || "the server did not answer" }));
    if (!out.id) {
      run = { error: out.error || "nothing ran", hint: out.hint || "" };
      runBtn.disabled = false;
      draw();
      return;
    }
    poll(out.id, ++polling);
  };
  function drawConfirm(p) {
    const typed = h("input", { className: "nd-confirm-in", type: "text", placeholder: p.confirmWith, "aria-label": `type ${p.confirmWith} to confirm`, spellcheck: "false", autocomplete: "off" });
    const typedCtx = p.work ? h("input", { className: "nd-confirm-in", type: "text", placeholder: p.context, "aria-label": `type ${p.context} to confirm the work context` }) : null;
    const go = h("button", { type: "button", className: "nd-btn nd-primary", text: p.sample ? "RUN SAMPLE" : "CREATE POD AND RUN" });
    const ok = () => p.sample || (typed.value === p.confirmWith && (!typedCtx || typedCtx.value === p.context));
    const sync = () => (go.disabled = !ok() || (p.needs.length > 0 && !p.sample));
    typed.addEventListener("input", sync);
    typedCtx?.addEventListener("input", sync);
    go.addEventListener("click", () => ok() && startInside({ namespace: typed.value || p.confirmWith, context: typedCtx?.value || "" }));
    sync();
    const t = p.plan.target;
    const c = p.spec.spec.containers[0];
    return h("section", { className: "nd-confirm", "aria-label": "debug pod: what will be created" },
      p.work ? h("div", { className: "nd-work", role: "alert", text: `WORK CONTEXT ${p.context}` }) : null,
      h("div", { className: "nd-fhead" }, h("b", { text: `DEBUG POD → ${t.kind === "service" ? `${t.name}.${t.namespace}:${t.port}` : `${t.host}:${t.port}`}` }), h("span", { className: "nd-quiet", text: p.sample ? "sample: nothing is created" : `context ${p.context}` })),
      h("ul", { className: "nd-plan" },
        h("li", { text: `pod ${p.spec.metadata.name} in ${p.plan.source.namespace}${p.plan.source.node ? ` on ${p.plan.source.node}` : ""} · TTL ${p.plan.ttlSeconds} s · deleted after the run` }),
        h("li", { text: `image ${c.image.replace(/@sha256:(.{12}).*/, "@sha256:$1…")}` }),
        h("li", { text: `${p.plan.raw ? "root with only NET_RAW (tcptraceroute), no escalation" : "non-root, read-only root, no capabilities, no service account token"} · cpu 100m · 64Mi` }),
        h("li", { text: `checks: ${Object.entries(p.plan.checks).filter(([, v]) => v).map(([k]) => k.toUpperCase()).join(" · ")}${t.endpoints?.length ? ` · ${t.endpoints.length} endpoint${t.endpoints.length === 1 ? "" : "s"} direct` : ""}` }),
        Object.keys(p.plan.source.labels || {}).length ? h("li", { text: `labels as ${Object.entries(p.plan.source.labels).map(([k, v]) => `${k}=${v}`).join(", ")} (NetworkPolicy source)` }) : null),
      p.needs.length && !p.sample ? h("div", { className: "nd-error", role: "alert" }, h("b", { text: "NOT YET" }), ...p.needs.map((n) => h("small", { text: n }))) : null,
      p.scc ? h("details", { className: "nd-drill" }, h("summary", {}, h("span", { className: "nd-label", text: "OPENSHIFT SCC (an admin applies it)" })), h("pre", { text: JSON.stringify(p.scc, null, 2) })) : null,
      h("details", { className: "nd-drill" }, h("summary", {}, h("span", { className: "nd-label", text: "POD SPEC" })), h("pre", { className: "nd-spec", text: JSON.stringify(p.spec, null, 2) })),
      h("div", { className: "nd-confirmrow" }, p.sample ? null : h("span", { className: "nd-label", text: "TYPE THE NAMESPACE" }), p.sample ? null : typed, typedCtx, go, h("button", { type: "button", className: "nd-btn", text: "CANCEL", onclick: () => ((confirmPlan = null), draw()) })));
  }

  const start = async ({ keepWhy = false } = {}) => {
    open = true;
    if (!keepWhy) {
      why = false;
      rechecks = 0;
    }
    clearTimeout(recheckTimer);
    const target = field.value.trim();
    if (!target) {
      field.focus();
      return;
    }
    runBtn.disabled = true;
    run = { target: { input: target }, steps: [{ text: "starting", state: "running" }] };
    filter = "all";
    draw();
    const out = await fetchJson("/api/netdebug", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ target, sample: sample() === true }) }).catch((err) => ({ error: err?.message || "the server did not answer" }));
    if (!out.id) {
      run = { error: out.error || "nothing ran", hint: out.retryAfterMs ? `try again in ${Math.ceil(out.retryAfterMs / 1000)} s` : "" };
      runBtn.disabled = false;
      draw();
      return;
    }
    poll(out.id, ++polling);
  };
  const poll = async (id, ticket) => {
    while (ticket === polling) {
      const got = await fetchJson(`/api/netdebug/${id}`).catch(() => null);
      if (got && ticket === polling) {
        run = got;
        draw();
        if (got.state !== "running") {
          if (got.report) onDone(got.report);
          // VERIFY keeps going by itself while the walkthrough is open.
          if (why && got.report && !verifyState(got.report).ok && rechecks < RECHECKS && !root.hidden) {
            recheckTimer = setTimeout(() => {
              if (!why || root.hidden) return;
              rechecks += 1;
              start({ keepWhy: true });
            }, RECHECK_MS);
          }
          break;
        }
      }
      await new Promise((r) => setTimeout(r, 350));
    }
    runBtn.disabled = false;
  };
  runBtn.addEventListener("click", () => (inside ? planInside() : start()));
  field.addEventListener("input", () => { field.title = field.value; });
  field.addEventListener("keydown", (event) => {
    if (event.key === "Enter") inside ? planInside() : start();
  });
  fold.addEventListener("click", () => {
    open = !open;
    draw();
  });

  function drawModes(model) {
    const from = model.from || ["local"];
    const chip = (label, on, title) => h("span", { className: "nd-mode", dataset: { on: on ? "1" : "0" }, title }, h("i"), label);
    modes.replaceChildren(
      chip("LOCAL", true, "DNS, TCP, TLS and HTTP from this machine"),
      chip("AWS", from.includes("aws"), "Route 53, CloudFront, ALB, VPC reads (read-only); on when the target is in this account"),
      chip("KUBE", from.includes("kube"), "Service, EndpointSlices, NetworkPolicies, CoreDNS through the viewer role (read-only); on when the target group belongs to a connected cluster"),
      chip("IN-CLUSTER", from.includes("pod"), from.includes("pod") ? "a short-lived debug pod in the cluster ran these checks" : "a debug pod in the cluster: FROM INSIDE (opt-in: network.pod.enabled and a context in kube.writeContexts)"),
    );
  }

  function drawChain(model) {
    const row = h("ol", { className: "nd-chain", "aria-label": "the request, left to right" });
    model.chain.forEach((n) => {
      if (n.edgeIn) row.append(h("li", { className: "nd-edge", dataset: { edge: n.edgeIn }, "aria-hidden": "true" }, h("i")));
      const node = h("li", { className: "nd-node", dataset: { status: n.status, layer: n.layer }, role: "button", tabindex: "0", title: `${n.label}: ${STATE_TEXT[n.status]} · click: only its checks` },
        h("span", { className: "nd-glyph", text: GLYPH[n.status] }),
        h("b", { text: n.label }),
        h("small", { text: n.fact }),
        n.live ? h("small", { className: "nd-live", title: `observe bundle, live: called by ${n.live.callers.join(", ")}`, text: `LIVE ${n.live.rps} rps · ${(n.live.errorRate * 100).toFixed(1)}% err · p95 ${n.live.p95ms} ms` }) : null);
      const pick = () => {
        filter = filter === n.layer ? "all" : n.layer;
        draw();
      };
      node.addEventListener("click", pick);
      node.addEventListener("keydown", (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), pick()));
      if (filter === n.layer) node.setAttribute("aria-pressed", "true");
      row.append(node);
    });
    return row;
  }

  function drawTiming(model) {
    if (!model.timing) return null;
    const strip = h("div", { className: "nd-timing", "aria-label": "where the time goes" }, h("span", { className: "nd-label", text: "TIMING" }));
    const barEl = h("div", { className: "nd-tbar" });
    for (const p of model.timing.parts) barEl.append(h("i", { dataset: { part: p.key }, style: `flex-grow: ${Math.max(p.share, 0.04)}`, title: `${p.label} ${p.ms} ms` }));
    strip.append(barEl, h("span", { className: "nd-tlegend" }, ...model.timing.parts.map((p) => h("span", { dataset: { part: p.key } }, `${p.label} ${p.ms} ms`)), h("b", { text: `total ${model.timing.total} ms` })));
    return strip;
  }

  function drawChecks(model) {
    const pane = h("section", { className: "nd-checks", "aria-label": "checks (facts)" });
    const chips = h("div", { className: "nd-filters", role: "group", "aria-label": "filter the checks" }, h("span", { className: "nd-label", text: "CHECKS" }));
    for (const [key, label] of [["all", "all"], ["FAIL", "fail"], ["UNKNOWN", "unknown"], ["PASS", "pass"], ["NOT_ASSESSED", "not assessed"]]) {
      const n = model.counts[key];
      if (key !== "all" && !n) continue;
      chips.append(h("button", { type: "button", className: "nd-chip", dataset: { status: key }, "aria-pressed": String(filter === key), text: `${label} ${n}`, onclick: () => ((filter = key), draw()) }));
    }
    if (!["all", "FAIL", "UNKNOWN", "PASS", "NOT_ASSESSED"].includes(filter)) chips.append(h("button", { type: "button", className: "nd-chip", "aria-pressed": "true", text: `${filter} ✕`, onclick: () => ((filter = "all"), draw()) }));
    const list = h("ul", { className: "nd-list" });
    for (const c of model.checks) {
      const copy = c.command ? h("button", { type: "button", className: "nd-copy", text: "COPY", title: c.command, onclick: (e) => copyText(c.command, e.currentTarget) }) : h("span");
      list.append(h("li", { className: "nd-row", dataset: { status: c.status } },
        h("span", { className: "nd-glyph", text: c.glyph, title: c.statusText }),
        h("code", { className: "nd-id", text: c.id }),
        h("span", { className: "nd-text", text: c.text || c.statusText }),
        h("span", { className: "nd-tool", text: c.tool }),
        copy));
    }
    pane.append(chips, list);
    return pane;
  }

  function drawFindings(model) {
    const pane = h("aside", { className: "nd-findings", "aria-label": "findings (inferences)" }, h("span", { className: "nd-label", text: "FINDINGS" }));
    if (!model.findings.length) {
      pane.append(h("p", { className: "nd-quiet", text: model.verdict === "PASS" ? `Nothing to explain: every check that ran passed from ${model.inside ? "the debug pod" : "this machine"}.` : "No finding ties the failing checks together yet." }));
      return pane;
    }
    for (const f of model.findings) {
      const card = h("div", { className: "nd-finding", dataset: { confidence: f.confidence } },
        h("div", { className: "nd-fhead" }, h("span", { className: "nd-conf", text: f.confidenceText }), h("span", { className: "nd-kind", text: "inference" }), f.walkthrough === "alb-503" ? h("button", { type: "button", className: "nd-btn nd-whybtn", text: why ? "WHY? ▴" : "WHY?", title: "walk the ALB 503 decision tree over this run's evidence", "aria-expanded": String(why), onclick: () => ((why = !why), why || clearTimeout(recheckTimer), draw()) }) : null),
        h("p", { text: f.statement }),
        h("div", { className: "nd-supports" }, h("span", { className: "nd-label", text: "FACTS" }), ...f.supports.map((id) => h("code", { text: id })), f.contradicts.length ? h("span", { className: "nd-contra", text: `contradicts ${f.contradicts.join(", ")}` }) : null));
      for (const next of f.next || []) card.append(h("div", { className: "nd-next" }, h("span", { className: "nd-label", text: "NEXT" }), h("code", { text: next }), h("button", { type: "button", className: "nd-copy", text: "COPY", onclick: (e) => copyText(next, e.currentTarget) })));
      if (f.verify) card.append(h("div", { className: "nd-verify" }, h("span", { className: "nd-label", text: "VERIFY" }), h("span", { text: f.verify })));
      pane.append(card);
    }
    return pane;
  }

  function drawWhy() {
    const w = albWalkthrough(run.report);
    const v = verifyState(run.report);
    return h("section", { className: "nd-why", "aria-label": "why is the load balancer answering 503" },
      h("div", { className: "nd-whyhead" },
        h("b", { text: `WHY IS ${String(w.lb).toUpperCase()} ANSWERING 503?` }),
        h("span", { className: "nd-quiet", text: `${w.host} · ${w.steps.length} step${w.steps.length === 1 ? "" : "s"} · this run's evidence, no new calls` }),
        h("button", { type: "button", className: "nd-fold", title: "close the walkthrough", text: "×", onclick: () => ((why = false), clearTimeout(recheckTimer), draw()) })),
      h("ol", { className: "nd-wsteps" }, ...w.steps.map((st, i) => h("li", { className: "nd-wstep", dataset: { state: st.state, last: i === w.steps.length - 1 ? "1" : "0" } },
        h("span", { className: "nd-wn", text: String(st.n) }),
        h("div", { className: "nd-wbody" },
          h("b", { text: st.question }),
          h("p", { text: st.answer }),
          h("div", { className: "nd-supports" }, ...st.evidence.map((e) => h("code", { dataset: { status: e.status }, title: e.text, text: e.id })), st.next ? h("span", { className: "nd-wnext", text: `→ step ${st.next}` }) : null))))),
      h("div", { className: "nd-wverdict" },
        h("span", { className: "nd-label", text: "VERDICT" }),
        h("p", { text: w.verdict.text }),
        ...w.verdict.fix.map((c) => h("div", { className: "nd-next" }, h("span", { className: "nd-label", text: "FIX" }), h("code", { text: c }), h("button", { type: "button", className: "nd-copy", text: "COPY", onclick: (e) => copyText(c, e.currentTarget) }))),
        h("div", { className: "nd-wverify", dataset: { ok: v.ok ? "1" : "0" } },
          h("span", { className: "nd-label", text: "VERIFY" }),
          h("i", { className: "nd-lamp", "aria-hidden": "true" }),
          h("span", { text: `${w.verify} · now: ${v.text}${!v.ok && rechecks < RECHECKS ? ` · re-checks every ${RECHECK_MS / 1000} s (${RECHECKS - rechecks} left)` : ""}` }),
          h("button", { type: "button", className: "nd-btn", text: "RE-CHECK", onclick: () => ((rechecks = 0), start({ keepWhy: true })) }))));
  }

  function drawDrill(model) {
    if (!model.drill.length) return null;
    const all = model.drill.join("\n");
    return h("details", { className: "nd-drill" },
      h("summary", {}, h("span", { className: "nd-label", text: "YOU KNOW THE DRILL" }), h("span", { className: "nd-drillpeek", text: model.drill.map((c) => c.split(" ").slice(0, 2).join(" ")).filter((v, i, a) => a.indexOf(v) === i).join(" · ") }), h("button", { type: "button", className: "nd-copy", text: "COPY ALL", onclick: (e) => (e.preventDefault(), copyText(all, e.currentTarget)) })),
      h("ol", {}, ...model.drill.map((c) => h("li", {}, h("code", { text: c }), h("button", { type: "button", className: "nd-copy", text: "COPY", onclick: (e) => copyText(c, e.currentTarget) })))));
  }

  function draw() {
    const model = ndModel(run, { filter });
    root.dataset.state = model.state;
    field.title = field.value; // long URLs end in an ellipsis; the tooltip has the whole one
    root.dataset.open = open ? "1" : "0";
    fold.textContent = open ? "▾" : "▴";
    fold.setAttribute("aria-expanded", String(open));
    drawModes(model);
    meta.textContent = model.state === "done" ? model.meta : model.state === "running" ? "running…" : "";
    exports.replaceChildren(...(model.state === "done" ? [h("a", { className: "nd-btn", href: `/api/netdebug/${model.id}.md`, download: `${model.id}.md`, text: "EXPORT MD" }), h("a", { className: "nd-btn", href: `/api/netdebug/${model.id}.json`, download: `${model.id}.json`, text: "JSON" })] : []));
    if (!open) {
      body.replaceChildren();
      return;
    }
    if (confirmPlan && model.state !== "running") {
      body.replaceChildren(drawConfirm(confirmPlan));
      return;
    }
    if (model.state === "empty" && inside) {
      const try_ = (text, ns, as = "", http = true) => h("button", { type: "button", className: "nd-chip", text: `${text}${ns ? ` from ${ns}` : ""}`, onclick: () => ((field.value = text), ns && (nsSel.value = ns), (asIn.value = as), (httpIn.checked = http), planInside()) });
      body.replaceChildren(h("div", { className: "nd-empty" },
        h("p", { text: "FROM INSIDE starts a short-lived netshoot pod in the namespace you pick (its NetworkPolicy source) and runs a fixed probe: DNS (short name and FQDN), TCP to the Service and to each pod, HTTP (or, for tcp://host:port, only the connect plus an optional TLS handshake: no payload), the hops (tracepath; tcptraceroute with NET_RAW) and the path MTU. Then it says which NetworkPolicy allows or blocks the path." }),
        h("p", { className: "nd-quiet", text: "Nothing else is written: no exec, no secrets; the pod is deleted after its log is read and expires by itself (TTL)." }),
        h("div", { className: "nd-tries" }, h("span", { className: "nd-label", text: "TRY" }), ...(sample() ? [try_("shopapi.shop:3000", "cloudspider-debug"), try_("shopapi.shop:3000", "web", "app=web"), try_("https://api.example.com/healthz", "cloudspider-debug")] : [try_("kubernetes.default:443", "")]))));
      return;
    }
    if (model.state === "empty") {
      const try_ = (text) => h("button", { type: "button", className: "nd-chip", text, onclick: () => ((field.value = text), start()) });
      body.replaceChildren(h("div", { className: "nd-empty" },
        h("p", { text: "Type a URL and RUN. Cloud Spider does the drill from this machine: DNS (yours and public DoH), TCP, TLS (chain, name, expiry) and one GET with the timing split. Every check has its command to COPY." }),
        h("p", { className: "nd-quiet", text: "Only the URL you type is probed: GET/HEAD, no cookies, rate-limited; metadata and link-local addresses are always refused." }),
        h("div", { className: "nd-tries" }, h("span", { className: "nd-label", text: "TRY" }), ...(sample() ? ["web.sample.test", "api.sample.test", "cdn.sample.test", "https://google.com"] : ["https://google.com", ...(hostInput?.value?.trim() ? [hostInput.value.trim()] : [])]).map(try_))));
      return;
    }
    if (model.state === "error") {
      body.replaceChildren(h("div", { className: "nd-error", role: "alert" }, h("b", { text: "NOT RUN" }), h("span", { text: model.text }), model.hint ? h("small", { text: model.hint }) : null));
      return;
    }
    if (model.state === "running") {
      body.replaceChildren(h("ol", { className: "nd-steps", "aria-live": "polite" }, ...model.steps.map((s) => h("li", { dataset: { state: s.state } }, h("span", { className: "nd-glyph", text: s.state === "done" ? "✓" : s.state === "failed" ? "✗" : "▶" }), s.text))));
      return;
    }
    // Open from a WHY? link too (an SLO burning on an ALB that answers 200
    // right now): whenever the run reached a load balancer of the account.
    const reachedAlb = (run?.report?.checks || []).some((c) => c.id === "A-ELB-01" && c.status !== "NOT_APPLICABLE");
    const hasWhy = why && (reachedAlb || run?.report?.findings?.some((f) => f.walkthrough === "alb-503"));
    body.replaceChildren(
      hasWhy ? drawWhy() : "",
      h("div", { className: "nd-verdict", dataset: { status: model.verdict } }, h("b", { text: STATE_TEXT[model.verdict] || model.verdict }), h("span", { text: `${model.summary.pass} pass · ${model.summary.fail} fail · ${model.summary.unknown} unknown · ${model.summary.notAssessed} not assessed` })),
      drawChain(model),
      drawTiming(model) || "",
      h("div", { className: "nd-main" }, drawChecks(model), drawFindings(model)),
      drawDrill(model) || "",
    );
  }

  return {
    setInside({ target = "", namespace = "" } = {}) {
      inside = true;
      confirmPlan = null;
      run = null;
      field.value = target;
      syncInside();
      if (namespace && [...nsSel.options].some((o) => o.value === namespace)) nsSel.value = namespace;
      if (!root.hidden) draw();
      field.focus();
    },
    show() {
      loadPodCfg();
      if (!shown) {
        shown = true;
        if (!field.value && hostInput?.value?.trim()) field.value = hostInput.value.trim();
      }
      root.hidden = false;
      draw();
      reserve();
    },
    hide() {
      root.hidden = true;
      reserve();
    },
    reset() {
      polling += 1;
      run = null;
      confirmPlan = null;
      filter = "all";
      runBtn.disabled = false;
      if (!root.hidden) draw();
    },
    setTarget(text, { go = false, whyOpen = false } = {}) {
      field.value = text;
      if (go) {
        start();
        why = whyOpen;
      }
    },
    whyOpen: () => why,
    target: () => field.value.trim(),
    isShown: () => !root.hidden,
    model: () => ndModel(run, { filter }),
  };
}
