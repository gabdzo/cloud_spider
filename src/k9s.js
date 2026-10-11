// The K9S window: a keyboard-driven, read-only resource table in the
// Cluster view, after k9s. Views :pods :deploy :svc :ing :events :nodes,
// "/" filters, j/k or arrows move, l logs (p: previous), d describe,
// y YAML (redacted), Enter opens the pod deep-inspect, Esc goes back.
// There is no key that writes: no exec, port-forward, delete, scale or
// edit, and the server side only GETs (kube-table.js).
//
// Keys are handled on the window itself and stop there, so the map's
// keyboard navigation never sees them while the window has focus.

export const K9S_KEYS = [
  [":", "view"],
  ["/", "filter"],
  ["j/k ↑↓", "move"],
  ["enter", "inspect"],
  ["l", "logs"],
  ["d", "describe"],
  ["y", "yaml"],
  ["n", "namespace"],
  ["esc", "back"],
];
export const K9S_VIEW_IDS = ["pods", "deploy", "svc", "ing", "events", "nodes"];
const REFRESH_MS = 5_000;

function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "className") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v != null && v !== false) node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) if (kid != null) node.append(kid);
  return node;
}

// Client-side filter, like k9s: every word must appear in some cell.
export function filterRows(rows, text) {
  const words = String(text || "").toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return rows;
  return rows.filter((r) => words.every((w) => r.cells.some((c) => String(c).toLowerCase().includes(w))));
}

