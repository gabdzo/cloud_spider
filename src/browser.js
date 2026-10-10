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
import { layoutPath, layoutDiagram, nodeAt } from "./path-layout.js";
import { paintPath } from "./path-draw.js";
import { drawSprite, paintDiagram } from "./scene.js";
import { barrel, radiationMark, sceneIcon, vaultDwellerSitting } from "./pixel-art.js";
import { CLUSTER_COLUMNS } from "./cluster.js";
import { upgradeSpiderLine } from "./upgrade-rules.js";

const ui = createUi();
const canvas = document.querySelector("#place");
const ctx = canvas.getContext("2d");
const regionSelect = document.querySelector("#region");
const statusEl = document.querySelector("#status");
const radioEl = document.querySelector("#radio");
const radioToggle = document.querySelector("#radio-toggle");
const radioSummary = document.querySelector("#radio-summary");
const radioLines = document.querySelector("#radio-lines");
const radioMark = document.querySelector("#radio-mark");
const confirmEl = document.querySelector("#confirm");
const errorEl = document.querySelector("#error");
const yes = document.querySelector("#yes");
const no = document.querySelector("#no");
const sampleButton = document.querySelector("#sample");
const map = document.querySelector("#map");
const pathButton = document.querySelector("#path");
const clusterButton = document.querySelector("#cluster");
const home = document.querySelector("#home");
const spendEl = document.querySelector("#spend");
const tallyEl = document.querySelector("#tally");
const tallyText = document.querySelector("#tally-text");
const wallGrain = document.querySelector("#wall-grain");
const upgradeButton = document.querySelector("#upgrade");
const pipEl = document.querySelector("#pip");
const lbSelect = document.querySelector("#lb");
const hostInput = document.querySelector("#host");

let place = null;
const spider = [];
let spiderRegion = "";
let region = "";
let animTime = 0;
let pulling = false;
let sample = false;
let mode = "map";
let pathData = null;
let pathSelected = null;
let pathPulling = false;
let pathAgain = false;
let spend = null;
let spendSample = null;
let spendOpen = false;
let spendTicket = 0;
let radioOpen = false;
let pipOpen = false;
let openCard = null;
let campGrain = "coarse";
let pipRunning = false;
let pipModules = [];
let clusterData = null;
let clusterSelected = null;
let clusterPulling = false;
let clusterAgain = false;
let reducedMotion = !window.matchMedia("(prefers-reduced-motion: reduce)").matches ? false : true;
let tabVisible = !document.hidden;

// Cache for layout to avoid recomputing every frame
const layoutCache = createLayoutCache(layout);

function paintHome() {
  const dpr = window.devicePixelRatio || 1;
  const width = 48;
  const height = 44;
  home.width = Math.round(width * dpr);
  home.height = Math.round(height * dpr);
  home.style.width = `${width}px`;
  home.style.height = `${height}px`;
  const hctx = home.getContext("2d");
  hctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  hctx.imageSmoothingEnabled = false;
  const sprite = vaultDwellerSitting();
  drawSprite(hctx, sprite, Math.round((width - sprite[0].length) / 2), Math.round((height - sprite.length) / 2), 1);
}

function spendText() {
  const label = spend?.label || "Cost";
  if (!spendOpen) return label;
  const lines = (spend?.lines || []).filter((line) => line !== label);
  return [label, ...lines].join("\n");
}

function renderTally() {
  const onMap = mode === "map" && Boolean(place);
  tallyEl.hidden = !onMap;
  if (!onMap) return;
  const line = accountLine(place);
  const pageFail = !errorEl.hidden && errorEl.textContent ? errorEl.textContent : "";
  const current = pageFail || place.linkNote || place.shelfNote || newestFail(logRows());
  tallyText.textContent = [line, current].filter(Boolean).join("\n");
}

function placeGrain(placed) {
  const camp = mode === "map" ? placed?.camp : null;
  wallGrain.hidden = !camp;
  if (!camp) return;
  wallGrain.value = campGrain;
  wallGrain.style.left = `${Math.max(8, camp.x + camp.w - 110)}px`;
  wallGrain.style.top = `${camp.y + 6}px`;
}

