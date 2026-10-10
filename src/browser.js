import { ROW_LIMIT, layout } from "./layout.js";
import { createLayoutCache, flipSampleState } from "./layout-cache.js";
import { buildingAt, paint } from "./draw.js";
import { isInstanceId } from "./ids.js";
import {
  clickBuilding,
  clickGround,
  createUi,
  pressN,
  pressY,
  setLogs,
  setRadio,
  setStatus,
  switchRegion,
} from "./ui.js";
import { layoutPath, nodeAt } from "./path-layout.js";
import { paintPath } from "./path-draw.js";
import {
  clockText, drawMascot, drawScope, mapStats, needleAt, paintIcons, pathStats, renderRadio, renderStats, setIcon,
} from "./chrome.js";
import { FRAME_MS } from "./theme.js";

const ui = createUi();
const canvas = document.querySelector("#place");
const ctx = canvas.getContext("2d");
const regionSelect = document.querySelector("#region");
const statusEl = document.querySelector("#status");
const radioEl = document.querySelector("#radio");
const confirmEl = document.querySelector("#confirm");
const errorEl = document.querySelector("#error");
const yes = document.querySelector("#yes");
const no = document.querySelector("#no");
const sampleButton = document.querySelector("#sample");
const map = document.querySelector("#map");
const pathButton = document.querySelector("#path");
const lbSelect = document.querySelector("#lb");
const hostInput = document.querySelector("#host");
const tabMap = document.querySelector("#tab-map");
const tabRadio = document.querySelector("#tab-radio");
const radioPanel = document.querySelector("#radio-panel");
const scope = document.querySelector("#scope");
const needle = document.querySelector("#needle");
const stationCount = document.querySelector("#station-count");
const acct = document.querySelector("#acct");
const clockEl = document.querySelector("#clock");
const statsEl = document.querySelector("#stats");
const mascotCanvas = document.querySelector("#mascot");

let place = null;
let region = "";
let animTime = 0;
let pulling = false;
let sample = false;
let mode = "map";
let pathData = null;
let pathSelected = null;
let pathPulling = false;
let pathAgain = false;
let reducedMotion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : true;
let tabVisible = !document.hidden;
let sampleRadio = "";
let stations = [];
let station = 0;
let winking = -1;

// Cache for layout to avoid recomputing every frame
const layoutCache = createLayoutCache(layout);

function renderChrome() {
  statusEl.textContent = ui.status;
  if (station >= stationCountOf(ui.radio)) station = 0;
  stations = renderRadio(radioEl, ui.radio || "", station);
  stationCount.textContent = stations.length ? `${stations.length} STATIONS` : "NO SIGNAL";
  needle.style.left = `${needleAt(station, stations.length)}%`;
  sampleButton.setAttribute("aria-pressed", String(sample));
  tabMap.setAttribute("aria-pressed", String(mode === "map"));
  pathButton.setAttribute("aria-pressed", String(mode === "path"));
  tabRadio.setAttribute("aria-pressed", String(!radioPanel.hidden));
  acct.textContent = sample ? "SAMPLE" : "LIVE";
  renderStats(statsEl, mode === "path" ? pathStats(pathData?.diagram) : mapStats(place));
  if (mode === "path") {
    confirmEl.textContent = (pathData?.notes || []).join("  ");
    no.hidden = true;
    yes.hidden = true;
    return;
  }
  confirmEl.textContent = ui.confirmation?.line || "";
  no.hidden = !ui.confirmation;
  yes.hidden = !ui.confirmation?.allowsY;
  yes.lastChild.textContent = ui.confirmation?.verb === "start" ? "bring it back" : "put it down";
  setIcon(yes, ui.confirmation?.verb === "start" ? "start" : "stop");
}

function stationCountOf(text) {
  return String(text || "").split("\n").filter(Boolean).length;
}

function sizeCanvas(contentWidth, contentHeight) {
  const width = Math.max(contentWidth, map.clientWidth || 960);
  const height = Math.max(contentHeight, map.clientHeight || 640);
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width, height };
}

