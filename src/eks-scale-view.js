// SCALE DOWN / SCALE UP on the EKS stack card (browser). The row shows a
// SCALED DOWN chip with the saved sizes when the cluster is down, the two
// buttons and the warning that a RUN of EKS / add-ons scales it back up.
// A button opens the dialog: the dry run (GET /api/eks/scale), cost before
// and after, what keeps billing, a 'workloads to 0' checkbox (scale down),
// and RUN, enabled only when the cluster name is typed exactly; it POSTs
// /api/eks/scale with that name as confirm.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const usd = (m) => `$${Number(m).toFixed(2)}`;

export const SCALE_WARNING = "A RUN (pulumi up) of this EKS card or of the add-ons stack puts the node group and Karpenter's limits back: it scales the cluster up again.";

export function savedSizesText(saved) {
  if (!saved) return "";
  const groups = (saved.nodegroups || []).map((g) => `${g.name} ${g.min}/${g.desired}/${g.max}`);
  const pools = (saved.nodepools || []).map((p) => `NodePool ${p.name} ${p.limits ? Object.entries(p.limits).map(([k, v]) => `${k} ${v}`).join(", ") : "no limits"}`);
  const wl = (saved.workloads || []).length ? [`${saved.workloads.length} workload${saved.workloads.length === 1 ? "" : "s"} at 0`] : [];
  return [...groups, ...pools, ...wl].join(" · ");
}

export function scaleRowHtml({ cluster, status }) {
  const down = Boolean(status?.scaledDown);
  const chip = down ? `<span class="st-chip scaled" title="saved sizes: ${esc(savedSizesText(status.saved))}${status.saved?.at ? ` (since ${esc(status.saved.at.slice(0, 16).replace("T", " "))} UTC)` : ""}">SCALED DOWN</span><span class="scale-saved">saved: ${esc(savedSizesText(status.saved))}</span>` : "";
  const off = status && status.canScale === false;
  return `<div class="scale-head">${chip}</div>`
    + `<div class="scale-btns"><button type="button" class="cmd" data-scale="down"${down || off ? " disabled" : ""} title="stop paying for nodes; keeps the control plane, data and state">scale down</button>`
    + `<button type="button" class="cmd" data-scale="up"${down && !off ? "" : " disabled"} title="restore the saved node sizes">scale up</button></div>`
    + `<em class="scale-warn">${esc(SCALE_WARNING)}</em>`
    + (off ? `<em class="scale-warn">Scaling ${esc(cluster || "this cluster")} needs a write context: add <code>kube.writeContexts: [${esc(cluster ? `${cluster}-admin` : "<context>")}]</code> to cloudspider.yaml (the viewer cannot scale).</em>` : "");
}

export function scaleDialogHtml(plan, { workloads = false } = {}) {
  if (plan.error) return `<div class="scale-dialog" role="dialog" aria-label="scale"><p class="scale-err">${esc(plan.error)}</p><div class="scale-btns"><button type="button" class="cmd" data-scale-cancel>close</button></div></div>`;
  const steps = plan.steps.map((s) => `<li><span>${esc(s.what)}</span>${s.cmd ? `<code>${esc(`${s.cmd} ${s.args.join(" ")}`)}</code>` : ""}</li>`).join("");
  const still = plan.mode === "down" ? `<h4>still billed while scaled down</h4><ul class="scale-still">${plan.after.items.map((i) => `<li><b>${usd(i.month)}</b><span>${esc(i.text)}</span></li>`).join("")}</ul>` : "";
  const after = plan.after ? usd(plan.after.month) : "?";
  const cost = `<div class="scale-cost"><span>now <b>${usd(plan.before.month)}</b>/mo</span><span>after <b>${after}</b>/mo</span>${plan.saves != null ? `<span>saves <b>${usd(plan.saves)}</b>/mo</span>` : ""}</div><small class="scale-fine">rough: eu-north-1 prices, spot ~35% of on-demand, ALB LCUs and data extra</small>`;
  const wl = plan.mode === "down" ? `<label class="scale-wl"><input type="checkbox" data-scale-workloads${workloads ? " checked" : ""}> workloads to 0 (apps outside system namespaces; replicas saved)</label>` : "";
  return `<div class="scale-dialog" role="dialog" aria-label="scale ${esc(plan.mode)} ${esc(plan.cluster)}">`
    + `<h3>scale ${esc(plan.mode)} ${esc(plan.cluster)} <small>dry run · nothing changed yet</small></h3>${cost}${wl}<ol class="scale-steps">${steps}</ol>${still}`
    + `<label class="scale-confirm">type <b>${esc(plan.cluster)}</b> to confirm <input name="scaleConfirm" autocomplete="off" spellcheck="false" data-expect="${esc(plan.cluster)}"></label>`
    + `<div class="scale-btns"><button type="button" class="cmd${plan.mode === "down" ? " danger" : ""}" data-scale-run="${esc(plan.mode)}" disabled>run scale ${esc(plan.mode)}</button><button type="button" class="cmd" data-scale-cancel>cancel</button></div>`
    + `<p class="scale-out" role="status"></p></div>`;
}

