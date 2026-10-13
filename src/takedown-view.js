// TAKE DOWN CLUSTER on the EKS card (browser): a button opens the plan
// (GET /api/upgrade/takedown: stacks in order, resource counts, what runs
// first, warnings), a "scale to 1 node first" choice when the cluster has
// 0 nodes, and RUN, enabled only when the cluster name is typed exactly.
// The run itself shows in the card's run pane (one step per stack).
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

// A 12x12 pixel radiation trefoil (Pip-Boy style): three blades round a hub.
const NUKE_ROWS = [
  "....####....",
  "...######...",
  "#..######..#",
  "##..####..##",
  "###......###",
  "####.##.####",
  "####.##.####",
  "###......###",
  ".....##.....",
  "....####....",
  "...######...",
  "..########..",
];
export function nukeIcon(size = 18) {
  const rects = NUKE_ROWS.flatMap((row, y) => [...row].map((c, x) => (c === "#" ? `<rect x="${x}" y="${y}" width="1" height="1"/>` : ""))).join("");
  return `<svg class="nuke-ico" viewBox="0 0 12 12" width="${size}" height="${size}" shape-rendering="crispEdges" aria-hidden="true"><circle cx="6" cy="6" r="6" class="nuke-bg"/><g class="nuke-fg">${rects}</g></svg>`;
}

export function takedownRowHtml(cluster = "") {
  return `<div class="scale-btns"><button type="button" class="cmd nuke-btn" data-takedown title="every stack on ${esc(cluster || "this cluster")} in order (workloads, add-ons, Kyverno last), then the cluster; shows the plan first and asks for the cluster name">${nukeIcon()}<span>TEAR EVERYTHING DOWN${cluster ? ` · ${esc(cluster)}` : ""}</span></button></div>`;
}

export function takedownDialogHtml(plan, { scaleUp = true } = {}) {
  if (!plan || plan.error) return `<div class="scale-dialog" role="dialog" aria-label="take down cluster"><p class="scale-err">${esc(plan?.error || "no plan")}</p><div class="scale-btns"><button type="button" class="cmd" data-takedown-cancel>close</button></div></div>`;
  const total = plan.order.length + (plan.eks ? 1 : 0);
  const pre = plan.pre.map((p) => `<li><span>first: ${esc(p.text)}</span></li>`).join("");
  const rows = plan.order.map((s) => `<li><span>${esc(s.stack)}</span><code>${s.count} resource${s.count === 1 ? "" : "s"}</code></li>`).join("")
    + (plan.eks ? `<li><span>${esc(plan.eks.stack)} · the cluster itself</span><code>${plan.eks.count} resources</code></li>` : "")
    + `<li><span>then: list anything still tagged for ${esc(plan.cluster)} in AWS (read-only)</span></li>`;
  const zero = plan.zeroNodes ? `<label class="scale-wl"><input type="checkbox" data-takedown-scale${scaleUp ? " checked" : ""}> scale to 1 node first (recommended: the controllers delete the ALB and EBS volumes; a few cents)</label>` : "";
  const warn = plan.warnings.map((w) => `<em class="scale-warn">${esc(w)}</em>`).join("");
  const skipped = plan.already.length ? `<small class="scale-fine">already down, skipped: ${esc(plan.already.join(", "))}</small>` : "";
  return `<div class="scale-dialog" role="dialog" aria-label="take down ${esc(plan.cluster)}">`
    + `<h3>${nukeIcon(22)} tear down ${esc(plan.cluster)} <small>plan · nothing changed yet · ${total} stack${total === 1 ? "" : "s"}, ${plan.resources} resources</small></h3>${zero}<ol class="scale-steps">${pre}${rows}</ol>${skipped}${warn}`
    + `<label class="scale-confirm">type <b>${esc(plan.cluster)}</b> to confirm <input name="takedownConfirm" autocomplete="off" spellcheck="false" data-expect="${esc(plan.cluster)}"></label>`
    + `<div class="scale-btns"><button type="button" class="cmd nuke-btn" data-takedown-run disabled>${nukeIcon()}<span>TEAR DOWN ${esc(plan.cluster)}</span></button><button type="button" class="cmd" data-takedown-cancel>cancel</button></div>`
    + `<p class="scale-out" role="status"></p></div>`;
}

// get() returns { cluster, sample }; onStarted(answer) after a POST started the run.
export function mountTakedown(box, get, { fetchJson = (u, o) => fetch(u, o).then((r) => r.json()), onStarted = () => {}, onChange = () => {} } = {}) {
  let dialog = null;
  const paint = (html) => { box.innerHTML = html; wire(); onChange(); };
  const row = () => paint(takedownRowHtml(get().cluster));
  async function open(scaleUp = true) {
    const { cluster, sample } = get();
    dialog = { scaleUp };
    box.innerHTML = `<div class="scale-dialog"><p class="scale-fine">reading the stacks on ${esc(cluster)}…</p></div>`;
    const q = new URLSearchParams({ cluster, ...(scaleUp ? {} : { scaleUp: "0" }), ...(sample ? { sample: "1" } : {}) });
    const out = await fetchJson(`/api/upgrade/takedown?${q}`).catch((e) => ({ error: String(e.message || e) }));
    if (!dialog) return;
    dialog.plan = out.plan || { error: out.error || "no plan" };
    paint(takedownDialogHtml(dialog.plan, { scaleUp }));
  }
  function wire() {
    box.querySelector("[data-takedown]")?.addEventListener("click", () => open(true));
    box.querySelector("[data-takedown-cancel]")?.addEventListener("click", () => { dialog = null; row(); });
    box.querySelector("[data-takedown-scale]")?.addEventListener("change", (e) => open(e.target.checked));
    const input = box.querySelector("[data-expect]");
    const run = box.querySelector("[data-takedown-run]");
    input?.addEventListener("input", () => { run.disabled = String(input.value).trim() !== input.dataset.expect; });
    run?.addEventListener("click", async () => {
      run.disabled = true;
      const outEl = box.querySelector(".scale-out");
      outEl.textContent = "starting…";
      const out = await fetchJson("/api/upgrade/takedown", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cluster: get().cluster, sample: get().sample, scaleUp: dialog.scaleUp, confirm: input.value.trim() }) }).catch((e) => ({ error: String(e.message || e) }));
      if (out.running || out.state === "running") { dialog = null; row(); onStarted(out); return; }
      outEl.textContent = out.error || "did not start";
      outEl.classList.add("bad");
    });
  }
  row();
  return { open, state: () => dialog };
}
