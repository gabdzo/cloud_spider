// SERVICES prototype view (SAMPLE only): who talks to whom in a cluster,
// grouped by operator or namespace, with an incident timeline under it.
// Plan: docs/plan-modules-and-service-graph.md. Data: graph-sample.js;
// what is shown: graph-model.js. HTML cards in bands, edges in one SVG
// overlay measured from the cards, so both themes style it with CSS.

import { graphScenario } from "./graph-sample.js";
import { routeEdge } from "./graph-route.js";
import { GROUP_BY, GROUP_BY_KEY, cleanGroupBy, regroup } from "./graph-group.js";
import { BADGES, KIND_BADGE, KIND_NAME, STATUS_TEXT, callsOf, edgeStatus, groupTalk, layerNodes, nodeTraffic, rateText } from "./graph-layers.js";
import { EVENT_KINDS, LAYERS, initialExpanded, initialLayers, sceneStats, stepEvent, timeline, visibleGraph } from "./graph-model.js";

const SVG = "http://www.w3.org/2000/svg";
const LAYER_LABEL = { static: "STATIC", flow: "FLOWS", trace: "TRACES", owner: "OWNERS" };
const LAYER_HINT = {
  static: "Services, Endpoints, Ingress, NetworkPolicies: what may talk",
  flow: "VPC CNI flow logs or Hubble: what did talk (L3/L4)",
  trace: "OpenTelemetry traces: which API called which (L7, with errors)",
  owner: "ownerReferences: operator → custom resources → what they own",
};
// Edge source marks: what each line style means (legend under the stats).
// Edge styles: is it talking or not (legend under the stats).
const EDGE_LEGEND = [
  ["st-live", "TALKING · live traffic (moving line, req/s)", "measured traffic: Beyla eBPF via the OTel collector (L7) or flow logs/Hubble (L4); the label shows req/s and errors"],
  ["st-error", "TALKING WITH ERRORS (≥ 1%)", "live traffic where at least 1% of requests fail"],
  ["st-config", "CONFIG ONLY · not seen talking", "declared by a Service, Ingress/Route or NetworkPolicy: allowed to talk, but no live traffic was measured"],
  ["st-owner", "OWNER", "ownerReferences: operator → custom resources → what they own"],
];
// Live trace edges get an on-line badge; past this many only the busiest
// (and the selected node's) keep theirs, so the graph stays readable.
const BADGE_MAX = 12;
export function edgeBadge(edge) {
  const src = edge.sources.includes("trace") ? "trace" : edge.sources.includes("flow") ? "flow" : "";
  if (!src || !(edge.rps > 0)) return "";
  const rate = edge.rps ? ` ${edge.rps}/s` : "";
  const err = edge.errors ? ` · ${edge.errors}% err` : "";
  return `${src === "trace" ? "LIVE · Beyla/OTel" : "LIVE · FLOW"}${rate}${err}`;
}
const KIND_TAG = KIND_BADGE;
const EVENT_TAG = { rollout: "ROLLOUT", restart: "RESTART", warning: "WARN", alarm: "ALARM", ok: "OK" };

function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "className") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (key === "dataset") Object.assign(node.dataset, value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
  return node;
}

