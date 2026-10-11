// SCORE panel (browser). scoreModel/fixModel turn /api/score answers into
// what the panel shows (pure, tested in node); createScoreView draws them
// with DOM nodes and textContent only. Requests: GET /api/score, GET
// /api/score/fix, GET /api/score/report (EXPORT links) and POST
// /api/score/scan|fix from a button press.
const LABEL = { INSUFFICIENT_EVIDENCE: "INSUFFICIENT EVIDENCE", BLOCKED: "BLOCKED", AT_RISK: "AT RISK", CONDITIONAL: "CONDITIONAL", NO_KNOWN_BLOCKERS: "NO KNOWN BLOCKERS" };
const TONE = { INSUFFICIENT_EVIDENCE: "warn", BLOCKED: "bad", AT_RISK: "bad", CONDITIONAL: "warn", NO_KNOWN_BLOCKERS: "ok" };
const ORDER = { FAIL: 0, UNKNOWN: 1, NOT_ASSESSED: 2, PASS: 3, NOT_APPLICABLE: 4 };
const STATUS_TEXT = { FAIL: "FAIL", PASS: "PASS", UNKNOWN: "UNKNOWN", NOT_ASSESSED: "NOT ASSESSED", NOT_APPLICABLE: "N/A" };
export const STAGES = ["Plan", "Preview", "Approve", "Install", "Rescan"];
const BUSY = ["previewing", "running", "rescanning"];
const CHANGE_ORDER = { fixed: 0, regressed: 1, changed: 2, new: 3 };
const CHANGE_LABEL = { fixed: "FIXED", regressed: "REGRESSED", changed: "CHANGED", new: "NEW" };
export const REPORT_FORMATS = ["md", "html", "json"];
const toneOf = (score) => (score >= 80 ? "ok" : score >= 60 ? "warn" : "bad");

// The first screen, in the spec's order: verdict, then number (never the
// number alone), coverage and confidence, categories, then what to fix first.
export function scoreModel(view) {
  const target = view?.target === "aws" ? "aws" : "kubernetes";
  if (!view || view.error) return { state: "error", target, text: view?.error || "the scorecard did not load", hint: view?.hint || "" };
  const scan = view.scan;
  if (!scan) return { state: "empty", target, cluster: view.cluster, text: target === "aws" ? "No scan of this AWS account yet. Press SCAN: it only reads (Describe/List/Get)." : `No scan of ${view.cluster || "this cluster"} yet. Press SCAN: it only reads.` };
  const card = scan.card;
  const fixable = new Map((view.suggestions || []).map((s) => [s.control, s]));
  const rows = [...scan.results]
    .sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.gate === true) - (a.gate === true) || a.id.localeCompare(b.id))
    .map((r) => ({ id: r.id, title: r.title, status: r.status, statusText: STATUS_TEXT[r.status] || r.status, severity: r.severity, gate: r.gate === true, reason: r.reason || failingLine(r), fix: fixable.get(r.id)?.already ? "" : fixable.get(r.id)?.addon || "", card: fixable.get(r.id)?.card || null, already: fixable.get(r.id)?.already || "" }));
  const counts = Object.fromEntries(Object.keys(ORDER).map((s) => [s, scan.results.filter((r) => r.status === s).length]));
  const rank = new Map((card.priorities || []).map((p, i) => [p.id, i]));
  // Actionable first (FIX or OPEN a card); an add-on that is already there
  // is not a next fix: it comes last, with why it still fails.
  const next = rows.filter((r) => r.fix || r.card || r.already).sort((a, b) => Boolean(a.already) - Boolean(b.already) || (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99)).slice(0, 3).map(({ id, title, fix, severity, card, already, reason }) => ({ id, title, addon: fix, severity, card, already, reason }));
  const categories = (card.categories || [])
    .filter((c) => c.applicableWeight > 0)
    .map((c) => ({
      name: c.name,
      weight: c.weight,
      score: c.insufficient || c.score == null ? null : Math.round(c.score),
      text: c.insufficient || c.score == null ? "not enough evidence" : String(Math.round(c.score)),
      tone: c.insufficient || c.score == null ? "muted" : toneOf(c.score),
      coverage: Math.round(c.coverage),
    }));
  // A first scan has nothing to compare with: every control would be "new".
  const changes = (view.diff?.from ? view.diff.changes || [] : [])
    .filter((c) => c.kind !== "new")
    .sort((a, b) => (CHANGE_ORDER[a.kind] ?? 9) - (CHANGE_ORDER[b.kind] ?? 9) || a.id.localeCompare(b.id))
    .map((c) => ({ kind: c.kind, label: CHANGE_LABEL[c.kind] || "CHANGED", id: c.id, title: c.title || "", move: `${STATUS_TEXT[c.from] || c.from} → ${STATUS_TEXT[c.to] || c.to}` }));
  return {
    state: "scored",
    target,
    where: target === "aws" ? "AWS account" : view.cluster,
    cluster: view.cluster,
    scanId: scan.id,
    verdict: card.verdict,
    verdictLabel: LABEL[card.verdict] || card.verdict,
    tone: TONE[card.verdict] || "warn",
    number: card.overall == null ? "" : `${Math.round(card.overall)}/100`,
    range: card.lower == null ? "" : `range ${Math.round(card.lower)}–${Math.round(card.upper)}`,
    coverage: `coverage ${Math.round(card.coverage)}% · confidence ${card.confidence}`,
    meter: { assessed: card.coverage ?? 0, unknown: card.unknown ?? 0, notAssessed: card.notAssessed ?? 0 },
    reasons: card.reasons || [],
    delta: view.diff?.delta == null ? null : { text: `${view.diff.delta > 0 ? "+" : ""}${view.diff.delta} since the last scan`, up: view.diff.delta > 0 },
    spark: (view.trend || []).map((t) => (t.overall == null ? 0 : Math.round(t.overall))),
    categories,
    counts,
    next,
    rows,
    when: scan.finishedAt,
    profile: `${card.profile}${scan.profileDefaulted ? " (no environment set: production assumed)" : ""}`,
    disclaimer: card.disclaimer,
    changes,
    catalogChanged: Boolean(view.diff?.catalogChanged),
    grants: view.permissions?.ok === false ? view.permissions.grants || [] : [],
    reports: REPORT_FORMATS.map((format) => ({ format, href: `/api/score/report?id=${encodeURIComponent(scan.id)}&format=${format}` })),
  };
}

