import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { samplePlace, sampleRadio } from "./sample.js";
import { samplePathGraph } from "./path-sample.js";
import { pathResult } from "./path-view.js";
import { cssVars } from "./theme.js";

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
  "theme.js",
  "draw-kit.js",
  "chrome.js",
  "sprites/icons.js",
  "sprites/mascot.js",
  "sprites/buildings.js",
  "sprites/landmarks.js",
]);

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cloud Spider</title>
<style>
  ${cssVars()}
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  html, body { height: 100%; overflow: hidden; }
  body {
    margin: 0;
    padding: 8px;
    background: radial-gradient(ellipse at 50% 0%, var(--case-lo), var(--case-seam) 70%);
    color: var(--pip-bright);
    font: bold 14px/1.4 var(--font);
    text-rendering: optimizeSpeed;
  }
  img.px, canvas { image-rendering: pixelated; image-rendering: crisp-edges; }
  [hidden] { display: none !important; }

  /* ---- device casing ---- */
  .device {
    position: relative;
    height: 100%;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px 12px;
    border-radius: 18px;
    background:
      linear-gradient(180deg, rgba(255, 255, 255, 0.08), transparent 18%, transparent 82%, rgba(0, 0, 0, 0.35)),
      repeating-linear-gradient(90deg, rgba(255, 255, 255, 0.015) 0 2px, rgba(0, 0, 0, 0.03) 2px 4px),
      linear-gradient(180deg, var(--case-hi), var(--case-mid) 30%, var(--case-lo));
    box-shadow:
      inset 0 2px 0 rgba(255, 255, 255, 0.18),
      inset 0 -3px 0 rgba(0, 0, 0, 0.5),
      inset 0 0 0 2px var(--case-seam),
      0 10px 30px rgba(0, 0, 0, 0.7);
  }
  /* Phillips screws in the four corners. */
  .device::before {
    content: "";
    position: absolute;
    inset: 6px;
    pointer-events: none;
    --screw: radial-gradient(circle at 40% 35%, var(--case-screw) 0 2px, #6a6956 3px, #2b2a1f 5px, transparent 5.5px);
    background:
      var(--screw) 0 0 / 12px 12px no-repeat,
      var(--screw) 100% 0 / 12px 12px no-repeat,
      var(--screw) 0 100% / 12px 12px no-repeat,
      var(--screw) 100% 100% / 12px 12px no-repeat;
  }

  /* ---- header bezel ---- */
  header {
    position: relative;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 10px 16px;
    min-width: 0;
    padding: 8px 14px 10px;
    border-radius: 10px;
    background:
      radial-gradient(circle, #8f8d72 0 1.5px, #23221a 2px, transparent 2.5px) 10px 3px / 22px 6px repeat-x,
      linear-gradient(180deg, rgba(0, 0, 0, 0.12), rgba(0, 0, 0, 0.3));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 -2px 0 rgba(0, 0, 0, 0.45);
  }
  .plate {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 5px 14px 5px 6px;
    border-radius: 6px;
    background: linear-gradient(180deg, #d9b766, var(--case-brass) 45%, var(--case-brass-lo));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5), inset 0 -1px 0 rgba(0, 0, 0, 0.4), 0 2px 4px rgba(0, 0, 0, 0.6);
  }
  .porthole {
    width: 54px;
    height: 54px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: radial-gradient(circle at 40% 35%, var(--pip-glass), var(--pip-ink) 75%);
    box-shadow: 0 0 0 3px var(--case-brass-lo), 0 0 0 5px #2b2210, inset 0 0 10px rgba(0, 0, 0, 0.9), 0 0 14px var(--glow-soft);
  }
  #mascot { width: 52px; height: 48px; filter: drop-shadow(0 0 4px var(--glow-bright)); }
  h1 {
    margin: 0;
    font-size: 22px;
    letter-spacing: 0.2em;
    line-height: 1;
    color: #2a1d08;
    text-shadow: 0 1px 0 rgba(255, 240, 200, 0.55), 0 -1px 0 rgba(0, 0, 0, 0.35);
  }
  .plate small {
    display: block;
    margin-top: 3px;
    font-size: 10px;
    letter-spacing: 0.2em;
    color: #3d2c0e;
    text-shadow: 0 1px 0 rgba(255, 240, 200, 0.4);
  }

  /* Tabs live on a strip of screen set into the bezel. */
  .tabs {
    display: flex;
    align-items: flex-end;
    gap: 2px;
    padding: 6px 10px 0;
    border-radius: 6px;
    background: radial-gradient(ellipse at 50% 0%, var(--pip-glass), var(--pip-ink));
    box-shadow: inset 0 0 0 2px #000, inset 0 0 12px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(255, 255, 255, 0.12);
    border-bottom: 2px solid var(--pip-mid);
  }
  .tab {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 40px;
    padding: 0 14px;
    margin-bottom: -2px;
    border: 2px solid transparent;
    border-bottom: 0;
    background: transparent;
    color: var(--pip-dim);
    font: inherit;
    font-size: 16px;
    letter-spacing: 0.14em;
    cursor: pointer;
  }
  .tab img { opacity: 0.6; }
  .tab:hover { color: var(--pip-mid); }
  .tab[aria-pressed="true"] {
    color: var(--pip-bright);
    border-color: var(--pip-mid);
    background: linear-gradient(180deg, var(--glow-soft), transparent);
    text-shadow: 0 0 6px var(--glow-bright);
  }
  .tab[aria-pressed="true"] img { opacity: 1; filter: drop-shadow(0 0 3px var(--glow-bright)); }
  /* RADIO opens a side panel rather than a view, so it lights up instead of
     taking the tab bracket. */
  .tab.toggle { margin-left: 10px; border-left: 2px solid var(--pip-dark); }
  .tab.toggle[aria-pressed="true"] { border-color: transparent; border-left-color: var(--pip-dark); background: transparent; }
  .tab.toggle::after { content: ""; width: 7px; height: 7px; border-radius: 50%; background: var(--pip-dark); }
  .tab.toggle[aria-pressed="true"]::after { background: var(--pip-bright); box-shadow: 0 0 6px var(--pip-bright); }

  /* SAMPLE: a physical toggle switch with an LED. */
  .switch {
    display: inline-flex;
    align-items: center;
    gap: 9px;
    min-height: 40px;
    padding: 0 12px 0 8px;
    border: 0;
    border-radius: 6px;
    background: linear-gradient(180deg, #5d5c46, #33321f);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.2), inset 0 -2px 0 rgba(0, 0, 0, 0.5), 0 2px 3px rgba(0, 0, 0, 0.6);
    color: #e9e3c4;
    font: inherit;
    font-size: 12px;
    letter-spacing: 0.16em;
    cursor: pointer;
  }
  .lever {
    position: relative;
    width: 14px;
    height: 26px;
    border-radius: 7px;
    background: linear-gradient(90deg, #111, #2c2c22 50%, #111);
    box-shadow: inset 0 0 0 1px #000;
  }
  .lever::after {
    content: "";
    position: absolute;
    left: 1px;
    top: 13px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #f3f1de, #9c9b86 55%, #4d4c3c);
    transition: top 0.12s;
  }
  .switch[aria-pressed="true"] .lever::after { top: 1px; }
  .led {
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #3a2c08;
    box-shadow: inset 0 0 0 1px #000;
  }
  .switch[aria-pressed="true"] .led { background: var(--world-amber); box-shadow: 0 0 8px var(--world-amber), inset 0 0 0 1px #000; }

  .readout {
    display: flex;
    align-items: center;
    gap: 14px;
    margin-left: auto;
    padding: 6px 12px;
    border-radius: 6px;
    background: radial-gradient(ellipse at 50% 0%, var(--pip-glass), var(--pip-ink));
    box-shadow: inset 0 0 0 2px #000, inset 0 0 10px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(255, 255, 255, 0.12);
    font-size: 13px;
  }
  .readout b, .readout label { color: var(--pip-dim); letter-spacing: 0.14em; font-weight: bold; }
  .readout label { display: flex; align-items: center; gap: 6px; }
  .readout output { color: var(--pip-bright); text-shadow: 0 0 6px var(--glow-bright); }
  .knobs { display: flex; align-items: center; gap: 10px; }
  .knob {
    width: 34px;
    height: 34px;
    border-radius: 50%;
    background:
      radial-gradient(circle at 50% 50%, transparent 0 9px, rgba(0, 0, 0, 0.35) 10px, transparent 11px),
      repeating-conic-gradient(#4b4a39 0 8deg, #2a291f 8deg 16deg),
      #3a392b;
    box-shadow: inset 0 2px 2px rgba(255, 255, 255, 0.25), 0 3px 4px rgba(0, 0, 0, 0.7), 0 0 0 2px #1a1a12;
    position: relative;
  }
  .knob::after {
    content: "";
    position: absolute;
    left: 15px;
    top: 4px;
    width: 4px;
    height: 10px;
    border-radius: 2px;
    background: #d9d4b0;
  }
  .knob.small { width: 24px; height: 24px; }
  .knob.small::after { left: 10px; top: 3px; height: 7px; width: 3px; }
  .power { width: 8px; height: 8px; border-radius: 50%; background: var(--pip-bright); box-shadow: 0 0 8px var(--pip-bright); }

  /* ---- controls on the screen ---- */
  select, button.cmd, input {
    min-height: 32px;
    padding: 0 10px;
    border: 2px solid var(--pip-dim);
    border-radius: 2px;
    background: var(--pip-ink);
    color: var(--pip-bright);
    font: inherit;
    font-size: 13px;
  }
  select:disabled { opacity: 0.45; }
  input { min-width: 0; flex: 1 1 220px; max-width: 420px; }
  input::placeholder { color: var(--pip-dim); }
  button { cursor: pointer; }
  button.cmd { display: inline-flex; align-items: center; gap: 6px; letter-spacing: 0.08em; text-transform: uppercase; }
  button.cmd::before { content: "["; color: var(--pip-dim); }
  button.cmd::after { content: "]"; color: var(--pip-dim); }
  button.cmd:hover { background: var(--pip-bright); color: var(--pip-ink); border-color: var(--pip-bright); }
  button.cmd:hover img { filter: brightness(0); }
  #yes { border-color: var(--status-hang); color: var(--status-hang); }
  #yes:hover { background: var(--status-hang); color: var(--pip-ink); }
  button:focus-visible, select:focus-visible, input:focus-visible { outline: 2px solid var(--pip-hot); outline-offset: 2px; }

  /* ---- the CRT ---- */
  .screen {
    position: relative;
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
    border-radius: 16px / 22px;
    background: var(--pip-screen);
    box-shadow:
      0 0 0 3px #0b0b08,
      0 0 0 6px var(--case-lo),
      0 0 0 8px var(--case-seam),
      inset 0 0 0 2px #000;
  }
  .glass {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 5;
    border-radius: inherit;
    background:
      radial-gradient(ellipse 70% 45% at 22% 6%, rgba(200, 255, 220, 0.07), transparent 70%),
      repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.22) 0 1px, transparent 1px 3px),
      radial-gradient(ellipse at 50% 50%, transparent 55%, rgba(0, 0, 0, 0.55) 100%);
    /* The rings repeat the screen's bezel and cover the canvas corners, so
       the screen needs no rounded overflow clip (a clip re-rasterises the
       whole screen on every animation frame). */
    box-shadow:
      inset 0 0 60px rgba(0, 0, 0, 0.75),
      inset 0 0 6px var(--glow-soft),
      0 0 0 3px #0b0b08,
      0 0 0 6px var(--case-lo),
      0 0 0 8px var(--case-seam);
    animation: flicker 7s steps(1) infinite;
  }
  @keyframes flicker { 0%, 100% { opacity: 1; } 31% { opacity: 0.93; } 32% { opacity: 1; } 77% { opacity: 0.96; } 78% { opacity: 1; } }

  .terminal {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 12px;
    min-width: 0;
    padding: 8px 18px;
    border-bottom: 2px solid var(--pip-dark);
    background: linear-gradient(180deg, rgba(20, 255, 106, 0.06), transparent);
    text-shadow: 0 0 5px var(--glow-bright);
  }
  .line { display: flex; gap: 8px; flex: 1 1 320px; min-width: 0; }
  .prompt { color: var(--pip-mid); }
  #status { min-width: 0; overflow-wrap: anywhere; }
  #status::after { content: "_"; margin-left: 2px; animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  #confirm { flex: 1 1 420px; min-width: 0; margin: 0; overflow-wrap: anywhere; color: var(--status-hang); text-shadow: none; }
  #confirm:empty, #radio:empty { display: none; }
  #error {
    margin: 0;
    padding: 6px 18px 6px 40px;
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--status-broken);
    background: linear-gradient(90deg, rgba(255, 90, 60, 0.12), transparent 70%);
    border-bottom: 1px solid rgba(255, 90, 60, 0.35);
    font-size: 12px;
    position: relative;
  }
  #error::before { content: "!"; position: absolute; left: 18px; top: 6px; color: var(--pip-ink); background: var(--status-broken); padding: 0 5px; font-size: 11px; }

  .body { flex: 1; min-height: 0; display: flex; }
  #map { flex: 1; min-width: 0; min-height: 0; overflow: auto; background: var(--pip-screen); }

  /* ---- radio panel ---- */
  #radio-panel {
    flex: 0 0 300px;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 14px;
    border-left: 2px solid var(--pip-dark);
    background: linear-gradient(90deg, rgba(0, 0, 0, 0.3), transparent 30%), var(--pip-ink);
    overflow: hidden;
  }
  .ptitle {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 8px;
    background: linear-gradient(180deg, var(--pip-hot), var(--pip-bright) 20%, var(--pip-mid));
    color: var(--pip-ink);
    letter-spacing: 0.14em;
  }
  .ptitle img { filter: brightness(0); }
  .ptitle span { margin-left: auto; font-size: 11px; letter-spacing: 0.06em; }
  .scope { position: relative; height: 92px; border: 2px solid var(--pip-dark); background: #010704; }
  #scope { width: 100%; height: 100%; display: block; }
  .dial { position: relative; height: 34px; border-top: 1px solid var(--pip-dark); border-bottom: 1px solid var(--pip-dark); }
  .dial .scale {
    position: absolute;
    inset: 4px 0 auto;
    height: 12px;
    background:
      repeating-linear-gradient(90deg, var(--pip-mid) 0 2px, transparent 2px 30px),
      repeating-linear-gradient(90deg, var(--pip-dim) 0 1px, transparent 1px 6px);
    background-size: 100% 12px, 100% 6px;
    background-repeat: no-repeat;
  }
  .dial .nums { position: absolute; left: 0; right: 0; bottom: 2px; display: flex; justify-content: space-between; font-size: 9px; color: var(--pip-dim); }
  #needle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 3px;
    left: 20%;
    background: var(--status-hang);
    box-shadow: 0 0 6px var(--status-hang);
    transition: left 0.3s;
  }
  #radio {
    flex: 1;
    min-height: 0;
    margin: 0;
    padding: 0;
    list-style: none;
    overflow: auto;
    font-size: 12px;
  }
  #radio li {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 6px;
    color: var(--pip-mid);
    cursor: pointer;
    overflow-wrap: anywhere;
  }
  #radio li:hover { color: var(--pip-bright); }
  #radio li[aria-current="true"] { background: var(--pip-bright); color: var(--pip-ink); }
  #radio li[aria-current="true"] img { filter: brightness(0); }
  .quiet { color: var(--pip-dim); font-size: 12px; }

  /* ---- status bar (Pip-Boy HP / AP strip) ---- */
  .statusbar {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 14px 8px;
    border-top: 2px solid var(--pip-dark);
    font-size: 12px;
    letter-spacing: 0.1em;
  }
  .statusbar span { padding: 2px 10px; background: rgba(20, 255, 106, 0.1); color: var(--pip-bright); }
  .statusbar .meter { display: inline-flex; align-items: center; gap: 8px; flex: 1; min-width: 160px; }
  .meter i { flex: 1; height: 10px; border: 1px solid var(--pip-mid); background: linear-gradient(90deg, var(--pip-bright) var(--fill, 0%), transparent var(--fill, 0%)); }

  @media (prefers-reduced-motion: reduce) {
    .glass, #status::after { animation: none; }
  }
  @media (max-width: 1100px) {
    #radio-panel { flex-basis: 250px; }
    .knobs { display: none; }
  }
  @media (max-width: 900px) {
    body { padding: 4px; }
    .device { padding: 6px; border-radius: 12px; }
    header { gap: 6px 10px; padding: 6px 8px; }
    .plate small { display: none; }
    .readout { margin-left: 0; }
    .body { flex-direction: column; }
    #radio-panel { flex: 0 0 180px; border-left: 0; border-top: 2px solid var(--pip-dark); }
    .scope, .dial { display: none; }
  }
  @media (max-height: 700px) {
    .porthole { width: 36px; height: 36px; }
    #mascot { width: 26px; height: 24px; }
    .tab, .switch { min-height: 30px; }
    .statusbar { display: none; }
  }
