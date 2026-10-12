// The LOG ERRORS panel under the morning report: services, worst first, each
// with its fingerprints (count, first/last seen, NEW, SPIKE, a sample stack
// trace) and links to SERVICES (focused) and the incident timeline.
// Browser-only; data from /api/morning/logs.

function h(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "text") node.textContent = value;
    else if (key === "className") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) node.append(kid);
  return node;
}

export function hhmm(time) {
  const d = new Date(time);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function windowText(window) {
  if (!window) return "";
  return `${hhmm(window.start)}–${hhmm(window.end)}${window.running ? " (so far)" : ""}`;
}

export function createLogErrorsView(root, { onGraph = () => {}, onTimeline = () => {}, onScenario = null, onClose = () => {} } = {}) {
  let data = null;
  function render() {
    root.replaceChildren();
    if (!data) return;
    const head = h("div", { className: "le-head" },
      h("h2", { text: "LOG ERRORS" }),
      h("span", { className: "le-meta", text: [data.title, windowText(data.window), data.source ? `from ${data.source === "loki" ? "Loki" : "CloudWatch Logs Insights"}` : "", data.compared ? "vs. the night before" : ""].filter(Boolean).join(" · ") }),
    );
    if (data.sample && onScenario) {
      const seg = h("span", { className: "le-seg", role: "group", "aria-label": "sample scenario" });
      for (const [id, text] of [["bare", "SANDBOX-BARE"], ["bundle", "SANDBOX-NIMBUS"]]) seg.append(h("button", { type: "button", "aria-pressed": String(data.scenario === id), text, onclick: () => onScenario(id) }));
      head.append(seg);
    }
    if (!api.embedded) head.append(h("button", { type: "button", className: "le-close", text: "CLOSE", "aria-label": "close log errors", onclick: onClose }));
    root.append(head);
    for (const note of [...(data.notes || []), data.error ? `not read: ${data.error}` : ""].filter(Boolean)) root.append(h("p", { className: "le-note", text: note }));
    const list = data.services || [];
    if (!list.length) root.append(h("p", { className: "le-empty", text: data.line?.text || "No errors." }));
    for (const svc of list) root.append(serviceCard(svc));
  }

  function serviceCard(svc) {
    const tone = svc.new || svc.spikes ? "fail" : svc.total || svc.restarts ? "warn" : "ok";
    const name = svc.links?.graph?.node || (svc.namespace ? `${svc.namespace}/${svc.service}` : svc.service);
    const nums = h("span", { className: "le-nums" },
      h("span", { text: `${svc.total} error${svc.total === 1 ? "" : "s"}` }),
      h("span", { text: `${svc.fingerprints} kind${svc.fingerprints === 1 ? "" : "s"}` }),
      svc.firstSeen ? h("span", { text: `first ${hhmm(svc.firstSeen)}` }) : null,
      svc.new ? h("span", { className: "le-badge new", text: `${svc.new} NEW` }) : null,
      svc.spikes ? h("span", { className: "le-badge spike", text: `${svc.spikes} SPIKE` }) : null,
      svc.restarts ? h("span", { className: "le-badge restart", title: svc.restartPods.map((r) => `${r.pod}: ${r.count}× ${r.reason}`).join("\n"), text: `${svc.restarts} RESTART${svc.restarts === 1 ? "" : "S"}${svc.restartPods[0]?.reason ? ` · ${svc.restartPods[0].reason}` : ""}` }) : null,
    );
    const links = h("span", { className: "le-links" },
      svc.links?.graph ? h("button", { type: "button", text: "SERVICES", title: `focus ${name} in SERVICES`, onclick: () => onGraph(svc.links.graph) }) : null,
      svc.links?.timeline ? h("button", { type: "button", text: `TIMELINE ${hhmm(svc.links.timeline.time)}`, title: "open the incident review at this minute", onclick: () => onTimeline(svc.links.timeline) }) : null,
    );
    const card = h("section", { className: "le-svc", dataset: { tone }, "aria-label": name },
      h("header", {}, h("span", {}, h("div", { className: "le-name", text: name }), nums), links));
    for (const group of svc.groups || []) {
      const badge = group.new ? h("span", { className: "le-badge new", text: "NEW" }) : group.spike ? h("span", { className: "le-badge spike", text: `SPIKE ×${Math.round(group.count / Math.max(1, group.yesterday))}` }) : group.yesterday ? h("span", { className: "le-badge seen", text: `${group.yesterday} yesterday` }) : null;
      card.append(h("details", {},
        h("summary", {}, h("span", { className: "le-count", text: `${group.count}×` }), h("span", { className: "le-msg", title: group.message, text: group.type && !group.message.includes(group.type) ? `${group.type}: ${group.message}` : group.message }), badge || h("span")),
        h("p", { className: "le-facts", text: [`first ${hhmm(group.firstSeen)}`, `last ${hhmm(group.lastSeen)}`, group.frame ? `at ${group.frame}` : "", `${group.pods.length} pod${group.pods.length === 1 ? "" : "s"}`, `#${group.id}`].filter(Boolean).join(" · ") }),
        h("pre", { text: group.sample, "aria-label": "sample stack trace" }),
      ));
    }
    return card;
  }

  const api = {
    embedded: false,
    set(next) {
      data = next;
      if (!root.hidden) render();
    },
    get data() {
      return data;
    },
    open() {
      root.hidden = false;
      render();
      root.querySelector("button")?.focus({ preventScroll: true });
    },
    close() {
      root.hidden = true;
    },
    get shown() {
      return !root.hidden;
    },
  };
  return api;
}
