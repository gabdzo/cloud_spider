// GET  /api/eks/scale?cluster=&context=&mode=down|up&workloads=1   dry run
// GET  /api/eks/scale/status?cluster=                               saved sizes (no AWS call)
// POST /api/eks/scale {cluster, context, mode, workloads, confirm}  runs it
//   (same-origin page only; context must be in kube.writeContexts; confirm
//   is the cluster name typed in the dialog). sample=1: the SAMPLE cluster,
//   nothing read or run.
import { originAllowed } from "./origin.js";
import { planScale, planText, confirmOk, sampleScaleState, scaleCluster } from "./eks-scale.js";

const sampleSaved = { record: null };

export async function eksScaleRoute(req, res, url, scale, { send, readJson }) {
  if (url.pathname !== "/api/eks/scale" && url.pathname !== "/api/eks/scale/status") return false;
  const args = req.method === "POST" ? await readJson(req).catch(() => null) : Object.fromEntries(url.searchParams);
  if (!args || typeof args !== "object") { send(res, 400, { error: "the request was not JSON" }); return true; }
  const sample = args.sample === true || args.sample === "1";
  if (url.pathname === "/api/eks/scale/status") {
    const saved = sample ? sampleSaved.record : scale ? await scale.store.load(String(args.cluster || "")) : null;
    send(res, 200, { scaledDown: Boolean(saved), saved, canScale: sample || Boolean(scale), writeContexts: scale?.writeContexts || [] });
    return true;
  }
  const mode = args.mode === "up" ? "up" : args.mode === "down" ? "down" : null;
  if (!mode || !args.cluster) { send(res, 400, { error: "cluster and mode (down|up) are required" }); return true; }
  const execute = req.method === "POST";
  const pageOrigin = scale?.pageOrigin || (sample ? `http://${req.headers.host}` : "");
  if (execute && !originAllowed(req.headers.origin, pageOrigin)) { send(res, 403, { error: "nothing was scaled", hint: "Open Cloud Spider at the address npm start printed." }); return true; }
  const workloads = args.workloads === true || args.workloads === "1";
  if (sample) {
    const base = sampleScaleState();
    const state = sampleSaved.record && mode === "down" ? { ...base, nodegroups: base.nodegroups.map((g) => ({ ...g, min: 0, desired: 0 })), nodeclaims: [], nodes: [] } : sampleSaved.record ? { ...base, nodes: [], nodeclaims: [] } : base;
    const plan = planScale(state, { mode, workloads, saved: sampleSaved.record });
    if (!execute || plan.error) { send(res, 200, { plan, text: planText(plan), ran: false, sample: true }); return true; }
    if (!confirmOk(plan, args.confirm)) { send(res, 400, { plan, ran: false, error: `type the cluster name (${plan.cluster}) to confirm` }); return true; }
    sampleSaved.record = mode === "down" ? { ...plan.record, at: new Date().toISOString() } : null;
    send(res, 200, { plan, ran: true, sample: true, result: { ok: true, done: plan.steps.map((s) => ({ what: s.what, ok: true })) } });
    return true;
  }
  if (!scale) { send(res, 200, { error: "scaling needs the kubernetes module and a kube.writeContexts entry" }); return true; }
  const context = String(args.context || scale.writeContexts[0] || "");
  if (!scale.writeContexts.includes(context)) { send(res, 400, { error: `context ${context || "(none)"} is not in kube.writeContexts`, writeContexts: scale.writeContexts }); return true; }
  try {
    const out = await scaleCluster({ cluster: String(args.cluster), context, region: args.region || "eu-north-1", mode, workloads, run: scale.run, store: scale.store, execute, confirm: args.confirm });
    if (execute && scale.audit) await scale.audit({ action: `eks-scale-${mode}`, cluster: args.cluster, context, ok: out.result?.ok ?? false, error: out.error });
    send(res, out.error ? 400 : 200, out);
  } catch (error) {
    send(res, 502, { error: String(error.message || error).slice(0, 400) });
  }
  return true;
}

export const _sampleReset = () => { sampleSaved.record = null; };
