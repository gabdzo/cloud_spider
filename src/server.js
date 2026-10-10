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
    background: #0d1117;
    color: #5fcf95;
    font: bold 14px/1.5 Menlo, Monaco, "Courier New", monospace;
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
    gap: 8px 16px;
    align-items: center;
    padding: 12px 20px;
    background: #1a1f2e;
    border: 3px solid #00d9ff;
    border-width: 0 0 3px 0;
    box-shadow: inset 0 0 0 1px #0a0e1a, 0 3px 8px rgba(0, 0, 0, 0.6);
    position: relative;
  }
  header::before {
    content: "";
    position: absolute;
    top: 0;
    left: 0;
    width: 6px;
    height: 6px;
    background: #00d9ff;
    box-shadow: calc(100% - 6px) 0 0 #00d9ff;
  }
  h1 {
    margin: 0;
    font-size: 16px;
    letter-spacing: 0.2em;
    color: #ff8500;
    text-shadow: 0 0 8px rgba(255, 133, 0, 0.6), 2px 2px 0 #000;
    font-weight: bold;
  }
  label {
    display: flex;
    gap: 6px;
    align-items: center;
    color: #6dff6d;
    font-size: 13px;
  }
  select, button, input {
    min-height: 36px;
    background: #0a0e1a;
    color: #5fcf95;
    border: 2px solid #4db8ff;
    font: inherit;
    font-size: 13px;
    padding: 0 12px;
    box-shadow: inset 0 0 0 1px #1a1f2e, 2px 2px 0 rgba(0, 0, 0, 0.4);
    position: relative;
  }
  select::before, button::before, input::before {
    content: "";
    position: absolute;
    top: -2px;
    left: -2px;
    width: 4px;
    height: 4px;
    background: #4db8ff;
  }
  button {
    cursor: pointer;
    transition: all 0.1s ease;
    font-weight: bold;
  }
  button:hover:not(:disabled) {
    background: #152030;
    box-shadow: inset 0 0 0 1px #1a1f2e, 2px 2px 0 rgba(0, 0, 0, 0.6), 0 0 12px rgba(77, 184, 255, 0.4);
  }
  button:active:not(:disabled) {
    transform: translate(1px, 1px);
    box-shadow: inset 0 0 0 1px #1a1f2e, 1px 1px 0 rgba(0, 0, 0, 0.6);
  }
  button:focus-visible, select:focus-visible, input:focus-visible {
    outline: 3px solid #ff8500;
    outline-offset: 2px;
  }
  #yes {
    border-color: #ff4444;
    color: #ffaa88;
    box-shadow: inset 0 0 0 1px #1a1f2e, 2px 2px 0 rgba(0, 0, 0, 0.4), 0 0 8px rgba(255, 68, 68, 0.3);
  }
  #yes:hover:not(:disabled) {
    box-shadow: inset 0 0 0 1px #1a1f2e, 2px 2px 0 rgba(0, 0, 0, 0.6), 0 0 16px rgba(255, 68, 68, 0.5);
  }
  #status { color: #ffa726; }
  #confirm {
    flex-basis: 100%;
    margin: 0;
    min-height: 1.5em;
    font-size: 14px;
    color: #6dff6d;
  }
  #confirm:empty, #status:empty, #radio:empty { display: none; }
  #radio {
    margin: 0;
    padding: 8px 20px;
    max-height: calc(6 * 1.5em + 16px);
    overflow: auto;
    white-space: pre;
    color: #ffa726;
    background: #0a0e1a;
    border: 3px solid #ff8500;
    border-width: 0 0 3px 0;
    box-shadow: inset 0 0 0 1px #1a1f2e;
    font-size: 12px;
  }
  select:disabled { opacity: 0.5; filter: grayscale(0.5); }
  input { min-width: 240px; }
  input::placeholder { color: #4db8ff; opacity: 0.6; }
  [hidden] { display: none !important; }
  #error {
    color: #ff6b6b;
    margin: 0;
    padding: 10px 20px;
    background: #1a0a0a;
    border: 3px solid #ff4444;
    border-width: 0 0 3px 0;
    box-shadow: inset 0 0 0 1px #000, 0 0 12px rgba(255, 68, 68, 0.3);
  }
  #map {
    flex: 1;
    min-height: 0;
    overflow: auto;
    background: radial-gradient(circle at 30% 40%, #1a1f2e 0%, #0d1117 60%);
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
      radial-gradient(circle at 20% 80%, rgba(255, 133, 0, 0.03) 0%, transparent 25%),
      radial-gradient(circle at 80% 20%, rgba(77, 184, 255, 0.03) 0%, transparent 25%);
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
