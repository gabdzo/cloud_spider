import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sampleMorning, samplePlace, sampleTrail } from "./sample.js";
import { samplePathGraph } from "./path-sample.js";
import { pathResult } from "./path-view.js";
import { cssVars } from "./theme.js";
import { sampleCost } from "./cost.js";
import { sampleCluster } from "./cluster.js";
import { samplePodDetail } from "./kube-sample.js";

const root = dirname(fileURLToPath(import.meta.url));
export const FILES = new Set([
  "browser.js",
  "draw.js",
  "sprites.js",
  "pixel-art.js",
  "layout-cache.js",
  "ui.js",
  "layout.js",
  "radio.js",
  "verbs.js",
  "ids.js",
  "report.js",
  "path-layout.js",
  "path-draw.js",
  "scene.js",
  "cluster.js",
  "kube-diagram.js",
  "metrics.js",
  "upgrade-rules.js",
  "theme.js",
  "draw-kit.js",
  "chrome.js",
  "sprites/icons.js",
  "sprites/mascot.js",
  "sprites/buildings.js",
  "sprites/landmarks.js",
  "sprites/vault.js",
  "vault-state.js",
  "vault-match.js",
  "vault-schema.js",
  "vault-layout.js",
  "vault-draw.js",
  "agent-text.js",
  "terminal.js",
]);

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cloud Spider</title>
<link rel="icon" href="data:,">
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
  /* A block canvas: inline it would sit on the text baseline, overflow #map by a few pixels and summon both scrollbars. */
  #place { display: block; }
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
    padding: 0;
    border: 0;
    cursor: pointer;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: radial-gradient(circle at 40% 35%, var(--pip-glass), var(--pip-ink) 75%);
    box-shadow: 0 0 0 3px var(--case-brass-lo), 0 0 0 5px #2b2210, inset 0 0 10px rgba(0, 0, 0, 0.9), 0 0 14px var(--glow-soft);
  }
  .porthole:hover { box-shadow: 0 0 0 3px var(--case-brass-lo), 0 0 0 5px #2b2210, inset 0 0 10px rgba(0, 0, 0, 0.9), 0 0 20px var(--pip-mid); }
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
    text-transform: uppercase;
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
  select, button.cmd, a.cmd, input {
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
  button.cmd, a.cmd { display: inline-flex; align-items: center; gap: 6px; letter-spacing: 0.08em; text-transform: uppercase; }
  button.cmd::before, a.cmd::before { content: "["; color: var(--pip-dim); }
  button.cmd::after, a.cmd::after { content: "]"; color: var(--pip-dim); }
  button.cmd:hover, a.cmd:hover { background: var(--pip-bright); color: var(--pip-ink); border-color: var(--pip-bright); }
  a.cmd:focus-visible { outline: 2px solid var(--pip-hot); outline-offset: 2px; }
  button.cmd:disabled { opacity: 0.6; cursor: wait; }
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
  /* Y and N wrap together, to the right, so neither is ever left alone on a row. */
  .choice { display: flex; gap: 12px; margin-left: auto; }
  .choice:not(:has(button:not([hidden]))) { display: none; }
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
  .mapwrap { position: relative; flex: 1; min-width: 0; min-height: 0; display: flex; }
  #map { position: relative; flex: 1; min-width: 0; min-height: 0; overflow: auto; background: var(--pip-screen); }

  /* ---- the morning report: three sentences pinned over the map ---- */
  #morning {
    position: relative;
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 0 14px;
    padding: 8px 14px 8px 12px;
    border-bottom: 2px solid var(--pip-dark);
    background:
      repeating-linear-gradient(90deg, rgba(20, 255, 106, 0.035) 0 2px, transparent 2px 6px),
      linear-gradient(180deg, rgba(255, 204, 51, 0.07), rgba(4, 20, 10, 0) 70%),
      var(--pip-ink);
    box-shadow: inset 0 -1px 0 rgba(20, 255, 106, 0.12), inset 0 6px 14px rgba(0, 0, 0, 0.6);
  }
  #morning[hidden] { display: none; }
  #sunrise {
    width: 64px; height: 36px;
    image-rendering: pixelated;
    border: 2px solid var(--pip-dark);
    box-shadow: 0 0 0 1px #000, 0 0 12px rgba(255, 154, 60, 0.25), inset 0 0 0 1px rgba(0, 0, 0, 0.6);
    background: linear-gradient(180deg, var(--world-wall), var(--world-dark) 70%);
  }
  .m-head { display: flex; flex-direction: column; line-height: 1.05; letter-spacing: 0.14em; }
  .m-head b { color: var(--world-amber); font-size: 13px; text-shadow: 0 0 6px rgba(255, 204, 51, 0.45); }
  .m-head small { color: var(--pip-mid); font-size: 10px; }
  .m-head output { color: var(--pip-dim); font-size: 10px; margin-top: 3px; letter-spacing: 0.06em; }
  .m-lines { list-style: none; margin: 0; padding: 0; min-width: 0; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 6px 10px; }
  .m-line {
    position: relative;
    display: grid;
    grid-template-columns: 16px auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    align-items: center;
    gap: 2px 6px;
    min-width: 0;
    padding: 5px 22px 5px 8px;
    border: 1px solid var(--pip-dark);
    background: linear-gradient(180deg, rgba(20, 255, 106, 0.05), rgba(0, 0, 0, 0.35));
    box-shadow: inset 0 0 0 1px #000, inset 3px 0 0 var(--m-tone, var(--pip-dim));
    --m-tone: var(--pip-dim);
  }
  .m-line img { grid-row: 1; image-rendering: pixelated; }
  .m-line b { grid-row: 1; font-size: 10px; letter-spacing: 0.16em; color: var(--m-tone); }
  .m-line .m-text {
    grid-column: 1 / -1; grid-row: 2;
    min-width: 0; font-size: 12px; line-height: 1.3; color: var(--world-text);
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
    overflow-wrap: anywhere;
  }
  .m-line .m-text time { color: var(--pip-mid); margin-right: 6px; }
  .m-led { position: absolute; top: 7px; right: 7px; width: 8px; height: 8px; background: var(--m-tone); box-shadow: 0 0 0 1px #000, 0 0 8px var(--m-tone); }
  .m-line.ok { --m-tone: var(--pip-bright); }
  .m-line.fail { --m-tone: var(--status-broken); background: linear-gradient(180deg, rgba(255, 90, 60, 0.12), rgba(0, 0, 0, 0.35)); }
  .m-line.fail .m-led { animation: blink 1.2s steps(1) infinite; }
  .m-line.warn { --m-tone: var(--world-amber); background: linear-gradient(180deg, rgba(255, 204, 51, 0.1), rgba(0, 0, 0, 0.35)); }
  .m-line.unknown { --m-tone: var(--pip-dim); }
  .m-line.unknown .m-text { color: var(--world-muted); }
  .m-line.unknown .m-led { background: transparent; box-shadow: 0 0 0 1px var(--pip-dim); }
  .m-fold {
    align-self: start;
    width: 22px; height: 22px; padding: 0;
    font-size: 10px; line-height: 1;
    color: var(--pip-mid); background: var(--pip-ink);
    border: 1px solid var(--pip-dark);
  }
  .m-fold:hover { color: var(--pip-ink); background: var(--pip-bright); }
  /* Folded: one line, the worst sentence only. */
  #morning.folded { padding-top: 4px; padding-bottom: 4px; }
  #morning.folded #sunrise { width: 32px; height: 18px; }
  #morning.folded .m-head small, #morning.folded .m-head output { display: none; }
  #morning.folded .m-lines { grid-template-columns: minmax(0, 1fr); }
  #morning.folded .m-line:not(.lead) { display: none; }
  #morning.folded .m-line { grid-template-rows: auto; grid-template-columns: 16px auto minmax(0, 1fr); padding-top: 3px; padding-bottom: 3px; }
  #morning.folded .m-text { grid-column: 3; grid-row: 1; -webkit-line-clamp: 1; }
  @media (min-width: 1600px) {
    #sunrise { width: 96px; height: 54px; }
    .m-line .m-text { font-size: 13px; }
  }
  @media (max-width: 1180px) {
    #morning { grid-template-columns: auto minmax(0, 1fr) auto; }
    .m-head { display: none; }
    .m-lines { grid-template-columns: minmax(0, 1fr); gap: 4px; }
    .m-line { grid-template-rows: auto; padding-top: 3px; padding-bottom: 3px; }
    .m-line .m-text { grid-column: 3; grid-row: 1; -webkit-line-clamp: 2; }
    .m-line b { min-width: 92px; }
  }
  @media (max-width: 820px) {
    #morning { grid-template-columns: minmax(0, 1fr) auto; padding-left: 10px; }
    #sunrise { display: none; }
    .m-line { grid-template-columns: 16px minmax(0, 1fr); grid-template-rows: auto auto; }
    .m-line b { min-width: 0; }
    .m-line .m-text { grid-column: 1 / -1; grid-row: 2; }
  }

  /* ---- header gauges: the tally and the bill as recessed LCD strips ---- */
  .gauges { flex: 1 1 360px; min-width: 0; display: flex; align-items: center; gap: 10px; }
  .lcd {
    display: flex; align-items: center; gap: 8px; min-width: 0; height: 44px; margin: 0;
    padding: 0 12px 0 9px; border: 0; border-radius: 6px;
    font: inherit; font-size: 13px; letter-spacing: 0.04em; white-space: nowrap;
    color: var(--pip-bright); text-shadow: 0 0 6px var(--glow-bright);
    background: radial-gradient(ellipse at 50% 0%, var(--pip-glass), var(--pip-ink));
    box-shadow: inset 0 0 0 2px #000, inset 0 0 10px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(255, 255, 255, 0.12);
  }
  .lcd img { flex: none; filter: drop-shadow(0 0 3px var(--glow-bright)); }
  #tally { flex: 1 1 auto; pointer-events: none; }
  #tally-text, #tally-issue { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  #tally-text { flex: 0 1 auto; }
  #tally-issue { flex: 1 1 0; color: var(--status-broken); text-shadow: 0 0 6px rgba(255, 90, 60, 0.45); }
  #tally-issue:empty { display: none; }
  #tally-issue::before { content: "! "; }
  #tally.issue { box-shadow: inset 0 0 0 2px #000, inset 3px 0 0 var(--status-broken), inset 0 0 10px rgba(0, 0, 0, 0.9), 0 1px 0 rgba(255, 255, 255, 0.12); }
  #corner { position: relative; flex: 0 1 260px; min-width: 150px; }
  #spend { width: 100%; cursor: pointer; text-align: left; }
  #spend b { flex: none; color: var(--pip-ink); background: var(--pip-bright); padding: 0 5px; letter-spacing: 0.12em; font-size: 11px; text-shadow: none; }
  #spend-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  #spend .caret { flex: none; width: 0; height: 0; border: 4px solid transparent; border-top-color: var(--pip-mid); margin-top: 4px; transition: transform 0.15s; }
  #spend[aria-expanded="true"] .caret { transform: rotate(180deg); margin-top: -4px; }
  #spend:hover, #spend:focus-visible { outline: none; box-shadow: inset 0 0 0 2px #000, inset 0 0 0 3px var(--pip-dim), inset 0 0 10px rgba(0, 0, 0, 0.9), 0 0 10px var(--glow-soft); }
  #spend.issue b { background: var(--status-broken); }
  #spend.issue #spend-label { color: var(--status-broken); }
  #spend-lines {
    position: absolute; z-index: 20; top: calc(100% + 6px); right: 0; width: max(100%, 320px); max-width: calc(100vw - 24px);
    margin: 0; padding: 8px 12px 10px; font: inherit; font-size: 12px; line-height: 1.5;
    white-space: pre-wrap; overflow-wrap: anywhere; max-height: 50vh; overflow: auto;
    color: var(--pip-mid); background: rgba(2, 10, 5, 0.96);
    border: 1px solid var(--pip-mid); border-top: 3px solid var(--pip-bright);
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.7), 0 0 12px rgba(20, 255, 106, 0.15);
  }
  /* ---- vaults: open/close-all switch and the panels beside open doors ---- */
  #vault-all { position: absolute; z-index: 2; min-height: 26px; padding: 0 10px; font-size: 11px; letter-spacing: 0.12em; }
  #vault-templates-btn { position: absolute; z-index: 2; min-height: 26px; padding: 0 10px; font-size: 11px; letter-spacing: 0.12em; }
  #vault-templates {
    position: absolute; z-index: 3; width: min(420px, calc(100vw - 32px)); max-height: 360px; overflow: auto;
    font-size: 12px; line-height: 1.45; color: var(--pip-mid);
    background: var(--pip-screen); border: 2px solid var(--pip-dim);
    box-shadow: 0 0 0 1px var(--pip-ink), 0 8px 20px var(--pip-ink);
  }
  .vt-title { display: flex; justify-content: space-between; gap: 8px; padding: 4px 10px; color: var(--pip-ink); background: var(--pip-bright); letter-spacing: 0.14em; font-size: 11px; }
  .vt-where { opacity: 0.75; letter-spacing: 0.04em; }
  .vt-list { list-style: none; margin: 0; padding: 4px 10px 8px; }
  .vt-list li { padding: 6px 0; border-bottom: 1px dashed var(--pip-dark); }
  .vt-list li:last-child { border-bottom: 0; }
  .vt-row { display: flex; align-items: center; gap: 8px; justify-content: space-between; }
  .vt-name { color: var(--pip-bright); text-shadow: 0 0 5px var(--glow-soft); }
  .vt-type { color: var(--pip-dim); font-size: 11px; letter-spacing: 0.12em; }
  .vt-desc { margin: 2px 0 4px; overflow-wrap: anywhere; }
  .vt-list li.damaged .vt-name, .vt-list li.damaged .vt-desc { color: var(--status-broken); }
  .vt-cmd { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--pip-hot); font-size: 11px; user-select: all; }
  .vt-copy { flex: none; min-height: 24px; padding: 0 8px; font-size: 11px; }
  .vt-empty { color: var(--pip-dim); }
  #kube-panel { position: absolute; z-index: 3; right: 12px; top: 12px; width: min(460px, calc(100% - 24px)); max-height: calc(100% - 24px); }
  .kp-title { display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 10px; color: var(--pip-ink); background: var(--pip-bright); letter-spacing: 0.12em; font-size: 11px; }
  .kp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kp-body { overflow: auto; padding: 6px 12px 10px; }
  .kp-body h4 { margin: 8px 0 4px; padding-top: 8px; border-top: 1px dashed var(--pip-dark); font-size: 11px; letter-spacing: 0.14em; color: var(--pip-dim); }
  .kp-log { max-height: 200px; }
  .kp-log li { color: var(--pip-mid); overflow-wrap: anywhere; }
  .kp-log li.bad { color: var(--status-broken); }
  .kp-events { list-style: none; margin: 0; padding: 0; font-size: 11px; }
  .kp-events li { display: grid; grid-template-columns: max-content max-content 1fr; gap: 6px; padding: 3px 0; border-bottom: 1px solid var(--pip-dark); }
  .kp-events .when { color: var(--pip-dim); }
  .kp-events .reason { color: var(--pip-bright); }
  .kp-events li.warn .reason { color: var(--status-hang); }
  .kp-events .msg { color: var(--pip-mid); overflow-wrap: anywhere; min-width: 0; }
  #vault-panels { position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 2; }
  .vault-panel {
    position: absolute; display: flex; flex-direction: column; min-width: 0;
    font-size: 12px; line-height: 1.45; color: var(--pip-mid);
    background: rgba(2, 10, 5, 0.94); border: 2px solid var(--pip-dim);
    box-shadow: 0 0 0 1px #000, 0 8px 20px rgba(0, 0, 0, 0.55), inset 0 0 18px rgba(20, 255, 106, 0.05);
  }
  .vault-panel::before, .vault-panel::after {
    content: ""; position: absolute; width: 12px; height: 12px; pointer-events: none;
    border: 3px solid var(--pip-bright);
  }
  .vault-panel::before { left: -5px; top: -5px; border-right: 0; border-bottom: 0; }
  .vault-panel::after { right: -5px; bottom: -5px; border-left: 0; border-top: 0; }
  .vp-title {
    display: flex; align-items: center; gap: 8px; margin: 4px; padding: 3px 4px 3px 8px; min-height: 26px;
    color: var(--pip-ink); font-size: 13px; font-weight: bold; letter-spacing: 0.08em;
    background: linear-gradient(180deg, var(--pip-hot), var(--pip-bright) 15%, var(--pip-mid));
  }
  .vp-title img { filter: brightness(0.15); }
  .vp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .vp-close {
    flex: none; min-height: 20px; padding: 0 8px; font: inherit; font-size: 10px; letter-spacing: 0.12em; cursor: pointer;
    color: var(--pip-bright); background: var(--pip-ink); border: 1px solid var(--pip-ink);
  }
  .vp-close:hover, .vp-close:focus-visible { outline: none; color: var(--pip-hot); box-shadow: 0 0 0 1px var(--pip-hot); }
  .vault-panel.damaged { border-color: var(--status-broken); }
  .vault-panel.damaged .vp-title { color: var(--pip-ink); background: var(--status-broken); }
  .vault-panel.damaged::before, .vault-panel.damaged::after { border-color: var(--status-broken); }
  .vp-body { flex: 1; min-height: 0; overflow: auto; padding: 4px 12px 8px; }
  .vp-desc { margin: 4px 0 10px; color: var(--pip-bright); text-shadow: 0 0 5px var(--glow-soft); overflow-wrap: anywhere; }
  .vp-facts { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0 0 10px; }
  .vp-facts dt { color: var(--pip-dim); letter-spacing: 0.12em; font-size: 11px; }
  .vp-facts dd { margin: 0; color: var(--pip-bright); overflow-wrap: anywhere; }
  .vp-checks h4 { margin: 0 0 4px; color: var(--pip-dim); font-size: 11px; letter-spacing: 0.14em; border-top: 1px dashed var(--pip-dark); padding-top: 8px; }
  .vp-checks ul, .vp-errors { list-style: none; margin: 0; padding: 0; }
  .vp-trouble h4, .vp-errlines h4 {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin: 8px 0 4px; padding-top: 8px; border-top: 1px dashed var(--pip-dark);
    font-size: 11px; letter-spacing: 0.14em; color: var(--pip-dim);
  }
  .vp-trouble h4 { color: var(--status-broken); }
  .vp-trouble ul { list-style: none; margin: 0; padding: 0; }
  .vp-trouble li { display: flex; gap: 8px; align-items: flex-start; padding: 4px 0; }
  .vp-trouble .dot { flex: none; width: 10px; height: 10px; margin-top: 3px; border-radius: 50%; background: var(--status-broken); box-shadow: 0 0 6px var(--status-broken); }
  .vp-trouble .body { display: flex; flex-direction: column; min-width: 0; }
  .vp-trouble .when, .vp-errlines .when { color: var(--pip-dim); font-size: 11px; }
  .vp-trouble .call { color: var(--pip-bright); overflow-wrap: anywhere; }
  .vp-trouble .err { color: var(--status-broken); overflow-wrap: anywhere; }
  .vp-metrics h4 {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin: 8px 0 4px; padding-top: 8px; border-top: 1px dashed var(--pip-dark);
    font-size: 11px; letter-spacing: 0.14em; color: var(--pip-dim);
  }
  .vp-metrics .res { margin: 6px 0 2px; display: flex; justify-content: space-between; gap: 8px; font-size: 11px; }
  .vp-metrics .res .name { color: var(--pip-bright); overflow-wrap: anywhere; min-width: 0; }
  .vp-metrics .res .head { color: var(--pip-mid); white-space: nowrap; }
  .vp-metrics .res.hang .head { color: var(--status-hang); }
  .vp-metrics .res.broken .head { color: var(--status-broken); }
  .vp-metrics ul { list-style: none; margin: 0; padding: 0; }
  .vp-metrics li { display: grid; grid-template-columns: 64px 1fr 74px; align-items: center; gap: 6px; padding: 1px 0; font-size: 10px; }
  .vp-metrics li .lbl { color: var(--pip-dim); letter-spacing: 0.1em; }
  .vp-metrics li .val { color: var(--pip-bright); text-align: right; white-space: nowrap; }
  .vp-metrics li.hot .val { color: var(--status-hang); }
  .vp-metrics svg { display: block; width: 100%; height: 16px; background: var(--pip-ink); border: 1px solid var(--pip-dark); }
  .vp-metrics svg polyline { fill: none; stroke: var(--pip-bright); stroke-width: 1.2; vector-effect: non-scaling-stroke; filter: drop-shadow(0 0 2px var(--pip-mid)); }
  .vp-metrics li.hot svg polyline { stroke: var(--status-hang); }
  .vp-metrics .kp-meter { height: 10px; background: var(--pip-ink); border: 1px solid var(--pip-dark); }
  .vp-metrics .kp-meter span { display: block; height: 100%; background: var(--pip-mid); box-shadow: 0 0 6px var(--glow-soft); }
  .vp-metrics li.hot .kp-meter span { background: var(--status-hang); }
  .vp-metrics.kp-body li { grid-template-columns: 64px 1fr 110px; }
  .vp-reload { min-height: 20px; padding: 0 6px; font: inherit; font-size: 10px; letter-spacing: 0.12em; color: var(--pip-mid); background: transparent; border: 1px solid var(--pip-dim); cursor: pointer; }
  .vp-reload:hover, .vp-reload:focus-visible { outline: none; color: var(--pip-hot); border-color: var(--pip-hot); }
  .vp-reload:disabled { opacity: 0.6; cursor: default; }
  .vp-note { margin: 2px 0 4px; color: var(--pip-dim); font-size: 11px; overflow-wrap: anywhere; }
  .vp-note.err { color: var(--status-broken); }
  .vp-lines { list-style: none; margin: 0; padding: 4px 6px; max-height: 132px; overflow: auto; background: var(--pip-ink); border: 1px solid var(--pip-dark); font-size: 11px; line-height: 1.4; }
  .vp-lines li { display: flex; gap: 6px; padding: 1px 0; }
  .vp-lines .text { color: var(--status-hang); overflow-wrap: anywhere; min-width: 0; }
  .vp-checks li { display: flex; gap: 8px; align-items: flex-start; padding: 4px 0; border-bottom: 1px solid rgba(20, 255, 106, 0.08); }
  .vp-checks .dot { flex: none; width: 10px; height: 10px; margin-top: 3px; border-radius: 50%; background: var(--pip-dim); box-shadow: inset 0 0 0 1px #000; }
  .vp-checks li.ok .dot { background: var(--status-ok); box-shadow: 0 0 6px var(--status-ok), inset 0 0 0 1px #000; }
  .vp-checks li.fail .dot { background: var(--status-broken); box-shadow: 0 0 6px var(--status-broken), inset 0 0 0 1px #000; }
  .vp-checks li.slow .dot { background: var(--status-hang); box-shadow: 0 0 6px var(--status-hang), inset 0 0 0 1px #000; }
  .vp-checks li.pending .dot { animation: vault-blink 1.2s steps(2) infinite; }
  .check-body { display: flex; flex-wrap: wrap; gap: 0 10px; min-width: 0; }
  .check-body .url { color: var(--pip-bright); overflow-wrap: anywhere; }
  .check-body .res { color: var(--pip-dim); }
  .check-body .err { flex-basis: 100%; color: var(--status-broken); overflow-wrap: anywhere; }
  .vp-checks li.slow .err { color: var(--status-hang); }
  .vp-errors li { position: relative; padding: 4px 0 4px 16px; color: var(--status-broken); overflow-wrap: anywhere; border-bottom: 1px solid rgba(255, 90, 60, 0.15); }
  .vp-errors li::before { content: "!"; position: absolute; left: 2px; top: 4px; font-weight: bold; }
  .vp-links { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px 10px; border-top: 1px dashed var(--pip-dark); }
  .vp-links .cmd { min-height: 28px; padding: 0 10px; font-size: 11px; letter-spacing: 0.12em; text-decoration: none; display: inline-flex; align-items: center; }
  @keyframes vault-blink { 50% { opacity: 0.25; } }
  @media (prefers-reduced-motion: reduce) { .vp-checks li.pending .dot { animation: none; } }
  #wall-grain { position: absolute; z-index: 2; min-height: 26px; padding: 0 6px; font-size: 11px; }
  #pip {
    position: absolute; top: 10px; left: 12px; z-index: 4; margin: 0;
    width: min(380px, calc(100% - 24px)); max-height: calc(100% - 20px); overflow: auto;
    padding: 0 0 8px; font-size: 13px; color: var(--pip-bright);
    background: rgba(2, 10, 5, 0.96); border: 2px solid var(--pip-mid);
    box-shadow: 0 0 18px rgba(20, 255, 106, 0.22); scrollbar-width: thin; scrollbar-color: var(--pip-dim) var(--pip-ink);
  }
  #pip .ptitle { margin-bottom: 8px; }
  #pip > .quiet { padding: 6px 10px; }
  #pip .card { margin: 0 8px 6px; border: 1px solid var(--pip-dark); }
  #pip .card.open { border-color: var(--pip-mid); }
  #pip .card-head {
    display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 4px 8px;
    color: var(--pip-mid); background: transparent; border: 0; font: inherit; letter-spacing: 0.06em; text-align: left; text-transform: uppercase;
  }
  #pip .card-head:hover, #pip .card.open .card-head { color: var(--pip-ink); background: var(--pip-bright); }
  #pip .card-head:hover img, #pip .card.open .card-head img { filter: brightness(0); }
  #pip .card-body { padding: 6px 10px 10px; display: flex; flex-direction: column; gap: 6px; color: var(--pip-mid); }
  #pip label { display: flex; gap: 8px; align-items: center; justify-content: space-between; color: var(--pip-dim); letter-spacing: 0.08em; text-transform: uppercase; font-size: 11px; }
  #pip label select, #pip label input { flex: 0 1 200px; }
  #pip .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  #pip .actions input { flex: 1 1 140px; }
  #pip .danger { border-color: var(--status-broken); color: var(--status-broken); }
  #pip .danger:hover { background: var(--status-broken); color: var(--pip-ink); }
  #pip-watch { margin: 0; color: var(--pip-bright); }
  #pip-watch.fail { color: var(--status-broken); }
  #pip pre { margin: 0; max-height: 220px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--pip-mid); font: inherit; font-size: 12px; }
  #pip pre:empty { display: none; }
  /* ---- TERMINAL: a RobCo CRT over the right side of the map ---- */
  #term {
    position: absolute; top: 10px; right: 12px; bottom: 10px; z-index: 5;
    width: min(560px, calc(100% - 24px)); display: flex; flex-direction: column; min-height: 0;
    color: var(--pip-bright); font-size: 13px; text-shadow: 0 0 5px var(--glow-soft);
    background: radial-gradient(ellipse at 50% 40%, var(--pip-glass), var(--pip-ink) 85%);
    border: 3px solid var(--pip-mid); box-shadow: inset 0 0 40px rgba(0, 0, 0, 0.85), 0 0 18px var(--glow-soft);
  }
  #term[hidden] { display: none; }
  #term::after {
    content: ""; position: absolute; inset: 0; pointer-events: none;
    background: repeating-linear-gradient(0deg, rgba(0, 0, 0, 0.22) 0 1px, transparent 1px 3px);
  }
  .term-head {
    display: flex; align-items: center; gap: 8px; padding: 4px 8px; flex: none;
    color: var(--pip-ink); font-weight: bold; letter-spacing: 0.1em; text-shadow: none;
    background: linear-gradient(180deg, var(--pip-hot), var(--pip-bright) 20%, var(--pip-mid));
  }
  .term-head img { filter: brightness(0); }
  .term-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .term-light { flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--pip-dark); box-shadow: inset 0 0 0 1px var(--pip-ink); }
  .term-light[data-state="running"] { background: var(--status-hang); box-shadow: 0 0 8px var(--status-hang); animation: vault-blink 0.8s steps(2) infinite; }
  .term-light[data-state="error"] { background: var(--status-broken); box-shadow: 0 0 8px var(--status-broken); }
  .term-state { flex: none; font-size: 11px; }
  .term-close { flex: none; color: var(--pip-bright); background: var(--pip-ink); border: 1px solid var(--pip-ink); font: inherit; font-size: 11px; padding: 1px 6px; cursor: pointer; }
  .term-close:hover, .term-close:focus-visible { outline: none; color: var(--pip-hot); box-shadow: 0 0 0 1px var(--pip-hot); }
  .term-note { margin: 0; padding: 4px 10px; flex: none; color: var(--pip-dim); font-size: 11px; letter-spacing: 0.08em; border-bottom: 1px dashed var(--pip-dark); }
  .term-log { flex: 1; min-height: 0; overflow: auto; padding: 8px 10px; scrollbar-width: thin; scrollbar-color: var(--pip-dim) var(--pip-ink); }
  .term-log p { margin: 0 0 6px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .term-hello p { color: var(--pip-mid); }
  .term-entry { margin-bottom: 12px; }
  .term-q { color: var(--pip-hot); }
  .term-text { color: var(--pip-bright); }
  .term-tool { color: var(--pip-dim); font-size: 11px; }
  .term-thinking { margin: 2px 0 6px; }
  .term-think-line { color: var(--pip-mid); letter-spacing: 0.12em; font-size: 12px; }
  .term-think-text { color: var(--pip-dim); font-size: 11px; font-style: italic; opacity: 0.8; max-height: 4.5em; overflow: hidden; }
  .term-cursor { display: inline-block; width: 0.6em; height: 1.05em; vertical-align: text-bottom; background: var(--pip-bright); box-shadow: 0 0 6px var(--glow-bright); animation: vault-blink 1s steps(2) infinite; }
  .term-block { margin: 4px 0 8px; border: 1px solid var(--pip-dim); background: rgba(0, 0, 0, 0.35); }
  .term-block.actions { border-color: var(--pip-mid); }
  .term-block-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 2px 2px 8px; color: var(--pip-dim); font-size: 11px; letter-spacing: 0.1em; border-bottom: 1px dashed var(--pip-dark); }
  .term-block pre { margin: 0; padding: 6px 8px; overflow-x: auto; white-space: pre; color: var(--pip-hot); font: inherit; font-size: 12px; }
  .term-actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 8px; border-top: 1px dashed var(--pip-dark); }
  #term .cmd { min-height: 26px; padding: 0 8px; font-size: 11px; letter-spacing: 0.1em; }
  .term-act { border-color: var(--status-hang); color: var(--status-hang); }
  .term-act:hover { background: var(--status-hang); color: var(--pip-ink); }
  .term-error { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; padding: 6px 8px; border: 1px solid var(--status-broken); color: var(--status-broken); }
  .term-error.cancelled { border-color: var(--pip-dim); color: var(--pip-dim); }
  .term-error-text::before { content: "! "; font-weight: bold; }
  .term-fix { color: var(--pip-bright); overflow-wrap: anywhere; }
  .term-chips { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 10px; flex: none; border-top: 1px dashed var(--pip-dark); }
  .chip { min-height: 24px; padding: 0 8px; font: inherit; font-size: 11px; color: var(--pip-mid); background: transparent; border: 1px solid var(--pip-dark); border-radius: 12px; cursor: pointer; }
  .chip:hover:not(:disabled), .chip:focus-visible { color: var(--pip-ink); background: var(--pip-bright); border-color: var(--pip-bright); outline: none; }
  .chip:disabled, #term .cmd:disabled { opacity: 0.4; cursor: default; }
  .term-form { display: flex; align-items: center; gap: 6px; padding: 6px 10px 8px; flex: none; }
  .term-prompt { color: var(--pip-hot); font-weight: bold; }
  .term-input { flex: 1; min-width: 0; min-height: 30px; caret-color: var(--pip-hot); }
  #ask-this { flex: none; min-height: 26px; padding: 0 8px; font-size: 11px; letter-spacing: 0.08em; display: inline-flex; align-items: center; gap: 6px; }
  #ask-this[hidden] { display: none; }
  @media (prefers-reduced-motion: reduce) { .term-cursor, .term-light[data-state="running"] { animation: none; } }
  @media (max-width: 900px) { #term { top: 6px; right: 6px; bottom: 6px; width: calc(100% - 12px); } }
  #status.issue { color: var(--status-broken); text-shadow: 0 0 6px rgba(255, 90, 54, 0.4); }
  /* Phosphor scrollbars: the path is wider than a narrow window, so the bar must read as part of the screen. */
  #map, #radio { scrollbar-width: thin; scrollbar-color: var(--pip-dim) var(--pip-ink); }

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
  #radio li time { flex: 0 0 auto; color: var(--pip-dim); font-size: 11px; }
  #radio li.fail { color: var(--status-broken); }
  #radio li.fail time { color: var(--status-broken); opacity: 0.75; }
  #radio-panel.issue .ptitle { background: var(--status-broken); }
  .tab.toggle.issue::after { background: var(--status-broken) !important; box-shadow: 0 0 6px var(--status-broken) !important; }
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
  /* Wide: the readout and knobs fit on the top row; the gauges get a row. */
  @media (min-width: 1600px) {
    .gauges { order: 10; flex-basis: 100%; }
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
    /* Narrow: the bill sits beside the readout, the tally takes its own row. */
    .gauges { display: contents; }
    .readout { order: 8; }
    #corner { order: 9; }
    #corner { flex: 1 1 180px; }
    #tally { order: 10; flex: 1 1 100%; }
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
    <button id="home" class="porthole" type="button" aria-label="overview" title="overview"><canvas id="mascot" width="26" height="24" aria-hidden="true"></canvas></button>
    <div><h1>CLOUD SPIDER</h1><small>SPIDER-TEC SURVEY UNIT 3000</small></div>
  </div>
  <nav class="tabs" aria-label="views">
    <button id="tab-map" class="tab" type="button" data-icon="map" aria-pressed="true">Map</button>
    <button id="path" class="tab" type="button" data-icon="path" aria-pressed="false">Path</button>
    <button id="cluster" class="tab" type="button" data-icon="cluster" aria-pressed="false">Cluster</button>
    <button id="tab-radio" class="tab toggle" type="button" data-icon="radio" aria-pressed="true">Radio</button>
    <button id="upgrade" class="tab toggle" type="button" data-icon="stack" aria-pressed="false">Stacks</button>
    <button id="ask" class="tab toggle" type="button" data-icon="terminal" aria-pressed="false" title="ask your local agent (runs only when you press ASK)">Ask</button>
  </nav>
  <button id="sample" class="switch" type="button" aria-pressed="false"><span class="lever"></span>SAMPLE<span class="led"></span></button>
  <div class="gauges" aria-label="map readouts">
    <p id="tally" class="lcd" hidden><img class="px" data-icon="map" alt=""><span id="tally-text"></span><span id="tally-issue"></span></p>
    <div id="corner">
      <button id="spend" class="lcd" type="button" aria-expanded="false" aria-controls="spend-lines" hidden><img class="px" data-icon="caps" alt=""><b>CAPS</b><span id="spend-label"></span><i class="caret" aria-hidden="true"></i></button>
      <pre id="spend-lines" hidden></pre>
    </div>
  </div>
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
    <span class="choice">
      <button id="yes" class="cmd" type="button" data-icon="stop" hidden>put it down</button>
      <button id="no" class="cmd" type="button" hidden>leave it</button>
    </span>
    <button id="ask-this" class="cmd" type="button" data-icon="terminal" hidden>ASK ABOUT THIS</button>
  </div>
  <p id="error" hidden></p>
  <section id="morning" aria-label="morning report" hidden>
    <canvas id="sunrise" width="64" height="36" aria-hidden="true"></canvas>
    <div class="m-head"><b>MORNING</b><small>REPORT</small><output id="morning-when"></output></div>
    <ul class="m-lines">
      <li id="m-hurting" class="m-line"><img class="px" data-icon="fire" alt=""><b>HURTING</b><span class="m-text"></span><i class="m-led" aria-hidden="true"></i></li>
      <li id="m-changed" class="m-line"><img class="px" data-icon="clock" alt=""><b>CHANGED</b><span class="m-text"></span><i class="m-led" aria-hidden="true"></i></li>
      <li id="m-idle" class="m-line"><img class="px" data-icon="caps" alt=""><b>IDLE·BILLED</b><span class="m-text"></span><i class="m-led" aria-hidden="true"></i></li>
    </ul>
    <button id="morning-fold" class="m-fold" type="button" aria-expanded="true" aria-controls="morning" title="fold the morning report">&#9650;</button>
  </section>
  <div class="body">
    <div class="mapwrap">
      <div id="map">
        <canvas id="place"></canvas>
        <select id="wall-grain" aria-label="camp grain" hidden>
          <option value="coarse">coarse</option>
          <option value="fine">fine</option>
        </select>
        <button id="vault-all" class="cmd" type="button" aria-pressed="false" hidden>OPEN ALL</button>
        <button id="vault-templates-btn" class="cmd" type="button" aria-expanded="false" aria-controls="vault-templates" hidden>TEMPLATES</button>
        <section id="vault-templates" aria-label="vault templates" hidden></section>
        <div id="vault-panels"></div>
      </div>
      <section id="kube-panel" class="vault-panel" aria-label="pod details" hidden></section>
      <form id="pip" hidden></form>
      <section id="term" hidden></section>
    </div>
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
    send(res, 200, { place: samplePlace(), trail: sampleTrail(), morning: sampleMorning() });
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

  if (req.method === "GET" && url.pathname === "/api/vaults") {
    // No boot here: vaults come from files, so they show even before (or
    // without) an AWS read; ownership fills in once the place is known.
    send(res, 200, await app.vaultsView({ sample: url.searchParams.get("sample") === "1" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/vaults/logs") {
    send(res, 200, await app.vaultLogs(url.searchParams.get("key") || "", { sample: url.searchParams.get("sample") === "1" }));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/vaults/test") {
    const body = await readJson(req);
    send(res, 200, await app.vaultsTest(req.headers.origin, body?.key, { sample: Boolean(body?.sample) }));
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
    const values = {};
    for (const key of ["clusterName", "name"]) {
      const value = url.searchParams.get(key);
      if (value) values[key] = value;
    }
    send(res, 200, await app.upgradeStatus(url.searchParams.get("module") || "", url.searchParams.get("fresh") === "1", values));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/upgrade") {
    const body = await readJson(req);
    send(res, 200, await app.upgradeRun(req.headers.origin, body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent") {
    const body = await readJson(req);
    let open = false;
    const write = (event) => {
      if (open && !res.writableEnded) res.write(`${JSON.stringify(event)}\n`);
    };
    const run = app.agentAsk(req.headers.origin, body, write);
    if (!run || run.error) {
      send(res, run?.status || 400, { error: run?.error || "the agent did not run" });
      return;
    }
    res.writeHead(200, {
      "content-type": "application/x-ndjson; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.flushHeaders();
    open = true;
    // A closed tab or a dropped fetch stops the agent too.
    res.on("close", () => {
      if (!res.writableEnded) app.agentCancel(req.headers.origin);
    });
    await run.done;
    if (!res.writableEnded) res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/agent/cancel") {
    const result = app.agentCancel(req.headers.origin);
    send(res, result.status || 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cluster-sample") {
    send(res, 200, sampleCluster());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cluster/pod") {
    if (url.searchParams.get("sample") === "1") {
      send(res, 200, samplePodDetail(url.searchParams.get("name") || ""));
      return;
    }
    send(res, 200, await app.clusterPod({ ns: url.searchParams.get("ns"), name: url.searchParams.get("name"), container: url.searchParams.get("container") }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/metrics") {
    const sample = url.searchParams.get("sample") === "1";
    if (!sample) await app.boot();
    send(res, 200, await app.metricsView({ sample }));
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
