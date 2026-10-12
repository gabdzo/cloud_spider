import { MODULE_IDS, gateStyle, moduleOff, stackModule } from "./modules.js";
import { sampleLogErrors } from "./log-errors-sample.js";
import { cleanLogWindow } from "./log-errors.js";
import { graphScenario } from "./graph-sample.js";
import { buildGraph } from "./graph-build.js";
import { readGraph } from "./graph-read.js";
import { readTimeline } from "./timeline-live.js";
import { detect as observeDetect, planView as observePlan } from "./observe/plan.js";
import { mergeLive, readLive as observeLive } from "./observe/live.js";
import { sampleObserve } from "./observe/sample.js";
import { originAllowed } from "./origin.js";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { sampleScoreView } from "./score/sample-scan.js";
import { sampleAlbRoutes, sampleMorning, samplePlace, sampleTrail } from "./sample.js";
import { samplePathGraph } from "./path-sample.js";
import { peerSampleWorld } from "./peer-path.js";
import { pathResult, withPeers } from "./path-view.js";
import { THEME_NAMES, cssVars } from "./theme.js";
import { SCORE_CSS } from "./score/style.js";
import { ND_CSS } from "./netdebug/style.js";
import { LE_CSS } from "./log-errors-style.js";
import { scoreRoute } from "./score/routes.js";
import { netdebugRoute } from "./netdebug/routes.js";
import { defaults, effectiveConfig } from "./config.js";
import { sampleCost } from "./cost.js";
import { sampleClusterSnapshot, sampleKubeSnapshot, sampleMapSnapshot, samplePodDetail, samplePodInspect } from "./kube-sample.js";
import { diagramFromKube } from "./kube-diagram.js";
import { inspectPod } from "./kube-inspect.js";
import { sampleTelemetry } from "./kube-telemetry.js";

const root = dirname(fileURLToPath(import.meta.url));
export const FILES = new Set([
  "browser.js",
  "where.js",
  "score/view.js",
  "netdebug/view.js",
  "netdebug/walkthrough.js",
  "spend-view.js",
  "draw.js",
  "sprites.js",
  "pixel-art.js",
  "layout-cache.js",
  "ui.js",
  "layout.js",
  "stack-sample.js",
  "peering.js",
  "arch-layout.js",
  "radio.js",
  "verbs.js",
  "ids.js",
  "report.js",
  "path-layout.js",
  "path-draw.js",
  "scene.js",
  "cluster.js",
  "kube-diagram.js",
  "kube-layout.js",
  "kube-search.js",
  "k9s.js",
  "kube-draw.js",
  "kube-telemetry.js",
  "tele-draw.js",
  "tele-view.js",
  "pod-inspect-view.js",
  "ops-view.js",
  "graph-sample.js",
  "graph-route.js",
  "graph-model.js",
  "graph-view.js",
  "graph-group.js",
  "graph-layers.js", "svc-endpoints.js",
  "kube-group.js",
  "log-errors-view.js",
  "kube-empty.js",
  "slo.js",
  "slo-view.js",
  "map-kube.js",
  "map-kube-draw.js",
  "map-pro.js",
  "map-pro-icons.js",
  "sprites/kube.js",
  "metrics.js",
  "upgrade-rules.js",
  "run-pane.js",
  "node-labels.js",
  "stack-costs.js",
  "stack-bundles.js",
  "theme.js",
  "draw-kit.js",
  "chrome.js",
  "sprites/icons.js",
  "sprites/perks.js",
  "sprites/mascot.js",
  "sprites/buildings.js",
  "sprites/landmarks.js",
  "sprites/vault.js",
  "vault-state.js",
  "vault-match.js",
  "vault-schema.js",
  "vault-layout.js",
  "vault-draw.js",
  "vault-page.js",
  "vault-perks.js",
  "alb-routes.js",
  "perk-view.js",
  "url-state.js",
  "settings-view.js",
  "module-keys.js",
  "map-focus.js",
  "agent-text.js",
  "terminal.js",
  "learn-view.js",
  "sprites/holotape.js",
]);

// Self-hosted fonts (SIL OFL 1.1, license in src/fonts/). Served by name
// only; nothing else under src/fonts is reachable.
export const FONT_FILES = new Map([
  ["fonts/ShareTechMono-Regular.woff2", "font/woff2"],
  // The pro theme's faces (SIL OFL 1.1, licenses beside them).
  ["fonts/inter-latin-400-normal.woff2", "font/woff2"],
  ["fonts/inter-latin-500-normal.woff2", "font/woff2"],
  ["fonts/inter-latin-600-normal.woff2", "font/woff2"],
  ["fonts/jetbrains-mono-latin-400-normal.woff2", "font/woff2"],
]);

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cloud Spider</title>
<link rel="icon" href="data:,">
<link rel="preload" href="/fonts/ShareTechMono-Regular.woff2" as="font" type="font/woff2" crossorigin>
<script>
  // The theme this browser picked in settings (settings-view.js) wins over
  // ui.theme from the config; applied before the first paint.
  try { const t = localStorage.getItem("cloudspider.theme"); if (t === "pip" || t === "pro") document.documentElement.dataset.theme = t; } catch {}
