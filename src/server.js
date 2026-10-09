import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const FILES = new Set([
  "browser.js",
  "draw.js",
  "sprites.js",
  "ui.js",
  "layout.js",
  "verbs.js",
  "ids.js",
  "report.js",
]);

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cloud Spider</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    display: flex;
    flex-direction: column;
    background: #14110d;
    color: #f2e3b8;
    font: bold 15px/1.4 Menlo, Monaco, Consolas, monospace;
  }
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 24px;
    align-items: center;
    padding: 12px 24px;
    border-bottom: 4px solid #4a3519;
    background: #1f1a14;
  }
  h1 { margin: 0; font-size: 18px; letter-spacing: 0.16em; color: #ffcc33; }
  label { display: flex; gap: 8px; align-items: center; color: #c2a978; }
  select, button {
    min-height: 44px;
    background: #2a2218;
    color: #f2e3b8;
    border: 2px solid #b08f52;
    font: inherit;
    padding: 0 14px;
  }
  button { cursor: pointer; }
  button:focus-visible, select:focus-visible { outline: 3px solid #ffcc33; outline-offset: 2px; }
  #yes { border-color: #e0603f; color: #ffd9cc; }
  #status { color: #fff2c8; }
  #radio { color: #a9cf86; }
  #confirm { flex-basis: 100%; margin: 0; min-height: 1.4em; font-size: 16px; }
  #confirm:empty, #status:empty, #radio:empty { display: none; }
  #error { color: #ff8a6b; margin: 0; padding: 10px 24px; background: #2a1510; }
  #map {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: repeating-linear-gradient(#1c1813 0 8px, #17140f 8px 16px);
  }
  canvas { display: block; image-rendering: pixelated; }
</style>
</head>
<body>
<header>
  <h1>CLOUD SPIDER</h1>
  <label>region <select id="region"></select></label>
  <span id="status"></span>
  <span id="radio"></span>
  <p id="confirm"></p>
  <button id="yes" type="button" hidden>put it down</button>
  <button id="no" type="button" hidden>leave it</button>
</header>
<p id="error" hidden></p>
<div id="map"><canvas id="place"></canvas></div>
<script type="module" src="/browser.js"></script>
</body>
</html>
`;

export function createServer(app) {
  return http.createServer(async (req, res) => {
    try {
      await route(app, req, res);
    } catch {
      send(res, 500, { status: "the page failed" });
    }
  });
}

export function listen(app, port = 9241) {
  const server = createServer(app);
  return new Promise((resolve, reject) => {
    const fail = (error) => reject(error);
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", fail);
      resolve(server);
    });
  });
}

async function route(app, req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(page);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/")) {
    const name = url.pathname.slice(1);
    if (FILES.has(name)) {
      const body = await readFile(join(root, name));
      res.writeHead(200, {
        "content-type": "text/javascript; charset=utf-8",
        "cache-control": "no-store",
      });
      res.end(body);
      return;
    }
  }

  if (req.method === "GET" && url.pathname === "/api/view") {
    await app.boot();
    send(res, 200, app.view());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/logs") {
    await app.boot();
    send(res, 200, await app.logsFor(url.searchParams.get("id")));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/stop") {
    const body = await readJson(req);
    send(res, 200, await app.stop(req.headers.origin, body.id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/start") {
    const body = await readJson(req);
    send(res, 200, await app.start(req.headers.origin, body.id));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/region") {
    const body = await readJson(req);
    send(res, 200, await app.switchRegion(body.region));
    return;
  }

  send(res, 404, { status: "not found" });
}

function send(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("body too large");
    chunks.push(chunk);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