function placedPath() {
  return pathData?.diagram
    ? layoutPath(pathData.diagram, map.clientWidth || 0)
    : { nodes: [], edges: [], contentWidth: 960, contentHeight: 640 };
}

function placedMap() {
  const width = map.clientWidth || 0;
  const rowLimit = width ? Math.min(ROW_LIMIT, width) : ROW_LIMIT;
  return layoutCache.get(place, rowLimit);
}

function drawPath() {
  const placed = placedPath();
  const { width, height } = sizeCanvas(placed.contentWidth, placed.contentHeight);
  paintPath(ctx, {
    placed,
    selectedId: pathSelected,
    animTime,
    width,
    height,
    empty: pathData?.headline || pathData?.error || "reading the path",
    reducedMotion,
  });
}

function draw() {
  if (mode === "path") {
    drawPath();
    return;
  }
  
  // Layout is cached per place; flipSampleState invalidates it on mutation.
  const placed = place
    ? placedMap()
    : {
        settlements: [],
        orphans: { items: [], label: "no VPC" },
        contentWidth: 960,
        contentHeight: 640,
      };

  const { width, height } = sizeCanvas(placed.contentWidth, placed.contentHeight);
  paint(ctx, { placed, ui, region, animTime, width, height, reducedMotion });
}

function syncSelection() {
  if (!ui.selection || !place) return;
  const found = place.instances.find((item) => item.id === ui.selection.id);
  if (!found) return;
  ui.selection = {
    ...ui.selection,
    state: found.state,
    type: found.type,
    name: found.name,
    tags: found.tags,
  };
}

function syncRegions(regions, current) {
  const shown = [...regionSelect.options].map((option) => option.value).join();
  if (shown !== regions.join()) {
    regionSelect.replaceChildren(
      ...regions.map((name) => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        return option;
      }),
    );
  }
  if (current && regionSelect.value !== current) regionSelect.value = current;
}

async function pull() {
  if (pulling) return;
  pulling = true;
  try {
    const view = await fetch("/api/view").then((response) => response.json());
    setRadio(ui, sample ? sampleRadio : view.radio || "");
    if (mode === "path") {
      if (!sample) syncRegions(view.regions || [], view.region);
      renderChrome();
      return;
    }
    if (sample) {
      if (view.error) {
        errorEl.hidden = false;
        errorEl.textContent = view.error;
      }
      renderChrome();
      draw();
      return;
    }
    region = view.region || "";
    place = view.place;
    setStatus(ui, view.status || "");
    errorEl.hidden = !view.error;
    errorEl.textContent = view.error || "";
    syncRegions(view.regions || [], view.region);
    syncSelection();
    renderChrome();
    draw();
  } finally {
    pulling = false;
  }
}

function showSample(next) {
  sample = true;
  ui.sample = true;
  place = next;
  regionSelect.disabled = true;
  clickGround(ui);
  setStatus(ui, "sample, not the account");
  renderChrome();
  draw();
}

function leaveSample() {
  sample = false;
  ui.sample = false;
  regionSelect.disabled = false;
  clickGround(ui);
  setStatus(ui, "");
  pull();
}

function pathStatus(body) {
  const words = [body.hostNote, body.headline].filter(Boolean).join(" ");
  return sample ? `sample, not the account. ${words}` : words;
}

function syncLoadBalancers(list, selected) {
  const shown = [...lbSelect.options].map((option) => option.value).join();
  if (shown !== list.map((item) => item.arn).join()) {
    lbSelect.replaceChildren(
      ...list.map((item) => {
        const option = document.createElement("option");
        option.value = item.arn;
        option.textContent = item.name;
        return option;
      }),
    );
  }
  if (selected && lbSelect.value !== selected) lbSelect.value = selected;
}

function pathQuery() {
  return new URLSearchParams({ lb: lbSelect.value || "", host: hostInput.value.trim() }).toString();
}

