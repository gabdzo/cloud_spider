// GET  /api/eks/scale?cluster=&context=&mode=down|up&workloads=1   dry run
// POST /api/eks/scale {cluster, context, mode, workloads, confirm}  runs it
//   (same-origin page only; context must be in kube.writeContexts; confirm
//   is the cluster name typed in the dialog).
import { originAllowed } from "./origin.js";
import { scaleCluster } from "./eks-scale.js";

export async function eksScaleRoute(req, res, url, scale, { send, readJson }) {
  if (url.pathname !== "/api/eks/scale") return false;
  if (!scale) { send(res, 200, { error: "scaling needs the kubernetes module and a write context" }); return true; }
  const args = req.method === "POST" ? await readJson(req).catch(() => null) : Object.fromEntries(url.searchParams);
  if (!args || typeof args !== "object") { send(res, 400, { error: "the request was not JSON" }); return true; }
  const context = String(args.context || scale.writeContexts[0] || "");
  if (!scale.writeContexts.includes(context)) { send(res, 400, { error: `context ${context || "(none)"} is not in kube.writeContexts`, writeContexts: scale.writeContexts }); return true; }
  const mode = args.mode === "up" ? "up" : args.mode === "down" ? "down" : null;
  if (!mode || !args.cluster) { send(res, 400, { error: "cluster and mode (down|up) are required" }); return true; }
  const execute = req.method === "POST";
  if (execute && !originAllowed(req.headers.origin, scale.pageOrigin)) { send(res, 403, { error: "nothing was scaled", hint: "Open Cloud Spider at the address npm start printed." }); return true; }
  try {
    const out = await scaleCluster({ cluster: String(args.cluster), context, region: args.region || "eu-north-1", mode, workloads: args.workloads === true || args.workloads === "1", run: scale.run, store: scale.store, execute, confirm: args.confirm });
    if (execute && scale.audit) await scale.audit({ action: `eks-scale-${mode}`, cluster: args.cluster, context, ok: out.result?.ok ?? false, error: out.error });
    send(res, out.error ? 400 : 200, out);
  } catch (error) {
    send(res, 502, { error: String(error.message || error).slice(0, 400) });
  }
  return true;
}