</script>
<style>
  /* Share Tech Mono ships with the app (src/fonts, SIL OFL 1.1), so the Mac,
     the box and every screenshot draw the same face. Bold is synthesized.
     If it fails to load, the stack falls to VT323, then Menlo. */
  @font-face {
    font-family: "Share Tech Mono";
    src: url("/fonts/ShareTechMono-Regular.woff2") format("woff2");
    font-weight: 400;
    font-style: normal;
    font-display: swap;
  }
  /* The pro theme: Inter for the UI, JetBrains Mono for aligned text. Only
     downloaded when a pro page uses them. */
  @font-face { font-family: "Inter"; src: url("/fonts/inter-latin-400-normal.woff2") format("woff2"); font-weight: 400; font-display: swap; }
  @font-face { font-family: "Inter"; src: url("/fonts/inter-latin-500-normal.woff2") format("woff2"); font-weight: 500; font-display: swap; }
  @font-face { font-family: "Inter"; src: url("/fonts/inter-latin-600-normal.woff2") format("woff2"); font-weight: 600 700; font-display: swap; }
  @font-face { font-family: "JetBrains Mono"; src: url("/fonts/jetbrains-mono-latin-400-normal.woff2") format("woff2"); font-weight: 400 700; font-display: swap; }
  ${cssVars()}
  ${SCORE_CSS}
  ${ND_CSS}
  ${LE_CSS}
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
  #place:focus { outline: none; }
  .sr-only { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; border: 0; }
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

  /* ---- hardware buttons ---- */
  /* The view and panel buttons are physical Pip-Boy push-buttons set into a
     recessed strip: dark unlit green glass in a black rim when off, phosphor
     lit from behind (and pressed in) when on. Every colour is a theme var. */
  .tabs {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 7px 10px 9px;
    border-radius: 7px;
    background:
      linear-gradient(180deg, var(--btn-rim) 0, transparent 7px),
      radial-gradient(ellipse at 50% 0%, var(--pip-glass), var(--pip-ink));
    box-shadow:
      inset 0 0 0 2px var(--btn-rim),
      inset 0 3px 10px var(--btn-shade),
      0 1px 0 var(--btn-rim-hi);
  }
  .tab {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 7px;
    min-height: 36px;
    padding: 0 12px 0 11px;
    border: 1px solid var(--btn-rim);
    border-radius: 5px;
    background:
      linear-gradient(180deg, var(--btn-off-top) 0%, var(--btn-off-mid) 48%, var(--btn-off-low) 100%);
    box-shadow:
      0 0 0 2px var(--btn-rim),
      0 0 0 3px var(--btn-rim-hi),
      inset 0 1px 0 var(--btn-gloss),
      inset 0 -3px 4px var(--btn-shade),
      inset 0 0 0 1px var(--btn-rim),
      0 3px 0 1px var(--btn-skirt),
      0 5px 6px var(--btn-shade);
    color: var(--btn-off-label);
    font: inherit;
    font-size: 15px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    text-shadow: 0 -1px 0 var(--btn-rim);
    cursor: pointer;
    transform: translateY(0);
    transition: transform 0.08s ease-out, box-shadow 0.12s, color 0.12s, background 0.12s;
  }
  /* glass sheen across the top half of the cap */
  .tab::before {
    content: "";
    position: absolute;
    inset: 2px 3px 55% 3px;
    border-radius: 3px 3px 8px 8px;
    background: linear-gradient(180deg, var(--btn-gloss), transparent);
    pointer-events: none;
  }
  /* indicator lamp: a small bulb in its own socket */
  .tab::after {
    content: "";
    flex: none;
    width: 7px;
    height: 7px;
    margin-left: 2px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, var(--lamp-off-hi), var(--lamp-off) 60%);
    box-shadow: 0 0 0 1px var(--btn-rim), inset 0 1px 2px var(--btn-shade);
  }
  .tab img { opacity: 0.45; filter: saturate(0.6) brightness(0.8); transition: opacity 0.12s, filter 0.12s; }
  .tab:hover, .tab:focus-visible {
    color: var(--pip-mid);
    background:
      linear-gradient(180deg, var(--btn-hover), transparent),
      linear-gradient(180deg, var(--btn-off-top) 0%, var(--btn-off-mid) 48%, var(--btn-off-low) 100%);
  }
  .tab:hover img, .tab:focus-visible img { opacity: 0.7; }
  .tab:focus-visible { outline: 2px dashed var(--pip-bright); outline-offset: 5px; }
  .tab:focus:not(:focus-visible) { outline: none; }
  .tab:active { transform: translateY(2px); }
  .tab[aria-pressed="true"] {
    color: var(--btn-lit-label);
    background:
      radial-gradient(ellipse at 50% 120%, var(--btn-glow), transparent 70%),
      linear-gradient(180deg, var(--btn-lit-top) 0%, var(--btn-lit-mid) 50%, var(--btn-lit-low) 100%),
      var(--pip-ink);
    box-shadow:
      0 0 0 2px var(--btn-rim),
      0 0 0 3px var(--btn-rim-hi),
      inset 0 1px 0 var(--btn-gloss-lit),
      inset 0 -2px 6px var(--btn-shade),
      inset 0 0 10px var(--btn-glow-far),
      0 1px 0 1px var(--btn-skirt),
      0 0 14px var(--btn-glow-far),
      0 0 4px var(--btn-glow);
    text-shadow: 0 0 6px var(--glow-bright), 0 0 1px var(--btn-lit-label);
    transform: translateY(2px);
  }
  .tab[aria-pressed="true"]::before { background: linear-gradient(180deg, var(--btn-gloss-lit), transparent); opacity: 0.6; }
  .tab[aria-pressed="true"]::after {
    background: radial-gradient(circle at 40% 35%, var(--lamp-on-core), var(--lamp-on) 55%, var(--pip-mid));
    box-shadow: 0 0 0 1px var(--btn-rim), 0 0 6px var(--lamp-on), 0 0 12px var(--btn-glow);
  }
  .tab[aria-pressed="true"] img { opacity: 1; filter: drop-shadow(0 0 3px var(--glow-bright)); }
  .tab[aria-pressed="true"]:hover { color: var(--btn-lit-label); filter: brightness(1.08); }

  /* SAMPLE: a worn lever toggle on a riveted, chipped plate. role=switch,
     aria-checked; the lever snaps up for ON. */
  .switch {
    position: relative;
    display: inline-grid;
    grid-template-columns: auto auto auto auto;
    align-items: center;
    gap: 8px;
    min-height: 44px;
    padding: 4px 12px 4px 10px;
    border: 0;
    border-radius: 4px;
    color: var(--plate-stencil);
    font: inherit;
    cursor: pointer;
    background:
      /* rivets */
      radial-gradient(circle at 5px 5px, var(--plate-steel) 0 1.5px, var(--plate-seam) 2.2px, transparent 2.8px),
      radial-gradient(circle at calc(100% - 5px) 5px, var(--plate-steel) 0 1.5px, var(--plate-seam) 2.2px, transparent 2.8px),
      radial-gradient(circle at 5px calc(100% - 5px), var(--plate-steel) 0 1.5px, var(--plate-seam) 2.2px, transparent 2.8px),
      radial-gradient(circle at calc(100% - 5px) calc(100% - 5px), var(--plate-steel) 0 1.5px, var(--plate-seam) 2.2px, transparent 2.8px),
      /* chipped paint showing steel */
      radial-gradient(ellipse 6px 3px at 18% 88%, var(--plate-steel) 0 60%, transparent 70%),
      radial-gradient(ellipse 4px 2px at 71% 12%, var(--plate-steel) 0 60%, transparent 70%),
      radial-gradient(ellipse 3px 2px at 92% 64%, var(--plate-steel-dim) 0 60%, transparent 70%),
      radial-gradient(ellipse 9px 5px at 96% 96%, var(--plate-rust) 0 40%, transparent 75%),
      /* scratches */
      linear-gradient(112deg, transparent 31%, var(--plate-scratch) 31.5%, transparent 33%),
      linear-gradient(74deg, transparent 63%, var(--plate-scratch) 63.4%, transparent 64.6%),
      linear-gradient(160deg, transparent 80%, var(--plate-scratch) 80.4%, transparent 81.2%),
      /* grime gathers at the edges */
      radial-gradient(ellipse at 50% 45%, transparent 55%, var(--plate-grime) 100%),
      /* brushed metal under olive paint */
      repeating-linear-gradient(90deg, transparent 0 2px, var(--plate-brush) 2px 3px, transparent 3px 5px),
      linear-gradient(180deg, var(--plate-paint-hi) 0%, var(--plate-paint) 45%, var(--plate-paint-lo) 100%);
    box-shadow:
      inset 0 1px 0 var(--btn-rim-hi),
      inset 0 -2px 0 var(--btn-shade),
      inset 0 0 0 1px var(--plate-seam),
      0 2px 0 var(--plate-seam),
      0 4px 6px var(--btn-shade);
  }
  .switch:focus-visible { outline: 2px dashed var(--pip-bright); outline-offset: 4px; }
  .switch:focus:not(:focus-visible) { outline: none; }
  /* the threaded bushing and its hex nut */
  .switch .well {
    position: relative;
    width: 24px;
    height: 34px;
  }
  .switch .nut {
    position: absolute;
    left: 3px;
    top: 10px;
    width: 18px;
    height: 14px;
    clip-path: polygon(25% 0, 75% 0, 100% 50%, 75% 100%, 25% 100%, 0 50%);
    background: linear-gradient(180deg, var(--lever-hi), var(--lever-mid) 45%, var(--lever-lo));
  }
  .switch .nut::after {
    content: "";
    position: absolute;
    left: 5px;
    top: 3px;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: radial-gradient(circle at 50% 40%, var(--plate-seam) 0 45%, var(--lever-lo) 70%, var(--lever-hi));
  }
  /* the bat-handle lever pivots on the nut's centre */
  .switch .lever {
    position: absolute;
    left: 9px;
    top: 0;
    width: 6px;
    height: 17px;
    border-radius: 3px 3px 2px 2px;
    transform-origin: 50% 100%;
    transform: rotate(160deg);
    background: linear-gradient(90deg, var(--lever-lo), var(--lever-hi) 40%, var(--lever-mid) 70%, var(--lever-lo));
    box-shadow: 1px 2px 2px var(--btn-shade);
    transition: transform 0.22s cubic-bezier(0.3, 1.7, 0.5, 1);
  }
  .switch .lever::before {
    content: "";
    position: absolute;
    left: -2px;
    top: -4px;
    width: 10px;
    height: 8px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, var(--lever-tip), var(--lever-hi) 35%, var(--lever-mid) 65%, var(--lever-lo));
    box-shadow: 0 1px 2px var(--btn-shade);
  }
  .switch[aria-checked="true"] .lever { transform: rotate(20deg); }
  .switch:active .lever { transform: rotate(90deg); }
  .switch .marks {
    display: grid;
    grid-template-rows: 1fr 1fr;
    align-content: space-between;
    height: 34px;
    font-size: 9px;
    letter-spacing: 0.12em;
    line-height: 1;
    color: var(--plate-stencil-dim);
    text-shadow: 0 1px 0 var(--btn-shade);
  }
  .switch .marks span:last-child { align-self: end; }
  .switch .name {
    font-size: 12px;
    letter-spacing: 0.2em;
    color: var(--plate-stencil);
    text-shadow: 0 -1px 0 var(--btn-shade), 0 1px 0 var(--btn-rim-hi);
    opacity: 0.85;
  }
  .switch[aria-checked="true"] .marks span:first-child,
  .switch[aria-checked="false"] .marks span:last-child { color: var(--plate-stencil); }
  /* the lamp sits in a steel bezel beside the name */
  .switch .led {
    grid-column: 4;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, var(--lamp-off-hi), var(--lamp-off) 60%);
    box-shadow: 0 0 0 2px var(--lever-lo), 0 0 0 3px var(--lever-hi), inset 0 1px 2px var(--btn-shade);
    transition: background 0.15s, box-shadow 0.15s;
  }
  .switch[aria-checked="true"] .led {
    background: radial-gradient(circle at 40% 35%, var(--lamp-on-core), var(--lamp-on) 55%, var(--pip-mid));
    box-shadow: 0 0 0 2px var(--lever-lo), 0 0 0 3px var(--lever-hi), 0 0 8px var(--lamp-on), 0 0 16px var(--btn-glow);
  }

  /* The control console: RADIO / STACKS / ASK open panels, not views, so they
     are chunky illuminated keys on their own riveted sub-panel, beside the
     SAMPLE lever. Each key: a square glass cap with its icon and a corner
     lamp, and a stamped label plate under it. */
  .console {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 6px 12px 6px 12px;
    border-radius: 7px;
    background:
      radial-gradient(circle at 6px 6px, var(--plate-steel) 0 1.5px, var(--plate-seam) 2.2px, transparent 2.8px),
      radial-gradient(circle at calc(100% - 6px) 6px, var(--plate-steel) 0 1.5px, var(--plate-seam) 2.2px, transparent 2.8px),
      radial-gradient(circle at 6px calc(100% - 6px), var(--plate-steel) 0 1.5px, var(--plate-seam) 2.2px, transparent 2.8px),
      radial-gradient(circle at calc(100% - 6px) calc(100% - 6px), var(--plate-steel) 0 1.5px, var(--plate-seam) 2.2px, transparent 2.8px),
      linear-gradient(180deg, var(--plate-paint-lo), var(--plate-seam));
    box-shadow:
      inset 0 2px 6px var(--btn-shade),
      inset 0 0 0 1px var(--plate-seam),
      0 1px 0 var(--btn-rim-hi);
  }
  .keys { display: flex; gap: 10px; }
  .key[hidden] { display: none !important; }
  .key {
    display: grid;
    justify-items: center;
    gap: 5px;
    padding: 0;
    border: 0;
    background: none;
    color: var(--btn-off-label);
    font: inherit;
    cursor: pointer;
  }
  .key .cap {
    position: relative;
    display: grid;
    place-items: center;
    width: 44px;
    height: 34px;
    border-radius: 6px;
    background: linear-gradient(180deg, var(--btn-off-top) 0%, var(--btn-off-mid) 48%, var(--btn-off-low) 100%);
    box-shadow:
      0 0 0 2px var(--btn-rim),
      0 0 0 4px var(--lever-lo),
      0 0 0 5px var(--btn-rim-hi),
      inset 0 1px 0 var(--btn-gloss),
      inset 0 -4px 5px var(--btn-shade),
      0 4px 0 1px var(--btn-skirt),
      0 6px 7px var(--btn-shade);
    transform: translateY(0);
    transition: transform 0.08s ease-out, box-shadow 0.12s, background 0.12s;
  }
  .key .cap::before {
    content: "";
    position: absolute;
    inset: 2px 3px 55% 3px;
    border-radius: 4px 4px 10px 10px;
    background: linear-gradient(180deg, var(--btn-gloss), transparent);
    pointer-events: none;
  }
  .key .cap::after {
    content: "";
    position: absolute;
    top: 4px;
    right: 4px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, var(--lamp-off-hi), var(--lamp-off) 60%);
    box-shadow: 0 0 0 1px var(--btn-rim), inset 0 1px 2px var(--btn-shade);
  }
  .key .cap img { width: 20px; height: 20px; image-rendering: pixelated; opacity: 0.45; filter: saturate(0.6) brightness(0.8); }
  .key .tag {
    min-width: 46px;
    padding: 1px 5px 2px;
    border-radius: 2px;
    background: linear-gradient(180deg, var(--plate-paint-hi), var(--plate-paint) 55%, var(--plate-paint-lo));
    box-shadow: inset 0 0 0 1px var(--plate-seam), inset 0 1px 0 var(--btn-rim-hi), 0 1px 1px var(--btn-shade);
    color: var(--plate-stencil-dim);
    font-size: 9px;
    letter-spacing: 0.18em;
    line-height: 1.3;
    text-align: center;
    text-transform: uppercase;
    text-shadow: 0 -1px 0 var(--btn-shade);
  }
  .key:hover .cap, .key:focus-visible .cap {
    background:
      linear-gradient(180deg, var(--btn-hover), transparent),
      linear-gradient(180deg, var(--btn-off-top) 0%, var(--btn-off-mid) 48%, var(--btn-off-low) 100%);
  }
  .key:hover .cap img, .key:focus-visible .cap img { opacity: 0.75; }
  .key:hover .tag, .key:focus-visible .tag { color: var(--plate-stencil); }
  .key:focus-visible { outline: 2px dashed var(--pip-bright); outline-offset: 4px; border-radius: 4px; }
  .key:focus:not(:focus-visible) { outline: none; }
  .key:active .cap { transform: translateY(3px); }
  .key[aria-pressed="true"] .cap {
    background:
      radial-gradient(ellipse at 50% 120%, var(--btn-glow), transparent 70%),
      linear-gradient(180deg, var(--btn-lit-top) 0%, var(--btn-lit-mid) 50%, var(--btn-lit-low) 100%),
      var(--pip-ink);
    box-shadow:
      0 0 0 2px var(--btn-rim),
      0 0 0 4px var(--lever-lo),
      0 0 0 5px var(--btn-rim-hi),
      inset 0 1px 0 var(--btn-gloss-lit),
      inset 0 -2px 6px var(--btn-shade),
      inset 0 0 12px var(--btn-glow-far),
      0 1px 0 1px var(--btn-skirt),
      0 0 16px var(--btn-glow-far),
      0 0 5px var(--btn-glow);
    transform: translateY(3px);
  }
  .key[aria-pressed="true"] .cap::before { background: linear-gradient(180deg, var(--btn-gloss-lit), transparent); opacity: 0.6; }
  .key[aria-pressed="true"] .cap::after {
    background: radial-gradient(circle at 40% 35%, var(--lamp-on-core), var(--lamp-on) 55%, var(--pip-mid));
    box-shadow: 0 0 0 1px var(--btn-rim), 0 0 6px var(--lamp-on), 0 0 12px var(--btn-glow);
  }
  .key[aria-pressed="true"] .cap img { opacity: 1; filter: drop-shadow(0 0 3px var(--glow-bright)); }
  .key[aria-pressed="true"] .tag { color: var(--plate-stencil); }
  @media (max-width: 520px) {
    .console { flex-wrap: wrap; justify-content: center; }
  }
  @media (prefers-reduced-motion: reduce) {
    .tab, .key .cap, .switch .lever, .switch .led { transition: none; }
  }
  /* ---- end hardware buttons ---- */

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
  .readout b, .readout label { color: var(--pip-dim-text); letter-spacing: 0.14em; font-weight: bold; }
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
  input::placeholder { color: var(--pip-dim-text); }
  button { cursor: pointer; }
  button.cmd, a.cmd { display: inline-flex; align-items: center; gap: 6px; letter-spacing: 0.08em; text-transform: uppercase; }
  button.cmd::before, a.cmd::before { content: "["; color: var(--pip-dim-text); }
  button.cmd::after, a.cmd::after { content: "]"; color: var(--pip-dim-text); }
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
  /* Cluster view: the prompt is a search line; the context note shrinks. */
  #kube-search {
    flex: 1 1 auto;
    min-width: 0;
    padding: 1px 4px;
    border: 0;
    border-bottom: 1px dashed var(--pip-dim);
    background: transparent;
    color: var(--pip-hot);
    font: inherit;
    text-shadow: inherit;
    caret-color: var(--pip-hot);
    outline: none;
  }
  #kube-search::placeholder { color: var(--pip-dim-text); opacity: 1; }
  #kube-search:focus { border-bottom: 1px solid var(--pip-bright); background: rgba(20, 255, 106, 0.05); }
  #kube-search::-webkit-search-cancel-button { filter: grayscale(1) brightness(1.6); }
  #kube-search-count { flex: none; color: var(--pip-mid); font-size: 12px; white-space: nowrap; }
  #kube-search-count.none { color: var(--status-hang); }
  #kube-groupby { flex: none; display: inline-flex; align-items: center; gap: 6px; margin-left: 10px; }
  #kube-groupby[hidden], #kube-groupby-custom[hidden] { display: none; }
  #kube-groupby b { font-weight: normal; font-size: 10px; letter-spacing: 0.16em; color: var(--pip-dim-text); white-space: nowrap; }
  #kube-groupby :is(select, input) { font: inherit; font-size: 12px; padding: 3px 6px; color: var(--pip-bright); background: var(--pip-ink); border: 1px solid var(--pip-dim); outline: none; }
  #kube-groupby input { width: 140px; }
  #kube-groupby input.bad { border-color: var(--status-broken); }
  #kube-groupby :is(select, input):focus { border-color: var(--pip-bright); box-shadow: 0 0 8px var(--glow-soft); }
  #confirm.caption { flex-basis: 100%; font-size: 11px; color: var(--pip-mid); opacity: 0.85; padding-left: 18px; }
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
  /* SCORE and LEARN fill the view with a small frame: a scrim under them so
     the map's labels in that frame do not read as part of the panel. */
  .mapwrap:has(#score:not([hidden]), #learn:not([hidden]))::before { content: ""; position: absolute; inset: 0; z-index: 5; background: rgba(0, 0, 0, 0.72); pointer-events: none; }
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
  .m-head output { color: var(--pip-dim-text); font-size: 10px; margin-top: 3px; letter-spacing: 0.06em; }
  /* One row of cards, however many lines the report has (three, or four with PODS). */
  .m-lines { list-style: none; margin: 0; padding: 0; min-width: 0; display: grid; grid-auto-flow: column; grid-auto-columns: minmax(0, 1fr); gap: 6px 10px; }
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
  /* A card is a button: it opens to its full sentence (and its subject's plate). */
  .m-line { cursor: pointer; }
  .m-line:focus-visible { outline: 2px solid var(--pip-hot); outline-offset: 1px; }
  .m-line[aria-expanded="true"] .m-text { -webkit-line-clamp: unset; display: block; }
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
  #morning.folded .m-lines { grid-auto-flow: row; grid-template-columns: minmax(0, 1fr); }
  #morning.folded .m-line:not(.lead) { display: none; }
  #morning.folded .m-line { grid-template-rows: auto; grid-template-columns: 16px auto minmax(0, 1fr); padding-top: 3px; padding-bottom: 3px; }
  #morning.folded .m-text { grid-column: 3; grid-row: 1; -webkit-line-clamp: 1; }
  @media (min-width: 1600px) {
    #sunrise { width: 96px; height: 54px; }
    .m-line .m-text { font-size: 13px; }
  }
  /* Narrow: a 2x2 grid of one-line cards (click one to read it whole), not
     four full-width rows that push the view under the fold; the MORNING
     word stays so the strip says what it is. */
  @media (max-width: 1180px) {
    #morning { grid-template-columns: auto auto minmax(0, 1fr) auto; gap: 0 10px; padding-top: 6px; padding-bottom: 6px; }
    #sunrise { width: 48px; height: 27px; }
    .m-head small, .m-head output { display: none; }
    .m-lines { grid-auto-flow: row; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 4px 8px; }
    .m-line { grid-template-rows: auto; padding-top: 3px; padding-bottom: 3px; }
    .m-line .m-text { grid-column: 3; grid-row: 1; -webkit-line-clamp: 1; }
    .m-line b { min-width: 0; }
  }
  @media (max-width: 820px) {
    #morning { grid-template-columns: minmax(0, 1fr) auto; padding-left: 10px; }
    #sunrise, .m-head { display: none; }
    .m-lines { grid-template-columns: minmax(0, 1fr); }
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
  /* The CAPS bill panel: an opaque Pip-Boy bezel under the LCD (spend-view.js). */
  #corner { z-index: 30; }
  #spend-lines {
    position: absolute; z-index: 40; top: calc(100% + 8px); right: 0;
    width: min(460px, calc(100vw - 24px)); max-height: min(70vh, 560px); overflow: auto; overscroll-behavior: contain;
    margin: 0; padding: 0 0 10px; font: inherit; font-size: 12px; line-height: 1.45; white-space: normal;
    color: var(--pip-mid); text-shadow: none;
    background: linear-gradient(180deg, var(--pip-glass), var(--pip-screen) 38%, var(--pip-ink));
    border-radius: 6px;
    box-shadow:
      0 0 0 2px #000, 0 0 0 4px var(--case-lo), 0 0 0 5px var(--case-seam),
      inset 0 1px 0 var(--glow-soft), inset 0 0 18px rgba(0, 0, 0, 0.85),
      0 14px 34px rgba(0, 0, 0, 0.8), 0 0 18px var(--glow-soft);
    scrollbar-color: var(--pip-dim) var(--pip-ink); scrollbar-width: thin;
  }
  #spend-lines .px { flex: none; image-rendering: pixelated; filter: drop-shadow(0 0 2px var(--glow-bright)); }
  .sp-head {
    position: sticky; top: 0; z-index: 1; display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
    padding: 10px 14px 9px; border-bottom: 1px solid var(--pip-dark);
    background: linear-gradient(180deg, var(--pip-glass), var(--pip-screen));
    box-shadow: inset 0 3px 0 var(--pip-bright), 0 4px 10px rgba(0, 0, 0, 0.6);
    border-radius: 6px 6px 0 0;
  }
  .sp-total { display: grid; gap: 1px; min-width: 0; }
  .sp-kicker { font-size: 10px; letter-spacing: 0.18em; color: var(--pip-dim-text); }
  .sp-big { font-size: 28px; line-height: 1.05; letter-spacing: 0.04em; color: var(--pip-hot); text-shadow: 0 0 10px var(--glow-bright); font-variant-numeric: tabular-nums; }
  .sp-cap { font-size: 10px; letter-spacing: 0.08em; color: var(--pip-dim-text); }
  .sp-chip {
    flex: none; margin-top: 2px; padding: 2px 7px; font-size: 10px; letter-spacing: 0.14em; color: var(--pip-ink);
    background: var(--pip-mid); border-radius: 2px; box-shadow: 0 0 0 1px #000, 0 0 8px var(--glow-soft);
  }
  .sp-pace { margin: 0; padding: 7px 14px; font-size: 11px; color: var(--pip-bright); border-bottom: 1px dashed var(--pip-dark); font-variant-numeric: tabular-nums; }
  .sp-credits { color: var(--case-brass); }
  .sp-sec { padding: 8px 14px 2px; }
  .sp-sec h3 { margin: 0 0 6px; font-size: 10px; font-weight: normal; letter-spacing: 0.18em; color: var(--pip-dim-text); display: flex; align-items: center; gap: 8px; }
  .sp-sec h3::after { content: ""; flex: 1; border-top: 1px solid var(--pip-dark); }
  .sp-rows { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
  .sp-rows li { display: grid; grid-template-columns: 16px minmax(0, 1fr) 30% auto; align-items: center; gap: 8px; }
  .sp-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pip-bright); }
  .sp-share { height: 6px; background: var(--pip-ink); box-shadow: inset 0 0 0 1px var(--pip-dark); }
  .sp-share i { display: block; height: 100%; background: linear-gradient(90deg, var(--pip-dim), var(--pip-bright)); box-shadow: 0 0 6px var(--glow-soft); }
  .sp-amt { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--pip-hot); }
  .sp-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  .sp-table td { padding: 4px 0; border-bottom: 1px solid rgba(0, 0, 0, 0.5); vertical-align: middle; }
  .sp-table tr:last-child td { border-bottom: 0; }
  .sp-who { display: flex; align-items: center; gap: 7px; min-width: 0; }
  .sp-svc { flex: none; min-width: 30px; padding: 0 4px; font-size: 9px; letter-spacing: 0.1em; text-align: center; color: var(--pip-ink); background: var(--pip-dim); border-radius: 2px; }
  .sp-chart { width: 84px; padding: 0 10px !important; }
  .sp-table .sp-amt { width: 104px; }
  .sp-spark { display: flex; align-items: flex-end; gap: 1px; height: 16px; }
  .sp-spark i { flex: 1; min-width: 2px; background: var(--pip-mid); box-shadow: 0 0 3px var(--glow-soft); }
  .sp-spark i.zero { background: var(--pip-dark); box-shadow: none; }
  .sp-spark.credit i { background: var(--case-brass); }
  #spend-lines .credit .sp-amt, #spend-lines .credit .sp-name, .sp-foot .credit { color: var(--case-brass); }
  #spend-lines .credit .sp-svc { background: var(--case-brass-lo); color: var(--world-text); }
  .sp-foot { display: flex; justify-content: flex-end; gap: 14px; margin: 6px 0 0; padding-top: 6px; border-top: 1px dashed var(--pip-dark); font-size: 11px; color: var(--pip-dim-text); font-variant-numeric: tabular-nums; }
  .sp-empty { margin: 2px 0 6px; padding: 8px 10px; color: var(--pip-dim-text); border: 1px dashed var(--pip-dark); }
  .sp-note { margin: 4px 14px; color: var(--pip-dim-text); }
  .sp-warn { margin: 6px 0 0; color: var(--status-hang); font-size: 11px; overflow-wrap: anywhere; }
  .sp-error { margin: 10px 14px 0; padding: 10px; border: 1px solid var(--status-broken); color: var(--status-broken); overflow-wrap: anywhere; }
  .sp-error b { display: block; margin-bottom: 4px; letter-spacing: 0.14em; font-size: 11px; }
  .sp-error p { margin: 0; color: var(--pip-mid); }
  #spend-lines.sp-legacy { padding-top: 10px; }
  @media (max-width: 520px) { .sp-chart { display: none; } .sp-rows li { grid-template-columns: 16px minmax(0, 1fr) auto; } .sp-share { display: none; } }
  .vpg-lamp {
    flex: none; width: 10px; height: 10px; border-radius: 50%; background: var(--pip-dim); opacity: 0.6;
    box-shadow: 0 0 0 2px var(--case-lo), 0 0 0 3px var(--case-seam);
  }
  .ok .vpg-lamp { background: var(--status-ok); opacity: 1; box-shadow: 0 0 0 2px var(--case-lo), 0 0 0 3px var(--case-seam), 0 0 8px var(--status-ok); }
  .slow .vpg-lamp { background: var(--status-hang); opacity: 1; box-shadow: 0 0 0 2px var(--case-lo), 0 0 0 3px var(--case-seam), 0 0 8px var(--status-hang); }
  .fail .vpg-lamp, .damaged .vpg-lamp { background: var(--status-broken); opacity: 1; box-shadow: 0 0 0 2px var(--case-lo), 0 0 0 3px var(--case-seam), 0 0 8px var(--status-broken); }
  .pending .vpg-lamp { animation: vpg-blink 1.2s steps(2) infinite; }
  @keyframes vpg-blink { 50% { opacity: 0.25; } }
  @media (prefers-reduced-motion: reduce) { .pending .vpg-lamp { animation: none; } }

  /* ---- the VAULTS page: covers the map ---- */
  #vault-page {
    position: absolute; inset: 0; z-index: 4; overflow: auto; padding: 0 18px 24px;
    font-size: 12px; line-height: 1.45; color: var(--pip-mid);
    background:
      repeating-linear-gradient(0deg, rgba(20, 255, 106, 0.03) 0 1px, transparent 1px 3px),
      radial-gradient(ellipse at 50% 0%, rgba(255, 204, 51, 0.06), transparent 60%),
      var(--pip-screen);
  }
  #vault-page[hidden] { display: none; }
  .vpg-head {
    position: sticky; top: 0; z-index: 1; display: flex; align-items: center; flex-wrap: wrap; gap: 6px 14px;
    margin: 0 -18px 14px; padding: 10px 18px; background: var(--pip-ink); border-bottom: 2px solid var(--pip-dark);
    box-shadow: 0 6px 14px rgba(0, 0, 0, 0.5);
  }
  .vpg-head h2 { margin: 0; font-size: 16px; letter-spacing: 0.16em; color: var(--world-amber); text-shadow: 0 0 8px rgba(255, 204, 51, 0.4); outline: none; }
  .vpg-sub { color: var(--pip-dim-text); font-size: 11px; letter-spacing: 0.12em; }
  .vpg-back { min-height: 28px; padding: 0 10px; font-size: 11px; letter-spacing: 0.12em; }
  .vpg-note { color: var(--status-hang); margin: 0 0 12px; }
  .vpg-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(214px, 1fr)); gap: 16px; }
  .vpg-empty { color: var(--pip-dim-text); grid-column: 1 / -1; }
  .vpg-open {
    position: relative; width: 100%; height: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 10px 10px 12px; font: inherit; color: inherit; text-align: center; cursor: pointer;
    background: linear-gradient(180deg, rgba(58, 42, 20, 0.35), rgba(2, 10, 5, 0.9) 62%);
    border: 2px solid var(--pip-dark); box-shadow: 0 0 0 1px var(--pip-ink), 0 6px 14px rgba(0, 0, 0, 0.5);
  }
  .vpg-open::before, .vpg-open::after { content: ""; position: absolute; width: 10px; height: 10px; border: 3px solid var(--pip-mid); pointer-events: none; }
  .vpg-open::before { left: -4px; top: -4px; border-right: 0; border-bottom: 0; }
  .vpg-open::after { right: -4px; bottom: -4px; border-left: 0; border-top: 0; }
  .vpg-open:hover, .vpg-open:focus-visible { outline: none; border-color: var(--pip-bright); box-shadow: 0 0 0 1px var(--pip-ink), 0 0 14px var(--glow-soft); }
  .vpg-card.fail .vpg-open, .vpg-card.damaged .vpg-open, .vpg-card.trouble .vpg-open { border-color: rgba(255, 90, 60, 0.6); }
  .vpg-door { image-rendering: pixelated; }
  .vpg-open h3 { margin: 2px 0 0; font-size: 13px; color: var(--pip-bright); letter-spacing: 0.06em; text-shadow: 0 0 5px var(--glow-soft); overflow-wrap: anywhere; }
  .vpg-status { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 11px; letter-spacing: 0.12em; color: var(--pip-mid); }
  .fail .vpg-status, .damaged .vpg-status { color: var(--status-broken); }
  .vpg-lines { display: flex; flex-direction: column; gap: 1px; color: var(--pip-dim-text); font-size: 11px; letter-spacing: 0.06em; overflow-wrap: anywhere; }
  .vpg-stack {
    position: absolute; right: 8px; top: 8px; padding: 1px 6px; font-size: 10px; letter-spacing: 0.14em;
    color: var(--pip-dim-text); border: 1px solid var(--pip-dark); background: var(--pip-ink);
  }
  .vpg-stack.live { color: var(--pip-ink); background: var(--pip-bright); border-color: var(--pip-bright); box-shadow: 0 0 8px var(--glow-soft); }
  .vpg-stack.down { color: var(--status-hang); border-color: var(--status-hang); }
  .vpg-stack.error { color: var(--status-broken); border-color: var(--status-broken); }
  .vpg-stack.big { position: static; margin: 8px 0 0; text-align: center; font-size: 11px; overflow-wrap: anywhere; }
  .vpg-templates { margin-top: 24px; border: 2px dashed var(--pip-dark); background: rgba(2, 10, 5, 0.7); }
  .vpg-templates h4 { margin: 0; padding: 4px 10px; color: var(--pip-ink); background: var(--pip-dim); letter-spacing: 0.14em; font-size: 11px; }
  /* ---- VAULTS: cluster vaults and their PERKS (perk-view.js) ---- */
  .vpg-section { margin: 20px 0 10px; color: var(--world-amber); letter-spacing: 0.18em; font-size: 12px; display: flex; align-items: center; gap: 10px; }
  .vpg-section::after { content: ""; flex: 1; height: 2px; background: linear-gradient(90deg, var(--pip-dark), transparent); }
  .vpg-section:first-of-type { margin-top: 4px; }
  .vpg-home { margin-top: 4px; padding: 1px 6px; font-size: 10px; letter-spacing: 0.12em; color: var(--world-amber); border: 1px solid rgba(255, 204, 51, 0.45); background: rgba(58, 42, 20, 0.5); }
  .pk-vault {
    position: relative; margin: 0 0 18px; padding: 14px 16px 16px; border: 2px solid var(--pip-dark);
    background:
      radial-gradient(ellipse at 12% 0%, rgba(255, 204, 51, 0.10), transparent 45%),
      radial-gradient(ellipse at 90% 110%, rgba(20, 255, 106, 0.08), transparent 55%),
      linear-gradient(180deg, rgba(36, 30, 16, 0.55), rgba(2, 10, 5, 0.94) 40%);
    box-shadow: inset 0 1px 0 rgba(255, 220, 140, 0.12), inset 0 0 0 1px var(--pip-ink), 0 10px 22px rgba(0, 0, 0, 0.55);
  }
  .pk-vault.gone { opacity: 0.7; }
  .pk-head { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
  .pk-head .vpg-door { flex: none; filter: drop-shadow(0 4px 6px rgba(0, 0, 0, 0.6)); }
  .pk-title { flex: 1 1 260px; min-width: 0; }
  .pk-kicker { display: block; color: var(--pip-dim-text); font-size: 10px; letter-spacing: 0.2em; }
  .pk-title h3 { margin: 2px 0 6px; font-size: 18px; letter-spacing: 0.12em; color: var(--pip-bright); text-shadow: 0 0 10px var(--glow-soft); overflow-wrap: anywhere; }
  .pk-meter { display: flex; gap: 3px; max-width: 360px; }
  .pk-meter i { flex: 1; height: 10px; border: 1px solid var(--pip-dark); background: rgba(2, 10, 5, 0.9); }
  .pk-meter i.unlocked { background: linear-gradient(180deg, var(--pip-bright), #0b8f3c); border-color: var(--pip-mid); box-shadow: 0 0 6px var(--glow-soft); }
  .pk-meter i.unlocked.warn { background: linear-gradient(180deg, #ffe07a, #b8860b); border-color: var(--world-amber); box-shadow: 0 0 6px rgba(255, 204, 51, 0.4); }
  .pk-meter i.available { background: repeating-linear-gradient(135deg, rgba(20, 255, 106, 0.18) 0 2px, transparent 2px 4px); }
  .pk-tally { margin: 6px 0 0; font-size: 11px; letter-spacing: 0.14em; color: var(--pip-mid); }
  .pk-side { display: flex; align-items: center; gap: 10px; }
  .pk-score {
    display: grid; place-items: center; width: 64px; height: 64px; border-radius: 50%; border: 2px solid var(--pip-dark);
    background: radial-gradient(circle at 35% 30%, rgba(255, 255, 255, 0.14), rgba(2, 10, 5, 0.95) 70%); box-shadow: inset 0 -4px 8px rgba(0, 0, 0, 0.6), 0 0 0 3px var(--pip-ink);
  }
  .pk-score small { font-size: 9px; letter-spacing: 0.16em; color: var(--pip-dim-text); margin-bottom: -10px; }
  .pk-score b { font-size: 17px; color: var(--pip-bright); text-shadow: 0 0 8px var(--glow-soft); }
  .pk-score.ok { border-color: var(--status-ok); } .pk-score.warn { border-color: var(--status-hang); } .pk-score.fail { border-color: var(--status-broken); }
  .pk-score.warn b { color: var(--status-hang); } .pk-score.fail b { color: var(--status-broken); }
  .pk-apps { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 10px 0 0; }
  .pk-apps .pk-kicker { display: inline; margin-right: 4px; }
  .pk-app { font: inherit; font-size: 11px; letter-spacing: 0.08em; padding: 2px 8px; cursor: pointer; color: var(--world-amber); background: rgba(58, 42, 20, 0.55); border: 1px solid rgba(255, 204, 51, 0.5); }
  .pk-app:hover, .pk-app:focus-visible { outline: none; background: rgba(255, 204, 51, 0.18); }
  .pk-label { margin: 14px 0 8px; font-size: 11px; letter-spacing: 0.2em; color: var(--pip-mid); }
  .pk-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(168px, 1fr)); gap: 12px; }
  .pk-open {
    position: relative; width: 100%; height: 100%; display: grid; grid-template-columns: 56px 1fr; grid-template-rows: auto auto 1fr auto; column-gap: 10px; align-items: start;
    padding: 10px; font: inherit; color: inherit; text-align: left; cursor: pointer;
    background: linear-gradient(160deg, rgba(20, 255, 106, 0.10), rgba(2, 10, 5, 0.92) 55%), var(--pip-ink);
    border: 1px solid var(--pip-dark); box-shadow: inset 0 1px 0 rgba(160, 255, 190, 0.12), 0 4px 10px rgba(0, 0, 0, 0.5);
  }
  .pk-open:hover, .pk-open:focus-visible, .pk-card.sel .pk-open { outline: none; border-color: var(--pip-bright); box-shadow: inset 0 1px 0 rgba(160, 255, 190, 0.2), 0 0 14px var(--glow-soft); }
  .pk-medal {
    grid-row: 1 / span 3; display: grid; place-items: center; width: 56px; height: 56px; border-radius: 50%;
    background: radial-gradient(circle at 35% 28%, #3dff8c 0, #0e6b33 45%, #03200f 78%);
    box-shadow: inset 0 3px 2px rgba(200, 255, 220, 0.35), inset 0 -4px 6px rgba(0, 0, 0, 0.6), 0 0 0 2px #0a3a1c, 0 0 0 4px rgba(20, 255, 106, 0.25), 0 3px 8px rgba(0, 0, 0, 0.7);
  }
  .pk-medal.warn { background: radial-gradient(circle at 35% 28%, #ffe07a 0, #9a6d10 45%, #2c1d04 78%); box-shadow: inset 0 3px 2px rgba(255, 240, 200, 0.35), inset 0 -4px 6px rgba(0, 0, 0, 0.6), 0 0 0 2px #3a2a08, 0 0 0 4px rgba(255, 204, 51, 0.28), 0 3px 8px rgba(0, 0, 0, 0.7); }
  .pk-medal.off, .pk-medal.na { background: radial-gradient(circle at 35% 28%, #3c4a40 0, #18241c 50%, #070d09 80%); }
  .pk-medal.big { width: 76px; height: 76px; }
  .pk-icon { image-rendering: pixelated; filter: drop-shadow(0 2px 0 rgba(0, 0, 0, 0.55)); }
  .pk-rank { grid-column: 2; display: flex; gap: 3px; margin-bottom: 2px; }
  .pk-rank i { width: 10px; height: 6px; border: 1px solid var(--pip-dark); transform: skewX(-20deg); background: rgba(2, 10, 5, 0.9); }
  .pk-rank i.on { background: var(--world-amber); border-color: #ffe07a; box-shadow: 0 0 4px rgba(255, 204, 51, 0.6); }
  .pk-name { grid-column: 2; color: var(--pip-bright); font-size: 13px; letter-spacing: 0.06em; text-shadow: 0 0 5px var(--glow-soft); overflow-wrap: anywhere; }
  .pk-effect { grid-column: 2; color: var(--pip-mid); font-size: 11px; line-height: 1.35; margin-top: 2px; }
  .pk-state { grid-column: 1 / -1; display: flex; align-items: center; gap: 6px; margin-top: 8px; padding-top: 6px; border-top: 1px dashed var(--pip-dark); font-size: 10px; letter-spacing: 0.14em; color: var(--pip-dim-text); }
  .pk-state i { width: 8px; height: 8px; border-radius: 50%; background: var(--pip-dim); opacity: 0.6; }
  .pk-card.ok .pk-state i { background: var(--status-ok); opacity: 1; box-shadow: 0 0 6px var(--status-ok); }
  .pk-card.warn .pk-state i { background: var(--status-hang); opacity: 1; box-shadow: 0 0 6px var(--status-hang); }
  .pk-card.ok .pk-state { color: var(--pip-mid); } .pk-card.warn .pk-state { color: var(--status-hang); }
  .pk-grid.avail .pk-open { background: repeating-linear-gradient(135deg, rgba(20, 255, 106, 0.04) 0 6px, transparent 6px 12px), rgba(2, 10, 5, 0.85); border-style: dashed; }
  .pk-grid.avail .pk-medal { filter: grayscale(0.85) brightness(0.8); }
  .pk-grid.avail .pk-name { color: var(--pip-mid); text-shadow: none; }
  .pk-card.locked .pk-open { opacity: 0.6; }
  .pk-install { position: absolute; right: 8px; bottom: 7px; font-size: 10px; letter-spacing: 0.14em; color: var(--world-amber); }
  .pk-drawer {
    margin: 12px 0 0; padding: 12px 14px; border: 2px solid var(--pip-mid);
    background: linear-gradient(180deg, rgba(20, 255, 106, 0.08), rgba(2, 10, 5, 0.96) 50%); box-shadow: 0 0 18px var(--glow-soft), inset 0 0 0 1px var(--pip-ink);
  }
  .pk-dhead { display: flex; align-items: center; gap: 14px; }
  .pk-dwords { flex: 1; min-width: 0; }
  .pk-dwords h4 { margin: 2px 0; font-size: 16px; color: var(--pip-bright); letter-spacing: 0.08em; }
  .pk-deffect { margin: 0; color: var(--world-amber); }
  .pk-dhead .pk-rank i { width: 14px; height: 8px; }
  .pk-close { min-width: 28px; min-height: 28px; }
  .pk-facts { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 4px 18px; margin: 12px 0; }
  .pk-fact { display: grid; grid-template-columns: 90px 1fr; gap: 8px; padding: 3px 0; border-bottom: 1px dotted var(--pip-dark); }
  .pk-fact dt { color: var(--pip-dim-text); font-size: 10px; letter-spacing: 0.16em; padding-top: 1px; }
  .pk-fact dd { margin: 0; color: var(--pip-mid); overflow-wrap: anywhere; }
  .pk-actions { display: flex; flex-wrap: wrap; gap: 8px; }
  .pk-actions .cmd { min-height: 30px; padding: 0 12px; letter-spacing: 0.12em; }
  .pk-actions .pk-primary { color: var(--pip-ink); background: var(--world-amber); border-color: var(--world-amber); }
  .pk-note { margin: 8px 0 0; color: var(--pip-dim-text); font-size: 11px; }
  @media (max-width: 560px) { .pk-head .vpg-door { display: none; } .pk-grid { grid-template-columns: 1fr; } .pk-fact { grid-template-columns: 80px 1fr; } }
  .vpg-detail { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 18px; align-items: start; }
  .vpg-side { display: flex; flex-direction: column; align-items: center; }
  #vault-page .vault-panel { position: relative; min-height: 0; }
  #vault-page .vp-body { overflow: visible; }
  .vpg-owned { margin-top: 18px; border: 2px solid var(--pip-dark); background: rgba(2, 10, 5, 0.85); }
  .vpg-owned h4 { margin: 0; padding: 4px 10px; color: var(--pip-ink); background: var(--pip-bright); letter-spacing: 0.14em; font-size: 11px; }
  .vpg-owned ul { list-style: none; margin: 0; padding: 4px 10px 8px; }
  .vpg-owned li { display: grid; grid-template-columns: 72px minmax(0, 1.2fr) 90px minmax(0, 1.4fr) auto; gap: 10px; align-items: center; padding: 5px 0; border-bottom: 1px dashed var(--pip-dark); }
  .vpg-owned li:last-child { border-bottom: 0; }
  .vpg-owned li.off { opacity: 0.6; }
  .vpg-owned .kind { color: var(--world-amber); font-size: 11px; letter-spacing: 0.12em; }
  .vpg-owned .name { color: var(--pip-bright); overflow-wrap: anywhere; }
  .vpg-owned .state { color: var(--pip-dim-text); font-size: 11px; }
  .vpg-owned .where { color: var(--pip-dim-text); font-size: 11px; overflow-wrap: anywhere; }
  .vpg-owned .cmd { min-height: 24px; padding: 0 8px; font-size: 11px; }
  @media (max-width: 820px) {
    .vpg-detail { grid-template-columns: minmax(0, 1fr); }
    .vpg-owned li { grid-template-columns: 60px minmax(0, 1fr) auto; }
    .vpg-owned .state, .vpg-owned .where { grid-column: 2 / 3; }
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
  .vt-type { color: var(--pip-dim-text); font-size: 11px; letter-spacing: 0.12em; }
  .vt-desc { margin: 2px 0 4px; overflow-wrap: anywhere; }
  .vt-list li.damaged .vt-name, .vt-list li.damaged .vt-desc { color: var(--status-broken); }
  .vt-cmd { flex: 1; min-width: 0; overflow-wrap: anywhere; color: var(--pip-hot); font-size: 11px; user-select: all; }
  .vt-copy { flex: none; min-height: 24px; padding: 0 8px; font-size: 11px; }
  .vt-empty { color: var(--pip-dim-text); }
  /* ---- pod deep-inspect ---- */
  #kube-panel.kp-wide { width: min(820px, calc(100% - 24px)); display: flex; flex-direction: column; background: var(--pip-screen); box-shadow: 0 0 0 1px var(--pip-dim), 0 8px 30px var(--btn-shade); }
  #kube-panel.kp-wide .kp-body { flex: 1; min-height: 0; max-height: none; }
  .pi-tabs { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px 0; border-bottom: 1px solid var(--pip-dim); }
  .pi-tabs button { font: inherit; font-size: 10px; letter-spacing: 0.14em; padding: 4px 10px; color: var(--pip-dim-text); background: var(--pip-ink); border: 1px solid var(--pip-dark); border-bottom: none; cursor: pointer; }
  .pi-tabs button:hover { color: var(--pip-bright); }
  .pi-tabs button[aria-selected="true"] { color: var(--pip-ink); background: var(--pip-bright); border-color: var(--pip-bright); }
  .pi-body dd.bad { color: var(--status-broken); }
  .pi-body dd.warn { color: var(--status-hang); }
  .pi-chain { display: flex; flex-wrap: wrap; gap: 6px; list-style: none; margin: 0; padding: 0; }
  .pi-chain li { color: var(--pip-bright); border: 1px solid var(--pip-dim); padding: 1px 6px; }
  .pi-chain li + li::before { content: "→ "; color: var(--pip-dim-text); }
  .pi-conds { display: flex; flex-wrap: wrap; gap: 14px; }
  .pi-container { margin: 8px 0; padding: 6px 8px; border: 1px solid var(--pip-dark); }
  .pi-chead { display: flex; gap: 10px; align-items: baseline; }
  .pi-chead b { color: var(--pip-hot); font-weight: normal; }
  .pi-chead .ok { color: var(--pip-bright); }
  .pi-chead .warn { color: var(--status-hang); }
  .pi-env { list-style: none; margin: 0; padding: 0; font-size: 11px; }
  .pi-env li { display: flex; justify-content: space-between; gap: 10px; padding: 1px 0; border-bottom: 1px dotted var(--pip-dark); }
  .pi-env code { font: inherit; color: var(--pip-bright); overflow-wrap: anywhere; }
  .pi-env span { color: var(--pip-dim-text); white-space: nowrap; }
  .pi-env span.warn { color: var(--status-hang); }
  .pi-logbar { display: flex; gap: 6px; align-items: center; }
  .pi-logbar select { font: inherit; font-size: 11px; color: var(--pip-bright); background: var(--pip-ink); border: 1px solid var(--pip-dim); }
  .pi-logbar button[aria-pressed="true"] { color: var(--pip-ink); background: var(--pip-bright); }
  .pi-log { max-height: 46vh; overflow: auto; }
  .pi-yaml { margin: 0; max-height: 52vh; overflow: auto; padding: 8px; font-size: 11px; color: var(--pip-mid); background: var(--pip-ink); border: 1px solid var(--pip-dark); white-space: pre; }
  .vp-metrics .pi-meters li { grid-template-columns: 70px minmax(60px, 1fr) max-content; }
  .vp-metrics .pi-meters li .val { white-space: nowrap; text-align: right; }
  .pi-bar { position: relative; height: 10px; background: var(--pip-ink); border: 1px solid var(--pip-dark); }
  .pi-bar .used { position: absolute; left: 0; top: 1px; bottom: 1px; background: var(--pip-bright); box-shadow: 0 0 4px var(--glow-soft); }
  .pi-bar .req { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--pip-hot); }
  .pi-meters li.hot .used { background: var(--status-hang); }
  /* ---- end pod deep-inspect ---- */
  /* ---- SLOs (slo-view.js) ---- */
  .slo-block { margin-top: 10px; }
  .slo-block h4 { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
  .slo-list { list-style: none; margin: 0; padding: 0; }
  .vp-metrics .slo-list li.slo-row { display: grid; grid-template-columns: 96px minmax(0, 1fr); gap: 8px; align-items: center; padding: 5px 0; border-bottom: 1px dashed var(--pip-dark); font-size: 10px; }
  .slo-dial { display: block; image-rendering: pixelated; }
  .slo-text p { margin: 0 0 2px; display: flex; justify-content: space-between; gap: 6px; flex-wrap: wrap; }
  .slo-head b { color: var(--pip-bright); font-size: 11px; letter-spacing: 0.06em; overflow-wrap: anywhere; }
  .slo-kind { color: var(--pip-dim-text); letter-spacing: 0.12em; }
  .slo-target { color: var(--pip-mid); }
  .slo-foot { color: var(--pip-dim-text); }
  .slo-foot .hot { color: var(--status-hang); }
  .slo-row.spent .slo-foot .hot { color: var(--status-broken); }
  .slo-budget { align-items: center; flex-wrap: nowrap !important; }
  .slo-budget .lbl { color: var(--pip-dim-text); letter-spacing: 0.12em; }
  .slo-budget .val { color: var(--pip-bright); min-width: 38px; text-align: right; }
  .slo-row.burning .slo-budget .val { color: var(--status-hang); }
  .slo-row.spent .slo-budget .val { color: var(--status-broken); }
  .slo-bar { flex: 1; display: grid; grid-template-columns: repeat(20, 1fr); gap: 1px; height: 9px; padding: 1px; background: var(--pip-ink); border: 1px solid var(--pip-dark); min-width: 60px; }
  .slo-bar i { background: var(--pip-dark); }
  .slo-bar i.on { background: var(--pip-bright); box-shadow: 0 0 3px var(--glow-soft); }
  .slo-row.burning .slo-bar i.on { background: var(--status-hang); box-shadow: none; }
  .slo-row.spent .slo-bar i.on, .slo-row.spent .slo-bar i { background: var(--status-broken); opacity: 0.5; }
  .slo-row.nodata { opacity: 0.7; }
  .slo-lamp { display: inline-flex; align-items: center; gap: 6px; letter-spacing: 0.12em; font-size: 10px; color: var(--pip-dim-text); }
  .slo-lamp i { width: 10px; height: 10px; border-radius: 50%; background: var(--lamp-off); box-shadow: inset 0 0 0 1px var(--btn-rim); }
  .slo-lamp.ok i { background: var(--lamp-on); box-shadow: 0 0 6px var(--btn-glow), inset 0 0 0 1px var(--lamp-on-core); }
  .slo-lamp.ok b { color: var(--pip-mid); }
  .slo-lamp.burning i { background: var(--status-hang); box-shadow: 0 0 8px var(--status-hang); animation: kt-blink 1s steps(2) infinite; }
  .slo-lamp.burning b { color: var(--status-hang); }
  .slo-lamp.spent i { background: var(--status-broken); box-shadow: 0 0 8px var(--status-broken); animation: kt-blink 0.7s steps(2) infinite; }
  .slo-lamp.spent b { color: var(--status-broken); }
  @media (prefers-reduced-motion: reduce) { .slo-lamp i { animation: none !important; } }
  .slo-help { margin-top: 6px; font-size: 10px; color: var(--pip-mid); }
  .slo-help summary { cursor: pointer; color: var(--pip-dim-text); letter-spacing: 0.12em; }
  .slo-help summary:hover, .slo-help summary:focus-visible { color: var(--pip-bright); }
  .slo-help dl { display: grid; grid-template-columns: 54px 1fr; gap: 3px 8px; margin: 6px 0; }
  .slo-help dt { color: var(--pip-bright); letter-spacing: 0.1em; }
  .slo-help dd { margin: 0; }
  .slo-help p { margin: 0; color: var(--pip-dim-text); }
  /* ---- end SLOs ---- */
  /* ---- cluster screens: tabs + telemetry ---- */
  #kube-tabs { position: absolute; z-index: 4; left: 14px; top: 10px; display: flex; gap: 6px; }
  #kube-tabs button { font: inherit; font-size: 11px; letter-spacing: 0.14em; padding: 5px 12px; color: var(--pip-dim-text); background: var(--pip-ink); border: 1px solid var(--pip-dark); cursor: pointer; }
  #kube-tabs button:hover { color: var(--pip-bright); border-color: var(--pip-dim); }
  #kube-tabs button[aria-pressed="true"] { color: var(--pip-ink); background: var(--pip-bright); border-color: var(--pip-bright); box-shadow: 0 0 10px var(--glow-soft); }
  /* Kube context switcher (kube-contexts.js): a row of lit push-buttons,
     one per context, each with its health lamp and scope. */
  #kube-ctx { position: absolute; z-index: 4; right: 14px; top: 8px; display: flex; align-items: stretch; gap: 0; padding: 3px; background: var(--btn-skirt); border: 1px solid var(--btn-rim); box-shadow: inset 0 1px 0 var(--btn-rim-hi), 0 2px 6px var(--btn-shade); max-width: calc(100% - 28px); overflow-x: auto; }
  #kube-ctx[hidden] { display: none; }
  /* The EKS connection panel: a chip in the context switcher (or alone in
     its place), and the panel it opens below it. */
  #kube-connect-dock { position: absolute; z-index: 4; left: auto; right: 14px; top: 8px; display: flex; }
  #kube-connect-dock[hidden] { display: none; }
  .kc-chip { display: flex; align-items: center; gap: 7px; min-height: 28px; padding: 0 10px 0 9px; font: inherit; font-size: 11px; letter-spacing: 0.1em; color: var(--btn-off-label); background: linear-gradient(180deg, var(--btn-off-top), var(--btn-off-mid) 45%, var(--btn-off-low)); border: 1px solid var(--btn-rim); box-shadow: inset 0 1px 0 var(--btn-gloss), inset 0 -2px 0 var(--btn-shade); cursor: pointer; white-space: nowrap; }
  .kc-chip:hover { color: var(--pip-mid); background: linear-gradient(180deg, var(--btn-hover), var(--btn-off-mid) 45%, var(--btn-off-low)); }
  .kc-chip[aria-expanded="true"] { color: var(--btn-lit-label); background: linear-gradient(180deg, var(--btn-lit-top), var(--btn-lit-mid) 45%, var(--btn-lit-low)); }
  .kc-chip i, #kube-connect .kc-lamp { flex: 0 0 auto; width: 9px; height: 9px; border-radius: 50%; background: var(--lamp-off); box-shadow: inset 0 0 0 1px var(--btn-rim); }
  .kc-chip[data-tone="ok"] i, #kube-connect .kc-lamp.ok { background: var(--lamp-on); box-shadow: 0 0 6px var(--btn-glow); }
  .kc-chip[data-tone="warn"] i, #kube-connect .kc-lamp.warn { background: var(--world-amber); box-shadow: 0 0 5px var(--world-amber); }
  .kc-chip[data-tone="fail"] i, #kube-connect .kc-lamp.fail { background: var(--status-broken); box-shadow: 0 0 6px var(--status-broken); }
  .kc-chip b { font-weight: normal; letter-spacing: 0.2em; }
  .kc-chip small { font-size: 9px; color: var(--pip-dim-text); }
  #kube-connect { position: absolute; z-index: 5; right: 14px; top: calc(var(--kube-top, 50px) + 2px); width: min(460px, calc(100% - 28px)); display: flex; flex-direction: column; color: var(--pip-bright); background: var(--pip-ink); border: 1px solid var(--pip-mid); box-shadow: 0 0 12px var(--btn-glow-far), 0 6px 18px var(--btn-shade); font-size: 12px; overflow: hidden; }
  #kube-connect.narrow { left: 14px; width: auto; }
  #kube-connect[hidden] { display: none; }
  #kube-connect .kc-head { flex: 0 0 auto; display: flex; gap: 8px; align-items: center; min-height: 40px; padding: 4px 4px 4px 9px; color: var(--pip-dim-text); background: var(--pip-screen); border-bottom: 1px solid var(--pip-dark); cursor: pointer; font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; }
  #kube-connect .kc-head > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #kube-connect .kc-head b { color: var(--pip-bright); letter-spacing: 0.2em; }
  #kube-connect .kc-head em { margin-left: auto; font-style: normal; white-space: nowrap; }
  #kube-connect .kc-fold { flex: 0 0 auto; min-width: 74px; min-height: 32px; padding: 0 10px; font: inherit; font-size: 11px; letter-spacing: 0.14em; color: var(--btn-off-label); background: linear-gradient(180deg, var(--btn-off-top), var(--btn-off-mid) 45%, var(--btn-off-low)); border: 1px solid var(--btn-rim); box-shadow: inset 0 1px 0 var(--btn-gloss), inset 0 -2px 0 var(--btn-shade); cursor: pointer; }
  #kube-connect .kc-fold:hover, #kube-connect .kc-fold:focus-visible { color: var(--pip-bright); background: linear-gradient(180deg, var(--btn-hover), var(--btn-off-mid) 45%, var(--btn-off-low)); }
  #kube-connect .kc-body { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 4px; padding: 5px; }
  #kube-connect .kc-body > * { flex-shrink: 0; }
  #kube-connect .connect-row .act { display: flex; gap: 4px; }
  #kube-connect .kc-logbar { width: 100%; min-height: 28px; padding: 0 8px; font: inherit; font-size: 10px; letter-spacing: 0.14em; text-align: left; color: var(--pip-mid); background: var(--pip-screen); border: 1px solid var(--pip-dark); cursor: pointer; }
  #kube-connect .kc-logbar[data-state="failed"], #kube-connect .kc-logbar[data-state="refused"] { color: var(--status-broken); border-color: var(--status-broken); }
  #kube-connect .kc-log .runpane[hidden] { display: none; }
  #kube-ctx > b { align-self: center; padding: 0 8px 0 6px; font-size: 9px; letter-spacing: 0.2em; color: var(--pip-dim-text); white-space: nowrap; }
  #kube-ctx button { position: relative; display: grid; grid-template-columns: 10px auto; grid-template-rows: auto auto; gap: 0 7px; align-items: center; min-width: 92px; padding: 4px 12px 4px 9px; font: inherit; text-align: left; color: var(--btn-off-label); background: linear-gradient(180deg, var(--btn-off-top), var(--btn-off-mid) 45%, var(--btn-off-low)); border: 1px solid var(--btn-rim); box-shadow: inset 0 1px 0 var(--btn-gloss), inset 0 -2px 0 var(--btn-shade); cursor: pointer; }
  #kube-ctx button + button { margin-left: 3px; }
  #kube-ctx button:hover { background: linear-gradient(180deg, var(--btn-hover), var(--btn-off-mid) 45%, var(--btn-off-low)); color: var(--pip-mid); }
  #kube-ctx button[aria-pressed="true"] { color: var(--btn-lit-label); background: linear-gradient(180deg, var(--btn-lit-top), var(--btn-lit-mid) 45%, var(--btn-lit-low)); box-shadow: inset 0 1px 0 var(--btn-gloss-lit), inset 0 2px 4px var(--btn-shade), 0 0 10px var(--btn-glow-far); }
  #kube-ctx button i { grid-row: 1 / 3; width: 9px; height: 9px; border-radius: 50%; background: var(--lamp-off); box-shadow: inset 0 0 0 1px var(--btn-rim), 0 0 0 1px var(--lamp-off-hi); }
  #kube-ctx button.ok i { background: var(--lamp-on); box-shadow: 0 0 6px var(--btn-glow), inset 0 0 0 1px var(--lamp-on-core); }
  #kube-ctx button.warn i { background: var(--status-hang); box-shadow: 0 0 6px var(--status-hang); }
  #kube-ctx button.unconnected { border-style: dashed; opacity: 0.78; }
  #kube-ctx button.fail i { background: var(--status-broken); box-shadow: 0 0 7px var(--status-broken); animation: blink 1.2s steps(1) infinite; }
  #kube-ctx button.error i { background: var(--status-broken); opacity: 0.6; }
  #kube-ctx button span { font-size: 11px; letter-spacing: 0.14em; white-space: nowrap; }
  #kube-ctx button small { font-size: 9px; letter-spacing: 0.08em; color: var(--pip-dim-text); white-space: nowrap; }
  #kube-ctx button[aria-pressed="true"] small { color: var(--pip-hot); opacity: 0.75; }
  #kube-ctx button { padding-right: 26px; }
  #kube-ctx button em { position: absolute; top: 3px; right: 3px; min-width: 15px; padding: 0 3px; font-style: normal; font-size: 9px; line-height: 13px; text-align: center; color: var(--pip-ink); background: var(--status-broken); border: 1px solid var(--btn-rim); }
  #kube-ctx button.warn em { background: var(--status-hang); }
  @media (max-width: 900px) {
    #kube-ctx { top: 44px; right: 8px; max-width: calc(100% - 16px); }
    #kube-ctx > b { display: none; }
    #kube-ctx button { min-width: 0; }
  }
  #kube-tele { position: absolute; z-index: 2; inset: 0; overflow: auto; padding: var(--kube-top, 50px) 16px 16px; background: var(--pip-screen); color: var(--pip-mid); font-size: 11px; }
  .kt-head { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; padding: 6px 10px; border: 1px solid var(--pip-dark); background: var(--pip-ink); }
  .kt-why { color: var(--pip-mid); flex: 1; min-width: 200px; }
  .kt-hist { color: var(--pip-dim-text); letter-spacing: 0.1em; }
  .kt-note { margin: 6px 0; color: var(--pip-dim-text); }
  .kt-note.err { color: var(--status-broken); }
  .kt-note.kt-limit { color: var(--warn); border-left: 2px solid var(--warn); padding-left: 8px; }
  .kt-lamp { display: inline-flex; align-items: center; gap: 6px; letter-spacing: 0.12em; font-size: 10px; color: var(--pip-dim-text); }
  .kt-lamp i { width: 10px; height: 10px; border-radius: 50%; background: var(--lamp-off); box-shadow: inset 0 0 0 1px var(--btn-rim); }
  .kt-lamp.on i { background: var(--lamp-on); box-shadow: 0 0 6px var(--btn-glow), inset 0 0 0 1px var(--lamp-on-core); }
  .kt-lamp.on b { color: var(--pip-bright); }
  .kt-lamp.idle i { background: var(--lamp-off); }
  .kt-lamp.warn i { background: var(--status-hang); box-shadow: 0 0 6px var(--status-hang); }
  .kt-lamp.warn b { color: var(--status-hang); }
  .kt-lamp.alarm i { background: var(--status-broken); box-shadow: 0 0 8px var(--status-broken); animation: kt-blink 1s steps(2) infinite; }
  .kt-lamp.alarm b { color: var(--status-broken); }
  @keyframes kt-blink { 50% { opacity: 0.35; } }
  @media (prefers-reduced-motion: reduce) { .kt-lamp.alarm i { animation: none; } }
  .kt-node { margin: 12px 0; padding: 10px 12px; border: 1px solid var(--pip-dim); background: var(--pip-ink); box-shadow: inset 0 0 24px var(--glow-soft); }
  .kt-title { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
  .kt-chip { font-size: 10px; padding: 0 5px; border: 1px solid; }
  .kt-name { color: var(--pip-hot); font-size: 14px; }
  .kt-facts { color: var(--pip-dim-text); }
  .kt-lamps { display: flex; flex-wrap: wrap; gap: 16px; margin: 8px 0; padding: 6px 8px; border: 1px dashed var(--pip-dark); }
  .kt-gauges { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; }
  .kt-side { display: flex; flex-direction: column; gap: 4px; min-width: 220px; }
  .kt-small { margin: 2px 0; color: var(--pip-dim-text); letter-spacing: 0.08em; font-size: 10px; }
  .kt-charts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 10px; }
  .kt-chart { border: 1px solid var(--pip-dark); }
  .kt-cw { margin-top: 8px; max-width: 560px; }
  .kt-pods { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
  .kt-top { padding: 4px 10px 8px; border: 1px solid var(--pip-dim); background: var(--pip-ink); }
  .kt-top.vp-metrics li { grid-template-columns: minmax(0, 1.5fr) minmax(50px, 1fr) 46px minmax(0, max-content); }
  .kt-pod { display: flex; flex-direction: column; min-width: 0; }
  .kt-pod b { color: var(--pip-bright); font-weight: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kt-pod small { color: var(--pip-dim-text); font-size: 9px; }
  .kt-flags { display: flex; gap: 4px; }
  .kt-flags em { font-style: normal; font-size: 9px; padding: 0 4px; border: 1px solid var(--pip-dim); color: var(--pip-mid); }
  .kt-flags em.bad { color: var(--status-broken); border-color: var(--status-broken); }
  /* ---- SERVICES (graph-view.js): service graph + incident review, SAMPLE prototype ---- */
  #kube-graph { position: absolute; z-index: 2; inset: 0; overflow: auto; padding: var(--kube-top, 50px) 16px 16px; background: var(--pip-screen); color: var(--pip-mid); font-size: 11px; display: flex; flex-direction: column; gap: 8px; outline: none; }
  #kube-graph[hidden] { display: none; }
  #kube-empty { position: absolute; z-index: 2; inset: 0; overflow: auto; padding: 56px 24px 24px; background: var(--pip-screen); color: var(--pip-mid); font-size: 12px; }
  #kube-empty[hidden] { display: none; }
  #kube-empty .ke-card { max-width: 760px; margin: 0 auto; display: flex; flex-direction: column; gap: 12px; }
  #kube-empty .ke-title { margin: 0; font-size: 18px; letter-spacing: 0.08em; text-transform: uppercase; color: var(--pip-bright); }
  #kube-empty .ke-reason { margin: 0; color: var(--world-amber); }
  #kube-empty .ke-step { border: 1px dashed var(--pip-dark); padding: 10px 12px; }
  #kube-empty .ke-step h3 { margin: 0 0 4px; font-size: 13px; color: var(--pip-bright); }
  #kube-empty .ke-step p { margin: 0; }
  #kube-empty .ke-code { margin: 8px 0 6px; padding: 8px 10px; background: var(--pip-ink); border: 1px solid var(--pip-dark); color: var(--pip-bright); white-space: pre-wrap; word-break: break-all; font-size: 11px; }
  #kube-empty .ke-alt { color: var(--pip-dim-text); font-size: 11px; }
  #kube-empty .ke-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
  #kube-empty .ke-btn { font: inherit; padding: 6px 12px; color: var(--pip-ink); background: var(--pip-bright); border: 1px solid var(--pip-bright); cursor: pointer; letter-spacing: 0.06em; }
  #kube-empty .ke-btn.ke-ghost { color: var(--pip-bright); background: transparent; }
  #kube-empty .ke-note { color: var(--pip-dim-text); }
  #kube-graph > * { flex-shrink: 0; }
  #kube-graph .gv-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
  #kube-graph .gv-title { display: flex; align-items: baseline; gap: 8px; margin-right: 4px; }
  #kube-graph .gv-title b { font-size: 15px; letter-spacing: 0.2em; color: var(--pip-bright); text-shadow: 0 0 8px var(--glow-bright); }
  #kube-graph .gv-proto { font-size: 10px; letter-spacing: 0.16em; color: var(--world-amber); border: 1px solid rgba(255, 204, 51, 0.5); padding: 1px 6px; }
  #kube-graph .gv-seg { display: inline-flex; gap: 4px; }
  #kube-graph .gv-btn { font: inherit; font-size: 10.5px; letter-spacing: 0.12em; padding: 4px 9px; cursor: pointer; color: var(--pip-dim-text); background: var(--pip-ink); border: 1px solid var(--pip-dark); }
  #kube-graph .gv-btn:hover { color: var(--pip-mid); border-color: var(--pip-dim); }
  #kube-graph .gv-btn[aria-pressed="true"] { color: var(--pip-ink); background: var(--pip-bright); border-color: var(--pip-bright); box-shadow: 0 0 10px var(--glow-soft); }
  #kube-graph .gv-layer[aria-pressed="false"] { text-decoration: line-through; opacity: 0.7; }
  #kube-graph .gv-search { flex: 1 1 200px; min-width: 150px; max-width: 320px; font: inherit; font-size: 12px; padding: 5px 9px; color: var(--pip-bright); background: var(--pip-ink); border: 1px solid var(--pip-dim); outline: none; }
  #kube-graph .gv-search:focus { border-color: var(--pip-bright); box-shadow: 0 0 8px var(--glow-soft); }
  #kube-graph .gv-groupby { align-items: center; gap: 6px; }
  #kube-graph .gv-gblabel { white-space: nowrap; font-size: 10px; letter-spacing: 0.16em; color: var(--pip-dim-text); }
  #kube-graph :is(.gv-gbsel, .gv-gbcustom) { font: inherit; font-size: 12px; padding: 4px 6px; color: var(--pip-bright); background: var(--pip-ink); border: 1px solid var(--pip-dim); outline: none; }
  #kube-graph .gv-gbcustom { width: 150px; }
  #kube-graph .gv-gbcustom[hidden] { display: none; }
  #kube-graph .gv-gbcustom.bad { border-color: var(--status-broken); }
  #kube-graph :is(.gv-gbsel, .gv-gbcustom):focus { border-color: var(--pip-bright); box-shadow: 0 0 8px var(--glow-soft); }
  #kube-graph .gv-group.unlabeled { border-style: dashed; }
  #kube-graph .gv-stats { margin: 0; color: var(--pip-dim-text); letter-spacing: 0.06em; }
  #kube-graph .gv-detail { margin: 0; padding: 6px 10px; color: var(--pip-bright); background: rgba(2, 10, 5, 0.6); border-left: 3px solid var(--pip-bright); min-height: 16px; }
  #kube-graph .gv-stage { position: relative; flex: 1 1 0; min-width: 0; }
  #kube-graph .gv-edges { position: absolute; left: 0; top: 0; pointer-events: none; overflow: visible; z-index: 3; }
  #kube-graph .gv-bands { position: relative; display: flex; flex-direction: column; gap: 20px; padding-top: 10px; }
  #kube-graph .gv-band { position: relative; padding: 18px 10px 10px; border: 1px dashed var(--pip-dark); }
  #kube-graph .gv-blabel { position: absolute; top: -8px; left: 10px; margin: 0; padding: 0 6px; font-size: 10px; letter-spacing: 0.2em; color: var(--pip-dim-text); background: var(--pip-screen); font-weight: normal; }
  #kube-graph .gv-grid { display: flex; flex-wrap: wrap; gap: 18px 18px; }
  #kube-graph .gv-group { position: relative; z-index: 2; display: flex; flex-direction: column; gap: 4px; min-width: 150px; max-width: 100%; padding: 6px 8px 7px; background: rgba(2, 10, 5, 0.92); border: 1px solid var(--pip-dim); box-shadow: 0 0 0 1px #000, 0 4px 10px rgba(0, 0, 0, 0.5); transition: opacity 0.15s; }
  #kube-graph .gv-group::before, #kube-graph .gv-group::after { content: ""; position: absolute; width: 7px; height: 7px; border: 2px solid var(--pip-bright); pointer-events: none; }
  #kube-graph .gv-group::before { left: -3px; top: -3px; border-right: 0; border-bottom: 0; }
  #kube-graph .gv-group::after { right: -3px; bottom: -3px; border-left: 0; border-top: 0; }
  #kube-graph .gv-group.open { flex: 0 1 auto; width: max-content; max-width: 100%; }
  #kube-graph .gv-group.dim { opacity: 0.28; }
  #kube-graph .gv-group.match { border-color: var(--world-amber); box-shadow: 0 0 0 1px #000, 0 0 12px rgba(255, 204, 51, 0.35); }
  #kube-graph .gv-group.focus { border-color: var(--pip-hot); box-shadow: 0 0 0 1px #000, 0 0 16px var(--glow-bright); }
  #kube-graph .gv-group[data-health="broken"] { border-color: var(--status-broken); }
  #kube-graph .gv-gtop { display: flex; align-items: center; gap: 6px; }
  #kube-graph .gv-ghead { flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; font: inherit; color: var(--pip-bright); background: none; border: 0; padding: 0; cursor: pointer; text-align: left; }
  #kube-graph .gv-glabel { font-size: 12px; letter-spacing: 0.04em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #kube-graph .gv-lamp { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--status-ok); box-shadow: 0 0 6px var(--status-ok); }
  #kube-graph [data-health="hang"] .gv-lamp { background: var(--status-hang); box-shadow: 0 0 6px var(--status-hang); }
  #kube-graph [data-health="broken"] .gv-lamp { background: var(--status-broken); box-shadow: 0 0 8px var(--status-broken); }
  #kube-graph .gv-tag, #kube-graph .gv-ntag, #kube-graph .gv-etag { flex: none; font-size: 9px; letter-spacing: 0.1em; padding: 0 4px; color: var(--pip-ink); background: var(--pip-dim); }
  #kube-graph .gv-open { flex: none; width: 20px; height: 20px; font: inherit; font-size: 13px; line-height: 1; color: var(--pip-mid); background: var(--pip-ink); border: 1px solid var(--pip-dark); cursor: pointer; padding: 0; }
  #kube-graph .gv-meta { color: var(--pip-dim-text); font-size: 10px; letter-spacing: 0.04em; }
  #kube-graph .gv-nodes { display: flex; flex-wrap: wrap; gap: 12px 10px; padding-top: 10px; border-top: 1px dashed var(--pip-dark); }
  #kube-graph .gv-node { display: inline-flex; align-items: center; gap: 5px; max-width: 220px; font: inherit; font-size: 11px; padding: 3px 7px 3px 4px; color: var(--pip-mid); background: var(--pip-ink); border: 1px solid var(--pip-dark); cursor: pointer; }
  #kube-graph .gv-node span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #kube-graph .gv-node:hover { border-color: var(--pip-dim); color: var(--pip-bright); }
  #kube-graph .gv-node.sel { border-color: var(--pip-hot); color: var(--pip-hot); box-shadow: 0 0 10px var(--glow-soft); }
  #kube-graph .gv-node.match { border-color: var(--world-amber); }
  #kube-graph .gv-node.k-operator .gv-ntag { background: var(--pip-bright); }
  #kube-graph .gv-node.k-cr .gv-ntag { background: var(--world-amber); }
  #kube-graph .gv-node.k-db .gv-ntag { background: #5ab0ff; }
  #kube-graph .gv-edge { fill: none; stroke: var(--pip-dim); opacity: 0.75; }
  #kube-graph .gv-edge.s-trace { stroke: var(--pip-bright); }
  #kube-graph .gv-edge.s-flow { stroke: var(--pip-mid); }
  #kube-graph .gv-edge.s-static { stroke-dasharray: 5 4; }
  #kube-graph .gv-edge.owns { stroke: var(--world-amber); stroke-dasharray: 1 4; stroke-linecap: round; }
  #kube-graph .gv-edge.err { stroke: var(--status-broken); opacity: 0.95; }
  #kube-graph .gv-edge.hot { opacity: 1; filter: drop-shadow(0 0 3px var(--glow-bright)); }
  #kube-graph .gv-edge.faint { opacity: 0.3; }
  #kube-graph .gv-edge.quiet { opacity: 0.3; stroke-width: 1px; }
  #kube-graph .gv-findings { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 4px 0; padding: 6px 10px; border: 2px solid #ff4b3e; background: rgba(255,75,62,.12); color: #ff8a80; }
  #kube-graph .gv-findings[hidden] { display: none; }
  #kube-graph .gv-finding { font: inherit; background: #ff4b3e; color: #120000; border: 0; padding: 1px 8px; cursor: pointer; font-weight: 700; }
  #kube-graph .gv-cep { font-size: 11px; opacity: .9; }
  #kube-graph .gv-cep.warn { color: #ffb347; }
  #kube-graph .gv-cep.bad { color: #ff6b5e; font-weight: 700; }
  #kube-graph .gv-flag, #kube-graph .gv-noep { display: inline-block; align-self: flex-start; background: #ff4b3e; color: #120000; font-weight: 700; font-size: 11px; padding: 1px 6px; margin: 2px 4px 0 0; letter-spacing: .04em; }
  #kube-graph .gv-flag.f-port, #kube-graph .gv-flag.f-selector { background: #ffb347; }
  #kube-graph .gv-card.no-ep { border-color: #ff4b3e !important; box-shadow: 0 0 0 2px rgba(255,75,62,.45); }
  #kube-graph .gv-sflag { color: #ff8a80; font-size: 12px; margin: 4px 0; }
  #kube-graph .gv-eports { font-size: 11px; opacity: .85; margin: 4px 0 0; }
  #kube-graph .gv-cnone.bad { color: #ff6b5e; font-weight: 700; }
  /* SERVICES v2 (graph-layers.js): opened groups take a full row, layered cards, talking vs not */
  #kube-graph .gv-main { display: flex; gap: 12px; align-items: flex-start; }
  #kube-graph .gv-main .gv-stage { flex: 1 1 auto; min-width: 0; }
  #kube-graph .gv-group.open { flex: 1 1 100%; width: 100%; max-width: 100%; padding: 10px 12px 14px; }
  #kube-graph .gv-gtop { flex-wrap: wrap; }
  #kube-graph .gv-gsum { display: inline-flex; flex-wrap: wrap; gap: 2px 10px; align-items: baseline; }
  #kube-graph .gv-meta { color: var(--pip-mid); font-size: 11px; }
  #kube-graph .gv-talk { font-size: 11px; letter-spacing: 0.03em; }
  #kube-graph .gv-talk.t-live { color: var(--pip-bright); }
  #kube-graph .gv-talk.t-err { color: var(--status-broken); }
  #kube-graph .gv-talk.t-none { color: var(--pip-mid); opacity: 0.85; }
  #kube-graph .gv-group:not(.open) .gv-gtop { flex-wrap: wrap; }
  #kube-graph .gv-group:not(.open) .gv-gsum { flex-basis: 100%; order: 3; flex-direction: column; gap: 2px; }
  #kube-graph .gv-layered { display: flex; gap: 72px; align-items: flex-start; padding: 14px 6px 4px; border-top: 1px dashed var(--pip-dark); overflow-x: auto; }
  #kube-graph .gv-col { display: flex; flex-direction: column; gap: 16px; min-width: 210px; }
  #kube-graph .gv-colhead { font-size: 10px; letter-spacing: 0.18em; color: var(--pip-dim-text); }
  #kube-graph .gv-card { display: flex; flex-direction: column; align-items: stretch; gap: 3px; width: 240px; max-width: 240px; padding: 8px 10px; font-size: 13px; text-align: left; }
  #kube-graph .gv-crow { display: flex; align-items: center; gap: 7px; min-width: 0; }
  #kube-graph .gv-cname { font-size: 14px; color: var(--pip-bright); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #kube-graph .gv-cmeta { font-size: 11px; color: var(--pip-mid); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  #kube-graph .gv-crate { font-size: 11.5px; letter-spacing: 0.03em; }
  #kube-graph .gv-card.t-live { border-left: 3px solid var(--pip-bright); }
  #kube-graph .gv-card.t-live .gv-crate { color: var(--pip-bright); }
  #kube-graph .gv-card.t-err { border-left: 3px solid var(--status-broken); }
  #kube-graph .gv-card.t-err .gv-crate { color: var(--status-broken); }
  #kube-graph .gv-card.t-none { border-left: 3px dashed var(--pip-dim); }
  #kube-graph .gv-card.t-none .gv-crate { color: var(--pip-dim-text); }
  #kube-graph .gv-card .gv-ntag { font-size: 10px; padding: 1px 5px; }
  #kube-graph .gv-edges path.gv-edge { pointer-events: visibleStroke; cursor: help; }
  #kube-graph .gv-edge.st-config { stroke: var(--pip-dim); stroke-dasharray: 6 5; opacity: 0.8; }
  #kube-graph .gv-edge.st-live { stroke: var(--pip-bright); stroke-dasharray: 12 6; animation: gv-flow 0.9s linear infinite; opacity: 0.95; }
  #kube-graph .gv-edge.st-error { stroke: var(--status-broken); stroke-dasharray: 12 6; animation: gv-flow 0.9s linear infinite; opacity: 1; }
  #kube-graph .gv-edge.st-owner { stroke: var(--world-amber); stroke-dasharray: 1 5; stroke-linecap: round; }
  @keyframes gv-flow { to { stroke-dashoffset: -18; } }
  @media (prefers-reduced-motion: reduce) { #kube-graph .gv-edge { animation: none !important; } }
  #kube-graph .gv-key.st-live i { border-top: 4px solid var(--pip-bright); }
  #kube-graph .gv-key.st-error i { border-top: 4px solid var(--status-broken); }
  #kube-graph .gv-key.st-config i { border-top: 2px dashed var(--pip-dim); }
  #kube-graph .gv-key.st-owner i { border-top: 2px dotted var(--world-amber); }
  #kube-graph .gv-legend { font-size: 12px; color: var(--pip-bright); }
  #kube-graph .gv-badgekey { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 0 0 4px; font-size: 11px; color: var(--pip-mid); }
  #kube-graph .gv-bk { display: inline-flex; align-items: center; gap: 5px; cursor: help; }
  #kube-graph .gv-ntag.t-DB { background: #5ab0ff; }
  #kube-graph .gv-ntag.t-OP { background: var(--pip-bright); }
  #kube-graph .gv-ntag.t-CR { background: var(--world-amber); }
  #kube-graph .gv-ntag.t-HOOK { background: #c79bff; }
  #kube-graph .gv-ntag.t-ING { background: #7fe0d0; }
  #kube-graph .gv-side { flex: 0 0 320px; position: sticky; top: 8px; z-index: 5; padding: 10px 12px; color: var(--pip-bright); background: rgba(2, 10, 5, 0.96); border: 1px solid var(--pip-bright); box-shadow: 0 0 14px var(--glow-soft); }
  #kube-graph .gv-side[hidden] { display: none; }
  #kube-graph .gv-side header { display: flex; align-items: center; gap: 8px; }
  #kube-graph .gv-side header b { flex: 1; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #kube-graph .gv-smeta { margin: 4px 0 8px; color: var(--pip-mid); font-size: 11px; }
  #kube-graph .gv-calls h5 { margin: 10px 0 4px; font-size: 11px; letter-spacing: 0.16em; color: var(--pip-dim-text); font-weight: normal; }
  #kube-graph .gv-calls ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  #kube-graph .gv-calls li { display: grid; grid-template-columns: 10px 1fr auto; grid-template-rows: auto auto; column-gap: 7px; align-items: center; padding: 4px 6px; border: 1px solid var(--pip-dark); }
  #kube-graph .gv-cdot { grid-row: span 2; width: 9px; height: 9px; border-radius: 50%; background: var(--pip-dim); }
  #kube-graph .c-live .gv-cdot { background: var(--pip-bright); box-shadow: 0 0 6px var(--pip-bright); }
  #kube-graph .c-error .gv-cdot { background: var(--status-broken); box-shadow: 0 0 6px var(--status-broken); }
  #kube-graph .c-error { border-color: var(--status-broken); }
  #kube-graph .c-owner .gv-cdot { background: var(--world-amber); }
  #kube-graph .gv-cpeer { font: inherit; font-size: 12.5px; text-align: left; color: var(--pip-bright); background: none; border: 0; padding: 0; cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #kube-graph .gv-ckind { grid-column: 2; font-size: 10px; color: var(--pip-dim-text); }
  #kube-graph .gv-calls .gv-crate { grid-row: 1 / span 2; grid-column: 3; }
  #kube-graph .c-live .gv-crate { color: var(--pip-bright); }
  #kube-graph .c-error .gv-crate { color: var(--status-broken); }
  #kube-graph .c-config .gv-crate { color: var(--pip-dim-text); }
  #kube-graph .gv-cnone { margin: 0; color: var(--pip-dim-text); font-size: 11px; }
  #kube-graph .gv-side .gv-inside { display: inline-block; margin-top: 10px; }
  #kube-graph .gv-badge rect { fill: var(--bg, #041a0c); stroke: var(--pip-bright); stroke-width: 1px; opacity: 0.92; }
  #kube-graph .gv-badge text { font: 10px/1 inherit; font-family: inherit; letter-spacing: 0.04em; fill: var(--pip-bright); }
  #kube-graph .gv-badge.err rect { stroke: var(--status-broken); }
  #kube-graph .gv-badge.err text { fill: var(--status-broken); }
  #kube-graph .gv-badge.faint { opacity: 0.3; }
  #kube-graph .gv-legend { display: flex; flex-wrap: wrap; gap: 4px 14px; margin: 2px 0 4px; font-size: 11px; letter-spacing: 0.06em; color: var(--pip-mid); }
  #kube-graph .gv-key { display: inline-flex; align-items: center; gap: 6px; }
  #kube-graph .gv-key i { display: inline-block; width: 26px; height: 0; border-top: 2px solid var(--pip-dim); }
  #kube-graph .gv-key.s-trace i { border-top-color: var(--pip-bright); border-top-width: 3px; }
  #kube-graph .gv-key.s-flow i { border-top-color: var(--pip-mid); }
  #kube-graph .gv-key.s-static i { border-top-style: dashed; }
  #kube-graph .gv-key.owns i { border-top: 2px dotted var(--world-amber); }
  #kube-graph .gv-key.err i { border-top-color: var(--status-broken); }
  #kube-graph .gv-arrowhead { fill: var(--pip-mid); }
  #kube-graph .gv-timeline { padding: 8px 10px 10px; border: 1px solid var(--pip-dark); background: rgba(2, 10, 5, 0.97); }
  /* Docked: the timeline stays on screen at the bottom of SERVICES however
     long the graph is; its list scrolls inside, ▾ folds it to one line. */
  #kube-graph { overflow: hidden; }
  #kube-graph > .gv-scroll { flex: 1 1 auto; min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 8px; padding-right: 4px; }
  #kube-graph > .gv-head { flex: none; }
  #kube-graph .gv-timeline { position: relative; z-index: 5; flex: none; display: flex; flex-direction: column; gap: 6px; max-height: 28vh; box-shadow: 0 -6px 14px rgba(0, 0, 0, 0.55); }
  #kube-graph .gv-timeline .gv-events { overflow: auto; min-height: 0; }
  #kube-graph .gv-timeline.folded { gap: 0; }
  #kube-graph .gv-tlfold { padding: 0 6px; min-width: 22px; }
  #kube-graph .gv-tlsrc { color: var(--pip-dim-text); font-size: 10px; }
  #kube-graph .gv-tlsrc.s-observe { color: var(--pip-bright); }
  #kube-graph .gv-tlhead { display: flex; gap: 12px; align-items: baseline; color: var(--pip-dim-text); }
  #kube-graph .gv-tlhead { flex-wrap: wrap; align-items: center; }
  #kube-graph .gv-kinds .gv-btn, #kube-graph .gv-window .gv-btn, #kube-graph .gv-follow { padding: 2px 6px; font-size: 10px; }
  #kube-graph .gv-kind[aria-pressed="false"] { opacity: 0.45; text-decoration: line-through; }
  #kube-graph .gv-tlkeys { margin-left: auto; color: var(--pip-dim-text); font-size: 10px; }
  #kube-graph .gv-noev { color: var(--pip-dim-text); padding: 4px 0; }
  #kube-graph .gv-tlhead b { color: var(--pip-bright); letter-spacing: 0.18em; font-size: 11px; }
  #kube-graph .gv-axis { display: flex; align-items: center; gap: 8px; margin: 10px 0 6px; color: var(--pip-dim-text); font-size: 10px; }
  #kube-graph .gv-track { position: relative; flex: 1; height: 22px; border-bottom: 1px solid var(--pip-dim); background: repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), var(--pip-dark) calc(10% - 1px) 10%); }
  #kube-graph .gv-incident { position: absolute; top: 0; bottom: 0; background: rgba(255, 90, 60, 0.14); border-left: 1px solid var(--status-broken); border-right: 1px solid var(--status-broken); }
  #kube-graph .gv-tick { position: absolute; bottom: -5px; width: 10px; height: 10px; margin-left: -5px; padding: 0; border: 1px solid #000; transform: rotate(45deg); cursor: pointer; background: var(--pip-mid); }
  #kube-graph .gv-tick.e-alarm, #kube-graph .gv-tick.e-restart { background: var(--status-broken); }
  #kube-graph .gv-tick.e-warning, #kube-graph .gv-tick.e-rollout { background: var(--status-hang); }
  #kube-graph .gv-tick.e-ok { background: var(--status-ok); }
  #kube-graph .gv-tick.sel { box-shadow: 0 0 0 2px var(--pip-hot), 0 0 10px var(--glow-bright); }
  #kube-graph .gv-events { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 2px 14px; }
  #kube-graph .gv-ev { display: flex; gap: 8px; align-items: baseline; width: 100%; font: inherit; font-size: 11px; text-align: left; padding: 2px 4px; color: var(--pip-mid); background: none; border: 0; cursor: pointer; }
  #kube-graph .gv-ev:hover, #kube-graph .gv-ev.sel { background: rgba(20, 255, 106, 0.08); color: var(--pip-bright); }
  #kube-graph .gv-ev time { color: var(--pip-dim-text); }
  #kube-graph .gv-ev.e-alarm .gv-etag, #kube-graph .gv-ev.e-restart .gv-etag { background: var(--status-broken); }
  #kube-graph .gv-ev.e-warning .gv-etag, #kube-graph .gv-ev.e-rollout .gv-etag { background: var(--status-hang); }
  #kube-graph .gv-ev.e-ok .gv-etag { background: var(--status-ok); }
  #kube-ops { position: absolute; z-index: 2; inset: 0; overflow: auto; padding: var(--kube-top, 50px) 16px 16px; background: var(--pip-screen); color: var(--pip-mid); font-size: 11px; }
  .ko-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 12px; margin-top: 12px; align-items: start; }
  .ko-panel { padding: 0 0 10px; border: 2px solid var(--pip-dim); background: var(--pip-ink); box-shadow: inset 0 0 24px var(--glow-soft), 0 0 0 1px var(--pip-dark); min-width: 0; }
  .ko-head { display: flex; align-items: center; gap: 8px; padding: 4px 8px; color: var(--pip-ink); background: var(--pip-bright); letter-spacing: 0.14em; border-bottom: 2px solid var(--pip-dark); }
  .ko-head .px { image-rendering: pixelated; filter: brightness(0.25); }
  .ko-head b { flex: 1; font-weight: normal; }
  .ko-chip { font-size: 9px; padding: 0 5px; border: 1px solid var(--pip-ink); letter-spacing: 0.12em; }
  .ko-chip.audit { color: var(--status-hang); background: var(--pip-ink); border-color: var(--status-hang); }
  .ko-chip.off { color: var(--pip-dim-text); background: var(--pip-ink); }
  .ko-chip.radio { color: var(--pip-ink); }
  .ko-panel h4 { margin: 10px 10px 4px; padding-top: 6px; border-top: 1px dashed var(--pip-dark); font-size: 10px; font-weight: normal; letter-spacing: 0.14em; color: var(--pip-dim-text); }
  .ko-empty { margin: 8px 10px; padding: 8px; border: 1px dashed var(--pip-dark); color: var(--pip-mid); }
  .ko-empty p { margin: 0 0 4px; }
  .ko-hint { margin: 6px 10px; color: var(--pip-dim-text); font-size: 10px; }
  .ko-empty .ko-hint { margin: 0; }
  .ko-strip { display: grid; grid-template-columns: repeat(24, 1fr); gap: 2px; margin: 10px 10px 4px; padding: 3px; border: 1px solid var(--pip-dark); background: var(--pip-screen); }
  .ko-strip i { height: 12px; background: var(--pip-mid); box-shadow: inset 0 -3px 0 var(--btn-shade); }
  .ko-strip i.fail { background: var(--status-broken); }
  .ko-strip i.warn { background: var(--status-hang); }
  .ko-strip i.off { background: var(--pip-dark); box-shadow: none; }
  .ko-tally { display: flex; gap: 14px; margin: 0 10px 6px; letter-spacing: 0.12em; font-size: 10px; }
  .ko-tally .pass { color: var(--pip-bright); }
  .ko-tally .fail { color: var(--status-broken); }
  .ko-tally .warn { color: var(--status-hang); }
  .ko-policies, .ko-viol, .ko-claims, .ko-events { list-style: none; margin: 0; padding: 0 10px; }
  .ko-policies li { display: grid; grid-template-columns: 10px minmax(0, 1fr) auto 64px; gap: 8px; align-items: center; padding: 3px 0; border-bottom: 1px solid var(--pip-dark); }
  .ko-lamp { width: 8px; height: 8px; background: var(--lamp-on); box-shadow: 0 0 5px var(--btn-glow); }
  .ko-policies li.bad .ko-lamp { background: var(--status-broken); box-shadow: 0 0 6px var(--status-broken); }
  .ko-policies b { font-weight: normal; text-align: right; color: var(--pip-bright); }
  .ko-policies li.bad b { color: var(--status-broken); }
  .ko-pname { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--pip-mid); }
  .ko-sev { font-style: normal; font-size: 9px; padding: 0 4px; border: 1px solid var(--pip-dim); color: var(--pip-dim-text); }
  .ko-sev.high, .ko-sev.critical { color: var(--status-hang); border-color: var(--status-hang); }
  .ko-viol li { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 8px; padding: 4px 0 4px 8px; border-left: 3px solid var(--status-broken); margin-bottom: 4px; background: var(--pip-screen); }
  .ko-viol li.warn { border-left-color: var(--status-hang); }
  .ko-what { display: flex; flex-direction: column; min-width: 0; }
  .ko-what b { color: var(--pip-bright); font-weight: normal; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ko-what small { color: var(--pip-dim-text); font-size: 9px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ko-msg { color: var(--pip-mid); font-size: 10px; overflow-wrap: anywhere; }
  .ko-hpa, .ko-pool { display: grid; grid-template-columns: minmax(0, 1fr) auto 40px minmax(64px, 1fr); gap: 10px; align-items: center; margin: 4px 10px; padding: 5px 6px; border: 1px solid var(--pip-dark); background: var(--pip-screen); position: relative; }
  .ko-pool { grid-template-columns: minmax(0, 1fr) minmax(60px, 1.4fr) auto; }
  .ko-rack { display: flex; gap: 3px; padding: 3px; border: 1px solid var(--pip-dim); background: var(--pip-ink); }
  .ko-rack i { width: 10px; height: 16px; background: var(--pip-dark); box-shadow: inset 0 0 0 1px var(--btn-rim); }
  .ko-rack i.ready { background: var(--pip-bright); box-shadow: 0 0 5px var(--glow-soft), inset 0 -4px 0 var(--btn-shade); }
  .ko-rack i.starting { background: var(--pip-mid); box-shadow: inset 0 -8px 0 var(--btn-shade); }
  .ko-rack i.wanted { background: var(--pip-ink); box-shadow: inset 0 0 0 1px var(--status-hang); animation: kt-blink 1s steps(2) infinite; }
  .ko-rack i.free { background: var(--pip-ink); }
  @media (prefers-reduced-motion: reduce) { .ko-rack i.wanted { animation: none; } }
  .ko-count { color: var(--pip-hot); font-size: 14px; text-align: center; letter-spacing: 0.06em; }
  .ko-count.moving { color: var(--status-hang); }
  .ko-cpu { display: flex; flex-direction: column; gap: 2px; min-width: 0; overflow: hidden; padding-top: 3px; }
  .ko-cpu small, .ko-pool > small { color: var(--pip-dim-text); font-size: 9px; letter-spacing: 0.08em; white-space: nowrap; }
  .ko-bar { position: relative; height: 8px; border: 1px solid var(--pip-dim); background: var(--pip-ink); }
  .ko-bar i { position: absolute; left: 0; top: 0; bottom: 0; background: var(--pip-mid); }
  .ko-bar i.hot { background: var(--status-hang); }
  .ko-tick { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--pip-hot); }
  .ko-flag { position: absolute; right: 4px; top: -7px; font-style: normal; font-size: 8px; letter-spacing: 0.12em; padding: 0 3px; color: var(--pip-ink); background: var(--status-hang); }
  .ko-claims { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .ko-claims li { display: flex; align-items: center; gap: 6px; padding: 3px 6px; border: 1px solid var(--pip-dim); background: var(--pip-screen); }
  .ko-claims li .px { image-rendering: pixelated; }
  .ko-claims b { font-weight: normal; color: var(--pip-bright); }
  .ko-claims em { font-style: normal; font-size: 8px; padding: 0 3px; border: 1px solid var(--pip-dim); color: var(--pip-mid); }
  .ko-claims em.spot { color: var(--world-amber); border-color: var(--world-amber); }
  .ko-claims small { color: var(--pip-dim-text); font-size: 9px; }
  .ko-state { font-size: 9px; letter-spacing: 0.12em; color: var(--pip-bright); }
  .ko-claims li.launching { border-style: dashed; border-color: var(--status-hang); }
  .ko-claims li.launching .ko-state { color: var(--status-hang); }
  .ko-claims li.going .ko-state { color: var(--pip-dim-text); }
  .ko-events { max-height: 560px; overflow: auto; margin-top: 6px; }
  .ko-events li { display: grid; grid-template-columns: 54px 16px minmax(0, 1fr); gap: 8px; align-items: start; padding: 4px 0; border-bottom: 1px solid var(--pip-dark); }
  .ko-events time { color: var(--pip-dim-text); font-size: 10px; }
  .ko-events .px { image-rendering: pixelated; }
  .ko-ev { display: flex; flex-direction: column; min-width: 0; }
  .ko-ev b { font-weight: normal; color: var(--pip-bright); letter-spacing: 0.06em; }
  .ko-ev span { color: var(--pip-mid); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ko-ev small { color: var(--pip-dim-text); font-size: 9px; overflow-wrap: anywhere; }
  .ko-events li.policy b, .ko-events li.warning b { color: var(--status-broken); }
  .ko-events li.node b { color: var(--world-amber); }
  /* ---- end cluster screens ---- */
  /* ---- K9S window (k9s.js): a terminal docked over the cluster ---- */
  #k9s { position: absolute; z-index: 4; left: 12px; right: 12px; bottom: 50px; height: min(56%, 520px); display: flex; flex-direction: column; background: var(--pip-ink); border: 1px solid var(--pip-dim); box-shadow: 0 0 0 3px var(--btn-skirt), 0 0 0 4px var(--btn-rim), 0 10px 30px var(--btn-shade); font-size: 12px; color: var(--pip-mid); outline: none; }
  #k9s[hidden] { display: none; }
  #k9s:focus-within, #k9s:focus { border-color: var(--pip-bright); }
  .k9-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; padding: 6px 10px; border-bottom: 1px solid var(--pip-dark); background: var(--pip-screen); }
  .k9-plate { display: inline-flex; align-items: baseline; gap: 6px; padding: 1px 7px; background: var(--btn-lit-mid); color: var(--btn-lit-label); }
  .k9-plate b { letter-spacing: 0.18em; }
  .k9-plate i { font-style: normal; font-size: 9px; letter-spacing: 0.12em; opacity: 0.8; }
  .k9-ctx { color: var(--pip-hot); }
  .k9-nslabel { color: var(--pip-dim-text); font-size: 11px; }
  .k9-ns { font: inherit; font-size: 11px; color: var(--pip-hot); background: var(--pip-ink); border: 1px solid var(--pip-dark); }
  .k9-tabs { display: inline-flex; gap: 3px; }
  .k9-tab { font: inherit; font-size: 11px; padding: 1px 6px; color: var(--pip-dim-text); background: transparent; border: 1px solid var(--pip-dark); cursor: pointer; }
  .k9-tab[aria-pressed="true"] { color: var(--pip-ink); background: var(--pip-bright); border-color: var(--pip-bright); }
  .k9-prompt { display: inline-flex; align-items: center; gap: 2px; color: var(--pip-hot); }
  .k9-input { width: 180px; font: inherit; color: var(--pip-hot); background: transparent; border: 0; border-bottom: 1px solid var(--pip-bright); outline: none; caret-color: var(--pip-hot); }
  .k9-filter { color: var(--status-hang); }
  .k9-count { margin-left: auto; color: var(--pip-bright); letter-spacing: 0.05em; }
  .k9-close { font: inherit; font-size: 14px; line-height: 1; padding: 0 6px; color: var(--pip-dim-text); background: transparent; border: 1px solid var(--pip-dark); cursor: pointer; }
  .k9-body { flex: 1; min-height: 0; overflow: auto; }
  .k9-table { width: 100%; border-collapse: collapse; white-space: nowrap; }
  .k9-table th { position: sticky; top: 0; z-index: 1; padding: 4px 10px; text-align: left; font-weight: normal; letter-spacing: 0.08em; color: var(--pip-bright); background: var(--pip-screen); border-bottom: 1px solid var(--pip-dark); }
  .k9-table td { padding: 2px 10px; max-width: 520px; overflow: hidden; text-overflow: ellipsis; }
  .k9-table tr.k9-ok td { color: var(--pip-mid); }
  .k9-table tr.k9-hang td { color: var(--status-hang); }
  .k9-table tr.k9-broken td { color: var(--status-broken); }
  .k9-table tr.k9-unknown td { color: var(--pip-dim-text); }
  .k9-table tbody tr { cursor: pointer; }
  .k9-table tbody tr.k9-on td { color: var(--pip-ink); background: var(--pip-bright); }
  .k9-table tbody tr.k9-on.k9-broken td { background: var(--status-broken); }
  .k9-table tbody tr.k9-on.k9-hang td { background: var(--status-hang); }
  .k9-sub { position: sticky; top: 0; padding: 4px 10px; color: var(--pip-bright); background: var(--pip-screen); border-bottom: 1px solid var(--pip-dark); letter-spacing: 0.06em; }
  .k9-pre { margin: 0; padding: 8px 12px; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--pip-mid); font: inherit; font-size: 12px; }
  .k9-pre.k9-logs { color: var(--pip-hot); }
  .k9-dim { margin: 10px 12px; color: var(--pip-dim-text); }
  .k9-error { margin: 10px 12px; color: var(--status-broken); }
  .k9-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 14px; padding: 5px 10px; border-top: 1px solid var(--pip-dark); color: var(--pip-dim-text); font-size: 11px; background: var(--pip-screen); }
  .k9-key kbd { margin-right: 4px; padding: 0 4px; font: inherit; color: var(--pip-bright); border: 1px solid var(--pip-dark); }
  .k9-msg { margin-left: auto; color: var(--pip-mid); }
  .k9-msg.k9-bad { color: var(--status-broken); }
  @media (max-width: 899px) { #k9s { left: 6px; right: 6px; height: 62%; } .k9-input { width: 120px; } }
  #kube-panel { position: absolute; z-index: 5; right: 12px; top: var(--kube-top, 48px); width: min(460px, calc(100% - 24px)); max-height: calc(100% - 60px); background: var(--pip-screen); }
  .kp-title { display: flex; align-items: center; gap: 8px; padding: 4px 4px 4px 10px; color: var(--pip-ink); background: var(--pip-bright); letter-spacing: 0.12em; font-size: 11px; }
  .kp-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .kp-body { overflow: auto; padding: 6px 12px 10px; }
  .kp-body h4 { margin: 8px 0 4px; padding-top: 8px; border-top: 1px dashed var(--pip-dark); font-size: 11px; letter-spacing: 0.14em; color: var(--pip-dim-text); }
  .kp-log { max-height: 200px; }
  .kp-log li { color: var(--pip-mid); overflow-wrap: anywhere; }
  .kp-log li.bad { color: var(--status-broken); }
  .kp-events { list-style: none; margin: 0; padding: 0; font-size: 11px; }
  .kp-events li { display: grid; grid-template-columns: max-content max-content 1fr; gap: 6px; padding: 3px 0; border-bottom: 1px solid var(--pip-dark); }
  .kp-events .when { color: var(--pip-dim-text); }
  .kp-events .reason { color: var(--pip-bright); }
  .kp-events li.warn .reason { color: var(--status-hang); }
  .kp-events .msg { color: var(--pip-mid); overflow-wrap: anywhere; min-width: 0; }
  #vault-panels { position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 2; }
  .vault-panel {
    position: absolute; display: flex; flex-direction: column; min-width: 0;
    font-size: 12px; line-height: 1.45; color: var(--pip-mid);
    background: rgb(2, 10, 5); border: 2px solid var(--pip-dim);
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
  .vp-facts dt { color: var(--pip-dim-text); letter-spacing: 0.12em; font-size: 11px; }
  .vp-facts dd { margin: 0; color: var(--pip-bright); overflow-wrap: anywhere; }
  .vp-checks h4 { margin: 0 0 4px; color: var(--pip-dim-text); font-size: 11px; letter-spacing: 0.14em; border-top: 1px dashed var(--pip-dark); padding-top: 8px; }
  .vp-checks ul, .vp-errors { list-style: none; margin: 0; padding: 0; }
  .vp-trouble h4, .vp-errlines h4 {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin: 8px 0 4px; padding-top: 8px; border-top: 1px dashed var(--pip-dark);
    font-size: 11px; letter-spacing: 0.14em; color: var(--pip-dim-text);
  }
  .vp-trouble h4 { color: var(--status-broken); }
  .vp-trouble ul { list-style: none; margin: 0; padding: 0; }
  .vp-trouble li { display: flex; gap: 8px; align-items: flex-start; padding: 4px 0; }
  .vp-trouble .dot { flex: none; width: 10px; height: 10px; margin-top: 3px; border-radius: 50%; background: var(--status-broken); box-shadow: 0 0 6px var(--status-broken); }
  .vp-trouble .body { display: flex; flex-direction: column; min-width: 0; }
  .vp-trouble .when, .vp-errlines .when { color: var(--pip-dim-text); font-size: 11px; }
  .vp-trouble .call { color: var(--pip-bright); overflow-wrap: anywhere; }
  .vp-trouble .err { color: var(--status-broken); overflow-wrap: anywhere; }
  .vp-metrics h4 {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    margin: 8px 0 4px; padding-top: 8px; border-top: 1px dashed var(--pip-dark);
    font-size: 11px; letter-spacing: 0.14em; color: var(--pip-dim-text);
  }
  .vp-metrics .res { margin: 6px 0 2px; display: flex; justify-content: space-between; gap: 8px; font-size: 11px; }
  .vp-metrics .res .name { color: var(--pip-bright); overflow-wrap: anywhere; min-width: 0; }
  .vp-metrics .res .head { color: var(--pip-mid); white-space: nowrap; }
  .vp-metrics .res.hang .head { color: var(--status-hang); }
  .vp-metrics .res.broken .head { color: var(--status-broken); }
  .vp-metrics ul { list-style: none; margin: 0; padding: 0; }
  .vp-metrics li { display: grid; grid-template-columns: 64px 1fr 74px; align-items: center; gap: 6px; padding: 1px 0; font-size: 10px; }
  .vp-metrics li .lbl { color: var(--pip-dim-text); letter-spacing: 0.1em; }
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
  .vp-note { margin: 2px 0 4px; color: var(--pip-dim-text); font-size: 11px; overflow-wrap: anywhere; }
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
  .check-body .res { color: var(--pip-dim-text); }
  .check-body .err { flex-basis: 100%; color: var(--status-broken); overflow-wrap: anywhere; }
  .vp-checks li.slow .err { color: var(--status-hang); }
  .vp-errors li { position: relative; padding: 4px 0 4px 16px; color: var(--status-broken); overflow-wrap: anywhere; border-bottom: 1px solid rgba(255, 90, 60, 0.15); }
  .vp-errors li::before { content: "!"; position: absolute; left: 2px; top: 4px; font-weight: bold; }
  .vp-links { display: flex; flex-wrap: wrap; gap: 6px; padding: 8px 12px 10px; border-top: 1px dashed var(--pip-dark); }
  .vp-links .cmd { min-height: 28px; padding: 0 10px; font-size: 11px; letter-spacing: 0.12em; text-decoration: none; display: inline-flex; align-items: center; }
  @keyframes vault-blink { 50% { opacity: 0.25; } }
  @media (prefers-reduced-motion: reduce) { .vp-checks li.pending .dot { animation: none; } }
  #wall-grain { position: absolute; z-index: 2; min-height: 26px; padding: 0 6px; font-size: 11px; }
  .vpc-fold { position: absolute; z-index: 2; min-height: 22px; padding: 0 6px; font-size: 11px; letter-spacing: 0.1em; }
  .vpc-fold:focus-visible { outline: 2px solid var(--pip-hot); outline-offset: 2px; }
  /* ---- learn ---- LEARN: the holotape shelf (theme vars only). */
  #learn {
    position: absolute; inset: 10px 12px; z-index: 6; display: flex; flex-direction: column; min-height: 0;
    color: var(--pip-bright); font-size: 13px; text-shadow: 0 0 4px var(--glow-soft);
    background: radial-gradient(ellipse at 60% 30%, var(--pip-glass), var(--pip-ink) 80%);
    border: 3px solid var(--pip-mid); box-shadow: 0 0 18px var(--glow-soft);
  }
  #learn[hidden] { display: none; }
  .lx-top { display: flex; align-items: stretch; gap: 8px; background: var(--pip-ink); border-bottom: 2px solid var(--pip-mid); }
  .lx-top .ptitle { flex: 0 0 auto; padding: 4px 12px; }
  .lx-tracks { display: flex; gap: 6px; flex: 1 1 auto; align-items: center; min-width: 0; padding: 4px 0; }
  .lx-track {
    display: inline-flex; align-items: center; gap: 7px; min-height: 30px; padding: 0 10px; cursor: pointer;
    font: inherit; font-size: 11px; letter-spacing: 0.1em; color: var(--pip-dim-text);
    background: var(--pip-screen); border: 1px solid var(--pip-dark); border-radius: 0;
  }
  .lx-track small { color: var(--pip-dim-text); letter-spacing: 0.04em; }
  .lx-track[aria-pressed="true"] { color: var(--pip-hot); border-color: var(--pip-bright); box-shadow: inset 0 0 10px var(--glow-soft), 0 0 6px var(--glow-soft); }
  .lx-track[aria-pressed="true"] small { color: var(--pip-bright); }
  .lx-track:hover { color: var(--pip-bright); }
  .lx-track:focus-visible, .lx-slot:focus-visible { outline: 2px solid var(--pip-hot); outline-offset: 2px; }
  .lx-band { width: 8px; height: 16px; border: 1px solid var(--case-seam); background: var(--world-vault); box-shadow: inset 0 -3px 0 var(--case-lo); }
  .lx-track.ex280 .lx-band { background: var(--world-cloth); }
  .lx-track.cloud .lx-band { background: var(--world-amber); }
  .lx-close { flex: 0 0 auto; align-self: center; margin-right: 6px; min-width: 30px; min-height: 28px; font-size: 16px; }
  .lx-body { flex: 1 1 auto; min-height: 0; display: grid; grid-template-columns: minmax(250px, 33%) 1fr; }
  /* The shelf: a steel rack, tapes standing on brass-edged boards. */
  .lx-shelf {
    overflow: auto; padding: 10px 10px 0; scrollbar-width: thin; scrollbar-color: var(--pip-dim) var(--pip-ink);
    background: linear-gradient(90deg, var(--case-lo), var(--case-seam) 6%, var(--case-seam) 94%, var(--case-lo));
    border-right: 3px solid var(--case-mid); box-shadow: inset 0 0 22px var(--pip-ink);
  }
  .lx-rack { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: 0 8px; }
  .lx-rack li { padding: 8px 0 0; border-bottom: 5px solid var(--case-mid); box-shadow: 0 2px 0 var(--case-brass-lo), 0 5px 0 var(--case-seam); margin-bottom: 10px; }
  .lx-slot {
    width: 100%; display: grid; justify-items: center; gap: 2px; padding: 4px 2px 6px; cursor: pointer;
    font: inherit; font-size: 11px; color: var(--world-muted); background: none; border: 1px solid transparent; border-radius: 0;
    text-shadow: none;
  }
  .lx-slot .lx-tape { width: 72px; height: 51px; transition: transform 120ms steps(2); filter: drop-shadow(0 3px 0 var(--case-seam)); }
  .lx-slot:hover .lx-tape { transform: translateY(-3px); }
  .lx-slot[aria-pressed="true"] { border-color: var(--pip-bright); background: var(--pip-ink); box-shadow: 0 0 10px var(--glow-soft); }
  .lx-slot[aria-pressed="true"] .lx-tape { transform: translateY(-5px); }
  .lx-num { color: var(--world-text); letter-spacing: 0.12em; }
  /* tape names wrap to two lines: a 96px slot cannot hold "ServiceAccounts and Pod Security" on one */
  .lx-name { max-width: 100%; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; line-clamp: 2; overflow-wrap: anywhere; text-align: center; line-height: 1.2; min-height: 2.4em; letter-spacing: 0.02em; }
  .lx-slot.passed .lx-num { color: var(--pip-bright); text-shadow: 0 0 5px var(--glow-bright); }
  .lx-slot.failing .lx-num { color: var(--status-broken); }
  .lx-slot.started .lx-num { color: var(--status-hang); }
  .lx-player { overflow: auto; padding: 12px 16px 16px; scrollbar-width: thin; scrollbar-color: var(--pip-dim) var(--pip-ink); color: var(--pip-mid); }
  .lx-head { display: flex; gap: 14px; align-items: center; padding-bottom: 10px; border-bottom: 2px solid var(--pip-dark); }
  .lx-head .lx-tape { width: 96px; height: 68px; filter: drop-shadow(0 4px 0 var(--case-seam)); }
  .lx-title { flex: 1 1 auto; min-width: 0; display: grid; gap: 2px; }
  .lx-title small { color: var(--pip-dim-text); letter-spacing: 0.16em; font-size: 11px; }
  .lx-title h3 { margin: 0; color: var(--pip-hot); font-size: 20px; letter-spacing: 0.06em; text-shadow: 0 0 8px var(--glow-bright); }
  .lx-state { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; letter-spacing: 0.16em; color: var(--pip-dim-text); }
  .lx-lamp { flex: 0 0 auto; width: 9px; height: 9px; background: var(--lamp-off); border: 1px solid var(--case-seam); box-shadow: inset 0 0 2px var(--lamp-off-hi); }
  .lx-state.passed, .lx-results .ok { color: var(--pip-bright); }
  .lx-state.passed .lx-lamp, .lx-results .ok .lx-lamp { background: var(--lamp-on); box-shadow: 0 0 6px var(--glow-bright), inset 0 0 2px var(--lamp-on-core); }
  .lx-state.failing, .lx-results .fail { color: var(--status-broken); }
  .lx-state.failing .lx-lamp, .lx-results .fail .lx-lamp { background: var(--status-broken); box-shadow: 0 0 6px var(--status-broken); }
  .lx-state.started { color: var(--status-hang); }
  .lx-state.started .lx-lamp { background: var(--status-hang); box-shadow: 0 0 6px var(--status-hang); }
  .lx-twin { flex: 0 0 auto; min-height: 28px; padding: 0 10px; font-size: 11px; letter-spacing: 0.12em; }
  .lx-sec { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 14px 0 6px; padding-bottom: 3px; border-bottom: 1px dashed var(--pip-dark); }
  .lx-sec b { color: var(--pip-dim-text); letter-spacing: 0.18em; font-size: 11px; }
  .lx-sec .cmd { min-height: 26px; padding: 0 10px; font-size: 11px; letter-spacing: 0.12em; }
  .lx-needs { color: var(--pip-dim-text); font-size: 11px; letter-spacing: 0.04em; font-weight: normal; }
  .lx-player p { margin: 0 0 6px; line-height: 1.45; }
  .lx-task { color: var(--pip-bright); white-space: pre-line; }
  .lx-runstate { display: flex; align-items: center; gap: 8px; padding: 6px 8px; border: 1px dashed var(--case-seam); color: var(--pip-dim-text); letter-spacing: 0.06em; font-size: 12px; }
  .lx-runstate .lx-lamp.live { background: var(--world-amber); box-shadow: 0 0 6px var(--world-amber); animation: vault-blink 1.2s steps(2) infinite; }
  .lx-player code { font: inherit; color: var(--pip-hot); background: var(--pip-screen); padding: 0 3px; overflow-wrap: anywhere; }
  .lx-reqs, .lx-hints, .lx-noeq { margin: 0; padding: 0 0 0 20px; display: grid; gap: 3px; line-height: 1.4; }
  .lx-reqs li::marker { content: "▸ "; color: var(--pip-dim-text); }
  .lx-hints li::marker { color: var(--status-hang); }
  .lx-hints li { color: var(--pip-bright); }
  .lx-hints .lx-hidden { color: var(--pip-dark); letter-spacing: -0.02em; overflow: hidden; white-space: nowrap; }
  .lx-noeq li { color: var(--world-muted); }
  .lx-cmds { display: grid; gap: 4px; margin-bottom: 4px; }
  .lx-cmd { display: flex; align-items: center; gap: 8px; padding: 3px 4px 3px 6px; background: var(--pip-ink); border: 1px solid var(--pip-dark); }
  .lx-cmd .lx-lbl { flex: 0 0 46px; color: var(--pip-dim-text); font-size: 10px; letter-spacing: 0.12em; }
  .lx-cmd code { flex: 1 1 auto; min-width: 0; padding: 0; background: none; color: var(--pip-bright); font-size: 12px; }
  .lx-copy { flex: 0 0 auto; min-height: 22px; padding: 0 8px; font-size: 10px; letter-spacing: 0.12em; }
  .lx-check { display: grid; gap: 6px; }
  .lx-run { color: var(--status-hang); letter-spacing: 0.16em; animation: vault-blink 0.8s steps(2) infinite; }
  .lx-sum { padding: 4px 8px; letter-spacing: 0.14em; border: 1px solid currentColor; }
  .lx-sum.ok { color: var(--pip-hot); background: var(--pip-dark); text-shadow: 0 0 6px var(--glow-bright); }
  .lx-sum.fail { color: var(--status-broken); }
  .lx-results { list-style: none; margin: 0; padding: 0; display: grid; gap: 3px; }
  .lx-results li { display: flex; align-items: baseline; gap: 8px; }
  .lx-results .lx-lamp { align-self: center; }
  .lx-word { flex: 0 0 36px; font-size: 11px; letter-spacing: 0.12em; }
  .lx-note { color: var(--pip-dim-text); font-size: 12px; }
  .lx-note.fail { color: var(--status-broken); }
  .lx-why { color: var(--world-muted); font-size: 12px; }
  .lx-map { width: 100%; border-collapse: collapse; font-size: 12px; }
  .lx-map th { text-align: left; color: var(--pip-dim-text); letter-spacing: 0.14em; font-size: 10px; padding: 3px 6px; border-bottom: 1px solid var(--pip-mid); }
  .lx-map td { padding: 4px 6px; border-bottom: 1px solid var(--pip-dark); vertical-align: top; color: var(--pip-mid); }
  .lx-map td:first-child { color: var(--world-muted); width: 42%; }
  .lx-forget { opacity: 0.8; }
  @media (prefers-reduced-motion: reduce) { .lx-run { animation: none; } .lx-slot .lx-tape { transition: none; } }
  @media (max-width: 900px) {
    #learn { inset: 6px; }
    .lx-body { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
    .lx-shelf { padding: 6px 6px 0; border-right: 0; border-bottom: 3px solid var(--case-mid); overflow-x: auto; overflow-y: hidden; }
    .lx-rack { grid-template-columns: none; grid-auto-flow: column; grid-auto-columns: 84px; }
    .lx-rack li { margin-bottom: 6px; }
    .lx-track small { display: none; }
    .lx-top .ptitle { padding: 4px 8px; }
  }
  /* ---- end learn ---- */
  /* Public ALBs: a dock hung under the card (lamp, OPEN ↗, ROUTES), never over the subnets. */
  #alb-docks[hidden], #vpc-folds[hidden] { display: none; }
  #alb-docks { position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 3; }
  .alb-dock { position: absolute; min-width: 0; font-size: 11px; letter-spacing: 0.04em; }
  .alr-bar {
    display: flex; align-items: center; gap: 6px; height: 22px; padding: 0 4px 0 6px; white-space: nowrap;
    color: var(--pip-mid); background: linear-gradient(180deg, #2a1f08, var(--pip-ink));
    border: 1px solid var(--world-amber); border-top: 0; box-shadow: 0 3px 8px rgba(0, 0, 0, 0.55), inset 0 -1px 0 rgba(255, 204, 51, 0.25);
  }
  .alr-bar .reach-lamp { flex: 1 0 auto; }
  .reach-lamp::before { flex: none; }
  .alr-bar a.cmd, .alr-bar .cmd { min-height: 18px; padding: 0 6px; font-size: 10px; letter-spacing: 0.08em; text-decoration: none; white-space: nowrap; }
  .alr-routes-toggle[aria-expanded="true"] { color: var(--pip-ink); background: var(--world-amber); border-color: var(--world-amber); }
  .alr-panel {
    position: absolute; left: 0; top: 24px; z-index: 6; width: max(100%, 420px); max-width: min(560px, 92vw);
    background: linear-gradient(180deg, rgba(42, 31, 8, 0.97), rgba(2, 10, 5, 0.98) 60px); border: 2px solid var(--world-amber);
    box-shadow: 0 0 0 1px var(--pip-ink), 0 10px 24px rgba(0, 0, 0, 0.7), 0 0 14px rgba(255, 204, 51, 0.25);
  }
  .alr-head { display: flex; align-items: baseline; gap: 10px; padding: 5px 8px; border-bottom: 1px solid rgba(255, 204, 51, 0.35); }
  .alr-head b { color: var(--world-amber); letter-spacing: 0.18em; }
  .alr-src { color: var(--pip-dim-text); font-size: 10px; letter-spacing: 0.1em; }
  .alr-search { display: block; width: calc(100% - 16px); margin: 6px 8px 0; padding: 3px 6px; font: inherit; color: var(--pip-bright); background: var(--pip-ink); border: 1px solid var(--pip-dark); }
  .alr-list { max-height: 260px; overflow: auto; padding: 2px 0 6px; }
  .alr-list:focus-visible { outline: 2px solid var(--pip-hot); outline-offset: -2px; }
  .alr-host { margin: 6px 8px 2px; color: var(--pip-dim-text); font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase; }
  .alr-list ul { list-style: none; margin: 0; padding: 0; }
  .alr-route { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 8px; padding: 3px 8px; border-top: 1px dotted rgba(20, 255, 106, 0.15); }
  .alr-route:hover { background: rgba(20, 255, 106, 0.06); }
  .alr-where { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; min-width: 0; }
  .alr-path { color: var(--pip-bright); font: inherit; overflow-wrap: anywhere; }
  .alr-svc { color: var(--pip-mid); overflow-wrap: anywhere; }
  .alr-tags { display: inline-flex; gap: 6px; }
  .alr-methods { color: var(--pip-dim-text); font-size: 10px; }
  .alr-from { padding: 0 4px; font-size: 9px; letter-spacing: 0.1em; color: var(--pip-ink); background: var(--pip-dim); }
  .alr-note { color: var(--pip-dim-text); font-size: 10px; }
  .alr-route.openapi .alr-path { color: var(--pip-mid); }
  .alr-route .reach-lamp { font-size: 10px; }
  .reach-lamp.skip { color: var(--pip-dim-text); }
  .alr-route a.cmd { min-height: 18px; padding: 0 6px; font-size: 11px; text-decoration: none; }
  .alr-empty { margin: 6px 8px; color: var(--pip-dim-text); }
  .alb-exposed {
    position: absolute; height: 22px; padding: 0 8px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; cursor: pointer;
    font: inherit; font-size: 11px; letter-spacing: 0.06em; color: var(--world-amber);
    background: linear-gradient(180deg, #2a1f08, var(--pip-ink)); border: 1px solid rgba(255, 204, 51, 0.55); border-top: 0;
  }
  .alb-exposed:hover, .alb-exposed:focus-visible { outline: none; color: var(--pip-ink); background: var(--world-amber); }
  .choice-note.warn { color: var(--status-hang); }
  .choice-note.warn::before { content: "⚠ "; }
  .card-open { display: flex; align-items: center; gap: 8px; margin: 6px 0; padding: 4px 6px; border: 1px solid var(--status-hang); flex-wrap: wrap; }
  .card-open .ps-tag { background: var(--status-hang); color: var(--pip-ink); padding: 1px 6px; font-weight: 700; letter-spacing: 0.12em; }
  .card-open .ps-url { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
  .card-open a.cmd { min-height: 22px; padding: 0 8px; font-size: 11px; text-decoration: none; }
  .reach-lamp { display: inline-flex; align-items: center; gap: 5px; white-space: nowrap; }
  .reach-lamp::before { content: ""; width: 9px; height: 9px; border-radius: 50%; background: var(--pip-dark); }
  .reach-lamp[data-state="ok"]::before { background: var(--status-ok); box-shadow: 0 0 6px var(--status-ok); }
  .reach-lamp[data-state="fail"]::before { background: var(--status-broken); box-shadow: 0 0 6px var(--status-broken); }
  .reach-lamp[data-state="fail"] { color: var(--status-broken); }
  #map-view { position: absolute; z-index: 2; display: flex; align-items: center; gap: 6px; padding: 3px 6px; background: var(--pip-ink); border: 1px solid var(--pip-dark); box-shadow: 0 0 0 1px var(--pip-ink), 0 4px 10px var(--pip-ink); }
  #map-view button.cmd { min-height: 24px; padding: 0 8px; font-size: 11px; letter-spacing: 0.12em; }
  #map-view button.cmd[aria-pressed="true"] { background: var(--pip-bright); color: var(--pip-ink); border-color: var(--pip-bright); text-shadow: none; }
  #map-view button.cmd[aria-pressed="true"]::before, #map-view button.cmd[aria-pressed="true"]::after { color: var(--pip-ink); }
  #map-view select { min-height: 24px; padding: 0 4px; font-size: 11px; max-width: 120px; }
  #pip {
    position: absolute; top: 10px; left: 12px; z-index: 4; margin: 0;
    width: min(400px, calc(100% - 24px)); max-height: calc(100% - 20px); overflow: auto;
    padding: 0 0 8px; font-size: 13px; color: var(--pip-bright);
    /* opaque: a see-through panel lets the map's labels read through the cards */
    background: rgb(2, 10, 5); border: 2px solid var(--pip-mid);
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
  #pip label { display: flex; gap: 8px; align-items: center; justify-content: space-between; color: var(--pip-dim-text); letter-spacing: 0.08em; text-transform: uppercase; font-size: 11px; }
  #pip label select, #pip label input { flex: 0 1 200px; }
  #pip .field-note { color: var(--status-broken); font-size: 11px; font-style: normal; text-align: right; }
  #pip .field-note:empty { display: none; }
  #pip .live-line { display: flex; flex-direction: column; gap: 2px; color: var(--pip-bright); font-size: 11px; letter-spacing: 0.06em; }
  #pip .live-line .field-note { text-align: left; font-weight: bold; }
  #pip .actions { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  #pip .actions input { flex: 1 1 140px; }
  #pip .danger { border-color: var(--status-broken); color: var(--status-broken); }
  #pip .danger:hover { background: var(--status-broken); color: var(--pip-ink); }
  #pip-watch { margin: 0; color: var(--pip-bright); }
  #pip-watch.fail { color: var(--status-broken); }
  #pip pre { margin: 0; max-height: 220px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; color: var(--pip-mid); font: inherit; font-size: 12px; }
  #pip pre:empty { display: none; }
  /* The run pane: the card's terminal (live log, steps, clock) and the red
     ERROR plate when a run fails or is refused. */
  #pip:has(.runpane:not([hidden])) { width: min(600px, calc(100% - 24px)); }
  .runpane { display: flex; flex-direction: column; gap: 5px; padding: 6px; background: var(--pip-ink); border: 1px solid var(--pip-dark); box-shadow: inset 0 0 10px var(--pip-ink), 0 0 0 1px var(--pip-screen); }
  .runpane[hidden], .runpane [hidden] { display: none; }
  .runpane .run-head { display: flex; align-items: center; gap: 8px; font-size: 11px; letter-spacing: 0.1em; color: var(--pip-bright); }
  .runpane .run-title { font-weight: normal; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .runpane .run-word { color: var(--pip-dim-text); }
  .runpane .run-time { font-variant-numeric: tabular-nums; color: var(--pip-bright); text-shadow: 0 0 6px var(--glow-bright); }
  .runpane .run-lamp { flex: 0 0 auto; width: 9px; height: 9px; border-radius: 50%; background: var(--pip-dim); }
  .runpane .run-lamp.run { background: var(--world-amber); box-shadow: 0 0 6px var(--world-amber); animation: run-blink 1s steps(2) infinite; }
  .runpane .run-lamp.ok { background: var(--pip-bright); box-shadow: 0 0 6px var(--glow-bright); }
  .runpane .run-lamp.fail { background: var(--status-broken); box-shadow: 0 0 6px var(--status-broken); }
  @keyframes run-blink { 50% { opacity: 0.35; } }
  @media (prefers-reduced-motion: reduce) { .runpane .run-lamp.run { animation: none; } }
  .runpane[data-state="failed"] .run-word, .runpane[data-state="refused"] .run-word { color: var(--status-broken); }
  .runpane .run-steps { margin: 0; padding: 0; list-style: none; font-size: 11px; display: flex; flex-direction: column; gap: 1px; }
  .runpane .run-steps li { display: grid; grid-template-columns: 14px 1fr; gap: 4px; color: var(--pip-dim-text); }
  .runpane .run-steps li code { font: inherit; overflow-wrap: anywhere; }
  .runpane .run-steps li.done { color: var(--pip-mid); }
  .runpane .run-steps li.running { color: var(--world-amber); }
  .runpane .run-steps li.failed { color: var(--status-broken); }
  .runpane .run-out, .runpane .run-out { max-height: 260px; min-height: 3em; padding: 4px 6px; color: var(--pip-mid); background: repeating-linear-gradient(0deg, var(--pip-screen) 0 2px, var(--pip-ink) 2px 3px); border: 1px solid var(--pip-dark); font-size: 11px; }
  .runpane .run-plate { display: flex; flex-direction: column; gap: 5px; padding: 6px 8px; color: var(--status-broken); background: color-mix(in srgb, var(--status-broken) 16%, var(--pip-ink)); border: 2px solid var(--status-broken); box-shadow: 0 0 10px color-mix(in srgb, var(--status-broken) 40%, transparent); }
  .runpane .run-plate .plate-title { font-size: 12px; letter-spacing: 0.24em; font-weight: bold; }
  .runpane .run-plate .plate-step { font-size: 10px; letter-spacing: 0.06em; overflow-wrap: anywhere; }
  .runpane .run-plate .plate-lines { max-height: none; color: var(--status-broken); font-size: 12px; white-space: pre-wrap; }
  .runpane .run-plate .plate-hint { margin: 0; color: var(--pip-bright); font-size: 12px; line-height: 1.35; }
  .runpane .run-plate .plate-hint b { color: var(--world-amber); font-weight: normal; letter-spacing: 0.12em; font-size: 10px; }
  .runpane .run-plate .plate-cmd { border-color: var(--status-broken); }
  .runpane .run-plate .plate-unlock { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; border-color: var(--status-broken); }
  .runpane .run-plate .plate-unlock .confirm-name { flex: 1 1 12em; min-width: 0; }
  .runpane .run-notes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .runpane .run-note { padding: 5px 8px; font-size: 12px; line-height: 1.35; color: var(--pip-bright); border: 1px solid var(--world-amber); background: color-mix(in srgb, var(--world-amber) 12%, var(--pip-ink)); overflow-wrap: anywhere; }
  .runpane .run-note b { color: var(--world-amber); font-weight: normal; letter-spacing: 0.12em; font-size: 10px; }
  .runpane .run-note.ok { border-color: var(--status-ok, var(--pip-bright)); }
  .runpane .run-note .cmdrow { margin-top: 4px; }
  .runpane .run-plate .plate-cmd code { max-height: 4.4em; overflow: auto; scrollbar-width: thin; }
  .runpane .run-foot { display: flex; justify-content: space-between; gap: 8px; font-size: 10px; color: var(--pip-dim-text); }
  .runpane .run-foot a { color: var(--pip-dim-text); overflow-wrap: anywhere; }
  .runpane .run-foot a:hover { color: var(--pip-bright); }
  .runpane pre { margin: 0; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; font: inherit; }
  .runpane .run-out { max-height: 260px; min-height: 3em; }
  .runpane .cmdrow { display: grid; grid-template-columns: 52px 1fr auto; gap: 6px; align-items: center; padding: 2px 3px; background: var(--pip-screen); border: 1px solid var(--pip-dark); }
  .runpane .cmdrow .lbl { font-size: 9px; letter-spacing: 0.16em; color: var(--pip-dim-text); }
  .runpane .cmdrow code { font: inherit; font-size: 11px; color: var(--pip-bright); overflow-wrap: anywhere; }
  .runpane .cmdrow .copy { min-height: 22px; padding: 0 6px; font-size: 10px; letter-spacing: 0.12em; }
  .runpane .run-offer { display: flex; align-items: center; gap: 8px; padding: 5px 8px; color: var(--pip-bright); border: 1px dashed var(--pip-mid); font-size: 12px; }
  .runpane .run-offer button { margin-left: auto; }
  /* CONNECT: a lamp, what it means and one button (Stacks EKS card, the
     Cluster view's EKS strip). */
  .connect-row { display: grid; grid-template-columns: 10px 1fr auto; gap: 4px 8px; align-items: center; padding: 5px 7px; border: 1px solid var(--pip-dark); background: var(--pip-ink); font-size: 12px; }
  .connect-row .lamp { width: 9px; height: 9px; border-radius: 50%; background: var(--lamp-off); box-shadow: inset 0 0 0 1px var(--btn-rim); }
  .connect-row[data-state="connected"] .lamp { background: var(--lamp-on); box-shadow: 0 0 6px var(--btn-glow); }
  .connect-row[data-state="not-connected"] .lamp, .connect-row[data-state="not-listed"] .lamp, .connect-row[data-state="clash-same"] .lamp { background: var(--world-amber); box-shadow: 0 0 5px var(--world-amber); }
  .connect-row[data-state="no-access"] .lamp, .connect-row[data-state="error"] .lamp { background: var(--status-broken); box-shadow: 0 0 6px var(--status-broken); }
  .connect-row .what { color: var(--pip-bright); letter-spacing: 0.08em; overflow-wrap: anywhere; }
  .connect-row[data-state="no-access"] .what, .connect-row[data-state="error"] .what { color: var(--status-broken); }
  .connect-row .hint { grid-column: 2 / 4; color: var(--pip-dim-text); font-size: 11px; line-height: 1.35; }
  .connect-row .hint:empty { display: none; }
  .connect-row button { min-height: 24px; }
  /* ADD-ONS bundle on the EKS card: a checklist, a slot line, one button. */
  .bundle { flex-shrink: 0; display: flex; flex-direction: column; gap: 3px; margin-top: 6px; padding: 6px 7px; border: 1px solid var(--pip-dark); background: var(--pip-ink); font-size: 12px; }
  .bundle > * { flex-shrink: 0; }
  .bundle .bhead { display: flex; flex-wrap: wrap; gap: 2px 8px; align-items: baseline; color: var(--pip-dim-text); font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; }
  .bundle .bhead b { color: var(--pip-bright); letter-spacing: 0.2em; }
  .bundle .bhead em { flex: 1 0 100%; font-style: normal; text-transform: none; letter-spacing: 0.04em; }
  .bundle .bhead em:empty { display: none; }
  .bundle .brow { display: grid; grid-template-columns: 16px minmax(0, 1fr) auto auto; gap: 2px 8px; align-items: center; min-height: 22px; padding: 1px 2px; border-bottom: 1px dotted var(--pip-dark); }
  .bundle .brow .name { color: var(--pip-bright); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .bundle .brow .cost { color: var(--pip-mid); font-size: 11px; text-align: right; }
  .bundle .brow .pods { color: var(--pip-dim-text); font-size: 11px; min-width: 44px; text-align: right; }
  .bundle .brow .state { grid-column: 2 / 5; color: var(--pip-dim-text); font-size: 10px; letter-spacing: 0.08em; overflow-wrap: anywhere; }
  .bundle .brow .state:empty { display: none; }
  .bundle .brow[data-state="installed"] .name, .bundle .brow[data-state="present"] .name { color: var(--pip-mid); }
  .bundle .brow[data-state="installed"] .state, .bundle .brow[data-state="present"] .state { color: var(--pip-mid); }
  .bundle .bline { margin-top: 3px; color: var(--pip-bright); letter-spacing: 0.04em; }
  .bundle .bline[data-tight="1"] { color: var(--status-hang); }
  .bundle .bhint { color: var(--pip-dim-text); font-size: 11px; line-height: 1.35; }
  .bundle .bhint:empty { display: none; }
  .bundle .bact { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; margin-top: 3px; }
  #pip .bundle .bact label { flex: 1 1 200px; justify-content: flex-start; gap: 6px; color: var(--pip-mid); font-size: 10px; line-height: 1.35; cursor: pointer; }
  #pip .bundle input[type="checkbox"] { flex: 0 0 auto; width: 14px; height: 14px; min-height: 0; margin: 0; padding: 0; accent-color: var(--pip-bright); }
  .bundle .bact button { margin-left: auto; min-height: 26px; }
  .bundle .bqueue { color: var(--world-amber); font-size: 11px; }
  .bundle .bqueue:empty { display: none; }
  /* Stacks cards: cost chip, engine plate, the bill readout, Terraform commands. */
  #pip .card-title { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #pip .cost-chip {
    flex: 0 0 auto; padding: 1px 6px; border-radius: 0; font-size: 11px; letter-spacing: 0.04em; text-transform: none;
    color: var(--pip-bright); background: var(--pip-screen); border: 1px solid var(--pip-dark);
    box-shadow: inset 0 1px 3px var(--pip-ink); text-shadow: 0 0 4px var(--glow-bright);
  }
  #pip .eng {
    flex: 0 0 auto; padding: 1px 5px; font-size: 9px; letter-spacing: 0.14em; color: var(--pip-ink);
    background: linear-gradient(var(--pip-mid), var(--pip-dim)); border: 1px solid var(--pip-dark); box-shadow: inset 0 1px 0 var(--glow-bright);
  }
  #pip .eng.tf { background: linear-gradient(var(--case-brass), var(--case-brass-lo)); border-color: var(--case-brass-lo); box-shadow: inset 0 1px 0 var(--world-glow); }
  #pip .card-head:hover .cost-chip, #pip .card.open .card-head .cost-chip { color: var(--pip-bright); background: var(--pip-ink); border-color: var(--pip-ink); }
  #pip .bill { display: flex; flex-direction: column; gap: 4px; }
  #pip .meter {
    display: grid; grid-template-columns: repeat(3, 1fr); gap: 2px; padding: 3px;
    background: var(--pip-ink); border: 1px solid var(--pip-dark); box-shadow: inset 0 0 8px var(--pip-ink), 0 0 0 1px var(--pip-screen);
  }
  #pip .meter-cell {
    display: flex; flex-direction: column; align-items: center; padding: 3px 2px 2px;
    background: repeating-linear-gradient(0deg, var(--pip-screen) 0 2px, var(--pip-ink) 2px 3px); border: 1px solid var(--pip-dark);
  }
  #pip .meter-cell b { font-size: 15px; font-weight: normal; color: var(--pip-bright); text-shadow: 0 0 6px var(--glow-bright), 0 0 1px var(--pip-hot); letter-spacing: 0.02em; }
  #pip .meter-cell i { font-style: normal; font-size: 9px; letter-spacing: 0.18em; color: var(--pip-dim-text); }
  #pip .lines { margin: 0; padding: 0; list-style: none; font-size: 11px; }
  #pip .lines li { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; border-bottom: 1px dotted var(--pip-dark); }
  #pip .lines li span:last-child { color: var(--pip-bright); white-space: nowrap; }
  #pip .lines li.usage { color: var(--pip-dim-text); }
  #pip .lines li.usage span:last-child { color: var(--pip-dim-text); }
  #pip .lines li span:first-child { overflow-wrap: anywhere; }
  #pip .src { font-size: 10px; color: var(--pip-dim-text); letter-spacing: 0.04em; }
  #pip .needs { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; font-size: 10px; letter-spacing: 0.14em; color: var(--pip-dim-text); }
  #pip .need { padding: 0 5px; color: var(--world-amber); border: 1px solid var(--case-brass-lo); background: none; font: inherit; letter-spacing: inherit; cursor: pointer; }
  #pip .need.unknown { opacity: 0.7; }
  #pip .need.ok { color: #7ee08a; border-color: #3f8f4a; }
  #pip .need.missing { color: #ff7a6b; border-color: #b4483c; }
  #pip .sbundle { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 11px; border: 1px dashed var(--case-brass-lo); padding: 4px 6px; }
  #pip .sbundle b { letter-spacing: 0.14em; color: var(--world-amber); }
  #pip .sbundle .sb-plan { flex-basis: 100%; color: var(--pip-dim-text); }
  #pip .sbundle .sb-plan.refused { color: #ff7a6b; }
  #pip .need-why { flex-basis: 100%; color: #ff7a6b; font-style: normal; letter-spacing: 0.04em; }
  #pip .need::before { content: ""; display: inline-block; width: 5px; height: 5px; margin-right: 4px; vertical-align: 1px; background: var(--world-amber); box-shadow: 0 0 4px var(--world-amber); }
  #pip .pdiv {
    display: flex; align-items: center; gap: 8px; margin: 10px 8px 6px; padding: 3px 8px;
    color: var(--case-brass); font-size: 11px; letter-spacing: 0.2em; border-top: 2px double var(--case-brass-lo); border-bottom: 1px solid var(--case-brass-lo);
  }
  #pip .pdiv .ro { margin-left: auto; font-size: 9px; color: var(--pip-dim-text); letter-spacing: 0.16em; }
  #pip .card.tf { border-color: var(--case-brass-lo); }
  #pip .card.tf.open .card-head, #pip .card.tf .card-head:hover { background: var(--case-brass); }
  #pip .tf-state { color: var(--pip-bright); font-size: 12px; }
  #pip .tf-state.off { color: var(--world-amber); }
  #pip .tf-state.fail { color: var(--status-broken); }
  #pip .cmds { display: flex; flex-direction: column; gap: 3px; }
  #pip .cmdrow { display: grid; grid-template-columns: 52px 1fr auto; gap: 6px; align-items: center; padding: 2px 3px; background: var(--pip-screen); border: 1px solid var(--pip-dark); }
  #pip .cmdrow .lbl { font-size: 9px; letter-spacing: 0.16em; color: var(--pip-dim-text); }
  #pip .cmdrow.destroy .lbl { color: var(--status-broken); }
  #pip .cmdrow code { font: inherit; font-size: 11px; color: var(--pip-bright); overflow-wrap: anywhere; }
  #pip .cmdrow .copy { min-height: 22px; padding: 0 6px; font-size: 10px; letter-spacing: 0.12em; }
  /* Cluster add-ons: a riveted plate per cluster, add-on rows hung under it. */
  #pip .pdiv.addons { color: var(--pip-bright); border-top-color: var(--pip-dim); border-bottom-color: var(--pip-dim); }
  #pip .pdiv.addons img { image-rendering: pixelated; }
  #pip .ad-cluster { margin: 0 8px 8px; border: 2px solid var(--pip-dim); background: var(--pip-ink); box-shadow: inset 0 0 14px var(--glow-soft); }
  #pip .ad-cluster.gone { border-style: dashed; border-color: var(--pip-dark); box-shadow: none; }
  #pip .ad-plate {
    display: flex; align-items: center; gap: 8px; padding: 4px 8px; font-size: 12px; letter-spacing: 0.08em;
    background: linear-gradient(var(--plate-steel), var(--case-lo)); color: var(--plate-stencil); border-bottom: 2px solid var(--pip-dark);
    box-shadow: inset 0 1px 0 var(--btn-rim-hi);
  }
  #pip .ad-plate::before, #pip .ad-plate::after { content: ""; width: 5px; height: 5px; flex: 0 0 auto; background: var(--case-screw); box-shadow: inset -1px -1px 0 var(--case-lo); }
  #pip .ad-plate::after { order: 9; }
  #pip .ad-plate img { image-rendering: pixelated; }
  #pip .ad-plate b { font-weight: normal; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #pip .ad-live { font-size: 9px; letter-spacing: 0.16em; padding: 0 4px; border: 1px solid var(--pip-dark); background: var(--pip-ink); }
  #pip .ad-live.on { color: var(--pip-bright); box-shadow: 0 0 6px var(--glow-soft); }
  #pip .ad-live.off { color: var(--pip-dim-text); }
  #pip .ad-count { font-size: 9px; letter-spacing: 0.12em; }
  #pip .ad-rows { position: relative; padding: 6px 0 2px 14px; }
  #pip .ad-rows::before { content: ""; position: absolute; left: 10px; top: 0; bottom: 14px; border-left: 2px dotted var(--pip-dark); }
  #pip .card.addon { position: relative; margin: 0 8px 4px 6px; background: var(--pip-screen); }
  #pip .card.addon::before { content: ""; position: absolute; left: -10px; top: 15px; width: 9px; border-top: 2px dotted var(--pip-dark); }
  #pip .card.addon.installed { border-color: var(--pip-dim); }
  #pip .card.addon.present { border-color: var(--status-hang); }
  #pip .card.addon.na { opacity: 0.7; border-style: dashed; }
  #pip .addon-head { min-height: 30px; gap: 8px; font-size: 12px; }
  #pip .addon-head:disabled { cursor: default; }
  #pip .addon-head:disabled:hover { color: var(--pip-mid); background: transparent; }
  #pip .addon-head:disabled:hover img { filter: none; }
  #pip .ad-name { display: flex; flex-direction: column; flex: 1 1 auto; min-width: 0; }
  #pip .ad-ver { font-size: 10px; letter-spacing: 0.04em; text-transform: none; color: var(--pip-dim-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #pip .card-head:hover .ad-ver, #pip .card.open .card-head .ad-ver { color: var(--pip-ink); }
  #pip .ad-state { display: inline-flex; align-items: center; gap: 5px; flex: 0 0 auto; padding: 1px 5px; font-size: 9px; letter-spacing: 0.14em; color: var(--pip-dim-text); background: var(--pip-ink); border: 1px solid var(--pip-dark); }
  #pip .ad-state i { width: 7px; height: 7px; background: var(--lamp-off); box-shadow: inset 0 0 0 1px var(--btn-rim); }
  #pip .ad-state b { font-weight: normal; }
  #pip .ad-state.on { color: var(--pip-bright); }
  #pip .ad-state.on i { background: var(--lamp-on); box-shadow: 0 0 5px var(--btn-glow), inset 0 0 0 1px var(--lamp-on-core); }
  #pip .ad-state.warn { color: var(--status-hang); border-color: var(--status-hang); }
  #pip .ad-state.warn i { background: var(--status-hang); box-shadow: 0 0 5px var(--status-hang); }
  #pip .ad-state.na { color: var(--world-amber); }
  #pip .ad-state.na i { background: var(--case-brass-lo); }
  #pip .ad-tags { display: flex; flex-wrap: wrap; gap: 4px; padding: 0 8px 4px 32px; }
  #pip .ad-tag { font-size: 9px; letter-spacing: 0.12em; padding: 0 4px; color: var(--world-amber); border: 1px solid var(--case-brass-lo); }
  #pip .ad-tag.warn { color: var(--status-hang); border-color: var(--status-hang); }
  #pip .ad-tag.dim { color: var(--pip-dim-text); border-color: var(--pip-dark); }
  #pip .nodebill { padding: 4px 6px; border: 1px dashed var(--pip-dim); }
  #pip .nodebill-head { display: flex; align-items: center; gap: 6px; font-size: 10px; letter-spacing: 0.14em; color: var(--pip-dim-text); }
  #pip .nodebill-head img { image-rendering: pixelated; }
  #pip .nodebill-head b { margin-left: auto; font-weight: normal; color: var(--pip-bright); letter-spacing: 0.02em; }
  #pip input[readonly] { color: var(--pip-dim-text); border-style: dashed; }
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
  .term-note { margin: 0; padding: 4px 10px; flex: none; color: var(--pip-dim-text); font-size: 11px; letter-spacing: 0.08em; border-bottom: 1px dashed var(--pip-dark); }
  .term-log { flex: 1; min-height: 0; overflow: auto; padding: 8px 10px; scrollbar-width: thin; scrollbar-color: var(--pip-dim) var(--pip-ink); }
  .term-log p { margin: 0 0 6px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .term-hello p { color: var(--pip-mid); }
  .term-entry { margin-bottom: 12px; }
  .term-q { color: var(--pip-hot); }
  .term-text { color: var(--pip-bright); }
  .term-tool { color: var(--pip-dim-text); font-size: 11px; }
  .term-thinking { margin: 2px 0 6px; }
  .term-think-line { color: var(--pip-mid); letter-spacing: 0.12em; font-size: 12px; }
  .term-think-text { color: var(--pip-dim-text); font-size: 11px; font-style: italic; opacity: 0.8; max-height: 4.5em; overflow: hidden; }
  .term-cursor { display: inline-block; width: 0.6em; height: 1.05em; vertical-align: text-bottom; background: var(--pip-bright); box-shadow: 0 0 6px var(--glow-bright); animation: vault-blink 1s steps(2) infinite; }
  .term-block { margin: 4px 0 8px; border: 1px solid var(--pip-dim); background: rgba(0, 0, 0, 0.35); }
  .term-block.actions { border-color: var(--pip-mid); }
  .term-block-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 2px 2px 2px 8px; color: var(--pip-dim-text); font-size: 11px; letter-spacing: 0.1em; border-bottom: 1px dashed var(--pip-dark); }
  .term-block pre { margin: 0; padding: 6px 8px; overflow-x: auto; white-space: pre; color: var(--pip-hot); font: inherit; font-size: 12px; }
  .term-actions { display: flex; flex-wrap: wrap; gap: 6px; padding: 6px 8px; border-top: 1px dashed var(--pip-dark); }
  #term .cmd { min-height: 26px; padding: 0 8px; font-size: 11px; letter-spacing: 0.1em; }
  .term-act { border-color: var(--status-hang); color: var(--status-hang); }
  .term-act:hover { background: var(--status-hang); color: var(--pip-ink); }
  .term-error { display: flex; flex-direction: column; gap: 4px; margin: 6px 0; padding: 6px 8px; border: 1px solid var(--status-broken); color: var(--status-broken); }
  .term-error.cancelled { border-color: var(--pip-dim); color: var(--pip-dim-text); }
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
  .ptitle span[data-pro-label] { margin-left: 0; font-size: inherit; letter-spacing: inherit; }
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
  .dial .nums { position: absolute; left: 0; right: 0; bottom: 2px; display: flex; justify-content: space-between; font-size: 9px; color: var(--pip-dim-text); }
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
  #radio li:focus-visible { outline: 2px solid var(--pip-hot); outline-offset: -2px; }
  #radio li time { flex: 0 0 auto; color: var(--pip-dim-text); font-size: 11px; }
  #radio li.fail { color: var(--status-broken); }
  #radio li.fail time { color: var(--status-broken); opacity: 0.75; }
  #radio-panel.issue .ptitle { background: var(--status-broken); }
  .key.issue .cap::after { background: radial-gradient(circle at 40% 35%, var(--lamp-on-core), var(--status-broken) 55%) !important; box-shadow: 0 0 0 1px var(--btn-rim), 0 0 6px var(--status-broken), 0 0 10px var(--status-broken) !important; }
  #radio li[aria-current="true"] { background: var(--pip-bright); color: var(--pip-ink); }
  #radio li[aria-current="true"] img { filter: brightness(0); }
  .quiet { color: var(--pip-dim-text); font-size: 12px; }

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
  /* Wide (review R6): no row for the gauges alone. 1600-1839: two full rows,
     plate / tabs / console, then tally / CAPS / readout / knobs (the readout
     used to wrap onto a row of its own here, three rows in all). */
  @media (min-width: 1600px) {
    .gauges { display: contents; }
    header::after { content: ""; order: 9; flex-basis: 100%; height: 0; }
    #tally { order: 10; flex: 1 1 320px; }
    #corner { order: 11; flex: 0 1 260px; }
    .readout { order: 12; }
    .knobs { order: 13; }
  }
  /* >=1840: one row. CAPS sits between the console and the readout; the
     tally moves to the terminal line (browser.js placeTally), right side. */
  @media (min-width: 1840px) {
    header::after { display: none; }
    header { gap: 10px 12px; }
    .plate { padding-right: 10px; }
    h1 { letter-spacing: 0.12em; }
    .plate small { letter-spacing: 0.12em; }
    .tabs { gap: 4px; padding-left: 7px; padding-right: 7px; }
    .tab { gap: 5px; padding: 0 6px; letter-spacing: 0.06em; }
    .console { gap: 8px; padding-left: 7px; padding-right: 7px; }
    /* Six console keys since SCORE: slightly tighter tabs, console and knobs
       keep the one row at 1920 with the cost box as wide as before (it
       already wrapped at 1840 before). */
    .keys { gap: 4px; }
    .knobs { gap: 6px; }
    #corner { order: 4; flex: 1 1 140px; min-width: 130px; max-width: 320px; margin-left: auto; }
    .readout { order: 5; margin-left: 0; }
    .knobs { order: 6; }
    .terminal #tally { order: 20; flex: 0 1 auto; max-width: 52%; height: 30px; margin-left: auto; font-size: 12px; }
  }
  /* Laptop (1280-ish): with a Menlo-width font (the Mac fallback when Share
     Tech Mono and VT323 are not installed) the plate, the four view tabs and
     the console no longer fit on one row and the header wraps to three rows.
     Tighten the spacing so it stays two rows: plate, tabs, console / gauges,
     readout, knobs. */
  @media (max-width: 1399px) {
    header { gap: 10px 12px; padding-left: 10px; padding-right: 10px; }
    .plate { padding-right: 10px; }
    h1 { letter-spacing: 0.12em; }
    .plate small { letter-spacing: 0.12em; }
    .tabs { gap: 6px; padding-left: 7px; padding-right: 7px; }
    .tab { gap: 5px; padding: 0 8px; letter-spacing: 0.06em; }
    .console { gap: 10px; padding-left: 9px; padding-right: 9px; }
    .keys { gap: 7px; }
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
    /* Narrow (review R3): the tally and the bill share one row under the
       readout, instead of a row each. */
    .gauges { display: contents; }
    .readout { order: 8; }
    #tally { order: 9; flex: 1 1 240px; }
    #corner { order: 10; flex: 0 1 230px; min-width: 150px; margin-left: auto; }
    /* An open LEARN, STACKS or ASK panel covers the morning report: the
       report gives its row to the panel. */
    .screen:has(#learn:not([hidden]), #pip:not([hidden]), #term:not([hidden])) #morning { display: none; }
    .body { flex-direction: column; }
    #radio-panel { flex: 0 0 180px; border-left: 0; border-top: 2px solid var(--pip-dark); }
    .scope, .dial { display: none; }
  }
  @media (max-height: 700px) {
    .porthole { width: 36px; height: 36px; }
    #mascot { width: 26px; height: 24px; }
    .tab { min-height: 30px; }
    .switch { min-height: 36px; }
    .statusbar { display: none; }
  }
  /* ---- settings: gear + panel (settings-view.js), both themes, role tokens ---- */
  .gear { flex: none; display: grid; place-items: center; width: 32px; height: 32px; padding: 0; border-radius: 6px; border: 1px solid var(--border); background: var(--raised); color: var(--text-2); cursor: pointer; }
  .gear:hover, .gear[aria-expanded="true"] { color: var(--text); border-color: var(--border-strong); background: var(--hover); }
  .gear:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  #settings { position: fixed; top: 70px; right: 18px; z-index: 60; width: min(580px, calc(100vw - 36px)); max-height: calc(100vh - 96px); overflow: auto; padding: 4px 18px 16px; background: var(--raised); color: var(--text); border: 1px solid var(--border-strong); border-radius: 10px; box-shadow: 0 18px 44px rgba(0, 0, 0, 0.6); font: 13px/1.45 var(--font-ui); }
  #settings .st-head { display: flex; align-items: center; justify-content: space-between; padding: 10px 0 6px; border-bottom: 1px solid var(--border); }
  #settings h2 { margin: 0; font-size: 15px; font-weight: 600; }
  #settings h3 { margin: 14px 0 8px; font-size: 12px; font-weight: 500; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.06em; }
  #settings .st-close { width: 28px; height: 28px; border: 1px solid var(--border); border-radius: 6px; background: none; color: var(--text-2); font-size: 18px; line-height: 1; cursor: pointer; }
  #settings .st-close:hover { color: var(--text); background: var(--hover); }
  #settings .st-seg { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  #settings .st-opt { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); font: inherit; text-align: left; cursor: pointer; }
  #settings .st-opt small { color: var(--text-3); }
  #settings .st-opt:hover { border-color: var(--border-strong); }
  #settings .st-opt[aria-checked="true"] { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  #settings .st-opt:focus-visible, #settings button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  #settings .st-note { margin: 8px 0 0; color: var(--text-2); font-size: 12px; }
  #settings .st-warn { color: var(--warn); }
  #settings .st-link { padding: 0; border: 0; background: none; color: var(--accent); font: inherit; text-decoration: underline; cursor: pointer; }
  #settings .st-table { width: 100%; margin-top: 8px; border-collapse: collapse; font: 12px/1.4 var(--font-mono); }
  #settings .st-table th { text-align: left; font-weight: 500; color: var(--text-3); padding: 5px 6px; border-bottom: 1px solid var(--border); }
  #settings .st-table td { padding: 4px 6px; border-bottom: 1px solid var(--border); color: var(--text); word-break: break-all; }
  #settings .st-table td.st-default, #settings .st-table td.st-set { white-space: nowrap; word-break: normal; }
  #settings .st-table td.st-default { color: var(--text-3); }
  /* Config keys never break mid-word (ui.refresh.radioSeconds); values may. */
  #settings .st-table td:first-child { white-space: nowrap; word-break: normal; }
  #settings .st-table td.st-set { color: var(--accent); }
  #settings .st-mods { list-style: none; margin: 8px 0 0; padding: 0; display: grid; gap: 4px; }
  #settings .st-mods label { display: grid; grid-template-columns: 18px 110px 1fr; gap: 8px; align-items: baseline; font-size: 12px; color: var(--text); cursor: pointer; }
  #settings .st-mods input { margin: 0; align-self: center; }
  #settings .st-mods label > * { align-self: center; }
  /* each part keeps its column even when the box is hidden (an off module) */
  #settings .st-mods input { grid-column: 1; }
  #settings .st-mods b { font-weight: 600; grid-column: 2; min-width: 0; overflow-wrap: anywhere; }
  #settings .st-mods small { grid-column: 3; min-width: 0; }
  #settings .st-mods small { color: var(--text-3); }
  #settings .st-mods .st-off label { color: var(--text-3); cursor: default; }
  #settings .st-yaml { margin: 8px 0 0; padding: 8px; border: 1px solid var(--border); border-radius: 4px; background: var(--surface); color: var(--text); font: 12px/1.4 var(--font-mono); white-space: pre-wrap; }

  /* ---- pro theme (phase 1): the same page, flat and quiet. Colours come
     from the role tokens and the remapped ramp (theme.js); this block only
     takes away the device: bezels, glows, scanlines, lamps and stencils.
     Canvases still draw the Pip art until the canvas phases. ---- */
  :root[data-theme="pro"] * { text-shadow: none !important; }
  :root[data-theme="pro"] body { padding: 0; background: var(--bg); color: var(--text); font: 400 13px/1.45 var(--font-ui); text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; }
  :root[data-theme="pro"] :is(pre, code, kbd, samp, textarea, output, .lcd, #status, #radio, #k9s, #term, .run-out, #spend-lines) { font-family: var(--font-mono); }
  :root[data-theme="pro"] .device { padding: 0 12px 10px; gap: 10px; border-radius: 0; background: var(--bg); box-shadow: none; }
  :root[data-theme="pro"] header { margin: 0 -12px; padding: 8px 16px; gap: 8px 14px; border-radius: 0; background: var(--raised); box-shadow: none; border-bottom: 1px solid var(--border); }
  :root[data-theme="pro"] :is(.knobs, .plate small, .tab::before, .tab::after, .key .cap::before, .key .cap::after, .switch .well, .switch .marks, #term::after) { display: none; }
  :root[data-theme="pro"] .plate { padding: 0; gap: 10px; border: 0; background: none; box-shadow: none; }
  :root[data-theme="pro"] .plate h1 { margin: 0; font: 600 15px/1 var(--font-ui); letter-spacing: -0.01em; color: var(--text); }
  :root[data-theme="pro"] .porthole { width: 28px; height: 28px; border-radius: 7px; border: 0; background: linear-gradient(135deg, var(--accent), var(--ok)); box-shadow: none; }
  :root[data-theme="pro"] .porthole:hover { box-shadow: 0 0 0 2px var(--border-strong); }
  :root[data-theme="pro"] :is(.tabs, .keys, .console, .readout, .gauges) { padding: 0; border: 0; background: none; box-shadow: none; }
  :root[data-theme="pro"] .tabs { gap: 2px; }
  :root[data-theme="pro"] :is(.tab, .key) { height: auto; min-height: 0; padding: 6px 10px; border: 1px solid transparent; border-radius: 6px; background: none; box-shadow: none; color: var(--text-2); font: 500 13px/1.2 var(--font-ui); letter-spacing: 0; text-transform: none; transform: none; }
  :root[data-theme="pro"] .key { display: inline-flex; flex-direction: row; align-items: center; gap: 6px; width: auto; }
  :root[data-theme="pro"] .key .cap { width: auto; height: auto; padding: 0; border: 0; background: none; box-shadow: none; }
  :root[data-theme="pro"] .key .tag { position: static; padding: 0; border: 0; background: none; box-shadow: none; color: inherit; font: inherit; letter-spacing: 0; text-transform: none; }
  :root[data-theme="pro"] :is(.tab, .key):hover { background: var(--hover); color: var(--text); }
  :root[data-theme="pro"] :is(.tab[aria-pressed="true"], .key[aria-pressed="true"]) { background: var(--surface-2); color: var(--text); border-color: var(--border); box-shadow: none; }
  :root[data-theme="pro"] :is(.tab, .key, .switch, .lcd, button):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  /* Pixel icons stay until the icon phase; neutral grey reads as an icon set. */
  :root[data-theme="pro"] :is(.tab img, .key .cap img, img.px) { width: 16px; height: 16px; opacity: 0.75 !important; filter: grayscale(1) brightness(1.7) !important; }
  :root[data-theme="pro"] :is(.tab[aria-pressed="true"] img, .key[aria-pressed="true"] .cap img) { opacity: 1; }
  :root[data-theme="pro"] .switch { width: auto; height: auto; min-height: 0; display: inline-flex; align-items: center; gap: 8px; padding: 5px 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); box-shadow: none; }
  :root[data-theme="pro"] .switch .name { position: static; transform: none; color: var(--text-2); font: 500 12px var(--font-ui); letter-spacing: 0; }
  :root[data-theme="pro"] .switch .led { position: static; width: 8px; height: 8px; border: 0; border-radius: 50%; background: var(--text-3); box-shadow: none; }
  :root[data-theme="pro"] .switch[aria-checked="true"] { border-color: var(--warn); }
  :root[data-theme="pro"] .switch[aria-checked="true"] .led { background: var(--warn); box-shadow: 0 0 0 3px rgba(245, 184, 74, 0.15); }
  :root[data-theme="pro"] .lcd { padding: 5px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--surface); box-shadow: none; color: var(--text); font-size: 12px; letter-spacing: 0; }
  :root[data-theme="pro"] #spend > b { display: none; }
  :root[data-theme="pro"] #mascot { display: none; }
  :root[data-theme="pro"] .porthole .pro-mark { display: grid; }
  .porthole .pro-mark { display: none; place-items: center; width: 100%; height: 100%; color: var(--bg); }
  :root[data-theme="pro"] .readout { gap: 12px; color: var(--text-2); font: 500 12px var(--font-ui); letter-spacing: 0; }
  :root[data-theme="pro"] .readout b { color: var(--text-3); font-weight: 500; }
  :root[data-theme="pro"] select, :root[data-theme="pro"] input { border: 1px solid var(--border); border-radius: 6px; background: var(--bg); color: var(--text); font: 13px var(--font-ui); box-shadow: none; }
  /* Pro: panels over the map are solid, and the PULUMI / TF engine tag keeps a face once its gradient is dropped */
  :root[data-theme="pro"] :is(#pip, .vault-panel) { background-color: var(--raised); }
  :root[data-theme="pro"] #pip .eng { color: var(--text, #e6e8eb); background-color: var(--surface); border: 1px solid var(--border); border-radius: 4px; }
  :root[data-theme="pro"] #pip .eng.tf { color: #0b0d10; background-color: #d9b45a; border-color: #d9b45a; }
  :root[data-theme="pro"] :is(.glass, #morning, .m-line, #spend-lines, .sp-head, #vault-page, .vpg-open, .kc-chip, #kube-connect .kc-fold, #kube-ctx button, #learn, .lx-shelf, #pip .eng, #pip .ad-plate, #term, .dial .scale, .runpane .run-out, #pip .meter-cell) { background-image: none; box-shadow: none; }
  :root[data-theme="pro"] .glass { display: none; }
  :root[data-theme="pro"] :is(#morning, #spend-lines, #learn, #term, #vault-page) { border-color: var(--border-strong); border-radius: 10px; background-color: var(--raised); }
  :root[data-theme="pro"] #spend-lines { box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5); }
  :root[data-theme="pro"] #kube-ctx button[aria-pressed="true"] { background: var(--surface-2); box-shadow: none; }
  :root[data-theme="pro"] #sunrise { display: none; }
  :root[data-theme="pro"] .screen { border-radius: 10px; background: var(--raised); box-shadow: 0 0 0 1px var(--border); }
  :root[data-theme="pro"] .terminal { border-bottom: 1px solid var(--border); background: none; }
  :root[data-theme="pro"] .statusbar { border-top: 1px solid var(--border); letter-spacing: 0; }
  :root[data-theme="pro"] .statusbar span { border-radius: 999px; background: var(--surface-2); color: var(--text-2); font: 500 12px var(--font-ui); }
  :root[data-theme="pro"] .ptitle { background: var(--raised); color: var(--text); border-bottom: 1px solid var(--border); font: 600 13px var(--font-ui); letter-spacing: 0; text-transform: none; }
  :root[data-theme="pro"] #radio-panel.issue .ptitle { background: var(--raised); box-shadow: inset 3px 0 0 var(--err); }
  /* Pro: perks as a quiet list with icons; no medallions, no glow. */
  :root[data-theme="pro"] :is(.pk-vault, .pk-open, .pk-drawer, .pk-medal, .pk-score, .pk-meter i, .pk-app, .vpg-home) { background: none; box-shadow: none; text-shadow: none; filter: none; }
  :root[data-theme="pro"] .pk-vault { border: 1px solid var(--border); border-radius: 10px; background: var(--surface); padding: 14px 16px; }
  :root[data-theme="pro"] :is(.vpg-section, .pk-label, .pk-kicker, .pk-tally, .pk-state, .pk-fact dt, .pk-install) { color: var(--text-3); letter-spacing: 0.02em; font: 500 12px var(--font-ui); text-transform: none; }
  :root[data-theme="pro"] .vpg-section::after { background: var(--border); height: 1px; }
  :root[data-theme="pro"] .pk-title h3, :root[data-theme="pro"] .pk-dwords h4 { color: var(--text); font: 600 16px var(--font-ui); letter-spacing: 0; }
  :root[data-theme="pro"] .pk-head .vpg-door { display: none; }
  :root[data-theme="pro"] .pk-meter i { height: 6px; border: 0; border-radius: 3px; background: var(--surface-2); }
  :root[data-theme="pro"] .pk-meter i.unlocked { background: var(--ok, #3fb950); }
  :root[data-theme="pro"] .pk-meter i.unlocked.warn { background: var(--warn); }
  :root[data-theme="pro"] .pk-score { width: auto; height: auto; border-radius: 6px; border: 1px solid var(--border); padding: 4px 10px; display: flex; gap: 6px; align-items: baseline; }
  :root[data-theme="pro"] .pk-score small { margin: 0; color: var(--text-3); letter-spacing: 0; }
  :root[data-theme="pro"] .pk-score b { color: var(--text); font: 600 15px var(--font-ui); }
  :root[data-theme="pro"] :is(.pk-app, .vpg-home) { color: var(--text-2); border: 1px solid var(--border); border-radius: 999px; font: 12px var(--font-ui); letter-spacing: 0; }
  :root[data-theme="pro"] .pk-grid { display: block; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  :root[data-theme="pro"] .pk-card + .pk-card { border-top: 1px solid var(--border); }
  :root[data-theme="pro"] .pk-open { display: grid; grid-template-columns: 24px minmax(120px, 0.9fr) minmax(0, 2fr) auto auto; grid-template-rows: auto; align-items: center; column-gap: 12px; padding: 8px 12px; border: 0; border-radius: 0; color: var(--text-2); font: 13px var(--font-ui); }
  :root[data-theme="pro"] .pk-open:hover, :root[data-theme="pro"] .pk-card.sel .pk-open { background: var(--hover); box-shadow: none; }
  :root[data-theme="pro"] .pk-medal { grid-row: auto; width: 20px; height: 20px; border-radius: 0; }
  :root[data-theme="pro"] .pk-medal .pk-icon { width: 20px; height: 20px; }
  :root[data-theme="pro"] .pk-medal.big, :root[data-theme="pro"] .pk-medal.big .pk-icon { width: 32px; height: 32px; }
  :root[data-theme="pro"] .pk-rank { grid-column: 4; grid-row: 1; margin: 0; }
  :root[data-theme="pro"] .pk-rank i { transform: none; width: 6px; height: 6px; border-radius: 50%; border: 0; background: var(--surface-2); box-shadow: none; }
  :root[data-theme="pro"] .pk-rank i.on { background: var(--accent); }
  :root[data-theme="pro"] .pk-name { grid-column: 2; grid-row: 1; color: var(--text); font: 500 13px var(--font-ui); letter-spacing: 0; }
  :root[data-theme="pro"] .pk-effect { grid-column: 3; grid-row: 1; margin: 0; color: var(--text-2); font-size: 12px; }
  :root[data-theme="pro"] .pk-state { grid-column: 5; grid-row: 1; margin: 0; padding: 0; border: 0; min-width: 130px; }
  :root[data-theme="pro"] .pk-card.ok .pk-state i { background: var(--ok, #3fb950); box-shadow: none; }
  :root[data-theme="pro"] .pk-card.warn .pk-state i { background: var(--warn); box-shadow: none; }
  :root[data-theme="pro"] .pk-card.warn .pk-state, :root[data-theme="pro"] .pk-card.ok .pk-state { color: var(--text-2); }
  :root[data-theme="pro"] .pk-grid.avail .pk-open { background: none; opacity: 0.8; }
  :root[data-theme="pro"] .pk-install { display: none; }
  :root[data-theme="pro"] .pk-drawer { border: 1px solid var(--border-strong); border-radius: 8px; background: var(--raised); }
  :root[data-theme="pro"] .pk-deffect { color: var(--text-2); }
  :root[data-theme="pro"] .pk-fact { border-bottom: 1px solid var(--border); }
  :root[data-theme="pro"] .pk-fact dd { color: var(--text); font: 13px var(--font-ui); }
  :root[data-theme="pro"] .pk-actions .pk-primary { background: var(--accent); border-color: var(--accent); color: var(--bg); }
  @media (max-width: 760px) { :root[data-theme="pro"] .pk-open { grid-template-columns: 24px 1fr auto; row-gap: 2px; } :root[data-theme="pro"] .pk-effect { grid-column: 2 / -1; grid-row: 2; } :root[data-theme="pro"] .pk-rank { grid-column: 3; } :root[data-theme="pro"] .pk-state { grid-column: 2 / -1; grid-row: 3; } }
  :root[data-theme="pro"] :is(.alr-bar, .alr-panel, .alb-exposed) { background: var(--raised); box-shadow: 0 4px 12px rgba(0, 0, 0, 0.35); border: 1px solid var(--border-strong); color: var(--text-2); font: 12px var(--font-ui); letter-spacing: 0; }
  :root[data-theme="pro"] .alr-bar { border-top: 0; border-radius: 0 0 6px 6px; }
  :root[data-theme="pro"] .alb-exposed { border-top: 0; border-radius: 0 0 6px 6px; }
  :root[data-theme="pro"] .alb-exposed:hover { background: var(--hover); color: var(--text); }
  :root[data-theme="pro"] .alr-panel { border-radius: 8px; }
  /* ---- pro polish (2026-10-12): buttons, narrow windows ---- */
  /* Commands are quiet outlined buttons: no [ ] stencil, no caps lock. */
  :root[data-theme="pro"] :is(button.cmd, a.cmd)::before, :root[data-theme="pro"] :is(button.cmd, a.cmd)::after { content: none; }
  :root[data-theme="pro"] :is(button.cmd, a.cmd) { padding: 5px 10px; border: 1px solid var(--border-strong); border-radius: 6px; background: var(--surface); color: var(--text); font: 500 12px/1.2 var(--font-ui); letter-spacing: 0; text-transform: none; box-shadow: none; }
  :root[data-theme="pro"] :is(button.cmd, a.cmd):hover { background: var(--hover); color: var(--text); border-color: var(--text-3); }
  :root[data-theme="pro"] button.cmd:hover img { filter: grayscale(1) brightness(1.7); }
  :root[data-theme="pro"] :is(button.cmd, a.cmd)[aria-pressed="true"] { background: var(--surface-2); border-color: var(--accent); color: var(--text); }
  :root[data-theme="pro"] button.cmd.danger { border-color: rgba(242, 85, 90, 0.5); color: var(--err); }
  :root[data-theme="pro"] button.cmd.danger:hover { background: rgba(242, 85, 90, 0.12); }
  /* Narrow windows: the action keys go icon-only and MODE/TIME step aside,
     so the header is two rows, not four. */
  @media (max-width: 1000px) {
    :root[data-theme="pro"] .key .tag { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
    :root[data-theme="pro"] .key { padding: 6px 8px; }
    :root[data-theme="pro"] .readout > span { display: none; }
    :root[data-theme="pro"] header { gap: 6px 8px; padding: 6px 10px; }
  }
  /* <=900 the base narrow rule (review R3) gives the tally 240px and the
     bill 230px after the readout, so in pro (slim keys) the bill wrapped to
     a third row. Put the tally and the bill on row two, sharing it. */
  @media (max-width: 900px) {
    :root[data-theme="pro"] .readout { order: 3; }
    :root[data-theme="pro"] #tally { order: 9; flex: 1 1 0; min-width: 0; height: 34px; font-size: 12px; }
    :root[data-theme="pro"] #corner { order: 10; flex: 0 1 180px; min-width: 120px; margin-left: 0; }
    :root[data-theme="pro"] #spend { height: 34px; font-size: 12px; }
    :root[data-theme="pro"] .readout label { font-size: 0; gap: 0; }
    :root[data-theme="pro"] .readout select { font-size: 12px; }
    /* k9s: the NODE column fits; long pod names give way first. */
    :root[data-theme="pro"] .k9-table :is(th, td) { padding-left: 6px; padding-right: 6px; }
    :root[data-theme="pro"] .k9-table td:nth-child(2) { max-width: 210px; }
  }
  /* Vault panel title: the pip phosphor gradient was a light grey slab in pro. */
  :root[data-theme="pro"] .vp-title { margin: 0; padding: 8px 12px; color: var(--text); background: var(--surface-2); border-bottom: 1px solid var(--border); letter-spacing: 0.02em; font-weight: 600; }
  :root[data-theme="pro"] .vp-title img { filter: none; opacity: 0.85; }
  :root[data-theme="pro"] .vault-panel.damaged .vp-title { color: var(--err); background: var(--surface-2); box-shadow: inset 3px 0 0 var(--err); }
  /* Vault pages in pro: no pip corner brackets, a card border, real badges. */
  :root[data-theme="pro"] :is(.vpg-open, .vault-panel)::before, :root[data-theme="pro"] :is(.vpg-open, .vault-panel)::after { content: none; }
  :root[data-theme="pro"] .vpg-open { border: 1px solid var(--border); border-radius: 10px; background: var(--raised); }
  :root[data-theme="pro"] .vpg-open:hover, :root[data-theme="pro"] .vpg-open:focus-visible { border-color: var(--accent); background: var(--hover); }
  :root[data-theme="pro"] .vault-panel { border: 1px solid var(--border); border-radius: 10px; background: var(--raised); color: var(--text-2); box-shadow: none; overflow: hidden; }
  :root[data-theme="pro"] .vpg-stack { padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; letter-spacing: 0.04em; color: var(--text-3); background: var(--surface-2); border: 1px solid var(--border); box-shadow: none; }
  :root[data-theme="pro"] .vpg-stack.live { color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); border-color: color-mix(in srgb, var(--ok) 45%, transparent); }
  :root[data-theme="pro"] .vpg-stack.down { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); }
  :root[data-theme="pro"] .vpg-stack.error { color: var(--err); border-color: color-mix(in srgb, var(--err) 45%, transparent); }
  /* The CAPS head is sticky: in pro it lost its gradient and went see-through, so the pace line showed under the total. */
  :root[data-theme="pro"] .sp-head { background-color: var(--raised); }
  /* SERVICES prototype in pro: flat cards, accent focus, no brackets or glow. */
  :root[data-theme="pro"] #kube-graph { background: var(--bg); color: var(--text-2); font-family: var(--font-ui); font-size: 12px; }
  :root[data-theme="pro"] #kube-empty { background: var(--bg); color: var(--text-2); font-family: var(--font-ui); font-size: 13px; }
  :root[data-theme="pro"] #kube-empty .ke-title { color: var(--text); letter-spacing: 0; text-transform: none; font-weight: 600; }
  :root[data-theme="pro"] #kube-empty .ke-reason { color: var(--warn); }
  :root[data-theme="pro"] #kube-empty .ke-step { border: 1px solid var(--border); border-radius: 6px; background: var(--raised); }
  :root[data-theme="pro"] #kube-empty .ke-step h3 { color: var(--text); font-weight: 600; }
  :root[data-theme="pro"] #kube-empty .ke-code { background: var(--surface); border-color: var(--border); border-radius: 4px; color: var(--text); font-family: var(--font-mono); }
  :root[data-theme="pro"] #kube-empty .ke-alt, :root[data-theme="pro"] #kube-empty .ke-note { color: var(--text-3); }
  :root[data-theme="pro"] #kube-empty .ke-btn { color: #fff; background: var(--accent); border-color: var(--accent); border-radius: 4px; letter-spacing: 0; }
  :root[data-theme="pro"] #kube-empty .ke-btn.ke-ghost { color: var(--text); background: transparent; border-color: var(--border-strong); }
  :root[data-theme="pro"] #kube-graph .gv-title b { color: var(--text); text-shadow: none; letter-spacing: 0.02em; font-weight: 600; }
  :root[data-theme="pro"] #kube-graph .gv-proto { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, transparent); border-radius: 999px; letter-spacing: 0.04em; font-weight: 600; }
  :root[data-theme="pro"] #kube-graph :is(.gv-btn, .gv-search, .gv-open, .gv-node) { border-radius: 6px; border-color: var(--border); background: var(--surface); color: var(--text-2); letter-spacing: 0.02em; }
  :root[data-theme="pro"] #kube-graph .gv-btn[aria-pressed="true"] { background: var(--surface-2); color: var(--text); border-color: var(--accent); box-shadow: none; }
  :root[data-theme="pro"] #kube-graph .gv-search { color: var(--text); }
  :root[data-theme="pro"] #kube-graph .gv-search:focus { border-color: var(--accent); box-shadow: none; }
  :root[data-theme="pro"] #kube-groupby b { color: var(--text-2); font-family: var(--font-ui); font-weight: 500; letter-spacing: 0.04em; }
  :root[data-theme="pro"] #kube-groupby :is(select, input) { color: var(--text); background: var(--raised); border: 1px solid var(--border); border-radius: 6px; font-family: var(--font-ui); }
  :root[data-theme="pro"] #kube-groupby :is(select, input):focus { border-color: var(--accent); box-shadow: none; }
  :root[data-theme="pro"] #kube-groupby input.bad { border-color: var(--err); }
  :root[data-theme="pro"] #kube-graph .gv-gblabel { color: var(--text-2); font-family: var(--font-ui); letter-spacing: 0.04em; font-weight: 500; }
  :root[data-theme="pro"] #kube-graph :is(.gv-gbsel, .gv-gbcustom) { color: var(--text); background: var(--raised); border: 1px solid var(--border); border-radius: 6px; font-family: var(--font-ui); }
  :root[data-theme="pro"] #kube-graph :is(.gv-gbsel, .gv-gbcustom):focus { border-color: var(--accent); box-shadow: none; }
  :root[data-theme="pro"] #kube-graph .gv-gbcustom.bad { border-color: var(--err); }
  :root[data-theme="pro"] #kube-graph .gv-stats { color: var(--text-3); letter-spacing: 0; }
  :root[data-theme="pro"] #kube-graph .gv-detail { color: var(--text); background: var(--surface); border-left-color: var(--accent); border-radius: 0 6px 6px 0; }
  :root[data-theme="pro"] #kube-graph .gv-band { border: 1px solid var(--border); border-radius: 10px; background: var(--raised); }
  :root[data-theme="pro"] #kube-graph .gv-blabel { color: var(--text-3); background: var(--bg); letter-spacing: 0.08em; font-weight: 600; border-radius: 4px; }
  :root[data-theme="pro"] #kube-graph .gv-group { background: var(--surface); border-color: var(--border); border-radius: 8px; box-shadow: none; }
  :root[data-theme="pro"] #kube-graph .gv-group::before, :root[data-theme="pro"] #kube-graph .gv-group::after { content: none; }
  :root[data-theme="pro"] #kube-graph .gv-group[data-health="broken"] { box-shadow: inset 3px 0 0 var(--err); border-color: var(--border); }
  :root[data-theme="pro"] #kube-graph .gv-group.focus { border-color: var(--accent); box-shadow: 0 0 0 1px var(--accent); }
  :root[data-theme="pro"] #kube-graph .gv-group.match { border-color: var(--warn); box-shadow: none; }
  :root[data-theme="pro"] #kube-graph .gv-ghead, :root[data-theme="pro"] #kube-graph .gv-node.sel { color: var(--text); }
  :root[data-theme="pro"] #kube-graph .gv-glabel { font-weight: 600; letter-spacing: 0; }
  :root[data-theme="pro"] #kube-graph .gv-lamp { background: var(--ok); box-shadow: none; }
  :root[data-theme="pro"] #kube-graph [data-health="hang"] .gv-lamp { background: var(--warn); box-shadow: none; }
  :root[data-theme="pro"] #kube-graph [data-health="broken"] .gv-lamp { background: var(--err); box-shadow: none; }
  :root[data-theme="pro"] #kube-graph :is(.gv-tag, .gv-ntag, .gv-etag) { border-radius: 4px; color: var(--text-2); background: var(--surface-2); font-weight: 600; }
  :root[data-theme="pro"] #kube-graph .gv-node.k-operator .gv-ntag { color: var(--accent); background: color-mix(in srgb, var(--accent) 15%, transparent); }
  :root[data-theme="pro"] #kube-graph .gv-node.k-cr .gv-ntag { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }
  :root[data-theme="pro"] #kube-graph .gv-node.k-db .gv-ntag { color: var(--info); background: color-mix(in srgb, var(--info) 14%, transparent); }
  :root[data-theme="pro"] #kube-graph .gv-node.sel { border-color: var(--accent); box-shadow: none; }
  :root[data-theme="pro"] #kube-graph :is(.gv-meta, .gv-ev time, .gv-tlhead, .gv-axis) { color: var(--text-3); }
  :root[data-theme="pro"] #kube-graph .gv-nodes { border-top-color: var(--border); }
  :root[data-theme="pro"] #kube-graph .gv-tlkeys, :root[data-theme="pro"] #kube-graph .gv-noev { color: var(--text-3); }
  :root[data-theme="pro"] #kube-graph .gv-edge { stroke: var(--text-3); }
  :root[data-theme="pro"] #kube-graph .gv-edge.s-trace { stroke: var(--accent); }
  :root[data-theme="pro"] #kube-graph .gv-edge.s-flow { stroke: var(--info); }
  :root[data-theme="pro"] #kube-graph .gv-edge.owns { stroke: var(--warn); }
  :root[data-theme="pro"] #kube-graph .gv-edge.err { stroke: var(--err); }
  :root[data-theme="pro"] #kube-graph .gv-edge.hot { filter: none; }
  :root[data-theme="pro"] #kube-graph .gv-findings { background: #fdecec; border-color: #d33; color: #8a1111; }
  :root[data-theme="pro"] #kube-graph .gv-flag, :root[data-theme="pro"] #kube-graph .gv-noep { background: #d33; color: #fff; }
  :root[data-theme="pro"] #kube-graph .gv-cep { color: #456; }
  :root[data-theme="pro"] #kube-graph .gv-meta { color: var(--text-2); }
  :root[data-theme="pro"] #kube-graph .gv-talk.t-live { color: var(--accent); }
  :root[data-theme="pro"] #kube-graph .gv-talk.t-err { color: var(--err); }
  :root[data-theme="pro"] #kube-graph .gv-talk.t-none { color: var(--text-2); }
  :root[data-theme="pro"] #kube-graph .gv-colhead { color: var(--text-3); font-family: var(--font-ui); letter-spacing: 0.08em; }
  :root[data-theme="pro"] #kube-graph .gv-card { border-radius: 8px; background: var(--raised); border: 1px solid var(--border); font-family: var(--font-ui); }
  :root[data-theme="pro"] #kube-graph .gv-cname { color: var(--text); font-weight: 600; }
  :root[data-theme="pro"] #kube-graph .gv-cmeta { color: var(--text-2); }
  :root[data-theme="pro"] #kube-graph .gv-card.t-live { border-left: 3px solid var(--accent); }
  :root[data-theme="pro"] #kube-graph .gv-card.t-live .gv-crate { color: var(--accent); }
  :root[data-theme="pro"] #kube-graph .gv-card.t-err { border-left: 3px solid var(--err); }
  :root[data-theme="pro"] #kube-graph .gv-card.t-err .gv-crate { color: var(--err); }
  :root[data-theme="pro"] #kube-graph .gv-card.t-none { border-left: 3px dashed var(--text-3); }
  :root[data-theme="pro"] #kube-graph .gv-card.t-none .gv-crate { color: var(--text-3); }
  :root[data-theme="pro"] #kube-graph .gv-edge.st-config { stroke: var(--text-3); }
  :root[data-theme="pro"] #kube-graph .gv-edge.st-live { stroke: var(--accent); }
  :root[data-theme="pro"] #kube-graph .gv-edge.st-error { stroke: var(--err); }
  :root[data-theme="pro"] #kube-graph .gv-edge.st-owner { stroke: var(--warn); }
  :root[data-theme="pro"] #kube-graph .gv-key.st-live i { border-top-color: var(--accent); }
  :root[data-theme="pro"] #kube-graph .gv-key.st-error i { border-top-color: var(--err); }
  :root[data-theme="pro"] #kube-graph .gv-key.st-config i { border-top-color: var(--text-3); }
  :root[data-theme="pro"] #kube-graph .gv-key.st-owner i { border-top-color: var(--warn); }
  :root[data-theme="pro"] #kube-graph .gv-legend { color: var(--text); }
  :root[data-theme="pro"] #kube-graph .gv-badgekey { color: var(--text-2); font-family: var(--font-ui); }
  :root[data-theme="pro"] #kube-graph .gv-side { color: var(--text); background: var(--raised); border: 1px solid var(--border); border-radius: 10px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35); font-family: var(--font-ui); }
  :root[data-theme="pro"] #kube-graph .gv-smeta, :root[data-theme="pro"] #kube-graph .gv-calls h5, :root[data-theme="pro"] #kube-graph .gv-ckind, :root[data-theme="pro"] #kube-graph .gv-cnone { color: var(--text-2); letter-spacing: 0.04em; }
  :root[data-theme="pro"] #kube-graph .gv-calls li { border-color: var(--border); border-radius: 6px; }
  :root[data-theme="pro"] #kube-graph .gv-cpeer { color: var(--text); font-family: var(--font-ui); }
  :root[data-theme="pro"] #kube-graph .c-live .gv-cdot { background: var(--accent); box-shadow: none; }
  :root[data-theme="pro"] #kube-graph .c-error .gv-cdot { background: var(--err); box-shadow: none; }
  :root[data-theme="pro"] #kube-graph .c-error { border-color: var(--err); }
  :root[data-theme="pro"] #kube-graph .c-live .gv-crate { color: var(--accent); }
  :root[data-theme="pro"] #kube-graph .c-error .gv-crate { color: var(--err); }
  :root[data-theme="pro"] #kube-graph .c-config .gv-crate { color: var(--text-3); }
  :root[data-theme="pro"] #kube-graph .gv-badge rect { fill: var(--raised); stroke: var(--accent); }
  :root[data-theme="pro"] #kube-graph .gv-badge text { fill: var(--accent); font-family: var(--font-ui); font-weight: 600; }
  :root[data-theme="pro"] #kube-graph .gv-badge.err rect { stroke: var(--err); }
  :root[data-theme="pro"] #kube-graph .gv-badge.err text { fill: var(--err); }
  :root[data-theme="pro"] #kube-graph .gv-legend { color: var(--text-2, var(--text)); font-family: var(--font-ui); letter-spacing: 0; }
  :root[data-theme="pro"] #kube-graph .gv-key i { border-top-color: var(--text-3); }
  :root[data-theme="pro"] #kube-graph .gv-key.s-trace i { border-top-color: var(--accent); }
  :root[data-theme="pro"] #kube-graph .gv-key.s-flow i { border-top-color: var(--info); }
  :root[data-theme="pro"] #kube-graph .gv-key.owns i { border-top-color: var(--warn); }
  :root[data-theme="pro"] #kube-graph .gv-key.err i { border-top-color: var(--err); }
  :root[data-theme="pro"] #kube-graph .gv-arrowhead { fill: var(--text-3); }
  :root[data-theme="pro"] #kube-graph .gv-timeline { background: var(--raised); border-color: var(--border); border-radius: 10px; }
  :root[data-theme="pro"] #kube-graph .gv-timeline { box-shadow: 0 -8px 18px rgba(0, 0, 0, 0.45); }
  :root[data-theme="pro"] #kube-graph .gv-tlsrc { color: var(--text-3); }
  :root[data-theme="pro"] #kube-graph .gv-tlsrc.s-observe { color: var(--ok); }
  :root[data-theme="pro"] #kube-graph .gv-tlhead b { color: var(--text); letter-spacing: 0.04em; font-weight: 600; }
  :root[data-theme="pro"] #kube-graph .gv-track { border-bottom-color: var(--border-strong); background: repeating-linear-gradient(90deg, transparent 0 calc(10% - 1px), var(--border) calc(10% - 1px) 10%); }
  :root[data-theme="pro"] #kube-graph .gv-tick { border-radius: 50%; transform: none; border-color: var(--bg); background: var(--text-3); }
  :root[data-theme="pro"] #kube-graph .gv-tick.e-alarm, :root[data-theme="pro"] #kube-graph .gv-tick.e-restart { background: var(--err); }
  :root[data-theme="pro"] #kube-graph .gv-tick.e-warning, :root[data-theme="pro"] #kube-graph .gv-tick.e-rollout { background: var(--warn); }
  :root[data-theme="pro"] #kube-graph .gv-tick.e-ok { background: var(--ok); }
  :root[data-theme="pro"] #kube-graph .gv-tick.sel { box-shadow: 0 0 0 2px var(--accent); }
  :root[data-theme="pro"] #kube-graph .gv-ev { color: var(--text-2); border-radius: 4px; }
  :root[data-theme="pro"] #kube-graph .gv-ev:hover, :root[data-theme="pro"] #kube-graph .gv-ev.sel { background: var(--hover); color: var(--text); }
  :root[data-theme="pro"] #kube-graph .gv-ev.e-alarm .gv-etag, :root[data-theme="pro"] #kube-graph .gv-ev.e-restart .gv-etag { color: var(--err); background: color-mix(in srgb, var(--err) 14%, transparent); }
  :root[data-theme="pro"] #kube-graph .gv-ev.e-warning .gv-etag, :root[data-theme="pro"] #kube-graph .gv-ev.e-rollout .gv-etag { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }
  :root[data-theme="pro"] #kube-graph .gv-ev.e-ok .gv-etag { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
  :root[data-theme="pro"] .vpg-templates h4 { color: var(--text-2); background: var(--surface-2); border-bottom: 1px solid var(--border); letter-spacing: 0.04em; font-weight: 600; font-size: 12px; padding: 7px 12px; }
  @media (max-width: 640px) {
    :root[data-theme="pro"] .tab { padding: 6px 8px; font-size: 12px; }
  }
  :root[data-theme="pro"] .alr-head { border-color: var(--border); }
  :root[data-theme="pro"] .alr-head b { color: var(--text); letter-spacing: 0.02em; font-weight: 600; }
  :root[data-theme="pro"] :is(.alr-src, .alr-host, .alr-methods, .alr-note) { color: var(--text-3); letter-spacing: 0; text-transform: none; }
  :root[data-theme="pro"] .alr-route { border-color: var(--border); }
  :root[data-theme="pro"] .alr-route:hover { background: var(--hover); }
  :root[data-theme="pro"] .alr-path { color: var(--text); font-family: ui-monospace, monospace; }
  :root[data-theme="pro"] .alr-svc { color: var(--text-2); }
  :root[data-theme="pro"] .alr-from { background: var(--surface-2); color: var(--text-2); border-radius: 4px; letter-spacing: 0; }
  :root[data-theme="pro"] .alr-routes-toggle[aria-expanded="true"] { background: var(--surface-2); color: var(--text); border-color: var(--border); }
  :root[data-theme="pro"] .alr-search { background: var(--bg); color: var(--text); border: 1px solid var(--border); border-radius: 6px; }
  :root[data-theme="pro"] #radio-panel { border-left: 1px solid var(--border); background-image: none; }
  :root[data-theme="pro"] #spend.issue b, :root[data-theme="pro"] #tally.issue { box-shadow: inset 3px 0 0 var(--err); }

  /* UX pass (docs/ux-review-2026-10-12.md): one affordance language.
     Clickable = pointer + hover lift + a visible keyboard ring; disabled =
     faded + not-allowed; info text never looks pressable. */
  button:not(:disabled), select:not(:disabled), summary, [role="button"], [role="tab"], a[href], label:has(> select) { cursor: pointer; }
  button:disabled, select:disabled, [aria-disabled="true"] { cursor: not-allowed !important; opacity: 0.45; filter: saturate(0.4); }
  :where(button, select, summary, a[href], input, textarea, [role="button"], [role="tab"], [tabindex]:not([tabindex="-1"])):focus-visible { outline: 2px dashed var(--pip-bright); outline-offset: 3px; }
  :root[data-theme="pro"] :where(button, select, summary, a[href], input, textarea, [role="button"], [role="tab"], [tabindex]:not([tabindex="-1"])):focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
  :where(.gv-btn, .gv-open, .gv-ghead, .gv-cpeer, .gv-finding, #kube-tabs button, .k9-tabs button, .le-btn, .sc-btn):not(:disabled):hover { filter: brightness(1.25); }
  /* links that leave the view: a chevron says "goes somewhere" */
  a.gv-inside, a.go, a[data-go] { text-decoration: underline; text-underline-offset: 3px; }
  /* where am I: CLUSTER › SERVICES */
  #where { margin: 2px 0 4px; padding: 0 18px; font-size: 12px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--pip-mid); }
  #where b { color: var(--pip-bright); font-weight: 700; }
  #where i { font-style: normal; padding: 0 6px; opacity: 0.7; }
  #where[hidden] { display: none; }

  /* UX pass 2: legend chips are a key, not buttons */
  #kube-graph .gv-key, #kube-graph .gv-bk { cursor: help; border: 0 !important; background: none !important; box-shadow: none !important; }
  #kube-graph .gv-legend::before, #kube-graph .gv-badgekey::before { content: "KEY"; margin-right: 8px; color: var(--pip-dim-text); letter-spacing: 0.14em; font-size: 11px; }
  #stats span[title], #stats .meter[title] { cursor: help; text-decoration: underline dotted; text-underline-offset: 3px; text-decoration-color: color-mix(in srgb, currentColor 40%, transparent); }
  /* UX pass 2: one spacing step (8 px) between the stacked bars at the
     top of a view: breadcrumb, prompt, morning report, sub-tabs, header */
  .screen > #where { margin: 6px 0 2px; }
  .terminal { margin-bottom: 8px; }
  #morning:not([hidden]) { margin-bottom: 8px; }
  #kube-tabs:not([hidden]) { margin: 0 0 8px; }
  #kube-graph .gv-head, #kube-graph .gv-stats, #kube-graph .gv-legend, #kube-graph .gv-badgekey { margin-bottom: 6px; }
  /* the breadcrumb reads in Pip: bright place names on a dark plate */
  #where { color: var(--pip-mid); text-shadow: 0 0 4px var(--glow-soft); }
  #where b { color: var(--pip-hot); text-shadow: 0 0 6px var(--glow-bright); }
  #where:not([hidden]) { position: relative; z-index: 6; display: inline-block; background: var(--pip-ink); border: 1px solid var(--pip-dark); padding: 2px 10px; margin-left: 18px; }
  :root[data-theme="pro"] #where { text-shadow: none; background: transparent; border: 0; }
  :root[data-theme="pro"] #where b { color: var(--text, inherit); text-shadow: none; }

  /* graph v3: wide responsive cards, status dots, empty state, no mesh */
  #kube-graph .gv-layered { display: flex; gap: clamp(48px, 5vw, 96px); align-items: flex-start; }
  #kube-graph .gv-col { flex: 1 1 0; min-width: 160px; max-width: 420px; display: flex; flex-direction: column; gap: 12px; }
  #kube-graph .gv-cardgrid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px 18px; padding: 4px 2px 8px; }
  #kube-graph .gv-card { width: 100%; max-width: none; min-width: 0; }
  #kube-graph .gv-card .gv-cmeta, #kube-graph .gv-card .gv-cep, #kube-graph .gv-card .gv-cname { white-space: normal; overflow: visible; text-overflow: clip; overflow-wrap: anywhere; }
  #kube-graph .gv-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; margin-right: 2px; background: var(--pip-dark); box-shadow: 0 0 0 1px var(--pip-dim); }
  #kube-graph .gv-dot.d-live { background: var(--pip-bright); box-shadow: 0 0 6px var(--glow-bright); }
  #kube-graph .gv-dot.d-err { background: var(--status-broken); box-shadow: 0 0 6px var(--status-broken); }
  #kube-graph .gv-empty { margin: 4px 0 8px; padding: 6px 10px; border-left: 3px solid var(--pip-dim); color: var(--pip-mid); }
  #kube-graph .gv-possible-note { margin: 0 0 8px; padding: 4px 10px; border: 1px dashed var(--pip-dim); color: var(--pip-dim-text); }
  #kube-graph .gv-head { flex-wrap: wrap; row-gap: 6px; }
  :root[data-theme="pro"] #kube-graph .gv-dot { background: var(--border); box-shadow: none; }
  :root[data-theme="pro"] #kube-graph .gv-dot.d-live { background: var(--ok); }
  :root[data-theme="pro"] #kube-graph .gv-dot.d-err { background: var(--err); }
  :root[data-theme="pro"] #kube-graph .gv-empty { border-left-color: var(--border-strong); color: var(--text-2); }
</style>
</head>
<body>
<section id="settings" role="dialog" aria-label="settings" tabindex="-1" hidden></section>
<div class="device">
<header>
  <div class="plate">
    <button id="home" class="porthole" type="button" aria-label="overview" title="overview"><canvas id="mascot" width="26" height="24" aria-hidden="true"></canvas><span class="pro-mark" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="16" y="16" width="6" height="6" rx="1"/><rect x="2" y="16" width="6" height="6" rx="1"/><rect x="9" y="2" width="6" height="6" rx="1"/><path d="M5 16v-3a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v3"/><path d="M12 12V8"/></svg></span></button>
    <div><h1 data-pro-label="Cloud Spider">CLOUD SPIDER</h1><small>SPIDER-TEC SURVEY UNIT 3000</small></div>
  </div>
  <nav class="tabs" aria-label="views">
    <button id="tab-map" class="tab" type="button" data-icon="map" aria-pressed="true" data-module="map">Map</button>
    <button id="path" class="tab" type="button" data-icon="path" aria-pressed="false" title="sniff: a request's path, and DEBUG for any URL" data-pro-title="network: a request's path, and DEBUG for any URL" data-module="network"><span data-pro-label="Network">Sniff</span></button>
    <button id="cluster" class="tab" type="button" data-icon="cluster" aria-pressed="false" data-module="kubernetes">Cluster</button>
    <button id="k9s-btn" class="tab" type="button" data-icon="terminal" aria-pressed="false" title="K9S: a read-only resource table for the connected cluster (:)" data-module="kubernetes">K9S</button>
    <button id="tab-vaults" class="tab" type="button" data-icon="vaults" aria-pressed="false" title="vaults: every project, its checks and what it owns" data-module="vaults">Vaults</button>
  </nav>
  <div class="console">
    <div class="keys" role="group" aria-label="panels">
      <button id="tab-radio" class="key" type="button" aria-pressed="true" title="radio: the account's recent calls" data-pro-title="activity: the account's recent calls" data-module="radio"><span class="cap" data-icon="radio"></span><span class="tag" data-pro-label="Activity">Radio</span></button>
      <button id="upgrade" class="key" type="button" aria-pressed="false" title="stacks: Pulumi upgrades" data-module="stacks"><span class="cap" data-icon="stack"></span><span class="tag">Stacks</span></button>
      <button id="learn-key" class="key" type="button" aria-pressed="false" title="learn: holotape labs for Kubernetes and OpenShift" data-module="learn"><span class="cap" data-icon="learn"></span><span class="tag">Learn</span></button>
      <button id="score-key" class="key" type="button" aria-pressed="false" title="score: production readiness of the connected cluster (reads only; FIX runs an add-on stack after you approve its preview)" data-module="score"><span class="cap" data-icon="vaults"></span><span class="tag">Score</span></button>
      <button id="ask" class="key" type="button" aria-pressed="false" title="ask your local agent (runs only when you press ASK)" data-module="ask"><span class="cap" data-icon="terminal"></span><span class="tag">Ask</span></button>
    </div>
  <button id="sample" class="switch" type="button" role="switch" aria-checked="false" aria-label="Sample mode" title="Sample mode: a made-up account, nothing read from AWS"><span class="well" aria-hidden="true"><span class="nut"></span><span class="lever"></span></span><span class="marks" aria-hidden="true"><span>ON</span><span>OFF</span></span><span class="name" aria-hidden="true">SAMPLE</span><span class="led" aria-hidden="true"></span></button>
  </div>
  <div class="gauges" aria-label="map readouts">
    <p id="tally" class="lcd" hidden data-module="map"><img class="px" data-icon="map" alt=""><span id="tally-text"></span><span id="tally-issue"></span></p>
    <div id="corner">
      <button id="spend" class="lcd" type="button" aria-expanded="false" aria-controls="spend-lines" hidden data-module="cost"><img class="px" data-icon="caps" alt=""><b data-pro-label="Cost" title="CAPS = money: the AWS bill so far this month">CAPS</b><span id="spend-label"></span><i class="caret" aria-hidden="true"></i></button>
      <div id="spend-lines" role="region" aria-label="the bill, month to date" tabindex="-1" hidden data-module="cost"></div>
    </div>
  </div>
  <div class="readout">
    <label data-module="aws">REGION <select id="region"></select></label>
    <span><b>MODE</b> <output id="acct">LIVE</output></span>
    <span><b>TIME</b> <output id="clock">--:--</output></span>
  </div>
  <button id="settings-key" class="gear" type="button" aria-expanded="false" aria-controls="settings" title="settings: theme and the effective config"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/></svg></button>
  <div class="knobs" aria-hidden="true"><i class="knob"></i><i class="knob small"></i><i class="power"></i></div>
</header>
<main class="screen">
  <p id="where" aria-live="polite" hidden></p>
  <div class="terminal">
    <span class="line"><span class="prompt">&gt;</span><span id="status"></span><input id="kube-search" type="search" aria-label="search the cluster" placeholder="search: name, ns:team, crash, pending, app=web   ( / )" autocomplete="off" spellcheck="false" hidden><output id="kube-search-count" aria-live="polite" hidden></output><span id="kube-groupby" title="Group by: the namespace, or a label; resources without it go to 'unlabeled'. System namespaces stay as they are." hidden><b>GROUP BY</b><select id="kube-groupby-sel" aria-label="group lanes by"></select><input id="kube-groupby-custom" type="text" aria-label="custom label key" placeholder="label key, e.g. team" autocomplete="off" spellcheck="false" hidden></span></span>
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
      <li id="m-hurting" data-module="map" class="m-line" role="button" tabindex="0" aria-expanded="false"><img class="px" data-icon="fire" alt=""><b>HURTING</b><span class="m-text"></span><i class="m-led" aria-hidden="true"></i></li>
      <li id="m-changed" data-module="map" class="m-line" role="button" tabindex="0" aria-expanded="false"><img class="px" data-icon="clock" alt=""><b>CHANGED</b><span class="m-text"></span><i class="m-led" aria-hidden="true"></i></li>
      <li id="m-idle" data-module="map" class="m-line" role="button" tabindex="0" aria-expanded="false"><img class="px" data-icon="caps" alt=""><b>IDLE·BILLED</b><span class="m-text"></span><i class="m-led" aria-hidden="true"></i></li>
      <li id="m-logs" class="m-line" role="button" tabindex="0" aria-expanded="false" aria-controls="log-errors" data-module="kubernetes"><img class="px" data-icon="terminal" alt=""><b>LOG ERRORS</b><span class="m-text"></span><i class="m-led" aria-hidden="true"></i></li>
    </ul>
    <button id="morning-fold" class="m-fold" type="button" aria-expanded="true" aria-controls="morning" title="fold the morning report">&#9650;</button>
  </section>
  <div class="body">
    <div class="mapwrap">
      <section id="log-errors" aria-label="log errors, last night" hidden data-module="kubernetes"></section>
      <div id="map">
        <canvas id="place" tabindex="0" role="application" aria-roledescription="survey map" aria-label="survey map. Tab or the arrow keys move between resources, Enter opens one, Escape closes it."></canvas>
        <p id="map-say" class="sr-only" aria-live="polite"></p>
        <select id="wall-grain" aria-label="camp grain" hidden>
          <option value="coarse">coarse</option>
          <option value="fine">fine</option>
        </select>
        <div id="vpc-folds"></div>
        <div id="alb-docks"></div>
        <div id="map-view" role="group" aria-label="map view" hidden>
          <button id="view-arch" class="cmd" type="button" aria-pressed="true" title="VPCs, zones and subnets, like an AWS diagram">ARCH</button>
          <button id="view-tag" class="cmd" type="button" aria-pressed="false" title="one walled camp per tag value">BY TAG</button>
          <select id="view-tag-key" aria-label="tag key to group by"></select>
        </div>
        <button id="vault-all" class="cmd" type="button" aria-pressed="false" hidden data-module="vaults">OPEN ALL</button>
        <button id="vault-templates-btn" class="cmd" type="button" aria-expanded="false" aria-controls="vault-templates" hidden data-module="vaults">TEMPLATES</button>
        <section id="vault-templates" aria-label="vault templates" hidden data-module="vaults"></section>
        <div id="vault-panels"></div>
      </div>
      <section id="vault-page" aria-label="vaults page" hidden></section>
      <nav id="kube-tabs" aria-label="cluster screens" hidden data-module="kubernetes"></nav>
      <nav id="kube-ctx" aria-label="kube contexts" hidden></nav>
      <div id="kube-connect-dock" hidden></div>
      <section id="kube-connect" aria-label="EKS clusters: kube connection" hidden></section>
      <section id="kube-tele" aria-label="cluster telemetry" hidden></section>
      <section id="kube-ops" aria-label="cluster add-ons" hidden></section>
      <section id="kube-empty" aria-label="no cluster connected" hidden></section>
      <section id="kube-graph" aria-label="services graph (sample prototype)" tabindex="-1" hidden data-module="graph"></section>
      <section id="kube-panel" class="vault-panel" aria-label="pod details" hidden></section>
      <section id="k9s" aria-label="K9S window, read-only resource table" hidden data-module="kubernetes"></section>
      <form id="pip" hidden></form>
      <section id="term" hidden></section>
      <section id="learn" aria-label="learn" hidden></section>
      <section id="score" aria-label="scorecard" hidden></section>
      <section id="netdebug" aria-label="network debugging" hidden></section>
    </div>
    <aside id="radio-panel" aria-label="radio" data-module="radio">
      <div class="ptitle"><img class="px" data-icon="radio" alt=""><span data-pro-label="Activity">RADIO</span><span id="station-count"></span></div>
      <div class="scope"><canvas id="scope"></canvas></div>
      <div class="dial" aria-hidden="true"><div class="scale"></div><div class="nums"><span>88</span><span>94</span><span>100</span><span>106</span><span>112</span></div><div id="needle"></div></div>
      <ol id="radio" role="listbox" aria-label="radio stations: arrow keys tune"></ol>
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
    } catch (failure) {
      // Always JSON with an error the page can show, never an empty 500.
      const error = `the server failed: ${failure?.message || "error"}`;
      send(res, 500, { status: "the page failed", error, hint: "Check the terminal where you ran npm start for the full error." });
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

// features in cloudspider.yaml switch whole surfaces off at the server, not
// only in the page: ASK (the agent), running STACKS, LEARN.
export function featureOff(features, method, path) {
  if (!features) return "";
  if (features.ask === false && path.startsWith("/api/agent")) return "ask";
  if (features.stacksRun === false && method === "POST" && (path === "/api/upgrade" || path === "/api/upgrade/unlock")) return "stacksRun";
  if (features.learn === false && path.startsWith("/api/learn")) return "learn";
  if (features.scorecard === false && path.startsWith("/api/score")) return "scorecard";
  // FIX runs add-on stacks through upgradeRun directly, so it is gated here too.
  if (features.stacksRun === false && method === "POST" && path === "/api/score/fix") return "stacksRun";
  return "";
}

// The page with the config's theme on <html>: data-theme is what shows (a
// browser's own choice in settings replaces it before the first paint),
// data-config-theme is the default "Use config" returns to.
export function pageFor(theme, enabled) {
  const t = THEME_NAMES.includes(theme) ? theme : "pip";
  const mods = (enabled || MODULE_IDS).filter((id) => MODULE_IDS.includes(id));
  const stamp = enabled ? ` data-modules="${mods.join(" ")}"` : "";
  return page
    .replace('<html lang="en">', `<html lang="en" data-theme="${t}" data-config-theme="${t}"${stamp}>`)
    .replace("</head>", `${gateStyle(mods)}</head>`);
}

export function listen(app, port = 9241, host = "127.0.0.1") {
  const server = createServer(app);
  return new Promise((resolve, reject) => {
    const fail = (error) => reject(error);
    server.once("error", fail);
    server.listen(port, host, () => {
      server.off("error", fail);
      resolve(server);
    });
  });
}

const graphCache = new Map();
async function liveGraph(kube, context, ttl = 20_000) {
  const key = context || kube.context || "";
  const hit = graphCache.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.body;
  let body;
  try {
    const reads = await readGraph(kube);
    body = reads.error ? { error: reads.error, unset: !!reads.unset } : buildGraph(reads, { title: reads.clusterName, namespaces: reads.scope });
  } catch (error) {
    body = { error: error?.message || "the graph read failed" };
  }
  graphCache.set(key, { at: Date.now(), body });
  return body;
}

async function route(app, req, res) {
  const url = new URL(req.url || "/", "http://127.0.0.1");
  // A write from another page (or with no Origin) is refused inside each
  // handler, which explains it in the body; the status says so too: 403,
  // not 200, so nothing (a proxy, a script, the browser) reads it as done.
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method) && app.pageOrigin && !originAllowed(req.headers.origin, app.pageOrigin)) res.foreign = true;
  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    res.end(pageFor(app.settings?.()?.config?.ui?.theme, app.settings?.()?.modules?.enabled));
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/")) {
    const name = url.pathname.slice(1);
    if (FONT_FILES.has(name)) {
      const body = await readFile(join(root, name));
      res.writeHead(200, {
        "content-type": FONT_FILES.get(name),
        "cache-control": "public, max-age=604800, immutable",
      });
      res.end(body);
      return;
    }
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

  if (req.method === "GET" && url.pathname === "/api/config") {
    send(res, 200, app.settings?.() || effectiveConfig({ config: defaults(), sources: {}, file: "" }));
    return;
  }

  // Modules (modules.js): a route of a module that is off is not there.
  // The map's /api/view still answers, empty, so the page's first pull is calm.
  const enabled = app.settings?.()?.modules?.enabled;
  const offModule = enabled ? moduleOff({ has: (id) => enabled.includes(id) }, url.pathname) : "";
  if (offModule === "map" && req.method === "GET" && url.pathname === "/api/view") {
    // The morning report without the map: PODS + LOG ERRORS (kubernetes module).
    const kubeMorning = enabled.includes("kubernetes") && app.morningKube ? app.morningKube() : null;
    send(res, 200, { off: "map", regions: [], radio: "", trail: [], morning: kubeMorning });
    return;
  }
  if (offModule) {
    send(res, 404, { error: `module off: ${offModule} (modules in cloudspider.yaml)`, module: offModule });
    return;
  }
  const off = featureOff(app.settings?.()?.config?.features, req.method, url.pathname);
  if (off) {
    send(res, 403, { error: `turned off in cloudspider.yaml (features.${off})` });
    return;
  }
  // SAMPLE scorecard (score/sample-scan.js): the real engine on a scripted story.
  if (req.method === "GET" && url.pathname === "/api/score/sample") {
    send(res, 200, await sampleScoreView(url.searchParams.get("target") === "aws" ? "aws" : "kubernetes"));
    return;
  }
  if (await scoreRoute(req, res, url, app.score, { send, readJson })) return;
  if (await netdebugRoute(req, res, url, app.netdebug, { send, readJson })) return;

  if (req.method === "GET" && url.pathname === "/api/sample") {
    send(res, 200, { place: samplePlace(), trail: sampleTrail(), morning: sampleMorning() });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/path-sample") {
    send(
      res,
      200,
      withPeers(
        pathResult(samplePathGraph(), {
          lb: url.searchParams.get("lb") || "",
          host: url.searchParams.get("host") || "",
          region: "sample",
        }),
        peerSampleWorld(samplePlace()),
        url.searchParams.get("lb") || "",
      ),
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
    // A card whose module is off (the observe bundle) is not offered.
    const on = (id) => !enabled || enabled.includes(stackModule(id));
    send(res, 200, { modules: (app.upgrades() || []).filter((m) => on(m.id)), terraform: app.terraformStacks ? app.terraformStacks() : [] });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/terraform/state") {
    send(res, 200, await app.terraformState(url.searchParams.get("id") || "", { fresh: url.searchParams.get("fresh") === "1", sample: url.searchParams.get("sample") === "1" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/learn") {
    send(res, 200, app.learnList ? app.learnList({ sample: url.searchParams.get("sample") === "1" }) : { tracks: [], labs: [], progress: {} });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/learn/check") {
    const body = await readJson(req);
    send(res, 200, await app.learnCheck(req.headers.origin, body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/learn/progress") {
    const body = await readJson(req);
    send(res, 200, app.learnProgress(req.headers.origin, body));
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
    const body = await readJson(req).catch(() => null);
    if (!body || typeof body !== "object") {
      send(res, 400, { error: "the run request was not JSON", hint: "Reload the page and press the button again." });
      return;
    }
    if (enabled && !enabled.includes(stackModule(String(body.module || "")))) {
      send(res, 404, { error: `module off: ${stackModule(String(body.module || ""))} (modules in cloudspider.yaml)` });
      return;
    }
    send(res, 200, await app.upgradeRun(req.headers.origin, body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/upgrade/unlock") {
    const body = await readJson(req).catch(() => null);
    if (!body || typeof body !== "object") {
      send(res, 400, { error: "the unlock request was not JSON", hint: "Reload the page and press UNLOCK again." });
      return;
    }
    send(res, 200, app.upgradeUnlock ? await app.upgradeUnlock(req.headers.origin, body) : { error: "upgrades are not set up" });
    return;
  }

  // CONNECT: one cluster's viewer context (GET status, POST connect or
  // disconnect, same-origin only).
  if (req.method === "GET" && url.pathname === "/api/kube/connect") {
    const cluster = url.searchParams.get("cluster") || "";
    send(res, 200, cluster ? await app.connectStatus(cluster) : await app.connectAll());
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/kube/connect") {
    const body = await readJson(req).catch(() => null);
    if (!body || typeof body !== "object") {
      send(res, 400, { error: "the request was not JSON", hint: "Reload the page and press the button again." });
      return;
    }
    send(res, 200, await app.connectRun(req.headers.origin, body));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/addons/bundle") {
    send(res, 200, app.bundleStatus ? await app.bundleStatus(url.searchParams.get("cluster") || "", { fresh: url.searchParams.get("fresh") === "1", items: url.searchParams.has("items") ? url.searchParams.get("items").split(",").filter(Boolean) : null }) : { error: "add-ons are not set up" });
    return;
  }
  if (req.method === "POST" && url.pathname === "/api/addons/bundle") {
    const body = await readJson(req).catch(() => null);
    if (!body || typeof body !== "object") {
      send(res, 400, { error: "the request was not JSON", hint: "Reload the page and press the button again." });
      return;
    }
    send(res, 200, await app.bundleRun(req.headers.origin, body));
    return;
  }

  // Stack bundles (Shop API, Demo): { bundle, cluster, params, plan }.
  if (req.method === "POST" && url.pathname === "/api/stacks/bundle") {
    const body = await readJson(req).catch(() => null);
    if (!body || typeof body !== "object") {
      send(res, 400, { error: "the request was not JSON", hint: "Reload the page and press the button again." });
      return;
    }
    send(res, 200, app.stackBundle ? await app.stackBundle(req.headers.origin, body) : { error: "bundles are not set up" });
    return;
  }

  // The card's fields as its stack has them (EKS: the live node group).
  if (req.method === "GET" && url.pathname === "/api/upgrade/live") {
    const values = {};
    const value = url.searchParams.get("clusterName");
    if (value) values.clusterName = value;
    send(res, 200, app.upgradeLive ? await app.upgradeLive(url.searchParams.get("module") || "", values) : { values: {} });
    return;
  }

  // NEEDS chips: what a card needs on its cluster and whether it is there.
  if (req.method === "GET" && url.pathname === "/api/upgrade/needs") {
    const values = {};
    for (const key of ["clusterName", "expose", "dbSecret"]) {
      const value = url.searchParams.get(key);
      if (value) values[key] = value;
    }
    send(res, 200, app.upgradeNeeds ? await app.upgradeNeeds(url.searchParams.get("module") || "", values) : { needs: [], refusal: "" });
    return;
  }

  // The whole log of a card's last run (.cloudspider/runs/<stack>/<ts>.log).
  if (req.method === "GET" && url.pathname === "/api/upgrade/log") {
    const values = {};
    for (const key of ["clusterName", "name"]) {
      const value = url.searchParams.get(key);
      if (value) values[key] = value;
    }
    const found = app.upgradeLog ? await app.upgradeLog(url.searchParams.get("module") || "", values) : null;
    if (!found?.text && !found?.log) {
      send(res, 404, { error: "no run log for this stack yet", hint: "Press PREVIEW or RUN; every run is logged under .cloudspider/runs." });
      return;
    }
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
    res.end(found.text || "");
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
    // SAMPLE's Cluster view: the demo app inside the sample EKS cluster, the
    // same kube picture a live context draws (lanes, search, K9S, TELEMETRY,
    // OPS and pod details all have sample answers). It used to be a
    // six-box OpenShift placeholder from before the kube view existed.
    send(res, 200, sampleKubeCluster());
    return;
  }

  // The map's cluster compound (map-kube.js): the kube diagram, shared
  // with the Cluster view and cached 30 s on the server.
  if (req.method === "GET" && url.pathname === "/api/map/kube") {
    if (url.searchParams.get("sample") === "1") {
      send(res, 200, { clusters: [{ name: "cloudspider-up", diagram: diagramFromKube(sampleMapSnapshot(), {}), at: Date.now() }], sample: true });
      return;
    }
    await app.boot();
    send(res, 200, app.mapKube ? await app.mapKube() : { clusters: [] });
    return;
  }

  // SERVICES: the static + ownership graph of a kube context (graph-read.js
  // reads, graph-build.js shapes). Read-only GETs, no Secrets, the
  // context's namespace allowlist. Cached 20 s per context.
  // OBSERVE (upgrades/observe): the bundle PREVIEW (what the Observe card
  // installs, rendered by upgrades/observe/render.js) and the live edges,
  // RED and Events it feeds (observe/live.js, service-proxy GETs only).
  // Read-only: installs go through the STACKS card.
  if (req.method === "GET" && url.pathname === "/api/observe/plan") {
    const q = Object.fromEntries(url.searchParams);
    let found = { nodes: 1 };
    const kube = q.sample === "1" ? null : app.kubeOf?.(q.context || "");
    if (kube && q.detect !== "0") {
      const reads = await readGraph(kube).catch(() => null);
      if (reads && !reads.error) found = observeDetect(reads);
    }
    try {
      send(res, 200, observePlan({ platform: q.platform || found.platform, kubeStateMetrics: q.kubeStateMetrics || found.kubeStateMetrics, allowPrivileged: q.allowPrivileged, profile: q.profile, logs: q.logs, lokiStorage: q.lokiStorage, lokiRetention: q.lokiRetention, storageClass: q.storageClass, nodeCidr: q.nodeCidr }, { nodes: found.nodes || 1 }));
    } catch (error) {
      send(res, 400, { error: error.message });
    }
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/observe/live") {
    if (url.searchParams.get("sample") === "1") { send(res, 200, sampleObserve()); return; }
    const kube = app.kubeOf?.(url.searchParams.get("context") || "");
    if (!kube) { send(res, 200, { installed: false, note: "no kube context" }); return; }
    send(res, 200, await observeLive(kube).catch((error) => ({ installed: true, error: error.message })));
    return;
  }
  // INCIDENT REVIEW: Events for a window (timeline-live.js): the observe
  // bundle's Loki when installed, else the API server's. Read-only.
  if (req.method === "GET" && url.pathname === "/api/cluster/timeline") {
    const windowMin = Number(url.searchParams.get("windowMin")) || 360;
    if (url.searchParams.get("sample") === "1") {
      const scene = graphScenario(url.searchParams.get("scenario") === "bundle" ? "bundle" : "bare");
      send(res, 200, { source: "sample", windowMin, events: scene.events, window: scene.window, note: "sample events" });
      return;
    }
    const context = url.searchParams.get("context") || "";
    const kube = app.kubeOf?.(context);
    if (!kube) {
      send(res, 200, { error: "no kube context", unset: true, events: [] });
      return;
    }
    const scene = await liveGraph(kube, context);
    send(res, 200, await readTimeline(kube, { scene: scene?.error ? {} : scene, windowMin }).catch((error) => ({ error: error.message, events: [] })));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/cluster/graph") {
    if (url.searchParams.get("sample") === "1") {
      send(res, 200, graphScenario(url.searchParams.get("scenario") === "bundle" ? "bundle" : "bare"));
      return;
    }
    const context = url.searchParams.get("context") || "";
    const kube = app.kubeOf?.(context);
    if (!kube) {
      send(res, 200, { error: "no kube context", unset: true });
      return;
    }
    const scene = await liveGraph(kube, context);
    // The observe bundle's live edges, RED and Events (TRACES layer), when it
    // is installed on this cluster and the observe module is on.
    const observing = !enabled || enabled.includes("observe");
    if (observing && scene && !scene.error && url.searchParams.get("live") !== "0") {
      const live = await Promise.race([observeLive(kube), new Promise((r) => setTimeout(() => r(null), 4000))]).catch(() => null);
      if (live?.installed && !live.error) { send(res, 200, mergeLive(scene, live)); return; }
    }
    send(res, 200, scene);
    return;
  }
  // LOG ERRORS for the morning report (log-report.js). Read-only.
  if (req.method === "GET" && url.pathname === "/api/morning/logs") {
    const sample = url.searchParams.get("sample") === "1";
    const scenario = url.searchParams.get("scenario") === "bundle" ? "bundle" : "bare";
    // window: night (the morning report, default) | 1h | 24h | auto (panel).
    const logWin = cleanLogWindow(url.searchParams.get("window") || "night");
    if (!app.logErrors) send(res, 200, sample ? sampleLogErrors(scenario, Date.now(), logWin === "auto" ? "night" : logWin) : { services: [], line: { status: "unknown", text: "LOG ERRORS is not set up." } });
    else send(res, 200, await app.logErrors.report({ sample, scenario, fresh: url.searchParams.get("fresh") === "1", window: logWin }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/cluster/telemetry") {
    if (url.searchParams.get("sample") === "1") {
      send(res, 200, await sampleTelemetry());
      return;
    }
    await app.boot();
    send(res, 200, await app.clusterTelemetry({ context: url.searchParams.get("context") || "" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cluster/ops") {
    send(res, 200, app.clusterOps ? await app.clusterOps({ sample: url.searchParams.get("sample") === "1", context: url.searchParams.get("context") || "" }) : { error: "not set up" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/addons") {
    send(res, 200, app.addonsView ? await app.addonsView({ sample: url.searchParams.get("sample") === "1", fresh: url.searchParams.get("fresh") === "1" }) : { tree: [] });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cluster/pod") {
    if (url.searchParams.get("sample") === "1") {
      send(res, 200, samplePodDetail(url.searchParams.get("name") || "", { previous: url.searchParams.get("previous") === "1" }));
      return;
    }
    send(res, 200, await app.clusterPod({ ns: url.searchParams.get("ns"), name: url.searchParams.get("name"), container: url.searchParams.get("container"), previous: url.searchParams.get("previous") === "1", tail: url.searchParams.get("tail"), context: url.searchParams.get("context") || "" }));
    return;
  }

  // K9S window: read-only tables, describe and YAML (kube-table.js).
  if (req.method === "GET" && url.pathname === "/api/kube/table") {
    const q = url.searchParams;
    send(res, 200, await app.kubeTable({ context: q.get("context") || "", view: q.get("view") || "pods", ns: q.get("ns") || "", filter: q.get("filter") || "", sample: q.get("sample") === "1" }));
    return;
  }
  if (req.method === "GET" && url.pathname === "/api/kube/describe") {
    const q = url.searchParams;
    send(res, 200, await app.kubeDescribe({ context: q.get("context") || "", view: q.get("view") || "pods", ns: q.get("ns") || "", name: q.get("name") || "", sample: q.get("sample") === "1" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cluster/pod/inspect") {
    if (url.searchParams.get("sample") === "1") {
      const raw = samplePodInspect(url.searchParams.get("name") || "");
      const tele = await sampleTelemetry();
      const pod = tele.pods.find((p) => p.name === raw.pod.metadata.name);
      send(res, 200, inspectPod(raw.pod, { events: raw.events, chain: raw.chain, usage: raw.usage, history: pod ? { ...pod.history, sampleMs: tele.sampleMs } : null }));
      return;
    }
    await app.boot();
    send(res, 200, await app.clusterPodInspect({ ns: url.searchParams.get("ns"), name: url.searchParams.get("name"), context: url.searchParams.get("context") || "" }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/metrics") {
    const sample = url.searchParams.get("sample") === "1";
    if (!sample) await app.boot();
    send(res, 200, await app.metricsView({ sample }));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/cluster") {
    // A non-primary kube context reads no AWS at all: it must not wait for
    // the account's first read (region, VPCs, instances) to finish.
    if (!app.contextNeedsAws || app.contextNeedsAws(url.searchParams.get("context") || "")) await app.boot();
    send(res, 200, await app.clusterView({ context: url.searchParams.get("context") || "" }));
    return;
  }

  // The health watch (kube-health.js): radio rows and one lamp per kube
  // context. Reads nothing itself; main.js polls on each context's clock.
  if (req.method === "GET" && url.pathname === "/api/kube/health") {
    send(res, 200, app.kubeHealth ? app.kubeHealth() : { radio: [], contexts: [] });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/view") {
    await app.boot();
    if (url.searchParams.get("sample") !== "1") {
      app.freshen?.();
      await app.mergeCamp(url.searchParams.get("grain") || "coarse");
      app.kickLinks();
    }
    send(res, 200, app.view());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/alb-routes") {
    const id = url.searchParams.get("id") || "";
    if (url.searchParams.get("sample") === "1") {
      send(res, 200, sampleAlbRoutes(id));
      return;
    }
    await app.boot();
    send(res, 200, app.albRoutes ? await app.albRoutes(id) : { id, error: "routes are not set up", routes: [] });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/reach") {
    await app.boot();
    send(res, 200, await app.reach(url.searchParams.get("url") || ""));
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

export function sampleKubeCluster() {
  const snap = sampleClusterSnapshot();
  return {
    sample: true,
    error: "",
    region: "sample",
    headline: "",
    diagram: diagramFromKube(snap, { cluster: { name: snap.clusterName, version: "1.32", status: "ACTIVE" } }),
    note: `sample, not the account. Inside ${snap.clusterName}: the demo app, Shop API and the system pods on two nodes (1a, 1b)`,
  };
}

function send(res, status, body) {
  if (res.foreign && status < 400) status = 403;
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
