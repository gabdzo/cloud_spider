// "/" quick-find outside the Cluster topology (which has its own search):
// on MAP it searches what the map draws (VPCs' buildings, fixtures, vault
// doors, app stalls: the same targets keyboard focus walks, map-focus.js);
// elsewhere it is a global GO TO over the tabs and the map's resources.
// The ranking is pure and tested; the overlay is a small dialog of its own.

const norm = (s) => String(s || "").toLowerCase();

// One map target → { key, label, hint, kind }.
export function mapItem(target) {
  const item = target?.item || {};
  const pick = {
    building: () => [item.name || item.id, [item.type, item.state].filter(Boolean).join(" · ")],
    fixture: () => [item.label || item.name || item.id, [item.caption || item.kind, item.status].filter(Boolean).join(" · ")],
    vault: () => [`vault ${item.vault?.name || item.key}`, "vault door"],
    app: () => [item.label || item.id, ["app", item.ns, item.count ? `${item.count} ready` : ""].filter(Boolean).join(" · ")],
  }[target?.kind];
  const [label, hint] = pick ? pick() : [item.id || target?.key, ""];
  return { key: target?.key || "", kind: target?.kind || "", label: String(label || ""), hint: String(hint || ""), id: String(item.id || "") };
}

// Every term must match the label, hint or id; label-start and word-start
// matches rank first. Returns at most `limit` items.
export function rankItems(items, query, limit = 12) {
  const terms = norm(query).split(/\s+/).filter(Boolean);
  if (!terms.length) return items.slice(0, limit);
  const scored = [];
  for (const it of items) {
    const label = norm(it.label);
    const all = `${label} ${norm(it.hint)} ${norm(it.id)}`;
    if (!terms.every((t) => all.includes(t))) continue;
    const t0 = terms[0];
    let score = 0;
    if (label === t0) score += 100;
    else if (label.startsWith(t0)) score += 60;
    else if (new RegExp(`(^|[^a-z0-9])${t0.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(label)) score += 40;
    else if (label.includes(t0)) score += 20;
    score -= label.length / 100;
    scored.push({ it, score });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.it);
}

export function createQuickFind({ doc = document, onPick = () => {} } = {}) {
  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(doc.createElement(tag), props);
    n.append(...kids);
    return n;
  };
  const box = el("div", { id: "quick-find", hidden: true, role: "dialog", ariaLabel: "quick find", className: "qf" });
  const head = el("div", { className: "qf-head" });
  const input = el("input", { className: "qf-in", type: "text", spellcheck: false, autocomplete: "off", placeholder: "find…" });
  input.setAttribute("aria-label", "quick find");
  const list = el("ul", { className: "qf-list", role: "listbox" });
  const foot = el("div", { className: "qf-foot", textContent: "↑↓ pick · Enter go · Esc close" });
  head.append(input);
  box.append(head, list, foot);
  const style = el("style", { textContent: `
    #quick-find { position: fixed; z-index: 9000; top: 12vh; left: 50%; transform: translateX(-50%); width: min(560px, 92vw); background: var(--panel, #10151c); color: var(--ink, #e6edf3); border: 1px solid var(--accent, #6aa8ff); border-radius: 8px; box-shadow: 0 12px 40px rgba(0,0,0,.55); font: 13px/1.4 var(--mono, ui-monospace, monospace); }
    #quick-find .qf-head { display: flex; gap: 8px; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,.08); }
    #quick-find .qf-scope { font-weight: 700; letter-spacing: .08em; opacity: .8; white-space: nowrap; }
    #quick-find .qf-in { flex: 1; background: transparent; border: 0; outline: none; color: inherit; font: inherit; font-size: 15px; }
    #quick-find .qf-list { list-style: none; margin: 0; padding: 4px; max-height: 50vh; overflow: auto; }
    #quick-find li { display: flex; justify-content: space-between; gap: 12px; padding: 6px 8px; border-radius: 5px; cursor: pointer; }
    #quick-find li small { opacity: .65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    #quick-find li[aria-selected="true"], #quick-find li:hover { background: rgba(106,168,255,.18); }
    #quick-find .qf-foot { padding: 6px 12px; opacity: .6; font-size: 11px; border-top: 1px solid rgba(255,255,255,.08); }
    #quick-find .qf-none { opacity: .6; cursor: default; }
  ` });
  doc.head.append(style);
  doc.body.append(box);
  let items = [];
  let shown = [];
  let cursor = 0;
  const scope = el("span", { className: "qf-scope" });
  head.prepend(scope);
  function paint() {
    shown = rankItems(items, input.value);
    cursor = Math.min(cursor, Math.max(0, shown.length - 1));
    list.replaceChildren(...(shown.length ? shown.map((it, i) => {
      const li = el("li", { role: "option" }, el("span", { textContent: it.label }), el("small", { textContent: it.hint }));
      li.setAttribute("aria-selected", String(i === cursor));
      li.addEventListener("mousedown", (e) => { e.preventDefault(); pick(i); });
      return li;
    }) : [el("li", { className: "qf-none", textContent: "nothing matches" })]));
    list.children[cursor]?.scrollIntoView?.({ block: "nearest" });
  }
  function close() {
    box.hidden = true;
  }
  function pick(i) {
    const it = shown[i];
    close();
    if (it) onPick(it);
  }
  input.addEventListener("input", () => { cursor = 0; paint(); });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "ArrowDown") { e.preventDefault(); cursor = Math.min(shown.length - 1, cursor + 1); paint(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); cursor = Math.max(0, cursor - 1); paint(); }
    else if (e.key === "Enter") { e.preventDefault(); pick(cursor); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
  });
  input.addEventListener("blur", () => setTimeout(close, 0));
  return {
    open({ title = "GO TO", entries = [] } = {}) {
      items = entries;
      scope.textContent = title;
      input.value = "";
      input.placeholder = title === "MAP" ? "find on the map: VPC, subnet, ALB, node, app…" : "go to a tab or a resource…";
      cursor = 0;
      box.hidden = false;
      paint();
      input.focus();
    },
    close,
    isOpen: () => !box.hidden,
  };
}
