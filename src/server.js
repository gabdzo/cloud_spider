import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { samplePlace } from "./sample.js";
import { samplePathGraph } from "./path-sample.js";
import { pathResult } from "./path-view.js";
import { sampleCost } from "./cost.js";
import { sampleCluster } from "./cluster.js";

const root = dirname(fileURLToPath(import.meta.url));
const FILES = new Set([
  "browser.js",
  "draw.js",
  "sprites.js",
  "pixel-art.js",
  "layout-cache.js",
  "ui.js",
  "layout.js",
  "verbs.js",
  "ids.js",
  "report.js",
  "path-layout.js",
  "path-draw.js",
  "scene.js",
  "cluster.js",
  "upgrade-rules.js",
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
  html, body { height: 100%; overflow: hidden; }
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
    min-width: 0;
    max-width: 100%;
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
  #status {
    min-width: 0;
    overflow-wrap: anywhere;
    color: #fff2c8;
  }
  #status.issue {
    color: #ff8a6b;
    background: #2a1510;
    padding: 2px 8px;
    border: 2px solid #e0603f;
  }
  #confirm {
    flex-basis: 100%;
    min-width: 0;
    margin: 0;
    min-height: 1.4em;
    overflow-wrap: anywhere;
    font-size: 16px;
    color: #c2a978;
  }
  #home {
    width: 48px;
    height: 44px;
    padding: 0;
    cursor: pointer;
    background: #2a2218;
    border: 2px solid #b08f52;
    box-shadow: inset 0 0 0 1px #1f1a14, 2px 2px 0 rgba(0, 0, 0, 0.4);
  }
  #upgrade { color: #b6ff9a; }
  #pip {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 2;
    width: min(360px, calc(100% - 24px));
    max-height: calc(100% - 24px);
    overflow: auto;
    margin: 0;
    padding: 10px 12px;
    color: #39ff14;
    background: #061208;
    border: 2px solid #39ff14;
    box-shadow: 0 0 16px rgba(57, 255, 20, 0.28);
    font-family: ui-monospace, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
  }
  #pip .card { margin: 0 0 8px; border: 1px solid #1f8a32; background: #041006; }
  #pip .card-head {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 36px;
    padding: 4px 8px;
    background: transparent;
    color: #39ff14;
    border: 0;
    box-shadow: none;
    font: inherit;
    text-align: left;
  }
  #pip .card-head::before { display: none; }
  #pip .card-head:hover { background: #0a1f0c; box-shadow: none; }
  #pip .card-mark { width: 24px; height: 24px; flex: 0 0 24px; image-rendering: pixelated; }
  #pip .card-body { padding: 4px 8px 8px; }
  #pip label { display: flex; gap: 8px; align-items: center; margin: 6px 0; color: #39ff14; }
  #pip input, #pip select, #pip button {
    background: #041006;
    color: #b6ff9a;
    border-color: #1f8a32;
  }
  #pip-watch { margin: 0 0 8px; color: #b6ff9a; }
  #pip-watch.fail { color: #ff8a6b; }
  #pip pre {
    margin: 8px 0 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: #b6ff9a;
  }
  #corner {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 2;
    width: min(420px, calc(100% - 24px));
    max-height: calc(100% - 24px);
    display: flex;
    flex-direction: column;
    gap: 8px;
    overflow: auto;
  }
  #tally {
    position: sticky;
    top: 8px;
    z-index: 4;
    height: 0;
    margin: 0;
    pointer-events: none;
    white-space: pre-line;
  }
  #tally span {
    display: inline-block;
    margin: 8px;
    max-width: min(560px, calc(100% - 280px));
    padding: 8px 12px;
    color: #fff2c8;
    background: #1a1510;
    border: 4px solid #4a3519;
    box-shadow: inset 0 0 0 1px #14110d;
    font: inherit;
    font-size: 13px;
    white-space: pre-line;
    overflow-wrap: anywhere;
  }
  #wall-grain {
    position: absolute;
    z-index: 3;
    background: #041006;
    color: #b6ff9a;
    border: 3px solid #1f8a32;
    font: inherit;
    font-size: 12px;
  }
  #spend {
    margin: 0;
    padding: 8px 12px;
    color: #fff2c8;
    background: #1a1510;
    border: 4px solid #4a3519;
    box-shadow: inset 0 0 0 1px #14110d;
    font: inherit;
    font-size: 13px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    cursor: pointer;
    text-align: left;
  }
  #confirm:empty, #status:empty { display: none; }
  #radio {
    margin: 0;
    min-width: 0;
    color: #39ff14;
    background: #061208;
    border: 2px solid #39ff14;
    box-shadow: 0 0 12px rgba(57, 255, 20, 0.22);
    font-family: ui-monospace, Menlo, Monaco, Consolas, monospace;
    font-size: 13px;
  }
  #radio.issue {
    border-color: #ff5a36;
    box-shadow: 0 0 12px rgba(255, 90, 54, 0.45);
  }
  #radio-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-height: 32px;
    padding: 4px 12px;
    background: transparent;
    color: #39ff14;
    border: 0;
    box-shadow: none;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  #radio-toggle::before { display: none; }
  #radio-toggle:hover { background: #0a1f0c; box-shadow: none; }
  #radio-toggle.issue, #radio-toggle.issue #radio-summary { color: #ff8a6b; }
  #radio-mark { width: 16px; height: 16px; flex: 0 0 16px; }
  #radio-summary { min-width: 0; overflow-wrap: anywhere; }
  #radio-lines {
    margin: 0;
    padding: 0 10px 8px;
    max-height: calc(8 * 1.4em);
    overflow: auto;
    color: #b6ff9a;
  }
  #radio-lines .log {
    display: grid;
    grid-template-columns: 8.5em 2.8em minmax(0, 1fr);
    gap: 6px;
    align-items: baseline;
  }
  #radio-lines .when { color: #1f8a32; }
  #radio-lines .mark { color: #39ff14; }
  #radio-lines .what { overflow-wrap: anywhere; }
  #radio-lines .log.fail .when,
  #radio-lines .log.fail .mark,
  #radio-lines .log.fail .what { color: #ff8a6b; }
  select:disabled { opacity: 0.45; filter: grayscale(0.5); }
  input { min-width: 0; flex: 1 1 240px; max-width: 420px; }
  input::placeholder { color: #c2a978; opacity: 0.6; }
  [hidden] { display: none !important; }
  #error {
    color: #ff8a6b;
    margin: 0;
    min-width: 0;
    max-width: 100%;
    overflow-wrap: anywhere;
    padding: 10px 24px;
    background: #2a1510;
    border: 4px solid #e0603f;
    border-width: 0 0 4px 0;
    box-shadow: inset 0 0 0 1px #14110d, 0 0 12px rgba(224, 96, 63, 0.3);
  }
  #map {
    flex: 1;
    min-width: 0;
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
  @media (max-width: 900px) {
    header { padding: 8px 12px; gap: 6px 10px; }
    h1 { font-size: 15px; letter-spacing: 0.08em; }
    #status, #confirm { flex-basis: 100%; }
    select, button, input { padding: 0 8px; }
    #error { padding-left: 12px; padding-right: 12px; }
  }
  @media (max-height: 700px) {
    header { padding: 6px 12px; }
    select, button, input { min-height: 36px; }
    #radio-lines { max-height: calc(4 * 1.4em); }
  }