function failingLine(r) {
  const bad = (r.resources || []).filter((x) => !x.pass);
  return bad.length ? `${bad[0].id}${bad[0].detail ? `: ${bad[0].detail}` : ""}${bad.length > 1 ? ` (+${bad.length - 1})` : ""}` : "";
}

// The FIX pane for the fix in progress (or the plan just asked for).
// stage indexes STAGES (5 = done); log is the Pulumi output, apart.
export function fixModel(state, plan = null) {
  const logOf = (s) => (s?.steps || []).flatMap((x) => [`— ${x.action} ${x.module}: ${x.ok ? "ok" : `failed: ${x.error}`}`, ...(x.lines || [])]).join("\n");
  if (plan?.error || plan?.refusal) return { step: "refused", stage: 0, text: plan.error || plan.refusal, log: "", buttons: [] };
  if (plan && (!state || ["idle", "done", "failed"].includes(state.phase))) return { step: "plan", stage: 0, title: plan.title || "", text: plan.confirm, log: "", buttons: ["PREVIEW"] };
  if (!state || state.phase === "idle") return { step: "idle", stage: -1, text: "", log: "", buttons: [] };
  const log = logOf(state);
  const title = state.title || "";
  if (state.phase === "previewing") return { step: "previewing", stage: 1, title, text: `Previewing ${state.running?.module || ""}… nothing changes in this step.`, log, buttons: [] };
  if (state.phase === "previewed") return { step: "previewed", stage: 2, title, text: `${state.confirm}\n\nPreview finished: nothing changed yet.`, log, buttons: ["APPROVE", "CANCEL"], previewId: state.id };
  if (state.phase === "running") return { step: "running", stage: 3, title, text: `Running ${state.running?.module || ""}…`, log, buttons: [] };
  if (state.phase === "rescanning") return { step: "rescanning", stage: 4, title, text: "Installed. Rescanning…", log, buttons: [] };
  if (state.phase === "done") return { step: "done", stage: 5, title, text: state.diff?.delta == null ? `${title} installed and rescanned. No score to compare: ${state.diff?.verdictTo === "INSUFFICIENT_EVIDENCE" ? "not enough evidence yet" : "the last scan had none"}.` : `${title} installed. Score ${state.diff.delta > 0 ? "+" : ""}${state.diff.delta}.`, log, buttons: [] };
  return { step: "failed", stage: -1, title, text: state.error || "the fix failed", log, buttons: [] };
}