function showSpend() {
  const onMap = mode === "map";
  spendEl.hidden = !onMap;
  pipEl.hidden = !pipOpen;
  if (!onMap) return;
  spendEl.textContent = spendText();
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
    showSpend();
  } catch {
    if (ticket !== spendTicket || wasSample !== sample) return;
    spend = { label: "the page failed", lines: ["the page failed"] };
    noteSpider("the bill did not load", "fail");
    spendSample = wasSample;
    showSpend();
  }
}

function queueSpend() {
  showSpend();
  if (mode !== "map") return;
  if (spend && spendSample === sample) return;
  loadSpend();
}

function goOverview() {
  if (mode === "path") leavePath();
  else if (mode === "cluster") leaveCluster();
}

function noteSpider(text, status = "ok") {
  if (!text || spider.some((row) => row.text === text && row.status === status)) return false;
  spider.unshift({ time: Date.now(), status, text });
  if (spider.length > 4) spider.length = 4;
  return true;
}

function paintRadioMark() {
  const dpr = window.devicePixelRatio || 1;
  const sprite = radiationMark();
  const scale = 1;
  const width = sprite[0].length * scale;
  const height = sprite.length * scale;
  radioMark.width = Math.round(width * dpr);
  radioMark.height = Math.round(height * dpr);
  radioMark.style.width = `${width}px`;
  radioMark.style.height = `${height}px`;
  const rctx = radioMark.getContext("2d");
  rctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  rctx.imageSmoothingEnabled = false;
  drawSprite(rctx, sprite, 0, 0, scale);
}