async function pullPath() {
  if (pathPulling) {
    pathAgain = true;
    return;
  }
  pathPulling = true;
  const wasSample = sample;
  const asked = pathQuery();
  try {
    const response = await fetch(`${wasSample ? "/api/path-sample" : "/api/path"}?${asked}`);
    const body = await response.json();
    if (body.stale || mode !== "path" || wasSample !== sample) return;
    if (pathQuery() !== asked) {
      pathAgain = true;
      return;
    }
    pathData = body;
    syncLoadBalancers(body.loadBalancers || [], body.selected || "");
    if (pathSelected && !body.diagram?.nodes?.some((node) => node.id === pathSelected)) pathSelected = null;
    setStatus(ui, body.error ? "" : pathStatus(body));
    errorEl.hidden = !body.error;
    errorEl.textContent = body.error || "";
    renderChrome();
    draw();
  } catch {
    errorEl.hidden = false;
    errorEl.textContent = "the page failed";
  } finally {
    pathPulling = false;
    if (pathAgain) {
      pathAgain = false;
      pullPath();
    }
  }
}

function dropSample() {
  if (!sample) return;
  sample = false;
  ui.sample = false;
  regionSelect.disabled = false;
}

// The radio panel remembers whether it is open per view; the path needs the
// width more, so it starts closed there unless the window is wide.
const radioOpen = { map: true, path: window.innerWidth >= 1700 };

function showRadioFor(next) {
  radioOpen[mode] = !radioPanel.hidden;
  radioPanel.hidden = !radioOpen[next];
}

function enterPath() {
  dropSample();
  showRadioFor("path");
  mode = "path";
  pathData = null;
  pathSelected = null;
  lbSelect.hidden = false;
  hostInput.hidden = false;
  clickGround(ui);
  setStatus(ui, "reading the path");
  renderChrome();
  draw();
  pullPath();
}

function leavePath() {
  dropSample();
  showRadioFor("map");
  mode = "map";
  pathData = null;
  pathSelected = null;
  lbSelect.hidden = true;
  hostInput.hidden = true;
  setStatus(ui, "");
  renderChrome();
  pull();
}

async function toggleSample() {
  if (mode === "path") {
    sample = !sample;
    ui.sample = sample;
    if (sample && !sampleRadio) {
      const body = await fetch("/api/sample").then((response) => response.json()).catch(() => ({}));
      sampleRadio = body.radio || "";
    }
    if (sample) setRadio(ui, sampleRadio);
    regionSelect.disabled = sample;
    pathData = null;
    pathSelected = null;
    lbSelect.replaceChildren();
    setStatus(ui, sample ? "sample, not the account" : "reading the path");
    renderChrome();
    draw();
    pullPath();
    return;
  }
  if (sample) {
    leaveSample();
    return;
  }
  try {
    const response = await fetch("/api/sample");
    if (!response.ok) throw new Error("the page failed");
    const body = await response.json();
    if (!body?.place) throw new Error("the page failed");
    sampleRadio = body.radio || "";
    setRadio(ui, sampleRadio);
    showSample(body.place);
  } catch {
    errorEl.hidden = false;
    if (!errorEl.textContent) errorEl.textContent = "the page failed";
  }
}

canvas.addEventListener("click", async (event) => {
  if (mode === "path") {
    const hit = nodeAt(placedPath(), event.offsetX, event.offsetY);
    pathSelected = hit?.id || null;
    draw();
    return;
  }
  if (!place) {
    clickGround(ui);
    renderChrome();
    draw();
    return;
  }
  const hit = buildingAt(placedMap(), event.offsetX, event.offsetY);
  if (!hit) {
    clickGround(ui);
    renderChrome();
    draw();
    return;
  }
  const raw = place.instances.find((item) => item.id === hit.id) || hit;
  clickBuilding(ui, raw, region);
  renderChrome();
  draw();
  if (sample || !isInstanceId(raw.id)) return;
  const logs = await fetch(`/api/logs?id=${encodeURIComponent(raw.id)}`).then((response) => response.json());
  if (ui.selection?.id !== raw.id) return;
  setLogs(ui, logs.entries || logs.lines || [], logs.note || "");
  draw();
});