</style>
</head>
<body>
<div class="device">
<header>
  <div class="plate">
    <div class="porthole"><canvas id="mascot" width="26" height="24" aria-hidden="true"></canvas></div>
    <div><h1>CLOUD SPIDER</h1><small>SPIDER-TEC SURVEY UNIT 3000</small></div>
  </div>
  <nav class="tabs" aria-label="views">
    <button id="tab-map" class="tab" type="button" data-icon="map" aria-pressed="true">MAP</button>
    <button id="path" class="tab" type="button" data-icon="path" aria-pressed="false">PATH</button>
    <button id="tab-radio" class="tab toggle" type="button" data-icon="radio" aria-pressed="true">RADIO</button>
  </nav>
  <button id="sample" class="switch" type="button" aria-pressed="false"><span class="lever"></span>SAMPLE<span class="led"></span></button>
  <div class="readout">
    <label>REGION <select id="region"></select></label>
    <span><b>MODE</b> <output id="acct">LIVE</output></span>
    <span><b>TIME</b> <output id="clock">--:--</output></span>
  </div>
  <div class="knobs" aria-hidden="true"><i class="knob"></i><i class="knob small"></i><i class="power"></i></div>
</header>
<main class="screen">
  <div class="terminal">
    <span class="line"><span class="prompt">&gt;</span><span id="status"></span></span>
    <select id="lb" aria-label="load balancer" hidden></select>
    <input id="host" type="text" aria-label="URL or host" placeholder="paste a URL or host" hidden>
    <p id="confirm"></p>
    <button id="yes" class="cmd" type="button" data-icon="stop" hidden>put it down</button>
    <button id="no" class="cmd" type="button" hidden>leave it</button>
  </div>
  <p id="error" hidden></p>
  <div class="body">
    <div id="map"><canvas id="place"></canvas></div>
    <aside id="radio-panel" aria-label="radio">
      <div class="ptitle"><img class="px" data-icon="radio" alt="">RADIO<span id="station-count"></span></div>
      <div class="scope"><canvas id="scope"></canvas></div>
      <div class="dial" aria-hidden="true"><div class="scale"></div><div class="nums"><span>88</span><span>94</span><span>100</span><span>106</span><span>112</span></div><div id="needle"></div></div>
      <ol id="radio"></ol>
    </aside>
  </div>
  <footer class="statusbar" id="stats"></footer>
  <div class="glass" aria-hidden="true"></div>
</main>
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
    send(res, 200, { place: samplePlace(), radio: sampleRadio() });
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
