// SERVICES prototype view (SAMPLE only): who talks to whom in a cluster,
// grouped by operator or namespace, with an incident timeline under it.
// Plan: docs/plan-modules-and-service-graph.md. Data: graph-sample.js;
// what is shown: graph-model.js. HTML cards in bands, edges in one SVG
// overlay measured from the cards, so both themes style it with CSS.

import { graphScenario } from "./graph-sample.js";
import { routeEdge } from "./graph-route.js";
import { LAYERS, initialExpanded, initialLayers, sceneStats, timeline, visibleGraph } from "./graph-model.js";

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
    Object.assign(state, { expanded: initialExpanded(scene), layers: initialLayers(scene), query: "", focus: null, selected: null, event: null });
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
    const ev = state.event !== null ? timeline(scene).events[state.event] : null;
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
    const tl = timeline(scene);
    const track = h("div", { className: "gv-track" });
    const [a, b] = tl.incident;
    track.append(h("span", { className: "gv-incident", style: `left:${a * 100}%;width:${(b - a) * 100}%`, title: "incident window" }));
    for (const ev of tl.events) {
      track.append(h("button", { type: "button", className: `gv-tick e-${ev.kind}${state.event === ev.index ? " sel" : ""}`, style: `left:${ev.x * 100}%`, title: `${ev.t} ${ev.text}`, "aria-label": `${ev.t} ${EVENT_TAG[ev.kind]}: ${ev.text}`, onclick: () => pickEvent(ev) }));
    }
    const rows = h("ol", { className: "gv-events" });
    for (const ev of tl.events) {
      rows.append(h("li", {}, h("button", { type: "button", className: `gv-ev e-${ev.kind}${state.event === ev.index ? " sel" : ""}`, onclick: () => pickEvent(ev) },
        h("time", { text: ev.t }), h("small", { className: "gv-etag", text: EVENT_TAG[ev.kind] }), h("span", { text: ev.text }))));
    }
    els.tl.replaceChildren(
      h("div", { className: "gv-tlhead" }, h("b", { text: "INCIDENT REVIEW" }), h("span", { text: `${tl.start} – ${tl.end} · events, restarts, rollouts, alarms` })),
      h("div", { className: "gv-axis" }, h("span", { text: tl.start }), track, h("span", { text: tl.end })),
      rows,
    );
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
    for (const edge of view.edges) {
      const a = at.get(edge.from);
      const b = at.get(edge.to);
      if (!a || !b) continue;
      const { d } = routeEdge(a, b, obstacles, { gap: 12, lanes });
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
    // for tests and screenshots
    state,
    setLive,
    loadLive,
    pick,
    render,
  };
}
