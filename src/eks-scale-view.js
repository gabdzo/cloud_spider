// SCALE DOWN / SCALE UP dialog for the EKS stack card: pure HTML from a dry
// run (GET /api/eks/scale). The run button stays disabled until the cluster
// name is typed; it POSTs /api/eks/scale with that name as confirm.
// Not yet mounted in the STACKS panel (being redesigned): the panel calls
// scaleButtonsHtml(card) and scaleDialogHtml(plan).
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const usd = (m) => `$${Number(m).toFixed(2)}/mo`;

export function scaleButtonsHtml({ cluster, scaledDown = false }) {
  return `<div class="eks-scale" data-cluster="${esc(cluster)}">`
    + `<button type="button" data-scale="down"${scaledDown ? " disabled" : ""} title="Stop paying for nodes; keeps the control plane, data and state">SCALE DOWN</button>`
    + `<button type="button" data-scale="up"${scaledDown ? "" : " disabled"} title="Restore the saved node sizes">SCALE UP</button></div>`;
}

export function scaleDialogHtml(plan) {
  if (plan.error) return `<div class="eks-scale-dialog" role="dialog"><p class="error">${esc(plan.error)}</p></div>`;
  const steps = plan.steps.map((s) => `<li>${esc(s.what)}${s.cmd ? `<code>${esc(`${s.cmd} ${s.args.join(" ")}`)}</code>` : ""}</li>`).join("");
  const still = plan.mode === "down" ? `<h4>Still billed while scaled down</h4><ul>${plan.after.items.map((i) => `<li>${usd(i.month)} ${esc(i.text)}</li>`).join("")}</ul><h4>Kept</h4><ul>${plan.keeps.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>` : "";
  const cost = `<p class="cost">now ~${usd(plan.before.month)} → after ~${plan.after ? usd(plan.after.month) : "?"}${plan.saves != null ? ` · saves ~${usd(plan.saves)}` : ""} <small>(rough, eu-north-1, spot ~35% of on-demand)</small></p>`;
  return `<div class="eks-scale-dialog" role="dialog" aria-label="scale ${esc(plan.mode)} ${esc(plan.cluster)}">`
    + `<h3>SCALE ${esc(plan.mode.toUpperCase())} ${esc(plan.cluster)} <small>dry run · nothing changed yet</small></h3>${cost}<ol>${steps}</ol>${still}`
    + `<label>Type <b>${esc(plan.cluster)}</b> to confirm <input name="confirm" autocomplete="off" data-expect="${esc(plan.cluster)}"></label>`
    + `<button type="button" data-scale-run="${esc(plan.mode)}" disabled>RUN SCALE ${esc(plan.mode.toUpperCase())}</button></div>`;
}

// Enable the run button only on an exact match (wired by the panel).
export const confirmReady = (typed, cluster) => String(typed || "").trim() === cluster;
