// /api/netdebug routes. server.js hands every request here first; true
// means it was answered. GET reads; POST needs the page's own origin.
export async function netdebugRoute(req, res, url, netdebug, { send, readJson }) {
  if (url.pathname !== "/api/netdebug" && !url.pathname.startsWith("/api/netdebug/")) return false;
  if (!netdebug) {
    send(res, 200, { error: "network debugging is not set up" });
    return true;
  }
  const status = (out) => out?.status || 200;
  if (req.method === "POST" && url.pathname === "/api/netdebug") {
    const body = await readJson(req).catch(() => null);
    if (!body || typeof body !== "object") {
      send(res, 400, { error: "the request was not JSON" });
      return true;
    }
    const out = await netdebug.start(req.headers.origin, body);
    send(res, status(out), out);
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/netdebug") {
    send(res, 200, await netdebug.list());
    return true;
  }
  const m = url.pathname.match(/^\/api\/netdebug\/([A-Za-z0-9-]+?)(?:\.(json|md))?$/);
  if (req.method === "GET" && m) {
    if (m[2]) {
      const out = await netdebug.export(m[1], m[2]);
      if (out.error) {
        send(res, status(out), out);
        return true;
      }
      res.writeHead(200, { "content-type": out.type, "content-disposition": `attachment; filename="${out.filename}"`, "cache-control": "no-store" });
      res.end(out.body);
      return true;
    }
    const out = await netdebug.get(m[1]);
    send(res, status(out), out);
    return true;
  }
  send(res, 404, { error: "no such netdebug route" });
  return true;
}
