import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { samplePlace } from "./sample.js";
import { samplePathGraph } from "./path-sample.js";
import { pathResult } from "./path-view.js";

const root = dirname(fileURLToPath(import.meta.url));
const FILES = new Set([
  "browser.js",
  "draw.js",
  "sprites.js",
  "pixel-art.js",
  "ui.js",
  "layout.js",
  "verbs.js",
  "ids.js",
  "report.js",
  "path-layout.js",
  "path-draw.js",
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
    text-rendering: optimizeSpeed;
    image-rendering: pixelated;
    position: relative;
  }
  body::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: repeating-linear-gradient(
      0deg,
      rgba(0, 0, 0, 0.15) 0px,
      transparent 1px,
      transparent 2px,
      rgba(0, 0, 0, 0.15) 3px
    );
    pointer-events: none;
    z-index: 9999;
    opacity: 0.3;
  }
  @media (prefers-reduced-motion: reduce) {
    body::before { display: none; }
  }
  header {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 24px;
    align-items: center;
    padding: 12px 24px;
    background: #1f1a14;
    border: 4px solid #4a3519;
    border-width: 0 0 4px 0;
    box-shadow: inset 0 0 0 1px #14110d, 0 3px 8px rgba(0, 0, 0, 0.6);
    position: relative;
  }
  header::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 6px;
    height: 6px;
    background: #7a5f48;
  }
  header::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    width: 6px;
    height: 6px;
    background: #7a5f48;
  }
  h1 {
    margin: 0;
    font-size: 18px;
    letter-spacing: 0.16em;
    color: #ffcc33;
    text-shadow: 0 0 8px rgba(255, 204, 51, 0.6), 2px 2px 0 #000;
    font-weight: bold;
  }
  label {
    display: flex;
    gap: 8px;
    align-items: center;
    color: #c2a978;
    font-size: 14px;
  }
  select, button, input {
    min-height: 44px;
    background: #2a2218;
    color: #f2e3b8;
    border: 2px solid #b08f52;
    font: inherit;
    padding: 0 14px;
    box-shadow: inset 0 0 0 1px #1f1a14, 2px 2px 0 rgba(0, 0, 0, 0.4);
    position: relative;
  }
  button::before {
    content: "";
    position: absolute;
    top: -2px;
    left: -2px;
    width: 4px;
    height: 4px;
    background: #b08f52;
  }
  button {
    cursor: pointer;
    transition: all 0.1s ease;
    font-weight: bold;
  }
  button:hover:not(:disabled) {
    background: #3a2a1a;
    box-shadow: inset 0 0 0 1px #1f1a14, 2px 2px 0 rgba(0, 0, 0, 0.6), 0 0 12px rgba(176, 143, 82, 0.4);
  }
  button:active:not(:disabled) {
    transform: translate(1px, 1px);
    box-shadow: inset 0 0 0 1px #1f1a14, 1px 1px 0 rgba(0, 0, 0, 0.6);
  }
  button:focus-visible, select:focus-visible, input:focus-visible {
    outline: 3px solid #ffcc33;
    outline-offset: 2px;
  }
  #yes {
    border-color: #e0603f;
    color: #ffd9cc;
    box-shadow: inset 0 0 0 1px #1f1a14, 2px 2px 0 rgba(0, 0, 0, 0.4), 0 0 8px rgba(224, 96, 63, 0.3);
  }
  #yes:hover:not(:disabled) {
    box-shadow: inset 0 0 0 1px #1f1a14, 2px 2px 0 rgba(0, 0, 0, 0.6), 0 0 16px rgba(224, 96, 63, 0.5);
  }
  #status { color: #fff2c8; }
  #confirm {
    flex-basis: 100%;
    margin: 0;
    min-height: 1.4em;
    font-size: 16px;
    color: #c2a978;
  }
  #confirm:empty, #status:empty, #radio:empty { display: none; }
  #radio {
    margin: 0;
    padding: 8px 24px;
    max-height: calc(6 * 1.4em + 16px);
    overflow: auto;
    white-space: pre;
    color: #a9cf86;
    background: #1a1510;
    border: 4px solid #4a3519;
    border-width: 0 0 4px 0;
    box-shadow: inset 0 0 0 1px #14110d;
    font-size: 13px;
  }
  select:disabled { opacity: 0.45; filter: grayscale(0.5); }
  input { min-width: 240px; }
  input::placeholder { color: #c2a978; opacity: 0.6; }
  [hidden] { display: none !important; }
  #error {
    color: #ff8a6b;
    margin: 0;
    padding: 10px 24px;
    background: #2a1510;
    border: 4px solid #e0603f;
    border-width: 0 0 4px 0;
    box-shadow: inset 0 0 0 1px #14110d, 0 0 12px rgba(224, 96, 63, 0.3);
  }
  #map {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: repeating-linear-gradient(#1c1813 0 8px, #17140f 8px 16px);
    position: relative;
  }
  #map::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-image: 
      radial-gradient(circle at 20% 80%, rgba(255, 204, 51, 0.03) 0%, transparent 25%),
      radial-gradient(circle at 80% 20%, rgba(169, 207, 134, 0.03) 0%, transparent 25%);
    pointer-events: none;
  }
  canvas { display: block; image-rendering: pixelated; image-rendering: crisp-edges; }
</style>
</head>
<body>
<header>
  <h1>CLOUD SPIDER</h1>
  <label>region <select id="region"></select></label>
  <button id="sample" type="button">Sample</button>
  <button id="path" type="button">Path</button>
  <select id="lb" aria-label="load balancer" hidden></select>
  <input id="host" type="text" aria-label="URL or host" placeholder="paste a URL or host" hidden>
  <span id="status"></span>
  <p id="confirm"></p>
  <button id="yes" type="button" hidden>put it down</button>
  <button id="no" type="button" hidden>leave it</button>
</header>
<pre id="radio"></pre>
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

export function listenExit(error, port = 9241) {
  if (error?.code === "EADDRINUSE") {
    return {
      code: 0,
      line: `Cloud Spider is already open at http://127.0.0.1:${port}`,
    };
  }
  return { code: 1, line: `listen: ${error?.message || "the page failed"}` };
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

  if (req.method === "GET" && url.pathname === "/api/sample") {
    send(res, 200, { place: samplePlace() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/path-sample") {
    send(
      res,
      200,
      pathResult(samplePathGraph(), {
        lb: url.searchParams.get("lb") || "",
        host: url.searchParams.get("host") || "",
        region: "sample",
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/path") {
    await app.boot();
    send(
      res,
      200,
      await app.pathView({
        lb: url.searchParams.get("lb") || "",
        host: url.searchParams.get("host") || "",
      }),
    );
    return;
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