function timeNote(time) {
  if (!time) return "--:--";
  const date = new Date(time);
  const clock = date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  if (date >= start) return clock;
  const yesterday = new Date(start);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date >= yesterday) return `yday ${clock}`;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${date.getDate()} ${months[date.getMonth()]} ${clock}`;
}

function logRows() {
  const pageIssue = !errorEl.hidden && errorEl.textContent
    ? [{ time: 0, status: "fail", text: errorEl.textContent, issue: "", count: 1 }]
    : [];
  const trail = (ui.trail || []).filter((row) => row?.text && row.text !== "the radio is quiet");
  return [...pageIssue, ...spider, ...trail].slice(0, 8);
}

function renderRadio() {
  const rows = logRows();
  const trouble = rows.some((row) => row.status === "fail");
  radioEl.hidden = mode !== "map" || rows.length === 0;
  radioEl.classList.toggle("issue", trouble);
  radioToggle.classList.toggle("issue", trouble);
  if (!rows.length) return;
  const lead = rows.find((row) => row.status === "fail") || rows[0];
  const rest = rows.filter((row) => row !== lead);
  const count = rest.length ? `  +${rest.length}` : "";
  radioSummary.textContent = radioOpen || !rest.length ? rowText(lead) : `${rowText(lead)}${count}`;
  radioLines.hidden = !radioOpen || rest.length === 0;
  radioLines.replaceChildren(...rest.map(logRow));
  radioToggle.setAttribute("aria-expanded", radioOpen ? "true" : "false");
}

function rowText(row) {
  const count = row.count > 1 ? `  ×${row.count}` : "";
  const issue = row.issue ? `  ${row.issue}` : "";
  return `${timeNote(row.time)}  ${row.status === "fail" ? "fail" : "ok"}  ${row.text}${count}${issue}`;
}

function logRow(row) {
  const line = document.createElement("div");
  line.className = row.status === "fail" ? "log fail" : "log";
  const when = document.createElement("span");
  when.className = "when";
  when.textContent = timeNote(row.time);
  const mark = document.createElement("span");
  mark.className = "mark";
  mark.textContent = row.status === "fail" ? "fail" : "ok";
  const what = document.createElement("span");
  what.className = "what";
  const count = row.count > 1 ? ` ×${row.count}` : "";
  const issue = row.issue ? `  ${row.issue}` : "";
  what.textContent = `${row.text}${count}${issue}`;
  line.append(when, mark, what);
  return line;
}

function renderChrome() {
  renderTally();
  const names = troubleNames().filter((name) => !(ui.status || "").includes(name));
  statusEl.textContent = names.length ? `${ui.status ? `${ui.status}  ` : ""}${names.join(", ")} is in trouble` : ui.status;
  const words = `${statusEl.textContent} ${!errorEl.hidden ? errorEl.textContent : ""}`;
  statusEl.classList.toggle("issue", hasTrouble() || /did not|cannot|fail|denied|broken|trouble/i.test(words));
  renderRadio();
  showSpend();
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
  yes.textContent = ui.confirmation?.verb === "start" ? "bring it back" : "put it down";
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
    wallGrain.hidden = true;
    tallyEl.hidden = true;
    drawPath();
    return;
  }
  if (mode === "cluster") {
    wallGrain.hidden = true;
    tallyEl.hidden = true;
    drawCluster();
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
  placeGrain(placed);
  renderTally();
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
    setTrail(ui, view.trail || []);
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
  pull();
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
}

function enterPath() {
  dropSample();
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

function placedCluster() {
  return clusterData?.diagram
    ? layoutDiagram(clusterData.diagram, CLUSTER_COLUMNS, map.clientWidth || 0)
    : { nodes: [], edges: [], contentWidth: 960, contentHeight: 640 };
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
    icon: (node) => sceneIcon(node.kind),
  });
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
    if (clusterSelected && !body.diagram?.nodes?.some((node) => node.id === clusterSelected)) {
      clusterSelected = null;
    }
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
  mode = "map";
  clusterData = null;
  clusterSelected = null;
  setStatus(ui, "");
  renderChrome();
  pull();
  queueSpend();
}

async function toggleSample() {
  if (mode === "path" || mode === "cluster") {
    sample = !sample;
    ui.sample = sample;
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
    showSample(body.place);
    queueSpend();
  } catch {
    sample = false;
    ui.sample = false;
    regionSelect.disabled = false;
    errorEl.hidden = false;
    if (!errorEl.textContent) errorEl.textContent = "the page failed";
  }
}

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
  pull();
});

canvas.addEventListener("click", async (event) => {
  if (mode === "path" || mode === "cluster") {
    const placed = mode === "path" ? placedPath() : placedCluster();
    const hit = nodeAt(placed, event.offsetX, event.offsetY);
    if (mode === "path") pathSelected = hit?.id || null;
    else clusterSelected = hit?.id || null;
    draw();
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
    if (!fixture) {
      clickGround(ui);
      renderChrome();
      draw();
      return;
    }
    clickFixture(ui, fixture, fixtureNote(fixture));
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
  if (mode === "path") leavePath();
  else enterPath();
});

clusterButton.addEventListener("click", () => {
  if (mode === "cluster") leaveCluster();
  else enterCluster();
});

const CARD_ART = {
  eks: () => sceneIcon("eks"),
  signal: () => radiationMark(),
  barrel: () => barrel(),
  camp: () => sceneIcon("bucket"),
};

function paintCardMark(canvas, id) {
  const sprite = CARD_ART[id]?.();
  if (!sprite || !canvas) return;
  const dpr = window.devicePixelRatio || 1;
  const scale = 2;
  const width = sprite[0].length * scale;
  const height = sprite.length * scale;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const mark = canvas.getContext("2d");
  mark.setTransform(dpr, 0, 0, dpr, 0, 0);
  mark.imageSmoothingEnabled = false;
  drawSprite(mark, sprite, 0, 0, scale);
}

function drawPipForm() {
  pipEl.replaceChildren();
  if (!pipModules.length) {
    pipEl.textContent = "no upgrade";
    return;
  }
  for (const spec of pipModules) {
    const card = document.createElement("section");
    card.className = "card";
    card.dataset.id = spec.id;
    const head = document.createElement("button");
    head.type = "button";
    head.className = "card-head";
    const mark = document.createElement("canvas");
    mark.className = "card-mark";
    mark.width = 24;
    mark.height = 24;
    mark.setAttribute("aria-hidden", "true");
    const title = document.createElement("span");
    title.textContent = spec.title;
    head.append(mark, title);
    head.addEventListener("click", () => {
      openCard = openCard === spec.id ? null : spec.id;
      drawPipForm();
      if (openCard) refreshUpgrade(true);
    });
    card.append(head);
    if (openCard === spec.id) {
      card.classList.add("open");
      const body = document.createElement("div");
      body.className = "card-body";
      const note = document.createElement("div");
      note.textContent = spec.note || "";
      const watch = document.createElement("div");
      watch.id = "pip-watch";
      watch.hidden = true;
      body.append(note, watch);
      if (spec.id === "camp") {
        const grainLabel = document.createElement("label");
        grainLabel.append("grain ");
        const grain = document.createElement("select");
        grain.id = "camp-grain";
        for (const choice of ["coarse", "fine"]) {
          const option = document.createElement("option");
          option.value = choice;
          option.textContent = choice;
          if (choice === campGrain) option.selected = true;
          grain.append(option);
        }
        grain.addEventListener("change", () => {
          campGrain = grain.value;
          wallGrain.value = campGrain;
          pull();
        });
        grainLabel.append(grain);
        body.append(grainLabel);
      }
      for (const parameter of spec.parameters || []) {
        const label = document.createElement("label");
        label.append(`${parameter.name} `);
        let field;
        if (parameter.choices) {
          field = document.createElement("select");
          for (const choice of parameter.choices) {
            const option = document.createElement("option");
            option.value = choice;
            option.textContent = choice;
            if (choice === parameter.default) option.selected = true;
            field.append(option);
          }
        } else {
          field = document.createElement("input");
          field.value = parameter.default ?? "";
        }
        field.name = parameter.name;
        label.append(field);
        body.append(label);
      }
      const confirm = document.createElement("input");
      confirm.name = "confirmName";
      confirm.placeholder = "type the name";
      confirm.autocomplete = "off";
      const run = document.createElement("button");
      run.type = "button";
      run.textContent = "run";
      run.addEventListener("click", () => postUpgrade("up"));
      const down = document.createElement("button");
      down.type = "button";
      down.textContent = "take it down";
      down.addEventListener("click", () => postUpgrade("destroy"));
      const out = document.createElement("pre");
      out.id = "pip-out";
      body.append(confirm, run, down, out);
      card.append(body);
    }
    pipEl.append(card);
    paintCardMark(mark, spec.id);
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
  pipRunning = Boolean(body?.running);
  const watch = document.querySelector("#pip-watch");
  if (watch) {
    const text = body?.watch?.text || "";
    watch.hidden = !text;
    watch.textContent = text;
    watch.classList.toggle("fail", body?.watch?.status === "fail");
    if (text && noteSpider(text, body.watch.status === "fail" ? "fail" : "ok")) renderRadio();
  }
  const out = document.querySelector("#pip-out");
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
  const body = await fetch(`/api/upgrade?${query}`).then((response) => response.json());
  paintUpgrade(body);
}

async function postUpgrade(action) {
  const spec = openSpec();
  const out = document.querySelector("#pip-out");
  if (!spec) return;
  if (sample) {
    const line = upgradeSpiderLine({ action, title: spec.title, sample: true });
    noteSpider(line.text, line.status);
    renderRadio();
    if (out) out.textContent = line.text;
    return;
  }
  const body = await fetch("/api/upgrade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ module: spec.id, action, params: pipParams() }),
  }).then((response) => response.json());
  const line = upgradeSpiderLine({ action, title: spec.title, response: body });
  noteSpider(line.text, line.status);
  renderRadio();
  paintUpgrade(body);
}

async function toggleUpgrade() {
  pipOpen = !pipOpen;
  showSpend();
  if (!pipOpen) return;
  if (!pipModules.length) {
    const body = await fetch("/api/upgrades").then((response) => response.json());
    pipModules = body.modules || [];
    drawPipForm();
  }
  refreshUpgrade(true);
}

radioToggle.addEventListener("click", () => {
  radioOpen = !radioOpen;
  renderRadio();
});

upgradeButton.addEventListener("click", () => {
  toggleUpgrade();
});
pipEl.addEventListener("submit", (event) => event.preventDefault());

home.addEventListener("click", goOverview);
home.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  goOverview();
});

spendEl.addEventListener("click", () => {
  spendOpen = !spendOpen;
  showSpend();
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

window.matchMedia("(prefers-reduced-motion: reduce)").addEventListener("change", (e) => {
  reducedMotion = e.matches;
});

document.addEventListener("visibilitychange", () => {
  tabVisible = !document.hidden;
});

// Animation loop: a plain 10fps timer. requestAnimationFrame would wake the
// page 60 times a second just to skip 5 of every 6 frames.
const FRAME_MS = 100;

function animate() {
  animTime += FRAME_MS;
  if (tabVisible && !reducedMotion && canvas.width) draw();
}

setInterval(animate, FRAME_MS);

window.addEventListener("resize", () => draw());

setInterval(() => {
  pull();
}, 2000);

setInterval(() => {
  if (pipOpen && openCard) refreshUpgrade(false);
}, 2000);

paintHome();
paintRadioMark();
pull();
queueSpend();
