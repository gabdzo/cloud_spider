// SERVICES prototype view (SAMPLE only): who talks to whom in a cluster,
// grouped by operator or namespace, with an incident timeline under it.
// Plan: docs/plan-modules-and-service-graph.md. Data: graph-sample.js;
// what is shown: graph-model.js. HTML cards in bands, edges in one SVG
// overlay measured from the cards, so both themes style it with CSS.

import { graphScenario } from "./graph-sample.js";
import { routeEdge } from "./graph-route.js";
import { EVENT_KINDS, LAYERS, initialExpanded, initialLayers, sceneStats, stepEvent, timeline, visibleGraph } from "./graph-model.js";

const SVG = "http://www.w3.org/2000/svg";
const LAYER_LABEL = { static: "STATIC", flow: "FLOWS", trace: "TRACES", owner: "OWNERS" };
const LAYER_HINT = {
  static: "Services, Endpoints, Ingress, NetworkPolicies: what may talk",
  flow: "VPC CNI flow logs or Hubble: what did talk (L3/L4)",
  trace: "OpenTelemetry traces: which API called which (L7, with errors)",
  owner: "ownerReferences: operator → custom resources → what they own",
};
const KIND_TAG = { operator: "OP", webhook: "HOOK", service: "SVC", db: "DB", cr: "CR", ingress: "ING", external: "API", workload: "WL", namespace: "NS" };
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
  let scene = graphScenario(state.scenario);
  state.expanded = initialExpanded(scene);
  let view = null;
  let shown = false;
  // Incident review filters: event kinds, the window (live only), and
  // whether the list follows the focused group (tlAll: every group).
  Object.assign(state, { kinds: new Set(EVENT_KINDS), windowMin: null, tlAll: false, tlOpen: true });
  // Live: the events come from /api/cluster/timeline for the picked window
  // (the observe bundle's Loki, else the API server); the server trims.
  let tlData = null;
  const tlScene = () => (live.on && tlData?.events ? { ...scene, events: tlData.events, window: { ...scene.window, startAt: tlData.window?.startAt, endAt: tlData.window?.endAt } } : scene);
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
    els.layers = h("div", { className: "gv-seg gv-layers", role: "group", "aria-label": "data sources" });
    for (const layer of LAYERS) els.layers.append(h("button", { type: "button", className: `gv-btn gv-layer gv-l-${layer}`, dataset: { layer }, title: LAYER_HINT[layer], text: LAYER_LABEL[layer], onclick: () => toggleLayer(layer) }));
    els.liveBox = h("div", { className: "gv-seg gv-live", hidden: true });
    els.refresh = h("button", { type: "button", className: "gv-btn", text: "REFRESH", title: "read the cluster again (GETs only)", onclick: () => loadLive(true) });
    els.liveNote = h("span", { className: "gv-livenote" });
    els.liveBox.append(els.liveNote, els.refresh);
    els.fold = h("button", { type: "button", className: "gv-btn", text: "FOLD ALL", title: "close every group", onclick: () => ((state.expanded = new Set()), (state.focus = null), render()) });
    els.stats = h("p", { className: "gv-stats" });
    els.detail = h("p", { className: "gv-detail", "aria-live": "polite" });
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
        els.scen, els.liveBox, els.search, els.layers, els.fold),
      els.stats,
      els.detail,
      els.stage,
      els.tl,
    );
    resize?.observe(els.stage);
  }

  function pick(id) {
    if (state.scenario === id) return;
    state.scenario = id;
    scene = graphScenario(id);
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
    const tag = group.kind === "operator" ? "OP" : "NS";
    const card = h("div", {
      className: `gv-group${group.open ? " open" : ""}${group.dim ? " dim" : ""}${group.match ? " match" : ""}${group.neighbor ? " neighbor" : ""}${state.focus === group.id ? " focus" : ""}`,
      dataset: { id: `g:${group.id}`, health: group.health || "ok" },
    });
    const head = h("button", { type: "button", className: "gv-ghead", title: state.focus === group.id ? "leave focus" : "focus: only this group and who it talks to", onclick: () => focusGroup(group.id) },
      h("i", { className: "gv-lamp", "aria-hidden": "true" }),
      h("b", { className: "gv-glabel", text: group.label }),
      h("small", { className: "gv-tag", text: tag }));
    const meta = h("span", { className: "gv-meta", text: [group.namespaces ? `${group.namespaces} ns` : "", group.crds ? `${group.crds} CRDs` : "", group.pods ? `${group.pods} pods` : ""].filter(Boolean).join(" · ") });
    const toggle = h("button", { type: "button", className: "gv-open", "aria-expanded": String(group.open), title: group.open ? "fold" : "open: its services, webhooks and CRs", text: group.open ? "−" : "+", onclick: (ev) => toggleOpen(group.id, ev) });
    card.append(h("div", { className: "gv-gtop" }, head, toggle), meta);
    if (group.open) {
      const list = h("div", { className: "gv-nodes" });
      for (const node of group.nodes) {
        list.append(h("button", {
          type: "button",
          className: `gv-node k-${node.kind}${node.match ? " match" : ""}${state.selected === node.id ? " sel" : ""}`,
          dataset: { id: node.id },
          title: `${node.label}\n${node.ns}`,
          onclick: (ev) => selectNode(node.id, ev),
        }, h("small", { className: "gv-ntag", text: KIND_TAG[node.kind] || "·" }), h("span", { text: node.label })));
      }
      card.append(list);
    }
    return card;
  }

  function emptyScene() {
    return { id: "live", title: live.context || "cluster", note: "", bands: [{ id: "edge", label: "EDGE" }, { id: "apps", label: "APPS" }, { id: "platform", label: "PLATFORM" }], groups: [], nodes: [], edges: [], events: [], window: { start: "00:00", end: "00:30", incident: ["00:00", "00:00"] } };
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
        scene = emptyScene();
      } else {
        const first = !scene || scene.id !== "live" || !scene.groups.length;
        scene = body;
        loadTimeline();
        if (first) Object.assign(state, { expanded: initialExpanded(scene), layers: initialLayers(scene) });
      }
      live.at = Date.now();
    } catch (error) {
      live.error = error?.message || "the graph did not load";
    }
    live.loading = false;
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
      scene = emptyScene();
      state.expanded = new Set();
      if (shown) loadLive();
    } else {
      scene = graphScenario(state.scenario);
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
      els.detail.textContent = `${ev ? `${ev.t} ${ev.text}  ▸  ` : ""}${node?.label} (${node?.ns}) · calls ${out.map((e) => fmt(e, e.to)).join(", ") || "nothing"} · called by ${inn.map((e) => fmt(e, e.from)).join(", ") || "nothing"}`;
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

  function drawEdges() {
    const svg = els.svg;
    if (!svg || !view) return;
    const box = els.stage.getBoundingClientRect();
    svg.setAttribute("width", String(els.stage.scrollWidth));
    svg.setAttribute("height", String(els.stage.scrollHeight));
    const marker = `<defs><marker id="gv-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L8,4 L0,8 z" class="gv-arrowhead"/></marker></defs>`;
    const at = new Map();
    for (const el of els.stage.querySelectorAll("[data-id]")) {
      const r = el.getBoundingClientRect();
      at.set(el.dataset.id, { x: r.left - box.left + els.stage.scrollLeft, y: r.top - box.top + els.stage.scrollTop, w: r.width, h: r.height });
    }
    const paths = [];
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
      const { d } = routeEdge(a, b, obstacles, { gap: 12, lanes, aPort: portOf.get(`${edge.from}|${key}`), bPort: portOf.get(`${edge.to}|${key}`) });
      const src = edge.sources.includes("trace") ? "trace" : edge.sources.includes("flow") ? "flow" : edge.sources[0];
      const touch = hot && (edge.from === hot || edge.to === hot);
      const cls = `gv-edge s-${src}${edge.quiet ? " quiet" : ""}${edge.kinds.includes("owns") ? " owns" : ""}${edge.errors >= 1 ? " err" : ""}${touch ? " hot" : ""}${hot && !touch ? " faint" : ""}`;
      const width = Math.min(3.2, 1 + Math.log10(1 + edge.rps) * 0.9).toFixed(2);
      const title = `${edge.from.replace(/^g:/, "")} → ${edge.to.replace(/^g:/, "")}: ${edge.count} link${edge.count > 1 ? "s" : ""} · ${edge.kinds.join("/")} · ${edge.sources.join("+")}${edge.rps ? ` · ${edge.rps}/s` : ""}${edge.errors ? ` · ${edge.errors}% errors` : ""}`;
      paths.push(`<path class="${cls}" d="${d}" stroke-width="${width}" marker-end="url(#gv-arrow)"><title>${title.replace(/[<&]/g, "")}</title></path>`);
    }
    svg.innerHTML = marker + paths.join("");
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
    focusOn({ scenario = "", node = "", t = "", query = "" } = {}) {
      if (!els.stage) build();
      if (scenario && !live.on) pick(scenario);
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
    },
    // for tests and screenshots
    state,
    setLive,
    loadLive,
    pick,
    render,
    stepTimeline,
    loadTimeline,
  };
}