export function createK9s({ root, getJson, context, sample, onInspect, onToggle }) {
  const state = {
    open: false,
    view: "pods",
    ns: "",
    filter: "",
    data: null,
    error: "",
    cursor: 0,
    mode: "table", // table | logs | describe | yaml
    detail: null,
    prompt: null, // { kind: "cmd" | "filter", value }
    message: "",
    timer: null,
    ticket: 0,
  };

  const head = h("div", { className: "k9-head" });
  const body = h("div", { className: "k9-body", role: "grid" });
  const foot = h("div", { className: "k9-foot" });
  root.replaceChildren(head, body, foot);
  root.tabIndex = 0;

  function rows() {
    return filterRows(state.data?.rows || [], state.filter);
  }

  async function load({ quiet = false } = {}) {
    const ticket = ++state.ticket;
    const q = new URLSearchParams({ view: state.view, context: context() || "", ns: state.ns || "" });
    if (sample()) q.set("sample", "1");
    const body = await getJson(`/api/kube/table?${q}`).catch((e) => ({ error: e?.message || "the table did not load" }));
    if (ticket !== state.ticket || !state.open) return;
    if (body.error) {
      state.error = body.error;
      if (!quiet) state.data = null;
    } else {
      state.error = "";
      const keep = rows()[state.cursor]?.id;
      state.data = body;
      state.ns = body.ns;
      const at = keep ? rows().findIndex((r) => r.id === keep) : -1;
      state.cursor = Math.max(0, Math.min(at >= 0 ? at : state.cursor, rows().length - 1));
    }
    render();
  }

  function schedule() {
    clearInterval(state.timer);
    // The server answers from the shared snapshot: this adds no kube load.
    state.timer = setInterval(() => {
      if (state.open && state.mode === "table" && !document.hidden) load({ quiet: true });
    }, REFRESH_MS);
  }

  function open() {
    if (state.open) return;
    state.open = true;
    root.hidden = false;
    state.mode = "table";
    render();
    load();
    schedule();
    root.focus({ preventScroll: true });
    onToggle?.(true);
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    clearInterval(state.timer);
    root.hidden = true;
    state.prompt = null;
    onToggle?.(false);
  }

  function setView(id) {
    state.view = id;
    state.cursor = 0;
    state.mode = "table";
    state.filter = "";
    state.message = "";
    load();
  }

  function command(text) {
    const word = String(text || "").trim().replace(/^:/, "").toLowerCase();
    if (!word) return;
    if (["q", "quit", "q!"].includes(word)) return close();
    const alias = { po: "pods", pod: "pods", pods: "pods", deploy: "deploy", deployments: "deploy", deployment: "deploy", dp: "deploy", svc: "svc", service: "svc", services: "svc", ing: "ing", ingress: "ing", ingresses: "ing", ev: "events", event: "events", events: "events", no: "nodes", node: "nodes", nodes: "nodes", ns: "ns" }[word];
    if (alias === "ns") return cycleNs(1);
    if (!alias) {
      state.message = `no view "${word.slice(0, 20)}": :pods :deploy :svc :ing :events${state.data?.clusterWide ? " :nodes" : ""}`;
      return render();
    }
    if (alias === "nodes" && state.data && !state.data.clusterWide) {
      state.message = "nodes are cluster-scoped: this context reads only its namespaces";
      return render();
    }
    setView(alias);
  }

  function cycleNs(step) {
    const list = ["*", ...(state.data?.namespaces || [])];
    if (list.length <= 2 && !state.data?.clusterWide) {
      state.message = `this context reads ${list[1] || "no namespace"} only`;
      return render();
    }
    const at = Math.max(0, list.indexOf(state.ns || "*"));
    state.ns = list[(at + step + list.length) % list.length];
    state.cursor = 0;
    load();
  }

  const current = () => rows()[state.cursor] || null;

  async function showDetail(kind) {
    const row = current();
    if (!row) return;
    const view = state.data?.view;
    if (kind === "logs" && view !== "pods") {
      state.message = "logs are for pods: :pods";
      return render();
    }
    if (view === "events") {
      state.message = "events have no describe or YAML of their own";
      return render();
    }
    state.mode = kind;
    state.detail = { row, text: "reading…", container: row.containers?.[0] || "", previous: false };
    render();
    const ticket = ++state.ticket;
    let text;
    if (kind === "logs") {
      const q = new URLSearchParams({ ns: row.ns, name: row.name, container: state.detail.container, context: context() || "", tail: "300" });
      if (state.detail.previous) q.set("previous", "1");
      if (sample()) q.set("sample", "1");
      const got = await getJson(`/api/cluster/pod?${q}`).catch((e) => ({ error: e?.message }));
      text = got.error || [...(got.lines || []), ...(got.logNote ? [`— ${got.logNote}`] : []), ...(!got.lines?.length && !got.logNote ? ["— no log lines"] : [])].join("\n");
    } else {
      const q = new URLSearchParams({ view, ns: row.ns || "", name: row.name, context: context() || "" });
      if (sample()) q.set("sample", "1");
      const got = await getJson(`/api/kube/describe?${q}`).catch((e) => ({ error: e?.message }));
      text = got.error || (kind === "yaml" ? got.yaml : got.text) || "";
    }
    if (ticket !== state.ticket || state.mode !== kind) return;
    state.detail.text = text;
    render();
  }

  async function relog(change) {
    change(state.detail);
    state.mode = "logs";
    const row = state.detail.row;
    state.detail.text = "reading…";
    render();
    const ticket = ++state.ticket;
    const q = new URLSearchParams({ ns: row.ns, name: row.name, container: state.detail.container, context: context() || "", tail: "300" });
    if (state.detail.previous) q.set("previous", "1");
    if (sample()) q.set("sample", "1");
    const got = await getJson(`/api/cluster/pod?${q}`).catch((e) => ({ error: e?.message }));
    if (ticket !== state.ticket) return;
    state.detail.text = got.error || [...(got.lines || []), ...(got.logNote ? [`— ${got.logNote}`] : []), ...(!got.lines?.length && !got.logNote ? ["— no log lines"] : [])].join("\n");
    render();
  }

  function move(step) {
    const n = rows().length;
    if (!n) return;
    state.cursor = Math.max(0, Math.min(n - 1, state.cursor + step));
    render();
  }

  function onKey(event) {
    if (!state.open) return;
    // Everything typed in the window stays in the window.
    event.stopPropagation();
    if (event.target?.classList?.contains("k9-input")) return;
    const k = event.key;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    let used = true;
    if (state.mode !== "table") {
      if (k === "Escape" || k === "q") {
        state.mode = "table";
        render();
      } else if (state.mode === "logs" && k === "p") relog((d) => { d.previous = !d.previous; });
      else if (state.mode === "logs" && k === "c" && state.detail.row.containers?.length > 1) relog((d) => { const list = d.row.containers; d.container = list[(list.indexOf(d.container) + 1) % list.length]; });
      else if (k === "j" || k === "ArrowDown") body.scrollTop += 40;
      else if (k === "k" || k === "ArrowUp") body.scrollTop -= 40;
      else if (k === "PageDown" || k === " ") body.scrollTop += body.clientHeight - 40;
      else if (k === "PageUp") body.scrollTop -= body.clientHeight - 40;
      else if (k === "d" || k === "y" || k === "l") showDetail(k === "d" ? "describe" : k === "y" ? "yaml" : "logs");
      else used = false;
    } else if (k === ":" || k === "/") {
      state.prompt = { kind: k === ":" ? "cmd" : "filter", value: k === "/" ? state.filter : "" };
      render();
    } else if (k === "j" || k === "ArrowDown") move(1);
    else if (k === "k" || k === "ArrowUp") move(-1);
    else if (k === "g" || k === "Home") move(-1e6);
    else if (k === "G" || k === "End") move(1e6);
    else if (k === "PageDown") move(10);
    else if (k === "PageUp") move(-10);
    else if (k === "l") showDetail("logs");
    else if (k === "d") showDetail("describe");
    else if (k === "y") showDetail("yaml");
    else if (k === "n") cycleNs(event.shiftKey ? -1 : 1);
    else if (k === "N") cycleNs(-1);
    else if (k === "Enter") {
      const row = current();
      if (row && state.data?.view === "pods") onInspect?.(row);
      else state.message = row ? "Enter inspects pods: try d (describe) or y (YAML)" : "";
      render();
    } else if (k === "Escape") {
      if (state.filter) {
        state.filter = "";
        state.cursor = 0;
        render();
      } else close();
    } else used = false;
    if (used) event.preventDefault();
  }
  root.addEventListener("keydown", onKey);

  function promptInput() {
    const input = h("input", { className: "k9-input", type: "text", "aria-label": state.prompt.kind === "cmd" ? "view command" : "filter", spellcheck: "false", autocomplete: "off" });
    input.value = state.prompt.value;
    input.addEventListener("input", () => {
      state.prompt.value = input.value;
      if (state.prompt.kind === "filter") {
        state.filter = input.value;
        state.cursor = 0;
        renderBody();
        renderFoot();
      }
    });
    input.addEventListener("keydown", (event) => {
      event.stopPropagation();
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault();
        const { kind, value } = state.prompt;
        state.prompt = null;
        if (event.key === "Escape" && kind === "filter") state.filter = "";
        render();
        root.focus({ preventScroll: true });
        if (event.key === "Enter" && kind === "cmd") command(value);
      }
    });
    queueMicrotask(() => input.focus());
    return h("span", { className: "k9-prompt" }, h("b", { text: state.prompt.kind === "cmd" ? ":" : "/" }), input);
  }

  function renderHead() {
    const d = state.data;
    const tabs = K9S_VIEW_IDS.filter((id) => id !== "nodes" || !d || d.clusterWide).map((id) =>
      h("button", { type: "button", className: "k9-tab", "aria-pressed": String(id === state.view), onclick: () => setView(id) }, `:${id}`),
    );
    const nsSel = h("select", { className: "k9-ns", "aria-label": "namespace", onchange: (e) => { state.ns = e.target.value; state.cursor = 0; load(); } });
    for (const ns of ["*", ...(d?.namespaces || [])]) nsSel.append(h("option", { value: ns, text: ns === "*" ? "all" : ns }));
    nsSel.value = state.ns || "*";
    head.replaceChildren(...[
      h("span", { className: "k9-plate" }, h("b", { text: "K9S" }), h("i", { text: "read-only" })),
      h("span", { className: "k9-ctx", text: d?.label || context() || "" }),
      h("label", { className: "k9-nslabel" }, "ns ", nsSel),
      h("span", { className: "k9-tabs" }, tabs),
      state.prompt ? promptInput() : state.filter ? h("span", { className: "k9-filter", text: `/${state.filter}` }) : null,
      h("span", { className: "k9-count", text: d ? `${d.title}(${d.ns === "*" ? "all" : d.ns})[${rows().length}${state.filter ? `/${d.rows.length}` : ""}]` : "" }),
      h("button", { type: "button", className: "k9-close", "aria-label": "close the K9S window", onclick: close }, "×"),
    ].filter(Boolean));
  }

  function renderBody() {
    if (state.mode !== "table") {
      const d = state.detail;
      const what = state.mode === "logs" ? `LOGS ${d.row.ns}/${d.row.name}${d.container ? ` [${d.container}]` : ""}${d.previous ? " (previous)" : ""}` : `${state.mode === "yaml" ? "YAML" : "DESCRIBE"} ${d.row.ns ? `${d.row.ns}/` : ""}${d.row.name}`;
      body.replaceChildren(h("div", { className: "k9-sub", text: what }), h("pre", { className: `k9-pre k9-${state.mode}`, text: d.text }));
      return;
    }
    if (state.error && !state.data) {
      body.replaceChildren(h("p", { className: "k9-error", text: state.error }));
      return;
    }
    if (!state.data) {
      body.replaceChildren(h("p", { className: "k9-dim", text: "reading…" }));
      return;
    }
    const list = rows();
    const table = h("table", { className: "k9-table" });
    table.append(h("thead", {}, h("tr", {}, state.data.columns.map((c) => h("th", { text: c })))));
    const tb = h("tbody");
    list.forEach((r, i) => {
      const tr = h("tr", { className: `k9-${r.status}${i === state.cursor ? " k9-on" : ""}`, "aria-selected": String(i === state.cursor), onclick: () => { state.cursor = i; render(); root.focus({ preventScroll: true }); }, ondblclick: () => { if (state.data.view === "pods") onInspect?.(r); } });
      for (const c of r.cells) tr.append(h("td", { text: c }));
      tb.append(tr);
    });
    table.append(tb);
    body.replaceChildren(table, ...(list.length ? [] : [h("p", { className: "k9-dim", text: state.filter ? "nothing matches the filter" : "nothing here" })]));
    const on = tb.children[state.cursor];
    if (on) {
      const top = on.offsetTop - 26;
      if (top < body.scrollTop) body.scrollTop = top;
      else if (on.offsetTop + on.offsetHeight > body.scrollTop + body.clientHeight) body.scrollTop = on.offsetTop + on.offsetHeight - body.clientHeight;
    }
  }

  function renderFoot() {
    const keys = state.mode === "logs" ? [["p", "previous"], ["c", "container"], ["j/k", "scroll"], ["d", "describe"], ["y", "yaml"], ["esc", "back"]] : state.mode !== "table" ? [["j/k", "scroll"], ["l", "logs"], ["d", "describe"], ["y", "yaml"], ["esc", "back"]] : K9S_KEYS;
    foot.replaceChildren(
      ...keys.map(([k, what]) => h("span", { className: "k9-key" }, h("kbd", { text: k }), what)),
      h("span", { className: `k9-msg${state.error ? " k9-bad" : ""}`, text: state.message || (state.error && state.data ? `last refresh failed: ${state.error}` : state.data?.note || "") }),
    );
  }

  function render() {
    if (!state.open) return;
    renderHead();
    renderBody();
    renderFoot();
  }

  return {
    open,
    close,
    toggle() {
      if (state.open) close();
      else open();
    },
    isOpen: () => state.open,
    focus: () => root.focus({ preventScroll: true }),
    // A new context: start over on its first namespace.
    reset() {
      state.ns = "";
      state.data = null;
      state.cursor = 0;
      state.mode = "table";
      if (state.open) {
        if (state.view === "nodes") state.view = "pods";
        render();
        load();
      }
    },
    state,
  };
}
