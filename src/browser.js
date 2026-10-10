import { ROW_LIMIT, accountLine, layout, newestFail } from "./layout.js";
import { createLayoutCache, flipSampleState } from "./layout-cache.js";
import { buildingAt, fixtureAt, paint } from "./draw.js";
import { isInstanceId } from "./ids.js";
import {
  clickBuilding,
  clickFixture,
  clickGround,
  createUi,
  pressN,
  pressY,
  setLogs,
  setRadio,
  setStatus,
  setTrail,
  switchRegion,
} from "./ui.js";
import { layoutDiagram, layoutPath, nodeAt } from "./path-layout.js";
import { paintDiagram, paintPath, sentenceRect } from "./path-draw.js";
import { CLUSTER_COLUMNS } from "./cluster.js";
import { upgradeSpiderLine } from "./upgrade-rules.js";
import {
  clockText, drawMascot, drawScope, iconURL, mapStats, scrollToShow, needleAt, paintIcons, pathStats, renderRadio, renderStats, setIcon,
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
const clusterButton = document.querySelector("#cluster");
const home = document.querySelector("#home");
const spendEl = document.querySelector("#spend");
const spendLabel = document.querySelector("#spend-label");
const spendLines = document.querySelector("#spend-lines");
const tallyEl = document.querySelector("#tally");
const tallyText = document.querySelector("#tally-text");
const wallGrain = document.querySelector("#wall-grain");
const upgradeButton = document.querySelector("#upgrade");
const pipEl = document.querySelector("#pip");

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
let sampleTrail = [];
let stations = [];
// The spider's own notes for the radio: a region read, the bill, a stack.
const spider = [];
let spiderRegion = "";
let spend = null;
let spendSample = null;
let spendOpen = false;
let spendTicket = 0;
let pipOpen = false;
let openCard = null;
let campGrain = "coarse";
let pipModules = [];
let clusterData = null;
let clusterSelected = null;
let clusterPulling = false;
let clusterAgain = false;
let station = 0;
let winking = -1;

// Cache for layout to avoid recomputing every frame
const layoutCache = createLayoutCache(layout);

function renderChrome() {
  renderTally();
  const names = troubleNames().filter((name) => !(ui.status || "").includes(name));
  statusEl.textContent = names.length ? `${ui.status ? `${ui.status}  ` : ""}${names.join(", ")} is in trouble` : ui.status;
  const words = `${statusEl.textContent} ${!errorEl.hidden ? errorEl.textContent : ""}`;
  statusEl.classList.toggle("issue", hasTrouble() || /did not|cannot|fail|denied|broken|trouble/i.test(words));
  renderRadioPanel();
  showSpend();
  sampleButton.setAttribute("aria-pressed", String(sample));
  tabMap.setAttribute("aria-pressed", String(mode === "map"));
  pathButton.setAttribute("aria-pressed", String(mode === "path"));
  clusterButton.setAttribute("aria-pressed", String(mode === "cluster"));
  tabRadio.setAttribute("aria-pressed", String(!radioPanel.hidden));
  upgradeButton.setAttribute("aria-pressed", String(pipOpen));
  acct.textContent = sample ? "SAMPLE" : "LIVE";
  const stats = mode === "path" ? pathStats(pathData?.diagram) : mode === "cluster" ? pathStats(clusterData?.diagram) : mapStats(place);
  renderStats(statsEl, stats);
  if (mode === "path" || mode === "cluster") {
    const notes = mode === "path" ? pathData?.notes || [] : [];
    const clusterNote = mode === "cluster" ? clusterData?.note || "" : "";
    confirmEl.textContent = clusterNote || notes.join("  ");
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

// ---- radio: page failure, the spider's notes and the trail, newest first ----

function noteSpider(text, status = "ok") {
  if (!text || spider.some((row) => row.text === text && row.status === status)) return false;
  spider.unshift({ time: Date.now(), status, text, issue: "", count: 1 });
  if (spider.length > 4) spider.length = 4;
  return true;
}

function logRows() {
  const pageIssue = !errorEl.hidden && errorEl.textContent
    ? [{ time: 0, status: "fail", text: errorEl.textContent, issue: "", count: 1 }]
    : [];
  const trail = (ui.trail || []).filter((row) => row?.text && row.text !== "the radio is quiet");
  return [...pageIssue, ...spider, ...trail].slice(0, 8);
}

function renderRadioPanel() {
  const rows = logRows();
  if (station >= rows.length) station = 0;
  stations = renderRadio(radioEl, rows, station);
  const trouble = rows.some((row) => row.status === "fail");
  radioPanel.classList.toggle("issue", trouble);
  tabRadio.classList.toggle("issue", trouble);
  stationCount.textContent = stations.length ? `${stations.length} STATIONS` : "NO SIGNAL";
  needle.style.left = `${needleAt(station, stations.length)}%`;
}

// ---- the map's own readouts: tally, trouble names, the bill ----

function renderTally() {
  const onMap = mode === "map" && Boolean(place);
  tallyEl.hidden = !onMap;
  if (!onMap) return;
  const line = accountLine(place);
  // The page's own failure already has the red line under the status bar;
  // the tally only carries what is wrong on the map itself.
  const current = place.linkNote || place.shelfNote || newestFail((ui.trail || []).concat(spider));
  tallyText.textContent = [line, current].filter(Boolean).join("\n");
  tallyEl.classList.toggle("issue", Boolean(current));
  tallyEl.hidden = !tallyText.textContent;
}

function hasTrouble() {
  if (mode === "path") return (pathData?.findings || []).some((item) => item.status && item.status !== "ok");
  if (mode === "cluster") return (clusterData?.diagram?.nodes || []).some((node) => node.status === "broken");
  return (place?.fixtures || []).some((item) => item.status === "broken");
}

function troubleNames() {
  if (mode === "cluster") {
    return (clusterData?.diagram?.nodes || [])
      .filter((node) => node.status === "broken")
      .map((node) => node.label || node.kind)
      .filter(Boolean)
      .slice(0, 2);
  }
  if (mode !== "map") return [];
  return (place?.fixtures || [])
    .filter((item) => item.status === "broken")
    .map((item) => item.name || item.kind)
    .filter(Boolean)
    .slice(0, 2);
}

function showSpend() {
  const onMap = mode === "map";
  spendEl.hidden = !onMap || !spend;
  pipEl.hidden = !pipOpen;
  if (spendEl.hidden) return;
  const label = spend?.label || "the bill";
  spendLabel.textContent = label;
  const lines = (spend?.lines || []).filter((line) => line !== label);
  spendLines.textContent = lines.join("\n");
  spendLines.hidden = !spendOpen || !lines.length;
  spendEl.setAttribute("aria-expanded", String(spendOpen));
  spendEl.classList.toggle("issue", Boolean(spend?.error));
  spendEl.title = spendOpen ? "" : label;
}

async function loadSpend() {
  const ticket = ++spendTicket;
  const wasSample = sample;
  try {
    const response = await fetch(wasSample ? "/api/cost-sample" : "/api/cost");
    const body = await response.json();
    if (ticket !== spendTicket || wasSample !== sample) return;
    spend = body;
    spendSample = wasSample;
    noteSpider(wasSample ? "read the sample bill" : "read the bill");
  } catch {
    if (ticket !== spendTicket || wasSample !== sample) return;
    spend = { label: "the page failed", lines: ["the page failed"], error: "the page failed" };
    noteSpider("the bill did not load", "fail");
    spendSample = wasSample;
  }
  renderChrome();
}

function queueSpend() {
  showSpend();
  if (mode !== "map") return;
  if (spend && spendSample === sample) return;
  loadSpend();
}

// The camp's coarse/fine switch sits on the camp wall and scrolls with it.
function placeGrain(placed) {
  const camp = mode === "map" ? placed?.camp : null;
  wallGrain.hidden = !camp;
  if (!camp) return;
  wallGrain.value = campGrain;
  wallGrain.style.left = `${Math.max(8, camp.x + camp.w - 110)}px`;
  wallGrain.style.top = `${camp.y + 8}px`;
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
    : { nodes: [], edges: [], contentWidth: 0, contentHeight: 0 };
}

function placedMap() {
  const width = map.clientWidth || 0;
  const rowLimit = width ? Math.min(ROW_LIMIT, width) : ROW_LIMIT;
  return layoutCache.get(place, rowLimit);
}

// On a narrow window the diagnosis can land past the edge of the scrolled
// map; scroll just enough to show it, keeping its left edge in view.
function revealPanel(rect) {
  const left = scrollToShow(map.scrollLeft, map.clientWidth, rect.x, rect.w);
  const top = scrollToShow(map.scrollTop, map.clientHeight, rect.y, rect.h);
  if (left !== map.scrollLeft || top !== map.scrollTop) map.scrollTo({ left, top, behavior: reducedMotion ? "auto" : "smooth" });
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

function placedCluster() {
  return clusterData?.diagram
    ? layoutDiagram(clusterData.diagram, CLUSTER_COLUMNS, map.clientWidth || 0)
    : { nodes: [], edges: [], contentWidth: 0, contentHeight: 0 };
}

function drawCluster() {
  const placed = placedCluster();
  const { width, height } = sizeCanvas(placed.contentWidth, placed.contentHeight);
  paintDiagram(ctx, {
    placed,
    selectedId: clusterSelected,
    animTime,
    width,
    height,
    empty: clusterData?.headline || clusterData?.error || "reading the cluster",
    reducedMotion,
  });
}

function draw() {
  if (mode === "path" || mode === "cluster") {
    wallGrain.hidden = true;
    tallyEl.hidden = true;
    if (mode === "path") drawPath();
    else drawCluster();
    return;
  }
  
  // Layout is cached per place; flipSampleState invalidates it on mutation.
  const placed = place
    ? placedMap()
    : {
        settlements: [],
        orphans: { items: [], label: "no VPC" },
        contentWidth: 0,
        contentHeight: 0,
      };

  const { width, height } = sizeCanvas(placed.contentWidth, placed.contentHeight);
  paint(ctx, { placed, ui, region, animTime, width, height, reducedMotion });
  placeGrain(placed);
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
    const query = new URLSearchParams({ grain: campGrain });
    if (sample) query.set("sample", "1");
    const view = await fetch(`/api/view?${query}`).then((response) => response.json());
    setRadio(ui, view.radio || "");
    setTrail(ui, sample ? sampleTrail : view.trail || []);
    if (mode === "path" || mode === "cluster") {
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
    if (region && region !== spiderRegion) {
      spiderRegion = region;
      noteSpider(`read ${region}`);
    }
    for (const fixture of place?.fixtures || []) {
      if (fixture.status === "broken") noteSpider(`${fixture.name || fixture.kind} is down`, "fail");
    }
    if (place?.shelfNote) noteSpider(place.shelfNote, "fail");
    if (place?.linkNote) noteSpider(place.linkNote, "fail");
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
  setTrail(ui, []);
  pull();
queueSpend();
  queueSpend();
  if (pipOpen && openCard) refreshUpgrade(true);
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
  // Forget the sample camp and stations at once; the live ones arrive with
  // the next pull, and until then the screen must not pass sample off as LIVE.
  place = null;
  setRadio(ui, "");
  setTrail(ui, []);
}

// The radio panel remembers whether it is open per view; the path needs the
// width more, so it starts closed there unless the window is wide.
const radioOpen = { map: true, path: window.innerWidth >= 1700, cluster: window.innerWidth >= 1700 };

function showRadioFor(next) {
  radioOpen[mode] = !radioPanel.hidden;
  radioPanel.hidden = !radioOpen[next];
}

function enterPath() {
  dropSample();
  showRadioFor("path");
  mode = "path";
  clusterData = null;
  clusterSelected = null;
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
  queueSpend();
}

async function pullCluster() {
  if (clusterPulling) {
    clusterAgain = true;
    return;
  }
  clusterPulling = true;
  const wasSample = sample;
  try {
    const response = await fetch(wasSample ? "/api/cluster-sample" : "/api/cluster");
    const body = await response.json();
    if (body.stale || mode !== "cluster" || wasSample !== sample) return;
    clusterData = body;
    if (clusterSelected && !body.diagram?.nodes?.some((node) => node.id === clusterSelected)) clusterSelected = null;
    setStatus(ui, body.error ? "" : body.headline || (wasSample ? "sample, not the account" : ""));
    errorEl.hidden = !body.error;
    errorEl.textContent = body.error || "";
    renderChrome();
    draw();
  } catch {
    errorEl.hidden = false;
    errorEl.textContent = "the page failed";
  } finally {
    clusterPulling = false;
    if (clusterAgain) {
      clusterAgain = false;
      pullCluster();
    }
  }
}

function enterCluster() {
  dropSample();
  showRadioFor("cluster");
  mode = "cluster";
  clusterData = null;
  clusterSelected = null;
  pathData = null;
  pathSelected = null;
  lbSelect.hidden = true;
  hostInput.hidden = true;
  clickGround(ui);
  setStatus(ui, "reading the cluster");
  renderChrome();
  draw();
  pullCluster();
}

function leaveCluster() {
  dropSample();
  showRadioFor("map");
  mode = "map";
  clusterData = null;
  clusterSelected = null;
  setStatus(ui, "");
  renderChrome();
  pull();
  queueSpend();
}

// The mascot porthole is "home": back to the map from Path or Cluster.
function goOverview() {
  if (mode === "path") leavePath();
  else if (mode === "cluster") leaveCluster();
}

async function loadSampleTrail() {
  if (sampleTrail.length) return;
  const body = await fetch("/api/sample").then((response) => response.json()).catch(() => ({}));
  sampleTrail = body.trail || [];
}

async function toggleSample() {
  if (mode === "path" || mode === "cluster") {
    sample = !sample;
    ui.sample = sample;
    if (sample) await loadSampleTrail();
    setTrail(ui, sample ? sampleTrail : []);
    setRadio(ui, "");
    regionSelect.disabled = sample;
    if (mode === "path") {
      pathData = null;
      pathSelected = null;
      lbSelect.replaceChildren();
      setStatus(ui, sample ? "sample, not the account" : "reading the path");
    } else {
      clusterData = null;
      clusterSelected = null;
      setStatus(ui, sample ? "sample, not the account" : "reading the cluster");
    }
    renderChrome();
    draw();
    if (mode === "path") pullPath();
    else pullCluster();
    if (!sample) pull();
    return;
  }
  if (sample) {
    leaveSample();
    return;
  }
  sample = true;
  ui.sample = true;
  regionSelect.disabled = true;
  try {
    const response = await fetch("/api/sample");
    if (!response.ok) throw new Error("the page failed");
    const body = await response.json();
    if (!body?.place) throw new Error("the page failed");
    sampleTrail = body.trail || [];
    setTrail(ui, sampleTrail);
    showSample(body.place);
    queueSpend();
  } catch {
    sample = false;
    ui.sample = false;
    regionSelect.disabled = false;
    errorEl.hidden = false;
    if (!errorEl.textContent) errorEl.textContent = "the page failed";
    renderChrome();
  }
}

// A fixture's plate note: what it uses, and the newest failure naming it.
function fixtureNote(hit) {
  const byId = new Map((place?.fixtures || []).map((item) => [item.id, item.name || item.kind || item.id]));
  const names = (hit.uses || []).map((id) => byId.get(id) || id);
  const bits = names.length ? [`uses ${names.join(", ")}`] : [];
  const fail = (!errorEl.hidden && errorEl.textContent) || place?.linkNote || place?.shelfNote || newestFail(logRows());
  const name = hit.name || hit.label || "";
  if (fail && name && fail.includes(name)) bits.push(fail);
  return bits.join("\n");
}

wallGrain.addEventListener("change", () => {
  campGrain = wallGrain.value;
  const grain = pipEl.querySelector("#camp-grain");
  if (grain) grain.value = campGrain;
  pull();
});

canvas.addEventListener("click", async (event) => {
  if (mode === "path" || mode === "cluster") {
    const placed = mode === "path" ? placedPath() : placedCluster();
    const hit = nodeAt(placed, event.offsetX, event.offsetY);
    if (mode === "path") pathSelected = hit?.id || null;
    else clusterSelected = hit?.id || null;
    draw();
    if (hit?.sentence) revealPanel(sentenceRect(hit, canvas.clientWidth, canvas.clientHeight));
    return;
  }
  if (!place) {
    clickGround(ui);
    renderChrome();
    draw();
    return;
  }
  const placed = placedMap();
  const hit = buildingAt(placed, event.offsetX, event.offsetY);
  if (!hit) {
    const fixture = fixtureAt(placed, event.offsetX, event.offsetY);
    if (fixture) clickFixture(ui, fixture, fixtureNote(fixture));
    else clickGround(ui);
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
  if (mode !== "map") return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
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
  if (mode === "cluster") {
    clusterData = null;
    clusterSelected = null;
    await pullCluster();
  }
});

pathButton.addEventListener("click", () => {
  if (mode !== "path") enterPath();
});

// ---- Stacks: Pulumi upgrade cards in a Pip-Boy panel over the map ----

const CARD_ICON = { eks: "cluster", signal: "radio", barrel: "stack", camp: "bucket" };

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
}

function iconImg(name) {
  const img = el("img", { className: "px", alt: "", width: 16, height: 16 });
  img.src = iconURL(name);
  return img;
}

function drawPipForm() {
  const title = el("div", { className: "ptitle" }, iconImg("stack"), "STACKS");
  pipEl.replaceChildren(title);
  if (!pipModules.length) {
    pipEl.append(el("div", { className: "quiet", textContent: "no upgrade" }));
    return;
  }
  for (const spec of pipModules) {
    const card = el("section", { className: "card" });
    card.dataset.id = spec.id;
    const head = el("button", { type: "button", className: "card-head" }, iconImg(CARD_ICON[spec.id] || "stack"), el("span", { textContent: spec.title }));
    head.setAttribute("aria-expanded", String(openCard === spec.id));
    head.addEventListener("click", () => {
      openCard = openCard === spec.id ? null : spec.id;
      drawPipForm();
      if (openCard) refreshUpgrade(true);
    });
    card.append(head);
    if (openCard === spec.id) {
      card.classList.add("open");
      const body = el("div", { className: "card-body" });
      const watch = el("div", { id: "pip-watch" });
      watch.hidden = true;
      body.append(el("div", { textContent: spec.note || "" }), watch);
      if (spec.id === "camp") {
        const grain = el("select", { id: "camp-grain" });
        for (const choice of ["coarse", "fine"]) {
          grain.append(el("option", { value: choice, textContent: choice, selected: choice === campGrain }));
        }
        grain.addEventListener("change", () => {
          campGrain = grain.value;
          wallGrain.value = campGrain;
          pull();
        });
        body.append(el("label", {}, "grain ", grain));
      }
      for (const parameter of spec.parameters || []) {
        let field;
        if (parameter.choices) {
          field = el("select");
          for (const choice of parameter.choices) {
            field.append(el("option", { value: choice, textContent: choice, selected: choice === parameter.default }));
          }
        } else {
          field = el("input", { value: parameter.default ?? "" });
        }
        field.name = parameter.name;
        body.append(el("label", {}, `${parameter.name} `, field));
      }
      const confirm = el("input", { name: "confirmName", placeholder: "type the name", autocomplete: "off" });
      const run = el("button", { type: "button", className: "cmd", textContent: "run" });
      run.addEventListener("click", () => postUpgrade("up"));
      const down = el("button", { type: "button", className: "cmd danger", textContent: "take it down" });
      down.addEventListener("click", () => postUpgrade("destroy"));
      body.append(el("div", { className: "actions" }, confirm, run, down), el("pre", { id: "pip-out" }));
      card.append(body);
    }
    pipEl.append(card);
  }
}

function openSpec() {
  return pipModules.find((item) => item.id === openCard) || null;
}

function pipParams() {
  const params = {};
  const card = pipEl.querySelector(".card.open");
  if (!card) return params;
  for (const field of card.querySelectorAll("input, select")) {
    if (!field.name) continue;
    params[field.name] = field.value;
  }
  return params;
}

function paintUpgrade(body) {
  if (sample) return;
  const watch = pipEl.querySelector("#pip-watch");
  if (watch) {
    const text = body?.watch?.text || "";
    watch.hidden = !text;
    watch.textContent = text;
    watch.classList.toggle("fail", body?.watch?.status === "fail");
    if (text && noteSpider(text, body.watch.status === "fail" ? "fail" : "ok")) renderRadioPanel();
  }
  const out = pipEl.querySelector("#pip-out");
  if (!out) return;
  const lines = [];
  if (body?.error) lines.push(body.error);
  lines.push(...(body?.lines || []));
  out.textContent = lines.join("\n");
}

async function refreshUpgrade(fresh) {
  if (sample || !pipOpen || !openCard) return;
  const query = new URLSearchParams({ module: openCard });
  if (fresh) query.set("fresh", "1");
  const body = await fetch(`/api/upgrade?${query}`).then((response) => response.json()).catch(() => ({ error: "the page failed" }));
  paintUpgrade(body);
}

async function postUpgrade(action) {
  const spec = openSpec();
  const out = pipEl.querySelector("#pip-out");
  if (!spec) return;
  if (sample) {
    const line = upgradeSpiderLine({ action, title: spec.title, sample: true });
    noteSpider(line.text, line.status);
    renderRadioPanel();
    if (out) out.textContent = line.text;
    return;
  }
  const body = await fetch("/api/upgrade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ module: spec.id, action, params: pipParams() }),
  }).then((response) => response.json()).catch(() => ({ error: "the page failed" }));
  const line = upgradeSpiderLine({ action, title: spec.title, response: body });
  noteSpider(line.text, line.status);
  renderRadioPanel();
  paintUpgrade(body);
}

async function toggleUpgrade() {
  pipOpen = !pipOpen;
  renderChrome();
  if (!pipOpen) return;
  if (!pipModules.length) {
    const body = await fetch("/api/upgrades").then((response) => response.json()).catch(() => ({}));
    pipModules = body.modules || [];
  }
  drawPipForm();
  refreshUpgrade(true);
}

tabMap.addEventListener("click", goOverview);

clusterButton.addEventListener("click", () => {
  if (mode !== "cluster") enterCluster();
});

home.addEventListener("click", goOverview);

spendEl.addEventListener("click", () => {
  spendOpen = !spendOpen;
  showSpend();
});

upgradeButton.addEventListener("click", () => {
  toggleUpgrade();
});
pipEl.addEventListener("submit", (event) => event.preventDefault());

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
  if (mode === "cluster") pullCluster();
}, 15_000);

setInterval(() => {
  if (pipOpen && openCard) refreshUpgrade(false);
}, 2000);

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
document.querySelector("link[rel=icon]").href = iconURL("map", 2);
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