export const confirmReady = (typed, cluster) => String(typed || "").trim() === cluster;

// Mount into a card element; get() returns { cluster, sample, context }.
export function mountScale(box, get, { fetchJson = (u, o) => fetch(u, o).then((r) => r.json()), onChange = () => {} } = {}) {
  let status = null;
  let dialog = null; // { mode, workloads }
  const q = (extra = {}) => { const { cluster, sample, context } = get(); return new URLSearchParams({ cluster, ...(context ? { context } : {}), ...(sample ? { sample: "1" } : {}), ...extra }); };
  const paint = (html) => { box.innerHTML = html; wire(); onChange(); };
  const row = () => paint(scaleRowHtml({ cluster: get().cluster, status }));
  async function refresh() {
    status = await fetchJson(`/api/eks/scale/status?${q()}`).catch(() => null);
    if (!dialog) row();
  }
  async function open(mode, workloads = false) {
    dialog = { mode, workloads };
    box.innerHTML = `<div class="scale-dialog"><p class="scale-fine">reading ${esc(get().cluster)}…</p></div>`;
    const out = await fetchJson(`/api/eks/scale?${q({ mode, ...(workloads ? { workloads: "1" } : {}) })}`).catch((e) => ({ plan: { error: String(e.message || e) } }));
    if (!dialog || dialog.mode !== mode) return;
    dialog.plan = out.plan || { error: out.error || "no plan" };
    paint(scaleDialogHtml(dialog.plan, { workloads }));
  }
  function wire() {
    box.querySelectorAll("[data-scale]").forEach((b) => b.addEventListener("click", () => open(b.dataset.scale)));
    box.querySelector("[data-scale-cancel]")?.addEventListener("click", () => { dialog = null; row(); });
    box.querySelector("[data-scale-workloads]")?.addEventListener("change", (e) => open("down", e.target.checked));
    const input = box.querySelector("[data-expect]");
    const run = box.querySelector("[data-scale-run]");
    input?.addEventListener("input", () => { run.disabled = !confirmReady(input.value, input.dataset.expect); });
    run?.addEventListener("click", async () => {
      run.disabled = true;
      const outEl = box.querySelector(".scale-out");
      outEl.textContent = `scaling ${dialog.mode}…`;
      const { cluster, sample, context } = get();
      const out = await fetchJson("/api/eks/scale", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cluster, context, sample, mode: dialog.mode, workloads: dialog.workloads, confirm: input.value.trim() }) }).catch((e) => ({ error: String(e.message || e) }));
      if (out.ran && out.result?.ok) { dialog = null; await refresh(); return; }
      outEl.textContent = out.error || out.result?.error || "failed";
      outEl.classList.add("bad");
    });
  }
  return { refresh, open, state: () => ({ status, dialog }) };
}
