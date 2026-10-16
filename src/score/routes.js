// /api/score routes. server.js hands every request here first; true means
// it was answered. GET reads; POST needs the page's own origin (api.js).
export async function scoreRoute(req, res, url, score, { send, readJson }) {
  if (url.pathname !== "/api/score" && !url.pathname.startsWith("/api/score/")) return false;
  if (!score) {
    send(res, 200, { error: "the scorecard is not set up" });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/score") {
    send(res, 200, await score.view({ context: url.searchParams.get("context") || "", target: url.searchParams.get("target") === "aws" ? "aws" : "kubernetes" }));
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/score/apps") {
    send(res, 200, score.apps ? await score.apps({ context: url.searchParams.get("context") || "", sample: url.searchParams.get("sample") === "1" }) : { error: "the app score is not set up" });
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/score/report") {
    const out = await score.report(url.searchParams.get("id") || "", url.searchParams.get("format") || "md");
    if (out.error) {
      send(res, out.error.startsWith("format") ? 400 : 404, out);
      return true;
    }
    res.writeHead(200, { "content-type": out.type, "content-disposition": `attachment; filename="${out.filename}"`, "cache-control": "no-store" });
    res.end(out.body);
    return true;
  }
  if (req.method === "GET" && url.pathname === "/api/score/fix") {
    send(res, 200, score.fixState());
    return true;
  }
  if (req.method === "POST" && ["/api/score/scan", "/api/score/fix"].includes(url.pathname)) {
    const body = await readJson(req).catch(() => null);
    if (!body || typeof body !== "object") {
      send(res, 400, { error: "the request was not JSON", hint: "Reload the page and press the button again." });
      return true;
    }
    send(res, 200, url.pathname === "/api/score/scan" ? await score.scan(req.headers.origin, body) : await score.fix(req.headers.origin, body));
    return true;
  }
  send(res, 404, { error: "no such scorecard route" });
  return true;
}