</style>
</head>
<body>
<header>
  <canvas id="home" width="48" height="44" role="button" tabindex="0" aria-label="overview"></canvas>
  <h1>CLOUD SPIDER</h1>
  <label>region <select id="region"></select></label>
  <button id="sample" type="button">Sample</button>
  <button id="path" type="button">Path</button>
  <button id="cluster" type="button">Cluster</button>
  <button id="upgrade" type="button">Stacks</button>
  <select id="lb" aria-label="load balancer" hidden></select>
  <input id="host" type="text" aria-label="URL or host" placeholder="paste a URL or host" hidden>
  <span id="status"></span>
  <p id="confirm"></p>
  <button id="yes" type="button" hidden>put it down</button>
  <button id="no" type="button" hidden>leave it</button>
</header>
<p id="error" hidden></p>
<div id="map">
  <p id="tally" hidden><span id="tally-text"></span></p>
  <canvas id="place"></canvas>
  <select id="wall-grain" aria-label="camp grain" hidden>
    <option value="coarse">coarse</option>
    <option value="fine">fine</option>
  </select>
  <div id="corner">
    <pre id="spend" hidden></pre>
    <div id="radio" hidden>
      <button id="radio-toggle" type="button" aria-expanded="false">
        <canvas id="radio-mark" width="16" height="16" aria-hidden="true"></canvas>
        <span id="radio-summary"></span>
      </button>
      <div id="radio-lines" hidden></div>
    </div>
  </div>
  <form id="pip" hidden></form>
</div>
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

  if (req.method === "GET" && url.pathname === "/api/cost-sample") {
    send(res, 200, sampleCost());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cost") {
    send(res, 200, await app.costView());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/upgrades") {
    send(res, 200, { modules: app.upgrades() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/upgrade") {
    send(res, 200, await app.upgradeStatus(url.searchParams.get("module") || "", url.searchParams.get("fresh") === "1"));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/upgrade") {
    const body = await readJson(req);
    send(res, 200, await app.upgradeRun(req.headers.origin, body));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cluster-sample") {
    send(res, 200, sampleCluster());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cluster") {
    await app.boot();
    send(res, 200, await app.clusterView());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/view") {
    await app.boot();
    if (url.searchParams.get("sample") !== "1") {
      await app.mergeCamp(url.searchParams.get("grain") || "coarse");
      app.kickLinks();
    }
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