export function createGraphView(root) {
  const state = { scenario: "bare", expanded: new Set(), query: "", layers: new Set(LAYERS), focus: null, selected: null, event: null };
  // Group by (graph-group.js): raw is the scene as read; scene is regrouped.
  const store = (() => {
    try {
      return globalThis.localStorage || null;
    } catch {
      return null;
    }
  })();
  state.groupBy = cleanGroupBy(store?.getItem?.(GROUP_BY_KEY) || "namespace");
  let raw = null;
  let scene = null;
  const setScene = (next) => {
    raw = next;
    scene = regroup(raw, state.groupBy);
    return scene;
  };
  setScene(graphScenario(state.scenario));
  state.expanded = initialExpanded(scene);
  function setGroupBy(key) {
    const next = cleanGroupBy(key);
    if (els.groupCustom) els.groupCustom.classList.toggle("bad", Boolean(String(key || "").trim()) && next === "namespace" && String(key).trim() !== "namespace");
    if (next === state.groupBy) return;
    state.groupBy = next;
    try {
      store?.setItem?.(GROUP_BY_KEY, next);
    } catch {
      // not kept
    }
    setScene(raw);
    Object.assign(state, { expanded: initialExpanded(scene), focus: null, selected: null, event: null });
    syncGroupBy();
    render();
  }
  function syncGroupBy() {
    if (!els.groupSel) return;
    const known = GROUP_BY.some((g) => g.id === state.groupBy);
    els.groupSel.value = known ? state.groupBy : "custom";
    els.groupCustom.hidden = known;
    if (!known) els.groupCustom.value = state.groupBy;
  }
  let view = null;
  let shown = false;
  // Incident review filters: event kinds, the window (live only), and
  // whether the list follows the focused group (tlAll: every group).
  Object.assign(state, { kinds: new Set(EVENT_KINDS), windowMin: null, tlAll: false, tlOpen: true });
  // Live: the events come from /api/cluster/timeline for the picked window
  // (the observe bundle's Loki, else the API server); the server trims.
  let tlData = null;
  const tlScene = () => (live.on && tlData?.events ? { ...scene, events: regroup({ ...raw, events: tlData.events }, state.groupBy).events, window: { ...scene.window, startAt: tlData.window?.startAt, endAt: tlData.window?.endAt } } : scene);
  const tlOpts = () => ({ kinds: state.kinds, windowMin: live.on ? null : state.windowMin, group: state.tlAll ? null : state.focus });
  async function loadTimeline() {
    if (!live.on) return;
    const q = new URLSearchParams({ windowMin: String(state.windowMin || 360) });
    if (live.context) q.set("context", live.context);
    try {
      const body = await fetch(`/api/cluster/timeline?${q}`).then((r) => r.json());
      tlData = body.error ? { events: null, note: body.error } : body;
    } catch {
      tlData = null;
    }
    if (shown) render();
  }
  // live: the selected kube context's graph (/api/cluster/graph); otherwise
  // the SAMPLE scenarios.
  const live = { on: false, context: "", loading: false, error: "", at: 0 };
  const resize = typeof ResizeObserver === "function" ? new ResizeObserver(() => shown && drawEdges()) : null;

  const els = {};
  function build() {
    root.replaceChildren();
    els.scen = h("div", { className: "gv-seg", role: "group", "aria-label": "sample scenario" });
    for (const [id, label] of [["bare", "BARE + CERT-MANAGER"], ["bundle", "NIMBUS BUNDLE · 40 OPS"]]) {
      els.scen.append(h("button", { type: "button", className: "gv-btn", dataset: { scenario: id }, text: label, onclick: () => pick(id) }));
    }
    els.search = h("input", { className: "gv-search", type: "search", placeholder: "find: service, namespace, operator…", "aria-label": "find in the graph", oninput: (ev) => ((state.query = ev.target.value), render()) });
    els.groupBox = h("label", { className: "gv-seg gv-groupby", title: "Group by: the namespace, or a label; resources without it go to 'unlabeled'. Operator (OLM) groups stay folded." }, h("span", { className: "gv-gblabel", text: "GROUP BY" }));
    els.groupSel = h("select", { className: "gv-gbsel", "aria-label": "group by", onchange: (ev) => (ev.target.value === "custom" ? ((els.groupCustom.hidden = false), els.groupCustom.focus(), els.groupCustom.value && setGroupBy(els.groupCustom.value)) : setGroupBy(ev.target.value)) });
    for (const g of GROUP_BY) els.groupSel.append(h("option", { value: g.id, text: g.label }));
    els.groupSel.append(h("option", { value: "custom", text: "custom label…" }));
    els.groupCustom = h("input", { className: "gv-gbcustom", type: "text", placeholder: "label key, e.g. team", "aria-label": "custom label key", hidden: true, spellcheck: "false", onchange: (ev) => setGroupBy(ev.target.value), onkeydown: (ev) => ev.key === "Enter" && setGroupBy(ev.target.value) });
    els.groupBox.append(els.groupSel, els.groupCustom);
    els.layers = h("div", { className: "gv-seg gv-layers", role: "group", "aria-label": "data sources" });
    for (const layer of LAYERS) els.layers.append(h("button", { type: "button", className: `gv-btn gv-layer gv-l-${layer}`, dataset: { layer }, title: LAYER_HINT[layer], text: LAYER_LABEL[layer], onclick: () => toggleLayer(layer) }));
    els.liveBox = h("div", { className: "gv-seg gv-live", hidden: true });
    els.refresh = h("button", { type: "button", className: "gv-btn", text: "REFRESH", title: "read the cluster again (GETs only)", onclick: () => loadLive(true) });
    els.liveNote = h("span", { className: "gv-livenote" });
    els.liveBox.append(els.liveNote, els.refresh);
    els.fold = h("button", { type: "button", className: "gv-btn", text: "FOLD ALL", title: "close every group", onclick: () => ((state.expanded = new Set()), (state.focus = null), render()) });
    els.stats = h("p", { className: "gv-stats" });
    els.detail = h("p", { className: "gv-detail", "aria-live": "polite" });
    els.legend = h("p", { className: "gv-legend", "aria-label": "edge sources" });
    for (const [cls, text, hint] of EDGE_LEGEND) els.legend.append(h("span", { className: `gv-key ${cls}`, title: hint }, h("i", { "aria-hidden": "true" }), h("span", { text })));
    els.badgeKey = h("p", { className: "gv-badgekey", "aria-label": "badge key" });
    for (const [tag, text] of Object.entries(BADGES)) els.badgeKey.append(h("span", { className: "gv-bk", title: text }, h("small", { className: `gv-ntag t-${tag}`, text: tag }), h("span", { text: text.split(/[:(]/)[0].trim() })));
    els.stage = h("div", { className: "gv-stage" });
    els.svg = document.createElementNS(SVG, "svg");
    els.svg.setAttribute("class", "gv-edges");
    els.svg.setAttribute("aria-hidden", "true");
    els.bands = h("div", { className: "gv-bands" });
    els.stage.append(els.svg, els.bands);
    els.tl = h("section", { className: "gv-timeline", "aria-label": "incident review" });
    root.append(
      h("header", { className: "gv-head" },
        h("div", { className: "gv-title" }, h("b", { text: "SERVICES" }), (els.proto = h("span", { className: "gv-proto", text: "SAMPLE · PROTOTYPE" }))),
        els.scen, els.liveBox, els.groupBox, els.search, els.layers, els.fold),
      els.stats,
      els.legend,
      els.badgeKey,
      els.detail,
      h("div", { className: "gv-main" }, els.stage, (els.side = h("aside", { className: "gv-side", "aria-label": "calls of the selected service", hidden: true }))),
      els.tl,
    );
    resize?.observe(els.stage);
    syncGroupBy();
  }

  function pick(id) {
    if (state.scenario === id) return;
    state.scenario = id;
    setScene(graphScenario(id));
    Object.assign(state, { expanded: initialExpanded(scene), layers: initialLayers(scene), query: "", focus: null, selected: null, event: null, kinds: new Set(EVENT_KINDS), windowMin: null, tlAll: false });
    els.search.value = "";
    render();
  }
  function toggleLayer(layer) {
    if (state.layers.has(layer)) state.layers.delete(layer);
    else state.layers.add(layer);
    render();
  }
  function focusGroup(id) {
    state.focus = state.focus === id ? null : id;
    state.selected = null;
    render();
  }
  function toggleOpen(id, event) {
    event.stopPropagation();
    if (state.expanded.has(id)) state.expanded.delete(id);
    else state.expanded.add(id);
    if (state.focus === id && !state.expanded.has(id)) state.focus = null;
    render();
  }
  function selectNode(id, event) {
    event?.stopPropagation();
    state.selected = state.selected === id ? null : id;
    render();
  }
  function pickEvent(ev) {
    state.event = state.event === ev.index ? null : ev.index;
    if (state.event !== null) {
      state.focus = ev.group;
      state.selected = ev.node;
    }
    render();
  }

  function groupCard(group) {
    const tag = group.kind === "operator" ? "OP" : group.kind === "label" ? (group.unlabeled ? "—" : "LBL") : "NS";
    const talk = groupTalk(group.id, scene);
    const card = h("div", {
      className: `gv-group${group.kind === "label" ? " by-label" : ""}${group.unlabeled ? " unlabeled" : ""}${group.open ? " open" : ""}${group.dim ? " dim" : ""}${group.match ? " match" : ""}${group.neighbor ? " neighbor" : ""}${state.focus === group.id ? " focus" : ""}${talk.errors ? " talk-err" : talk.live ? " talk-live" : ""}`,
      dataset: { id: `g:${group.id}`, health: group.health || "ok" },
    });
    const head = h("button", { type: "button", className: "gv-ghead", title: state.focus === group.id ? "leave focus" : "focus: only this group and who it talks to", onclick: () => focusGroup(group.id) },
      h("i", { className: "gv-lamp", "aria-hidden": "true" }),
      h("b", { className: "gv-glabel", text: group.label }),
      h("small", { className: "gv-tag", text: tag, title: tag === "OP" ? BADGES.OP : tag === "NS" ? BADGES.NS : tag === "LBL" ? BADGES.LBL : "resources without the Group by label" }));
    const meta = h("span", { className: "gv-meta", text: [group.namespaces ? `${group.namespaces} ns` : "", group.crds ? `${group.crds} CRDs` : "", group.pods ? `${group.pods} pods` : ""].filter(Boolean).join(" · ") });
    const talkEl = h("span", { className: `gv-talk ${talk.errors ? "t-err" : talk.live ? "t-live" : "t-none"}`, title: "live links: measured traffic touching this group; config links are only declared", text: talk.text });
    const toggle = h("button", { type: "button", className: "gv-open", "aria-expanded": String(group.open), title: group.open ? "fold" : "open: its services, how they call each other, live or not", text: group.open ? "−" : "+", onclick: (ev) => toggleOpen(group.id, ev) });
    card.append(h("div", { className: "gv-gtop" }, head, h("span", { className: "gv-gsum" }, meta, talkEl), toggle));
    if (group.open) {
      const cols = layerNodes(group.nodes, scene.edges);
      const row = h("div", { className: "gv-layered" });
      cols.forEach((col, i) => {
        const colEl = h("div", { className: "gv-col" }, h("small", { className: "gv-colhead", text: i === 0 && col.every((n) => n.kind === "ingress") ? "ENTRY" : i === cols.length - 1 && col.every((n) => n.kind === "db" || n.kind === "cr") ? "DATA / RESOURCES" : `STEP ${i + (cols[0].every((n) => n.kind === "ingress") ? 0 : 1)}` }));
        for (const node of col) colEl.append(nodeCard(node));
        row.append(colEl);
      });
      card.append(row);
    }
    return card;
  }

  function nodeCard(node) {
    const t = nodeTraffic(node.id, scene.edges);
    const badge = KIND_TAG[node.kind] || "·";
    const pods = node.pods && typeof node.pods === "object" ? node.pods : null;
    return h("button", {
      type: "button",
      className: `gv-node gv-card k-${node.kind}${node.match ? " match" : ""}${state.selected === node.id ? " sel" : ""}${t.errors >= 1 ? " t-err" : t.talking ? " t-live" : " t-none"}`,
      dataset: { id: node.id },
      title: `${node.label} · ${KIND_NAME[node.kind] || node.kind} · ${node.ns}\n${t.talking ? `talking: ${t.live} live link${t.live === 1 ? "" : "s"}` : "not seen talking"} — click for its calls`,
      onclick: (ev) => selectNode(node.id, ev),
    },
      h("span", { className: "gv-crow" }, h("small", { className: `gv-ntag t-${badge}`, title: BADGES[badge] || node.kind, text: badge }), h("b", { className: "gv-cname", text: node.label })),
      h("span", { className: "gv-cmeta", text: [KIND_NAME[node.kind] || node.kind, node.ns, pods ? `${pods.ready}/${pods.total} ready` : ""].filter(Boolean).join(" · ") }),
      h("span", { className: "gv-crate", text: t.talking ? `${t.rps}/s${t.errors ? ` · ${t.errors}% err` : ""}` : "not seen talking" }));
  }

  function renderSide() {
    const node = state.selected && scene.nodes.find((n) => n.id === state.selected);
    els.side.hidden = !node;
    if (!node) return els.side.replaceChildren();
    const calls = callsOf(node.id, scene, state.layers);
    const list = (title, rows) => h("section", { className: "gv-calls" },
      h("h5", { text: `${title} · ${rows.length}` }),
      rows.length ? h("ul", {}, ...rows.map((r) => h("li", { className: `c-${r.status}`, title: STATUS_TEXT[r.status] },
        h("i", { className: "gv-cdot", "aria-hidden": "true" }),
        h("button", { type: "button", className: "gv-cpeer", text: r.label, title: `${r.ns} · select`, onclick: (ev) => selectNode(r.peer, ev) }),
        h("small", { className: "gv-ckind", text: r.kind }),
        h("span", { className: "gv-crate", text: rateText(r) })))) : h("p", { className: "gv-cnone", text: "none" }));
    const svcName = String(node.label || "").split(/[\s:]/)[0];
    els.side.replaceChildren(
      h("header", {}, h("small", { className: `gv-ntag t-${KIND_TAG[node.kind] || "x"}`, title: BADGES[KIND_TAG[node.kind]] || "", text: KIND_TAG[node.kind] || "·" }), h("b", { text: node.label }),
        h("button", { type: "button", className: "gv-btn gv-sclose", text: "×", title: "close (Esc)", "aria-label": "close", onclick: (ev) => selectNode(node.id, ev) })),
      h("p", { className: "gv-smeta", text: `${KIND_NAME[node.kind] || node.kind} · ${node.ns}` }),
      list("CALLED BY", calls.inbound),
      list("CALLS", calls.outbound),
      node.ns && /^[a-z0-9-]+$/.test(svcName) ? h("a", { className: "gv-inside", href: `#path?debug=${encodeURIComponent(`${svcName}.${node.ns}:`)}&inside=1`, text: "DEBUG FROM INSIDE ›", title: "SNIFF › FROM INSIDE: a short-lived debug pod checks DNS, TCP, HTTP, hops and NetworkPolicy to this Service" }) : null,
    );
  }

  function emptyScene() {
    return { id: "live", title: live.context || "cluster", note: "", bands: [{ id: "edge", label: "EDGE" }, { id: "apps", label: "APPS" }, { id: "platform", label: "PLATFORM" }], groups: [], nodes: [], edges: [], events: [], window: { start: "00:00", end: "00:30", incident: ["00:00", "00:00"] } };
  }
  // A LOG ERRORS link in live mode can arrive before the live graph has
  // loaded: keep it and apply it when the graph is there.
  let pendingFocus = null;
  function focusOn({ scenario = "", node = "", t = "", query = "" } = {}) {
    if (!els.stage) build();
    if (scenario && !live.on) pick(scenario);
    if (live.on && (live.loading || !scene || scene.id !== "live")) {
      pendingFocus = { scenario, node, t, query };
      if (!live.loading) loadLive();
      return false;
    }
    const hit = scene.nodes.find((x) => x.id === node);
    Object.assign(state, { focus: null, selected: null, event: null, query: "" });
    if (hit) {
      state.expanded.add(hit.group);
      state.focus = hit.group;
      state.selected = hit.id;
      const tl = timeline(scene).events;
      const at = t ? tl.filter((ev) => ev.node === hit.id || ev.group === hit.group).find((ev) => ev.t >= t) || tl.find((ev) => ev.node === hit.id) : null;
      if (at) state.event = at.index;
    } else if (query) state.query = query;
    els.search.value = state.query;
    render();
    return Boolean(hit);
  }
  async function loadLive(fresh = false) {
    if (!live.on || live.loading) return;
    live.loading = true;
    live.error = "";
    if (shown) render();
    try {
      const q = new URLSearchParams(live.context ? { context: live.context } : {});
      if (fresh) q.set("t", String(Date.now()));
      const body = await fetch(`/api/cluster/graph?${q}`).then((r) => r.json());
      if (body.error) {
        live.error = body.error;
        setScene(emptyScene());
      } else {
        const first = !scene || scene.id !== "live" || !scene.groups.length;
        setScene(body);
        loadTimeline();
        if (first) Object.assign(state, { expanded: initialExpanded(scene), layers: initialLayers(scene) });
      }
      live.at = Date.now();
    } catch (error) {
      live.error = error?.message || "the graph did not load";
    }
    live.loading = false;
    if (pendingFocus && scene?.id === "live") {
      const f = pendingFocus;
      pendingFocus = null;
      focusOn(f);
      return;
    }
    pendingFocus = null;
    if (shown) render();
  }
  function setLive(on, context = "") {
    const changed = on !== live.on || (on && context !== live.context);
    live.on = on;
    live.context = context;
    if (!changed) return;
    Object.assign(state, { query: "", focus: null, selected: null, event: null });
    tlData = null;
    if (on) {
      setScene(emptyScene());
      state.expanded = new Set();
      if (shown) loadLive();
    } else {
      setScene(graphScenario(state.scenario));
      state.expanded = initialExpanded(scene);
    }
    if (shown) render();
  }

  function render() {
    if (!els.stage) build();
    els.scen.hidden = live.on;
    els.liveBox.hidden = !live.on;
    els.proto.textContent = live.on ? "LIVE · READ-ONLY" : "SAMPLE · PROTOTYPE";
    els.liveNote.textContent = live.on ? (live.loading ? "reading…" : live.at ? `read ${new Date(live.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "") : "";
    view = visibleGraph(scene, state);
    for (const button of els.scen.children) button.setAttribute("aria-pressed", String(button.dataset.scenario === state.scenario));
    for (const button of els.layers.children) button.setAttribute("aria-pressed", String(state.layers.has(button.dataset.layer)));
    const stats = sceneStats(scene);
    els.stats.textContent = [
      scene.title,
      scene.note,
      `${stats.operators} operators · ${stats.namespaces} namespaces · ${stats.crds} CRDs · ${stats.pods} pods`,
      view.hidden ? `${view.edges.length} of ${view.total} links shown (errors first; focus a group for all)` : `${view.total} links`,
      state.query ? `${view.matches} groups match` : "",
    ].filter(Boolean).join("  ·  ");
    els.bands.replaceChildren(...view.bands.filter((band) => band.groups.length).map((band) =>
      h("section", { className: "gv-band", dataset: { band: band.id } }, h("h4", { className: "gv-blabel", text: `${band.label} · ${band.groups.length}` }), h("div", { className: "gv-grid" }, ...band.groups.map(groupCard)))));
    renderDetail();
    renderSide();
    renderTimeline();
    drawEdges();
  }

  function renderDetail() {
    const ev = state.event !== null ? timeline(tlScene()).events.find((x) => x.index === state.event) : null;
    if (state.selected) {
      const node = scene.nodes.find((n) => n.id === state.selected);
      const out = scene.edges.filter((e) => e.from === state.selected && state.layers.has(e.source));
      const inn = scene.edges.filter((e) => e.to === state.selected && state.layers.has(e.source));
      const label = (id) => scene.nodes.find((n) => n.id === id)?.label || id;
      const fmt = (e, other) => `${label(other)} ${e.kind}${e.rps ? ` ${e.rps}/s` : ""}${e.errors ? ` ${e.errors}% err` : ""} (${e.source})`;
      els.detail.textContent = `${ev ? `${ev.t} ${ev.text}  ▸  ` : ""}${node?.label} (${node?.ns}): its calls are listed on the right · Esc or × closes`;
    } else if (state.focus) {
      const group = scene.groups.find((g) => g.id === state.focus);
      els.detail.textContent = `FOCUS ${group?.label}: ${view.total} links to ${view.bands.flatMap((b) => b.groups).filter((g) => g.neighbor).length} groups · click a service for its calls · Esc leaves focus`;
    } else if (live.on && live.error) {
      els.detail.textContent = `The graph could not be read: ${live.error}`;
    } else if (live.on && !scene.groups.length) {
      els.detail.textContent = live.loading ? "Reading Services, workloads, Ingress/Routes, NetworkPolicies and owners (GETs only)…" : "Nothing in this context's namespaces yet.";
    } else {
      els.detail.textContent = "Click a group to focus it, + to open it, or an event below to jump to where it happened.";
    }
  }

  function renderTimeline() {
    const tl = timeline(tlScene(), tlOpts());
    const track = h("div", { className: "gv-track" });
    const [a, b] = tl.incident;
    if (b > a) track.append(h("span", { className: "gv-incident", style: `left:${a * 100}%;width:${(b - a) * 100}%`, title: "incident window" }));
    for (const ev of tl.shown) {
      track.append(h("button", { type: "button", className: `gv-tick e-${ev.kind}${state.event === ev.index ? " sel" : ""}`, style: `left:${ev.x * 100}%`, title: `${ev.t} ${ev.text}`, "aria-label": `${ev.t} ${EVENT_TAG[ev.kind]}: ${ev.text}`, onclick: () => pickEvent(ev) }));
    }
    const rows = h("ol", { className: "gv-events" });
    for (const ev of tl.shown) {
      rows.append(h("li", {}, h("button", { type: "button", className: `gv-ev e-${ev.kind}${state.event === ev.index ? " sel" : ""}`, dataset: { index: String(ev.index) }, onclick: () => pickEvent(ev) },
        h("time", { text: ev.t }), h("small", { className: "gv-etag", text: EVENT_TAG[ev.kind] }), h("span", { text: ev.text }))));
    }
    if (!tl.shown.length) rows.append(h("li", { className: "gv-noev", text: tl.events.length ? "no events match these filters" : live.on ? "no events in this window (Kubernetes keeps about an hour; the observe bundle keeps more)" : "no events" }));
    const kinds = h("div", { className: "gv-seg gv-kinds", role: "group", "aria-label": "event kinds" });
    for (const kind of EVENT_KINDS) {
      kinds.append(h("button", { type: "button", className: `gv-btn gv-kind e-${kind}`, "aria-pressed": String(state.kinds.has(kind)), dataset: { kind }, text: `${EVENT_TAG[kind]} ${tl.counts[kind]}`, onclick: () => {
        if (state.kinds.has(kind)) state.kinds.delete(kind);
        else state.kinds.add(kind);
        render();
      } }));
    }
    const fold = h("button", { type: "button", className: "gv-btn gv-tlfold", "aria-expanded": String(state.tlOpen), title: state.tlOpen ? "fold the timeline" : "open the timeline", text: state.tlOpen ? "▾" : "▸", onclick: () => ((state.tlOpen = !state.tlOpen), render()) });
    const head = h("div", { className: "gv-tlhead" }, fold, h("b", { text: "INCIDENT REVIEW" }), h("span", { text: `${tl.start} – ${tl.end}` }), kinds);
    if (live.on) {
      const win = h("div", { className: "gv-seg gv-window", role: "group", "aria-label": "window" });
      const cur = tlData?.windowMin || state.windowMin || 360;
      for (const [min, label] of [[60, "1H"], [360, "6H"], [1440, "24H"], [4320, "72H"]]) {
        win.append(h("button", { type: "button", className: "gv-btn", "aria-pressed": String(cur === min), text: label, onclick: () => ((state.windowMin = min), loadTimeline()) }));
      }
      head.append(win);
      if (tlData?.note) head.append(h("small", { className: `gv-tlsrc s-${tlData.source || "none"}`, text: tlData.note }));
    }
    if (state.focus) {
      const group = scene.groups.find((g) => g.id === state.focus);
      head.append(h("button", { type: "button", className: "gv-btn gv-follow", "aria-pressed": String(!state.tlAll), title: "the list follows the focused group", text: state.tlAll ? "ALL GROUPS" : `ONLY ${group?.label || state.focus}`, onclick: () => ((state.tlAll = !state.tlAll), render()) }));
    }
    head.append(h("small", { className: "gv-tlkeys", text: "← → step through events" }));
    els.tl.classList.toggle("folded", !state.tlOpen);
    els.tl.replaceChildren(head, ...(state.tlOpen ? [h("div", { className: "gv-axis" }, h("span", { text: tl.start }), track, h("span", { text: tl.end })), rows] : []));
  }

  // ← / → walk the kept events (graph focus follows each one).
  function stepTimeline(dir) {
    const next = stepEvent(timeline(tlScene(), tlOpts()), state.event, dir);
    if (!next) return;
    state.event = next.index;
    state.focus = next.group;
    state.selected = next.node;
    render();
    els.tl.querySelector(`.gv-ev[data-index="${next.index}"]`)?.scrollIntoView?.({ block: "nearest" });
  }

  function groupOfId(id) {
    return scene.nodes.find((n) => n.id === id)?.group;
  }
  function sideCurve(a, b, ap, bp) {
    const spread = (p, h) => (p && p.n > 1 ? (h * (p.i + 1)) / (p.n + 1) : h / 2);
    if (b.x >= a.x + a.w - 1) {
      const x1 = a.x + a.w;
      const y1 = a.y + spread(ap, a.h);
      const x2 = b.x - 2;
      const y2 = b.y + spread(bp, b.h);
      const dx = Math.max(24, (x2 - x1) / 2);
      return { d: `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}` };
    }
    // same column or backwards: out of the bottom, back in from below
    const x1 = a.x + a.w / 2;
    const y1 = a.y + a.h;
    const x2 = b.x + b.w / 2;
    const y2 = b.y + b.h + 2;
    const low = Math.max(y1, y2) + 26;
    return { d: `M${x1},${y1} C${x1},${low} ${x2},${low} ${x2},${y2}` };
  }

  function drawEdges() {
    const svg = els.svg;
    if (!svg || !view) return;
    const box = els.stage.getBoundingClientRect();
    svg.setAttribute("width", String(els.stage.scrollWidth));
    svg.setAttribute("height", String(els.stage.scrollHeight));
    const marker = `<defs><marker id="gv-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="10" markerHeight="10" markerUnits="userSpaceOnUse" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" class="gv-arrowhead"/></marker></defs>`;
    const at = new Map();
    for (const el of els.stage.querySelectorAll("[data-id]")) {
      const r = el.getBoundingClientRect();
      at.set(el.dataset.id, { x: r.left - box.left + els.stage.scrollLeft, y: r.top - box.top + els.stage.scrollTop, w: r.width, h: r.height });
    }
    const paths = [];
    const badges = [];
    const hot = state.selected;
    // Orthogonal routes through the gaps (graph-route.js); every card and
    // chip is an obstacle, so lines no longer cross cards or labels.
    const obstacles = [...at.values()];
    const lanes = new Map();
    // Ports: the edges at one box are spread across its width, ordered by
    // where the other end is (left to right), so fan-in does not bunch.
    const ports = new Map();
    const addPort = (id, other, key) => {
      if (!ports.has(id)) ports.set(id, []);
      ports.get(id).push({ key, x: at.get(other)?.x ?? 0 });
    };
    for (const edge of view.edges) {
      if (!at.get(edge.from) || !at.get(edge.to)) continue;
      addPort(edge.from, edge.to, `${edge.from}>${edge.to}`);
      addPort(edge.to, edge.from, `${edge.from}>${edge.to}`);
    }
    const portOf = new Map();
    for (const [id, list] of ports) {
      list.sort((p, q) => p.x - q.x);
      list.forEach((p, i) => portOf.set(`${id}|${p.key}`, { i, n: list.length }));
    }
    for (const edge of view.edges) {
      const a = at.get(edge.from);
      const b = at.get(edge.to);
      if (!a || !b) continue;
      const key = `${edge.from}>${edge.to}`;
      // Inside one opened group (layered columns): left to right, side to
      // side, a smooth curve; backwards calls loop under the cards.
      const rowOf = (id) => els.stage.querySelector(`[data-id="${CSS.escape(id)}"]`)?.closest(".gv-layered");
      const rowA = rowOf(edge.from);
      const sameRow = !!rowA && rowA === rowOf(edge.to);
      const { d } = sameRow ? sideCurve(a, b, portOf.get(`${edge.from}|${key}`), portOf.get(`${edge.to}|${key}`)) : routeEdge(a, b, obstacles, { gap: 12, lanes, aPort: portOf.get(`${edge.from}|${key}`), bPort: portOf.get(`${edge.to}|${key}`) });
      const src = edge.sources.includes("trace") ? "trace" : edge.sources.includes("flow") ? "flow" : edge.sources[0];
      const touch = hot && (edge.from === hot || edge.to === hot);
      const st = edgeStatus(edge);
      const inner = !edge.from.startsWith("g:") && !edge.to.startsWith("g:");
      const cls = `gv-edge s-${src} st-${st}${inner ? " inner" : ""}${edge.quiet ? " quiet" : ""}${edge.kinds.includes("owns") ? " owns" : ""}${edge.errors >= 1 ? " err" : ""}${touch ? " hot" : ""}${hot && !touch ? " faint" : ""}`;
      const width = (st === "live" || st === "error" ? Math.min(6, 2.5 + Math.log10(1 + edge.rps) * 1.2) : inner ? 2 : 1.5).toFixed(2);
      const name = (id) => scene.nodes.find((n) => n.id === id)?.label || scene.groups.find((g) => `g:${g.id}` === id)?.label || id.replace(/^g:/, "");
      const title = `${name(edge.from)} → ${name(edge.to)} · ${STATUS_TEXT[st]}${edge.rps && st !== "config" ? ` · ${edge.rps}/s` : ""}${edge.errors ? ` · ${edge.errors}% errors` : ""} · ${edge.kinds.join("/")} · from ${edge.sources.map((x) => ({ trace: "Beyla/OTel", flow: "flow logs", static: "config", owner: "ownerReferences" })[x] || x).join(" + ")}${edge.count > 1 ? ` · ${edge.count} links` : ""}`;
      paths.push(`<path class="${cls}" d="${d}" stroke-width="${width}" marker-end="url(#gv-arrow)" data-src="${src}"><title>${title.replace(/[<&]/g, "")}</title></path>`);
      if ((st === "live" || st === "error") && edgeBadge(edge)) badges.push({ i: paths.length - 1, text: edgeBadge(edge), rps: edge.rps, touch, err: edge.errors >= 1 });
    }
    svg.innerHTML = marker + paths.join("");
    // Badges at each live edge's midpoint (needs SVG geometry; skipped without it).
    const keep = badges.length <= BADGE_MAX ? badges : badges.filter((b) => b.touch).concat([...badges].sort((p, q) => q.rps - p.rps).slice(0, BADGE_MAX)).filter((b, i, all) => all.indexOf(b) === i);
    const drawn = svg.querySelectorAll("path.gv-edge");
    const out = [];
    for (const b of keep) {
      const path = drawn[b.i];
      if (!path?.getTotalLength) continue;
      let pt;
      try {
        pt = path.getPointAtLength(path.getTotalLength() / 2);
      } catch {
        continue;
      }
      const w = Math.round(b.text.length * 6.4 + 12);
      const safe = b.text.replace(/[<&]/g, "");
      out.push(`<g class="gv-badge${b.err ? " err" : ""}${hot && !b.touch ? " faint" : ""}" transform="translate(${Math.round(pt.x + 6)},${Math.round(pt.y - 8)})"><rect width="${w}" height="15" rx="2"/><text x="5" y="11">${safe}</text></g>`);
    }
    if (out.length) svg.insertAdjacentHTML("beforeend", out.join(""));
  }

  root.addEventListener("keydown", (event) => {
    if ((event.key === "ArrowRight" || event.key === "ArrowLeft") && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || "")) {
      event.preventDefault();
      stepTimeline(event.key === "ArrowRight" ? 1 : -1);
      return;
    }
    if (event.key !== "Escape") return;
    if (state.selected || state.focus || state.event !== null) {
      Object.assign(state, { selected: null, focus: null, event: null });
      render();
    }
  });

  return {
    show() {
      shown = true;
      root.hidden = false;
      render();
      if (live.on && !live.at) loadLive();
    },
    hide() {
      shown = false;
      root.hidden = true;
    },
    // LOG ERRORS (log-errors-view.js): focus a service and, when given, the
    // timeline minute (HH:MM). Unknown node: falls back to a search for its name.
    focusOn(args = {}) {
      return focusOn(args);
    },
    // for tests and screenshots
    state,
    setLive,
    loadLive,
    pick,
    setGroupBy,
    render,
    stepTimeline,
    loadTimeline,
  };
}
