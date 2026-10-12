// The only Kubernetes writes in Cloud Spider's network toolkit: create,
// get, log and delete of its own debug pods, through a WRITE context
// (kube.writeContexts), never the viewer. Paths are fixed: pods in one
// namespace, nothing else.
import { request } from "node:https";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { parse } from "yaml";
import { checkName, kubeconfigPath, pickContext, runExec } from "../kube.js";

function call(url, { method, ca, token, servername, body, timeout = 15_000 }) {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : null;
    const req = request(url, { method, ca: ca || undefined, ...(servername ? { servername } : {}), timeout, headers: { authorization: `Bearer ${token}`, accept: "application/json", ...(data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {}) } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => {
        if (text.length < 1024 * 1024) text += c;
      });
      res.on("end", () => resolve({ status: res.statusCode || 0, text }));
    });
    req.on("timeout", () => req.destroy(new Error(`no answer in ${timeout} ms`)));
    req.on("error", (e) => resolve({ status: 0, text: "", error: e?.message || "the request failed" }));
    if (data) req.write(data);
    req.end();
  });
}

export function createPodWriter({ context, env = process.env, read = readFile, run = spawn, send = call }) {
  let target = null;
  async function auth() {
    if (!target) {
      const text = await read(kubeconfigPath(env), "utf8").catch(() => null);
      if (!text) return { error: `no kubeconfig at ${kubeconfigPath(env)}` };
      const picked = pickContext(parse(text), context);
      if (picked.error) return picked;
      let ca = picked.caData ? Buffer.from(picked.caData, "base64").toString("utf8") : "";
      if (!ca && picked.caFile) ca = await read(picked.caFile, "utf8").catch(() => "");
      target = { ...picked, ca };
    }
    if (target.token) return { ...target, bearer: target.token };
    if (!target.exec) return { error: `kube context ${context} has no token and no exec plugin` };
    const got = await runExec(run, target.exec, env);
    return got.error ? got : { ...target, bearer: got.token };
  }
  async function go(method, path, { body, text = false } = {}) {
    const t = await auth();
    if (t.error) return { error: t.error };
    const res = await send(`${t.server}${path}`, { method, ca: t.ca, servername: t.tlsServerName, token: t.bearer, body });
    if (res.error) return { error: res.error };
    if (res.status === 403) return { forbidden: true, error: `forbidden for ${context}` };
    if (res.status === 404) return { missing: true, error: "not found" };
    if (res.status < 200 || res.status >= 300) {
      let msg = `the cluster said ${res.status}`;
      try {
        msg += `: ${JSON.parse(res.text).message}`;
      } catch {}
      return { error: msg };
    }
    if (text) return { text: res.text };
    try {
      return { json: JSON.parse(res.text) };
    } catch {
      return { error: "the cluster did not answer JSON" };
    }
  }
  const pods = (ns) => `/api/v1/namespaces/${checkName(ns)}/pods`;
  return {
    context,
    createPod: (ns, spec) => {
      if (spec?.kind !== "Pod" || spec.metadata?.namespace !== ns || spec.metadata?.labels?.["app.kubernetes.io/managed-by"] !== "cloudspider") return Promise.resolve({ error: "only Cloud Spider debug pods are created" });
      return go("POST", pods(ns), { body: spec });
    },
    getPod: (ns, name) => go("GET", `${pods(ns)}/${checkName(name)}`),
    podLog: (ns, name) => go("GET", `${pods(ns)}/${checkName(name)}/log?container=probe&limitBytes=262144`, { text: true }),
    deletePod: (ns, name) => go("DELETE", `${pods(ns)}/${checkName(name)}?gracePeriodSeconds=0`),
    listPods: (ns, selector) => go("GET", `${pods(ns)}?labelSelector=${encodeURIComponent(selector)}`),
  };
}