export function createScoreView({ root, toggleButton, context = () => "", onChange = () => {}, openCard = null }) {
  let open = false;
  let target = "kubernetes";
  let model = null;
  let plan = null;
  let fixState = null;
  let timer = null;
  const el = (tag, cls = "", text = "") => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text) node.textContent = text;
    return node;
  };
  const button = (label, cls = "sc-btn") => {
    const b = el("button", cls, label);
    b.type = "button";
    return b;
  };
  const getJson = (path) => fetch(path).then((r) => r.json()).catch(() => ({ error: "the page failed" }));
  const post = (path, body) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => ({ error: "the page failed" }));
  const q = () => `?target=${target}${target === "kubernetes" && context() ? `&context=${encodeURIComponent(context())}` : ""}`;

  async function load() {
    model = scoreModel(await getJson(`/api/score${q()}`));
    fixState = await getJson("/api/score/fix");
    draw();
    poll();
  }
  function poll() {
    clearTimeout(timer);
    if (open && BUSY.includes(fixState?.phase)) {
      timer = setTimeout(async () => {
        const was = fixState.phase;
        fixState = await getJson("/api/score/fix");
        if (was === "rescanning" && fixState.phase === "done") model = scoreModel(await getJson(`/api/score${q()}`));
        draw();
        poll();
      }, 2000);
    }
  }
  async function act(body) {
    const out = await post("/api/score/fix", { scanId: model.scanId, ...body });
    if (body.phase === "plan") plan = { ...out, control: body.control };
    else if (out.error) plan = { error: out.error };
    else plan = null;
    fixState = await getJson("/api/score/fix");
    draw();
    poll();
  }
  function scanButton() {
    const b = button("SCAN", "sc-btn sc-primary");
    b.title = target === "aws" ? "Read the AWS account (Describe/List/Get only)" : "Read the cluster again (GET requests only)";
    b.addEventListener("click", async () => {
      b.disabled = true;
      b.textContent = "SCANNING…";
      const out = await post("/api/score/scan", { context: context(), target });
      if (out.error) {
        model = scoreModel(out);
        draw();
        return;
      }
      await load();
    });
    return b;
  }
  // CLUSTER | AWS ACCOUNT: which target the panel shows and SCAN reads.
  function targets() {
    const bar = el("div", "sc-targets");
    bar.setAttribute("role", "group");
    bar.setAttribute("aria-label", "scan target");
    for (const [value, label] of [["kubernetes", "CLUSTER"], ["aws", "AWS ACCOUNT"]]) {
      const b = button(label, "sc-target");
      b.setAttribute("aria-pressed", String(target === value));
      b.addEventListener("click", () => {
        if (target === value) return;
        target = value;
        plan = null;
        load();
      });
      bar.append(b);
    }
    return bar;
  }
  function exports() {
    const wrap = el("div", "sc-exports");
    wrap.append(el("span", "sc-label", "Export"));
    for (const r of model.reports) {
      const a = el("a", "sc-export", r.format.toUpperCase());
      a.href = r.href;
      a.download = "";
      a.title = `download this scan as ${r.format.toUpperCase()} (no evidence fields)`;
      wrap.append(a);
    }
    return wrap;
  }
  function changes() {
    const wrap = el("section", "sc-changes");
    wrap.append(el("div", "sc-label", `Since the last scan · ${model.changes.length} change${model.changes.length === 1 ? "" : "s"}`));
    if (model.catalogChanged) wrap.append(el("p", "sc-muted sc-small", "The catalog changed between these scans: some moves are new rules, not changes in your cluster."));
    const list = el("ul", "sc-changelist");
    for (const c of model.changes.slice(0, 8)) {
      const li = el("li");
      li.dataset.kind = c.kind;
      li.append(el("span", "sc-chip", c.label), el("span", "sc-id", c.id), el("span", "", c.title), el("span", "sc-muted", c.move));
      list.append(li);
    }
    if (model.changes.length > 8) list.append(el("li", "sc-muted sc-small", `+${model.changes.length - 8} more in the table below`));
    wrap.append(list);
    return wrap;
  }
  function grants() {
    const pane = el("section", "sc-grant");
    pane.append(el("div", "sc-label", "Some reads were refused"), el("p", "sc-small", "Their controls are UNKNOWN, so coverage is lower. To grant them (read-only):"));
    for (const g of model.grants) pane.append(el("code", "sc-code", g));
    return pane;
  }
  function spark(values) {
    const box = el("div", "sc-spark");
    box.setAttribute("aria-label", `score trend: ${values.join(", ")}`);
    for (const v of values.slice(-24)) {
      const bar = el("i");
      bar.style.height = `${Math.max(6, v)}%`;
      bar.dataset.tone = toneOf(v);
      box.append(bar);
    }
    return box;
  }
  function meter(m) {
    const bar = el("div", "sc-meter");
    bar.setAttribute("aria-label", `assessed ${m.assessed}%, unknown ${m.unknown}%, not assessed ${m.notAssessed}%`);
    for (const [k, v] of [["assessed", m.assessed], ["unknown", m.unknown], ["not", m.notAssessed]]) {
      if (!v) continue;
      const seg = el("i");
      seg.dataset.part = k;
      seg.style.width = `${v}%`;
      bar.append(seg);
    }
    return bar;
  }
  function top() {
    const head = el("div", "sc-top");
    const gauge = el("div", "sc-gauge");
    gauge.dataset.tone = model.tone;
    gauge.append(el("span", "sc-verdict", model.verdictLabel));
    const num = el("div", "sc-number");
    if (model.number) {
      const [n, of] = model.number.split("/");
      num.append(el("b", "", n), el("small", "", `/${of}`));
    } else num.append(el("small", "", "no score: not enough evidence"));
    gauge.append(num, el("span", "sc-muted", model.range));
    const meta = el("div", "sc-meta");
    meta.append(el("div", "sc-label", "Coverage"), meter(model.meter), el("div", "sc-muted", model.coverage));
    const legend = el("div", "sc-legend");
    for (const [k, text] of [["assessed", `assessed ${Math.round(model.meter.assessed)}%`], ["unknown", `unknown ${Math.round(model.meter.unknown)}%`], ["not", `not assessed ${Math.round(model.meter.notAssessed)}%`]]) {
      const item = el("span", "", text);
      item.dataset.part = k;
      legend.append(item);
    }
    meta.append(legend, el("div", "sc-muted sc-small", `${model.where} · ${model.profile}`));
    const side = el("div", "sc-side");
    side.append(el("div", "sc-label", "Trend"), spark(model.spark));
    if (model.delta) {
      const d = el("span", "sc-delta", model.delta.text);
      d.dataset.up = model.delta.up ? "1" : "0";
      side.append(d);
    }
    side.append(scanButton(), exports());
    head.append(gauge, meta, side);
    return head;
  }
  function categories() {
    const wrap = el("div", "sc-cats");
    for (const c of model.categories) {
      const tile = el("div", "sc-cat");
      tile.dataset.tone = c.tone;
      const bar = el("div", "sc-catbar");
      const fill = el("i");
      fill.style.width = `${c.score ?? 0}%`;
      bar.append(fill);
      tile.append(el("span", "sc-label", c.name), el("b", "", c.text), bar, el("span", "sc-muted sc-small", `coverage ${c.coverage}% · weight ${c.weight}`));
      wrap.append(tile);
    }
    return wrap;
  }
  function fixPane(f) {
    const pane = el("section", "sc-pane");
    pane.dataset.step = f.step;
    const steps = el("ol", "sc-steps");
    STAGES.forEach((name, i) => {
      const li = el("li", "", name);
      li.dataset.state = f.stage > i ? "done" : f.stage === i ? "now" : "todo";
      steps.append(li);
    });
    pane.append(el("div", "sc-label", f.title ? `Fix · ${f.title}` : "Fix"), steps, el("p", "sc-text", f.text));
    if (f.log) pane.append(el("pre", "sc-log", f.log));
    if (f.buttons.length) {
      const bar = el("div", "sc-actions");
      for (const label of f.buttons) {
        const b = button(label, label === "CANCEL" ? "sc-btn" : "sc-btn sc-primary");
        b.addEventListener("click", () => {
          if (label === "PREVIEW") act({ control: plan.control, phase: "preview" });
          if (label === "APPROVE") act({ control: fixState.control, phase: "up", previewId: f.previewId });
          if (label === "CANCEL") {
            plan = null;
            fixState = { phase: "idle" };
            draw();
          }
        });
        bar.append(b);
      }
      pane.append(bar);
    }
    return pane;
  }
  function nextUp(busy) {
    const wrap = el("section", "sc-next");
    wrap.append(el("div", "sc-label", "Fix next"));
    const list = el("div", "sc-nextlist");
    for (const n of model.next) {
      const card = el("div", "sc-nextcard");
      card.append(el("span", "sc-sev", n.severity), el("span", "sc-nexttitle", n.title));
      if (n.card) {
        // Fixed on a Stacks card: open it prefilled (live instance type).
        const params = Object.entries(n.card.params || {}).map(([k, v]) => `${k} ${v}`).join(", ");
        const b = button(`OPEN ${String(n.card.id).toUpperCase()} CARD`, "sc-btn sc-primary");
        b.disabled = busy || !openCard;
        b.addEventListener("click", () => openCard?.(n.card, model.cluster));
        card.append(el("span", "sc-muted sc-small", `${n.id} · ${n.reason || ""}`.trim()), el("span", "sc-muted sc-small", `opens Stacks › ${String(n.card.id).toUpperCase()}${params ? ` with ${params}` : ""}; PREVIEW first, nothing changes until you RUN`), b);
      } else if (n.already) {
        card.append(el("span", "sc-muted sc-small", `${n.id} · ${n.already}`));
      } else {
        const b = button(`FIX: ${n.addon}`, "sc-btn sc-primary");
        b.disabled = busy;
        b.addEventListener("click", () => act({ control: n.id, phase: "plan" }));
        card.append(el("span", "sc-muted sc-small", `${n.id} · ${["pod-identity", "metrics-server"].includes(n.addon) ? `reruns the EKS stack (it installs ${n.addon})` : `add-on stack ${n.addon}`}: preview first, nothing changes until you approve`), b);
      }
      list.append(card);
    }
    wrap.append(list);
    return wrap;
  }
  function table(busy) {
    const wrap = el("section", "sc-table");
    const head = el("div", "sc-tablehead");
    head.append(el("div", "sc-label", "Controls"));
    const counts = el("div", "sc-counts");
    for (const [s, n] of Object.entries(model.counts)) {
      if (!n) continue;
      const chip = el("span", "sc-chip", `${n} ${STATUS_TEXT[s]}`);
      chip.dataset.status = s;
      counts.append(chip);
    }
    head.append(counts);
    wrap.append(head);
    for (const r of model.rows) {
      const row = el("div", "sc-row");
      row.dataset.status = r.status;
      const status = el("span", "sc-chip", r.statusText);
      status.dataset.status = r.status;
      const what = el("div", "sc-what");
      const line = el("div", "sc-title");
      line.append(el("span", "sc-id", r.id), el("span", "", r.title));
      if (r.gate) line.append(el("span", "sc-gate", "GATE"));
      what.append(line);
      if (r.reason) what.append(el("div", "sc-muted sc-small", r.reason));
      row.append(status, el("span", "sc-sev", r.severity), what);
      if (r.fix) {
        const b = button(`FIX: ${r.fix}`);
        b.disabled = busy;
        b.addEventListener("click", () => act({ control: r.id, phase: "plan" }));
        row.append(b);
      } else row.append(el("span"));
      wrap.append(row);
    }
    return wrap;
  }
  function draw() {
    root.replaceChildren();
    if (!model) return;
    if (model.state !== "scored") {
      const empty = el("div", "sc-empty");
      empty.append(el("div", "sc-label", "Production readiness"), el("p", "", model.text));
      if (model.hint) empty.append(el("p", "sc-muted", model.hint));
      empty.append(scanButton());
      root.append(targets(), empty);
      return;
    }
    const busy = BUSY.includes(fixState?.phase);
    root.append(targets(), top());
    if (model.grants.length) root.append(grants());
    if (model.reasons.length) root.append(el("p", "sc-reasons", model.reasons.join(" · ")));
    root.append(categories());
    if (model.changes.length) root.append(changes());
    // FIX installs add-on stacks on the cluster; the AWS view has none.
    const f = model.target === "aws" ? fixModel(null) : fixModel(fixState, plan);
    if (f.step !== "idle") root.append(fixPane(f));
    // After a fix ends (or is refused) the next suggestions come back.
    if (["idle", "done", "failed", "refused"].includes(f.step) && model.next.length) root.append(nextUp(busy));
    root.append(table(busy), el("p", "sc-disclaimer", model.disclaimer));
  }
  return {
    isOpen: () => open,
    async setOpen(value) {
      open = Boolean(value);
      root.hidden = !open;
      toggleButton?.setAttribute("aria-pressed", String(open));
      if (open) await load();
      else clearTimeout(timer);
      onChange(open);
    },
    toggle() {
      return this.setOpen(!open);
    },
  };
}
