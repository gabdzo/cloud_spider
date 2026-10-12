// LOG ERRORS panel (browser): the morning report's fourth card opens it.
// Services worst first, each a <details> with its fingerprints, a sample
// stack trace, NEW / SPIKE / restarts, and links into SERVICES (focused) and
// the incident timeline. Data: GET /api/logs/errors (routes.js).

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

const hhmm = (t) => {
  if (!t) return "";
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const POLL = 5 * 60_000;

export function createLogErrorsView(root, { focus = () => {}, changed = () => {}, fetchJson = (u) => fetch(u).then((r) => r.json()) } = {}) {
  const state = { sample: false, scenario: "bundle", data: null, open: false, at: 0, loading: false };
  let timer = 0;

  async function load({ sample = state.sample, fresh = false } = {}) {
    if (sample !== state.sample) state.data = null;
    state.sample = sample;
    state.loading = true;
    const q = new URLSearchParams(sample ? { sample: "1", scenario: state.scenario } : fresh ? { fresh: "1" } : {});
    try {
      state.data = await fetchJson(`/api/logs/errors?${q}`);
    } catch (error) {
      state.data = { error: `LOG ERRORS did not answer: ${error?.message || error}`, line: { status: "unknown", text: "did not answer." } };
    }
    state.loading = false;
    state.at = Date.now();
    if (state.open) render();
    changed();
    clearTimeout(timer);
    timer = setTimeout(() => load(), POLL);
  }

  function line() {
    return state.data?.line || null;
  }

  function badge(cls, text, title) {
    return h("span", { className: `le-tag ${cls}`, text, title });
  }

  function serviceItem(svc, index) {
    const tone = svc.newCount || svc.spike ? "bad" : svc.count || svc.restarts ? "warn" : "ok";
    const tags = [];
    if (svc.newCount) tags.push(badge("new", `NEW ×${svc.newCount}`, `${plural(svc.newCount, "error")} not seen in the same window yesterday`));
    if (svc.spike) tags.push(badge("spike", `SPIKE ×${Math.round(svc.count / Math.max(1, svc.yesterday))}`, `${svc.count} tonight vs ${svc.yesterday} yesterday`));
    if (svc.restarts) tags.push(badge("rst", `${plural(svc.restarts, "restart")}`, svc.restartReasons.join(", ")));
    const details = h("details", { className: "le-svc", dataset: { tone, key: svc.key }, open: index === 0 ? true : undefined });
    details.append(
      h("summary", { "aria-label": `${svc.service}: ${plural(svc.count, "error")}` },
        h("span", { className: "le-name" }, h("b", { text: svc.service }), h("small", { text: svc.namespace })),
        h("span", { className: "le-nums" }, ...tags, h("span", { className: "le-count", text: String(svc.count) }), h("span", { className: "le-when", text: svc.firstSeen ? `first ${hhmm(svc.firstSeen)}` : "" }))),
    );
    const body = h("div", { className: "le-body" });
    const link = svc.link;
    const links = h("div", { className: "le-links" },
      h("span", { text: `${plural(svc.errors.length, "kind")} of error${svc.pods.length ? ` · ${plural(svc.pods.length, "pod")}` : ""}${svc.yesterday !== null && svc.yesterday !== undefined ? ` · yesterday ${svc.yesterday}` : ""}` }),
      link ? h("button", { type: "button", className: "le-btn", text: "SERVICES ›", title: "focus this service in Cluster › SERVICES", onclick: () => focus({ ...link, t: "" , query: svc.service }) }) : null,
      link?.t ? h("button", { type: "button", className: "le-btn", text: `TIMELINE ${link.t} ›`, title: "the incident review at this minute", onclick: () => focus({ ...link, query: svc.service }) }) : null,
    );
    body.append(links);
    if (svc.restarts) body.append(h("div", { className: "le-links" }, h("span", { text: `Restarts: ${svc.restarts} (${svc.restartReasons.join(", ") || "terminated"})` })));
    for (const err of svc.errors.slice(0, 12)) {
      const head = h("div", { className: "le-fp-head" },
        h("span", { className: "le-count", text: `×${err.count}` }),
        h("span", { className: "le-msg", text: err.message, title: `fingerprint ${err.id}: ${err.title}` }),
        h("span", { className: "le-when" }, err.isNew ? badge("new", "NEW") : null, err.spike ? badge("spike", `×${Math.round(err.count / Math.max(1, err.yesterday))}`) : null, ` ${hhmm(err.firstSeen)}–${hhmm(err.lastSeen)}`));
      const fp = h("div", { className: "le-fp" }, head);
      if (err.sample?.length > 1) {
        fp.append(h("details", {}, h("summary", { text: `stack trace · ${err.kind} · ${err.sample.length} lines` }, " ", badge("kind", err.kind.toUpperCase())), h("pre", { text: err.sample.join("\n") })));
      }
      body.append(fp);
    }
    if (svc.errors.length > 12) body.append(h("p", { className: "le-note", text: `${svc.errors.length - 12} more kinds of error not shown.` }));
    details.append(body);
    return h("li", {}, details);
  }

  function render() {
    root.hidden = !state.open;
    if (!state.open) return;
    const d = state.data;
    root.replaceChildren();
    const head = h("header", { className: "le-head" }, h("b", { text: "LOG ERRORS" }));
    if (d?.window?.label) head.append(h("span", { className: "le-meta", text: `${d.window.label} · ${d.source === "sample" ? `sample · ${d.title}` : d.source || ""}${d.compared ? " · vs yesterday" : ""}` }));
    if (state.sample) {
      const seg = h("span", { className: "le-seg", role: "group", "aria-label": "sample scenario" });
      for (const [id, label] of [["bare", "BARE"], ["bundle", "NIMBUS"]]) {
        seg.append(h("button", { type: "button", className: "le-btn", "aria-pressed": String(state.scenario === id), text: label, onclick: () => ((state.scenario = id), load()) }));
      }
      head.append(seg);
    } else head.append(h("button", { type: "button", className: "le-btn", text: "REFRESH", title: "read the logs again", onclick: () => load({ fresh: true }) }));
    head.append(h("button", { type: "button", className: "le-btn le-close", text: "CLOSE", "aria-label": "close log errors", onclick: () => toggle(false) }));
    root.append(head);
    if (!d || state.loading && !d) {
      root.append(h("p", { className: "le-empty", text: "Reading…" }));
      return;
    }
    if (d.error) {
      root.append(h("p", { className: "le-empty", text: d.error }));
      return;
    }
    root.append(h("div", { className: "le-totals" },
      h("span", { className: `le-total${d.total ? " warn" : ""}` }, h("strong", { text: String(d.total) }), "errors"),
      h("span", { className: "le-total" }, h("strong", { text: String(d.fingerprints) }), "kinds"),
      h("span", { className: `le-total${d.newCount ? " bad" : ""}` }, h("strong", { text: String(d.newCount) }), "new"),
      h("span", { className: `le-total${d.spikes ? " warn" : ""}` }, h("strong", { text: String(d.spikes) }), "spikes"),
      h("span", { className: `le-total${d.restarts ? " warn" : ""}` }, h("strong", { text: String(d.restarts) }), "restarts")));
    for (const note of d.notes || []) root.append(h("p", { className: "le-note", text: note }));
    if (d.truncated) root.append(h("p", { className: "le-note", text: "Only the first 5000 lines were read; counts are a floor." }));
    if (!d.services.length) {
      root.append(h("p", { className: "le-empty", text: "No errors or restarts in the window." }));
      return;
    }
    root.append(h("ol", {}, d.services.map(serviceItem)));
  }

  function toggle(open = !state.open) {
    state.open = open;
    render();
    changed();
  }

  return { load, line, toggle, render, state, isOpen: () => state.open };
}