yes.addEventListener("click", () => act(pressY(ui)));
no.addEventListener("click", () => {
  pressN(ui);
  renderChrome();
  draw();
});

window.addEventListener("keydown", (event) => {
  if (mode === "path") return;
  if (!ui.confirmation) return;
  const key = event.key.toLowerCase();
  if (key !== "y" && key !== "n") return;
  event.preventDefault();
  if (key === "y") act(pressY(ui));
  else {
    pressN(ui);
    renderChrome();
    draw();
  }
});

function flipSample(action) {
  const state = flipSampleState(place, action, layoutCache);
  if (!state) return;
  if (ui.selection?.id === action.id) ui.selection = { ...ui.selection, state };
  setStatus(ui, "sample, not the account");
}

async function act(action) {
  renderChrome();
  draw();
  if (!action) return;
  if (action.local) {
    flipSample(action);
    renderChrome();
    draw();
    return;
  }
  const path = action.verb === "start" ? "/api/start" : "/api/stop";
  const body = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: action.id }),
  }).then((response) => response.json());
  if (body.status) setStatus(ui, body.status);
  renderChrome();
  await pull();
}

sampleButton.addEventListener("click", () => {
  toggleSample();
});

regionSelect.addEventListener("change", async () => {
  if (sample) return;
  switchRegion(ui);
  renderChrome();
  draw();
  const body = await fetch("/api/region", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ region: regionSelect.value }),
  }).then((response) => response.json());
  if (body.status) setStatus(ui, body.status);
  await pull();
  if (mode === "path") {
    pathData = null;
    pathSelected = null;
    lbSelect.replaceChildren();
    hostInput.value = "";
    await pullPath();
  }
});

pathButton.addEventListener("click", () => {
  if (mode !== "path") enterPath();
});

tabMap.addEventListener("click", () => {
  if (mode === "path") leavePath();
});

tabRadio.addEventListener("click", () => {
  radioPanel.hidden = !radioPanel.hidden;
  renderChrome();
  draw();
  if (!radioPanel.hidden) drawScope(scope, reducedMotion ? 0 : animTime, stations.length);
});

radioEl.addEventListener("click", (event) => {
  const li = event.target.closest("li[data-index]");
  if (!li) return;
  station = Number(li.dataset.index);
  renderChrome();
});

lbSelect.addEventListener("change", () => {
  hostInput.value = "";
  pathSelected = null;
  pullPath();
});

hostInput.addEventListener("change", () => {
  pathSelected = null;
  pullPath();
});

setInterval(() => {
  if (mode === "path") pullPath();
}, 15_000);

window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
  reducedMotion = e.matches;
});

document.addEventListener("visibilitychange", () => {
  tabVisible = !document.hidden;
});

// Animation loop: a plain 10fps timer. requestAnimationFrame would wake the
// page 60 times a second just to skip 5 of every 6 frames.
function animate() {
  animTime += FRAME_MS;
  if (!tabVisible) return;
  if (animTime % 1000 === 0) clockEl.textContent = clockText(new Date());
  if (reducedMotion) return;
  if (canvas.width) draw();
  if (!radioPanel.hidden) drawScope(scope, animTime, stations.length);
  // The mascot winks for a moment every eight seconds.
  const wink = animTime % 8000 < 300 ? 1 : 0;
  if (wink !== winking) {
    winking = wink;
    drawMascot(mascotCanvas, wink);
  }
}

paintIcons();
drawMascot(mascotCanvas, 0);
clockEl.textContent = clockText(new Date());
if (window.matchMedia("(max-width: 900px)").matches) {
  radioOpen.map = false;
  radioPanel.hidden = true;
}
renderChrome();
drawScope(scope, 0, 0);

setInterval(animate, FRAME_MS);

window.addEventListener("resize", () => {
  draw();
  if (!radioPanel.hidden) drawScope(scope, reducedMotion ? 0 : animTime, stations.length);
});

setInterval(() => {
  pull();
}, 2000);

pull();
