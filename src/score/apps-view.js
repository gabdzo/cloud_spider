// APPS panel (browser): one row per app, worst first, with its grade; a
// click opens the app card (category bars, fails by points with the fix and
// where it was seen, the app's resources). Reads GET /api/score/apps only;
// it never changes anything. appsModel is pure (tested in node); the view
// draws with DOM nodes and textContent only.
const GRADE_TONE = { A: "ok", B: "ok", C: "warn", D: "bad", F: "bad", "?": "muted", "-": "muted" };
export const gradeTone = (g) => GRADE_TONE[g] || "muted";
const catTone = (s) => (s === null || s === undefined ? "muted" : s >= 80 ? "ok" : s >= 60 ? "warn" : "bad");

export function appsModel(view) {
  if (!view || view.error) return { state: "error", text: view?.error || "the app score did not load", hint: view?.hint || "" };
  const apps = (view.apps || []).map((a) => ({
    id: a.id, name: a.name, namespace: a.namespace, kind: a.kind, grade: a.grade, tone: gradeTone(a.grade),
    overall: a.overall, scaledDown: Boolean(a.scaledDown), replicas: `${a.ready ?? 0}/${a.replicas ?? 0}`,
    top: a.fails?.[0] ? `${a.fails[0].title} (+${a.fails[0].points} pts)` : a.scaledDown ? "SCALED DOWN: not scored" : "no fails",
    categories: (a.categories || []).map((c) => ({ name: c.name, score: c.score, tone: catTone(c.score) })),
    fails: a.fails || [], warns: a.warns || [], resources: a.resources || {},
  }));
  if (!apps.length) return { state: "empty", text: "No apps here: no Deployments or StatefulSets outside the system namespaces." };
  return { state: "ok", context: view.context, apps, grades: view.grades || {}, scope: view.scope };
}

// "A 1 · B 2 · F 3": the STAT line and the panel header.
export function gradeLine(grades = {}) {
  return ["A", "B", "C", "D", "F", "?"].filter((g) => grades[g]).map((g) => `${g} ${grades[g]}`).join(" · ") || "no apps";
}

export function createAppsView({ root, toggleButton, context = () => "", sample = () => false, onChange = () => {}, tabs = null }) {
  let open = false;
  let model = null;
  let picked = null;
  const el = (tag, cls = "", text = "") => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== "") n.textContent = String(text);
    return n;
  };
  async function load() {
    const q = sample() ? "?sample=1" : context() ? `?context=${encodeURIComponent(context())}` : "";
    model = appsModel(await fetch(`/api/score/apps${q}`).then((r) => r.json()).catch(() => ({ error: "the page failed" })));
    draw();
  }
  function bar(name, score, tone) {
    const row = el("div", "ap-bar");
    row.dataset.tone = tone;
    const fill = el("span", "ap-fill");
    fill.style.width = `${Math.max(0, Math.min(100, score ?? 0))}%`;
    const track = el("span", "ap-track");
    track.append(fill);
    row.append(el("span", "ap-cat", name), track, el("span", "ap-num", score ?? "?"));
    return row;
  }
  function card(a) {
    const box = el("section", "ap-card");
    const head = el("div", "ap-head");
    const g = el("b", "ap-grade", a.grade);
    g.dataset.tone = a.tone;
    const back = el("button", "sc-btn", "◂ ALL APPS");
    back.type = "button";
    back.addEventListener("click", () => { picked = null; draw(); });
    head.append(g, el("span", "ap-title", `${a.namespace}/${a.name}`), el("span", "sc-muted", `${a.kind} · ${a.replicas} ready · ${a.overall ?? "?"}/100`), back);
    box.append(head);
    const bars = el("div", "ap-bars");
    for (const c of a.categories) bars.append(bar(c.name, c.score, c.tone));
    box.append(bars, el("div", "sc-label", `FIX FIRST (${a.fails.length})`));
    const list = el("ol", "ap-fails");
    for (const f of a.fails) {
      const li = el("li", "ap-fail");
      li.dataset.sev = f.severity;
      const top = el("div", "ap-fline");
      top.append(el("span", "ap-pts", `+${f.points}`), el("span", "ap-fid", f.id), el("span", "", f.title), el("span", "sc-muted", f.severity));
      li.append(top, el("div", "sc-remedy", f.fix));
      for (const s of f.source) li.append(el("div", "sc-muted sc-small", `${s.id}${s.detail ? `: ${s.detail}` : ""}`));
      list.append(li);
    }
    box.append(list);
    if (a.warns.length) {
      box.append(el("div", "sc-label", "WARN"));
      for (const w of a.warns) box.append(el("div", "sc-small", `${w.id} ${w.title}: ${w.detail}`));
    }
    const chips = el("div", "ap-chips");
    const r = a.resources;
    const add = (label, v) => { for (const x of [].concat(v || [])) chips.append(el("span", "ap-chip", `${label} ${x}`)); };
    add("svc", r.services); add("ing", r.ingresses); add("hpa", r.hpa); add("pdb", r.pdbs); add("netpol", r.netpols); add("sa", r.serviceAccount); add("cm", r.configMaps); add("secret", r.secrets); add("mon", r.monitors);
    box.append(el("div", "sc-label", "RESOURCES"), chips, el("p", "sc-disclaimer", "Read-only: env and ConfigMap values and Secrets are never read; Secrets are shown by name."));
    return box;
  }
  function draw() {
    root.replaceChildren();
    // SCORE's tab bar (CLUSTER | AWS ACCOUNT | APPS) with APPS lit.
    if (tabs) root.append(tabs());
    const head = el("div", "ap-top");
    head.append(el("span", "sc-label", "APPS · production readiness per app"), el("span", "ap-line", model?.state === "ok" ? gradeLine(model.grades) : ""));
    root.append(head);
    if (!model || model.state !== "ok") {
      root.append(el("div", "sc-empty", model?.text || "loading…"));
      if (model?.hint) root.append(el("div", "sc-muted", model.hint));
      return;
    }
    const a = picked && model.apps.find((x) => x.id === picked);
    if (a) return root.append(card(a));
    const list = el("div", "ap-list");
    for (const x of model.apps) {
      const row = el("button", "ap-row");
      row.type = "button";
      row.dataset.tone = x.tone;
      row.dataset.app = x.id;
      row.append(el("b", "ap-grade", x.grade), el("span", "ap-title", x.id), el("span", "ap-num", x.overall ?? "–"), el("span", "sc-muted ap-top1", x.top));
      row.addEventListener("click", () => { picked = x.id; draw(); });
      list.append(row);
    }
    root.append(list);
  }
  return {
    isOpen: () => open,
    model: () => model,
    async setOpen(v) {
      open = Boolean(v);
      root.hidden = !open;
      toggleButton?.setAttribute("aria-pressed", String(open));
      if (open) await load();
      onChange(open);
    },
    toggle() { return this.setOpen(!open); },
    // A Pip-Boy grade tile: open straight on that app's card.
    openApp(id) { picked = id || null; return this.setOpen(true); },
    showList() { picked = null; return this.setOpen(true); },
    refresh() { return open ? load() : undefined; },
    load,
  };
}
