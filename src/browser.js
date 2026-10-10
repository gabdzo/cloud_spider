import { ROW_LIMIT, accountLine, blastLine, layout, newestFail } from "./layout.js";
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
  setFacts,
  setLogs,
  setRadio,
  setStatus,
  setTrail,
  switchRegion,
} from "./ui.js";
import { layoutDiagram, layoutPath, nodeAt } from "./path-layout.js";
import { paintDiagram, paintPath, sentenceRect } from "./path-draw.js";
import { CLUSTER_COLUMNS } from "./cluster.js";
import { KUBE_COLUMNS } from "./kube-diagram.js";
import { upgradeSpiderLine } from "./upgrade-rules.js";
import { costLine } from "./stack-costs.js";
import {
  clockText, drawMascot, drawScope, iconURL, mapStats, scrollToShow, needleAt, paintIcons, pathStats, renderRadio, renderStats, setIcon,
} from "./chrome.js";
import { FRAME_MS } from "./theme.js";
import { createVaultState } from "./vault-state.js";
import { vaultAt } from "./vault-layout.js";
import { plateText } from "./vault-schema.js";
import { snapshot } from "./agent-text.js";
import { createTerminal } from "./terminal.js";
import { metricAlerts, paintPlace } from "./metrics.js";
import { sunrise } from "./sprites/landmarks.js";
import { drawSprite } from "./draw-kit.js";

const ui = createUi();
// The morning report (SRE overview): three sentences from the server's
// reads (or the sample's), shown over the map.
const morningEl = document.querySelector("#morning");
const morningWhen = document.querySelector("#morning-when");
const morningFold = document.querySelector("#morning-fold");
const morningLines = {
  hurting: document.querySelector("#m-hurting"),
  changed: document.querySelector("#m-changed"),
  idle: document.querySelector("#m-idle"),
};
let liveMorning = null;
let sampleMorningData = null;
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
const tallyIssue = document.querySelector("#tally-issue");
const wallGrain = document.querySelector("#wall-grain");
const upgradeButton = document.querySelector("#upgrade");
const pipEl = document.querySelector("#pip");
const vaultPanels = document.querySelector("#vault-panels");
const vaultAll = document.querySelector("#vault-all");
const kubePanel = document.querySelector("#kube-panel");
const vaultTemplatesButton = document.querySelector("#vault-templates-btn");
const vaultTemplates = document.querySelector("#vault-templates");
const askTab = document.querySelector("#ask");
const askThis = document.querySelector("#ask-this");
const termEl = document.querySelector("#term");
let termReady = false;

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
let pipTerraform = [];
let clusterData = null;
let clusterSelected = null;
let clusterPulling = false;
let clusterAgain = false;
let station = 0;
let winking = -1;

// Vaults: projects from YAML files, drawn as doors in a hillside.
let vaultsData = { vaults: [], note: "", templates: [] };
let vaultsFor = null; // sample flag the vaults were read for
let vaultsAt = 0;
let vaultsLoading = false;
let vaultsTicket = 0;
let vaultsShown = "";
let doorFrame = 0;
const vaultLights = new Map();
const vaultState = createVaultState({
  storage: (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })(),
  clock: () => performance.now(),
});
const EMPTY_PLACE = { region: "", vpcs: [], subnets: [], instances: [], fixtures: [] };

// Cache for layout to avoid recomputing every frame
const layoutCache = createLayoutCache(layout);

function renderChrome() {
  renderTally();
  renderMorning();
  const names = troubleNames().filter((name) => !(ui.status || "").includes(name));
  statusEl.textContent = names.length ? `${ui.status ? `${ui.status}  ` : ""}${names.join(", ")} is in trouble` : ui.status;
  const words = `${statusEl.textContent} ${!errorEl.hidden ? errorEl.textContent : ""}`;
  statusEl.classList.toggle("issue", hasTrouble() || /did not|cannot|fail|denied|broken|trouble/i.test(words));
  renderRadioPanel();
  showSpend();
  sampleButton.setAttribute("aria-checked", String(sample));
  tabMap.setAttribute("aria-pressed", String(mode === "map"));
  pathButton.setAttribute("aria-pressed", String(mode === "path"));
  clusterButton.setAttribute("aria-pressed", String(mode === "cluster"));
  tabRadio.setAttribute("aria-pressed", String(!radioPanel.hidden));
  upgradeButton.setAttribute("aria-pressed", String(pipOpen));
  acct.textContent = sample ? "SAMPLE" : "LIVE";
  const stats = mode === "path" ? pathStats(pathData?.diagram) : mode === "cluster" ? pathStats(clusterData?.diagram) : mapStats(place);
  renderStats(statsEl, stats);
  renderAskThis();
  if (termReady) terminal.refresh();
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
  tallyText.textContent = line;
  tallyIssue.textContent = current || "";
  tallyEl.title = [line, current].filter(Boolean).join("\n");
  tallyEl.classList.toggle("issue", Boolean(current));
  tallyEl.hidden = !line && !current;
}

// ---- the morning report ----
const MORNING_RANK = { fail: 0, warn: 1, unknown: 2, ok: 3 };
const MORNING_FOLD_KEY = "cloudspider.morning.folded";
let morningFolded = (() => {
  try {
    return window.localStorage.getItem(MORNING_FOLD_KEY) === "1";
  } catch {
    return false;
  }
})();
let morningShown = "";

function currentMorning() {
  return sample ? sampleMorningData : liveMorning;
}

function hhmm24(time) {
  const date = new Date(time);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function renderMorning() {
  const report = mode === "map" ? currentMorning() : null;
  ui.marks = currentMorning()?.marks || null;
  morningEl.hidden = !report;
  if (!report) return;
  const key = JSON.stringify([report.hurting, report.changed, report.idle, morningFolded]);
  if (key === morningShown) return;
  morningShown = key;
  const order = ["hurting", "changed", "idle"];
  const lead = order.slice().sort((a, b) => (MORNING_RANK[report[a]?.status] ?? 3) - (MORNING_RANK[report[b]?.status] ?? 3))[0];
  for (const name of order) {
    const line = report[name] || { status: "unknown", text: "not checked." };
    const li = morningLines[name];
    li.className = `m-line ${line.status || "unknown"}${name === lead ? " lead" : ""}`;
    const text = li.querySelector(".m-text");
    text.replaceChildren();
    if (line.time) {
      const when = document.createElement("time");
      when.dateTime = new Date(line.time).toISOString();
      when.textContent = hhmm24(line.time);
      text.append(when);
    }
    text.append(line.text || "");
    li.title = `${line.time ? `${hhmm24(line.time)} ` : ""}${line.text || ""}`;
  }
  morningWhen.textContent = sample ? "SAMPLE" : hhmm24(Date.now());
  morningEl.classList.toggle("folded", morningFolded);
  morningFold.setAttribute("aria-expanded", String(!morningFolded));
  morningFold.innerHTML = morningFolded ? "&#9660;" : "&#9650;";
  morningFold.title = morningFolded ? "open the morning report" : "fold the morning report";
}

morningFold.addEventListener("click", () => {
  morningFolded = !morningFolded;
  try {
    window.localStorage.setItem(MORNING_FOLD_KEY, morningFolded ? "1" : "0");
  } catch {
    // Folding still works for this page.
  }
  renderMorning();
});

(function paintSunrise() {
  const badge = document.querySelector("#sunrise");
  const sprite = sunrise();
  badge.width = sprite[0].length * 2;
  badge.height = sprite.length * 2;
  const g = badge.getContext("2d");
  g.imageSmoothingEnabled = false;
  drawSprite(g, sprite, 0, 0, 2);
})();

// The plate's morning facts: the object's last change, what else it
// touches, and why it is idle when it is.
function plateFacts(id) {
  const report = currentMorning();
  const mark = report?.marks?.[id];
  const facts = [];
  if (mark?.idle) facts.push({ label: mark.fire ? "IDLE·BILLED" : "IDLE", text: mark.idle, tone: mark.fire ? "warn" : "" });
  if (!report) facts.push({ label: "LAST CHANGE", text: "not checked", tone: "unknown" });
  else if (mark?.lastChange) facts.push({ label: "LAST CHANGE", text: `${hhmm24(mark.lastChange.time)}  ${mark.lastChange.text}`, tone: mark.lastChange.status === "fail" ? "fail" : "" });
  else if (/not checked/.test(report.changed?.text || "")) facts.push({ label: "LAST CHANGE", text: "not checked", tone: "unknown" });
  else facts.push({ label: "LAST CHANGE", text: "none in the radio's CloudTrail window", tone: "unknown" });
  if (place) facts.push({ label: "BLAST", text: blastLine(place, id).replace(/^touches: /, "") });
  return facts;
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
  if (spendEl.hidden) {
    spendLines.hidden = true;
    return;
  }
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
  // An open plate is drawn on the canvas; the select would sit on top of it.
  wallGrain.hidden = !camp || Boolean(ui.selection);
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

function vaultKeys() {
  return vaultsData.vaults.map((vault) => vault.key);
}

function placedMap() {
  const width = map.clientWidth || 0;
  const rowLimit = width ? Math.min(ROW_LIMIT, width) : ROW_LIMIT;
  const vaults = vaultsData.vaults;
  const extra = {
    key: `${vaultsShown}|${vaultState.key(vaultKeys())}`,
    options: { vaults, isOpen: (key) => vaultState.isOpen(key) },
  };
  const placed = layoutCache.get(place || EMPTY_PLACE, rowLimit, extra);
  // A reload with the same vaults keeps the layout but brings new check
  // results: point the cells at the fresh records.
  if (placed.vaults && placed.vaults.boundTo !== vaultsData) {
    const byKey = new Map(vaults.map((vault) => [vault.key, vault]));
    for (const cell of placed.vaults.cells) cell.vault = byKey.get(cell.key) || cell.vault;
    placed.vaults.boundTo = vaultsData;
  }
  return placed;
}

// ---- vaults ----

function vaultSignature(vaults) {
  return vaults.map((vault) => `${vault.key}:${vault.number}:${vault.damaged ? 1 : 0}:${vault.title}:${vault.stack ? `${vault.stack.dir}/${vault.stack.name}/${vault.stackInfo?.stacks?.length || 0}` : ""}:${(vault.trouble || []).length}:${(vault.owned || []).join(",")}`).join("|");
}

async function loadVaults() {
  const ticket = ++vaultsTicket;
  const wasSample = sample;
  vaultsLoading = true;
  try {
    const body = await fetch(`/api/vaults${wasSample ? "?sample=1" : ""}`).then((response) => response.json());
    if (ticket !== vaultsTicket || wasSample !== sample) return;
    vaultsData = {
      vaults: Array.isArray(body?.vaults) ? body.vaults : [],
      note: body?.note || "",
      templates: Array.isArray(body?.templates) ? body.templates : [],
    };
    vaultsFor = wasSample;
    vaultsAt = Date.now();
    vaultsShown = vaultSignature(vaultsData.vaults);
    noteVaults();
  } catch {
    if (ticket !== vaultsTicket) return;
    vaultsFor = wasSample;
    vaultsAt = Date.now();
  } finally {
    if (ticket === vaultsTicket) vaultsLoading = false;
  }
  renderChrome();
  draw();
}

// The radio hears about a vault when its light turns red, once per turn.
function noteVaults() {
  for (const vault of vaultsData.vaults) {
    const light = vault.damaged ? "damaged" : vault.status;
    const before = vaultLights.get(vault.key);
    vaultLights.set(vault.key, light);
    if (light === before) continue;
    if (light === "damaged") noteSpider(`${vault.file} is a damaged vault`, "fail");
    else if (light === "fail" && before) noteSpider(`${vault.title || vault.name} failed its check`, "fail");
    else if (light === "ok" && before === "fail") noteSpider(`${vault.title || vault.name} passes again`);
  }
}

function wantVaults() {
  if (vaultsLoading) return;
  const pending = vaultsData.vaults.some((vault) => vault.status === "pending");
  const age = Date.now() - vaultsAt;
  if (vaultsFor !== sample || age > 15_000 || (pending && age > 2500)) loadVaults();
}

// Doors roll on animation frames, only while one is moving.
function rollDoors() {
  if (doorFrame) return;
  const step = () => {
    doorFrame = 0;
    if (mode !== "map") return;
    draw();
    if (vaultState.moving(reducedMotion)) doorFrame = requestAnimationFrame(step);
  };
  doorFrame = requestAnimationFrame(step);
}

function toggleVault(key) {
  const open = vaultState.toggle(key);
  draw();
  rollDoors();
  if (open) {
    const cell = placedMap().vaults?.cells.find((item) => item.key === key);
    if (cell) revealPanel({ x: cell.x, y: cell.y, w: Math.min(cell.w, map.clientWidth), h: Math.min(cell.h, map.clientHeight) });
  }
}

function vel(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function checkLine(check) {
  const li = vel("li", check.status || "pending");
  li.append(vel("i", "dot"));
  const body = vel("span", "check-body");
  body.append(vel("span", "url", check.name || check.url));
  const result = check.status === "pending"
    ? "checking…"
    : [check.code ? String(check.code) : "", check.ms ? `${check.ms} ms` : ""].filter(Boolean).join(" · ");
  body.append(vel("span", "res", result || "no answer"));
  if (check.error) body.append(vel("span", "err", check.error));
  li.append(body);
  li.title = check.url;
  return li;
}

// TROUBLE: failed AWS calls (CloudTrail, via the radio) on this vault's
// resources, and the last error lines of its log groups.
function hhmm(time) {
  if (!time) return "--:--";
  const date = new Date(time);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function troubleBlock(vault) {
  const block = vel("div", "vp-trouble");
  block.append(vel("h4", "", `TROUBLE · ${vault.trouble.length} FAILED CALL${vault.trouble.length === 1 ? "" : "S"}`));
  const list = vel("ul");
  for (const item of vault.trouble) {
    const li = vel("li", "fail");
    li.append(vel("span", "dot"));
    const body = vel("span", "body");
    body.append(vel("span", "when", hhmm(item.time)), vel("span", "call", `${item.call}${item.resource ? ` · ${item.resource}` : ""}`), vel("span", "err", item.issue));
    li.append(body);
    list.append(li);
  }
  block.append(list);
  return block;
}

const vaultLogState = new Map();
const LOG_REFRESH_MS = 60_000;

function errorLinesBlock(vault) {
  const block = vel("div", "vp-errlines");
  const head = vel("h4");
  const state = vaultLogState.get(vault.key);
  head.append(vel("span", "", state?.lines?.length ? `ERROR LINES · LAST HOUR · ${state.lines.length}` : "ERROR LINES · LAST HOUR"));
  const again = vel("button", "vp-reload", state?.loading ? "READING…" : "RE-READ");
  again.type = "button";
  again.disabled = Boolean(state?.loading);
  again.title = `read ${vault.logGroups.join(", ")} again`;
  again.addEventListener("click", () => loadVaultLogs(vault.key, true));
  head.append(again);
  block.append(head);
  if (!state || state.loading) block.append(vel("p", "vp-note", "reading the log groups…"));
  else {
    if (state.note) block.append(vel("p", state.error ? "vp-note err" : "vp-note", state.note));
    if (state.lines?.length) {
      const pre = vel("ol", "vp-lines");
      for (const line of state.lines) {
        const li = vel("li");
        li.append(vel("span", "when", hhmm(line.time)), vel("span", "text", line.text));
        li.title = line.group;
        pre.append(li);
      }
      block.append(pre);
    }
  }
  return block;
}

// METRICS: CloudWatch numbers for what this vault owns (EC2, ALB, Lambda),
// 3 hours at 5-minute points, read in one batch for the whole map.
let metricsData = null;
let metricsPulling = false;
const metricsSeen = new Set();
const METRICS_CHECK_MS = 30_000;
const SVG = "http://www.w3.org/2000/svg";

function sparkline(points) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 100 16");
  svg.setAttribute("preserveAspectRatio", "none");
  const values = points.map((p) => (p == null ? null : Number(p)));
  const seen = values.filter((v) => v != null);
  const top = Math.max(...seen, 0) || 1;
  const step = values.length > 1 ? 100 / (values.length - 1) : 100;
  const line = document.createElementNS(SVG, "polyline");
  line.setAttribute("points", values.map((v, i) => (v == null ? null : `${(i * step).toFixed(1)},${(15 - (v / top) * 13).toFixed(1)}`)).filter(Boolean).join(" "));
  svg.append(line);
  return svg;
}

function metricValue(item) {
  if (item.last == null) return "—";
  if (item.unit === "%") return `${Math.round(item.last)}%`;
  if (item.unit === "s") return `${Math.round(item.last * 1000)}ms`;
  if (item.unit === "ms") return `${Math.round(item.last)}ms`;
  if (item.unit === "fail") return item.last > 0 ? "FAILED" : "OK";
  return `${item.hour ?? item.last}/h`;
}

function metricHot(item) {
  if (/5XX|ERR|THROTTLE/.test(item.label)) return (item.hour || 0) > 0;
  if (item.unit === "%") return (item.last || 0) >= 75;
  if (item.unit === "fail") return (item.last || 0) > 0;
  return false;
}

function vaultMetrics(vault) {
  return (vault.owned || []).map((id) => metricsData?.targets?.[id]).filter(Boolean);
}

function metricsBlock(vault) {
  const hits = vaultMetrics(vault);
  const block = vel("div", "vp-metrics");
  const head = vel("h4");
  head.append(vel("span", "", `METRICS · 3H · ${hits.length} RESOURCE${hits.length === 1 ? "" : "S"}`));
  if (metricsData?.at) head.append(vel("span", "", `READ ${hhmm(metricsData.at)}`));
  block.append(head);
  for (const hit of hits) {
    const res = vel("div", `res ${hit.flag || "ok"}`);
    res.append(vel("span", "name", hit.name), vel("span", "head", `${hit.flag && hit.flag !== "ok" ? "! " : ""}${hit.headline}`));
    block.append(res);
    const list = vel("ul");
    for (const item of hit.series || []) {
      const li = vel("li", metricHot(item) ? "hot" : "");
      li.title = `${item.metric} · peak ${item.peak ?? "—"}`;
      li.append(vel("span", "lbl", item.label), sparkline(item.points || []), vel("span", "val", metricValue(item)));
      list.append(li);
    }
    block.append(list);
  }
  return block;
}

function applyMetrics() {
  if (!place) return;
  paintPlace(place, metricsData);
  layoutCache.invalidate();
}

async function pullMetrics(force = false) {
  if (!tabVisible || metricsPulling) return;
  if (mode === "path" && !force) return;
  if (!force && metricsData && Date.now() < (metricsData.nextAt || 0)) return;
  if (!sample && !place) return;
  metricsPulling = true;
  const wasSample = sample;
  try {
    const body = await fetch(`/api/metrics${wasSample ? "?sample=1" : ""}`).then((response) => response.json());
    if (wasSample !== sample) return;
    metricsData = body?.targets ? body : null;
    if (body?.error) noteSpider(body.error, "fail");
    for (const alert of metricAlerts(metricsData)) {
      const key = `${alert.id}|${alert.text}`;
      if (metricsSeen.has(key)) continue;
      metricsSeen.add(key);
      noteSpider(alert.text, alert.flag === "broken" ? "fail" : "ok");
    }
    applyMetrics();
    repaintPanels();
  } catch {
    // The next check tries again.
  } finally {
    metricsPulling = false;
  }
}

async function loadVaultLogs(key, force = false) {
  const state = vaultLogState.get(key);
  if (state?.loading) return;
  if (!force && state && Date.now() - state.at < LOG_REFRESH_MS) return;
  vaultLogState.set(key, { ...(state || {}), loading: true, at: Date.now() });
  repaintPanels();
  const wasSample = sample;
  let next;
  try {
    const body = await fetch(`/api/vaults/logs?key=${encodeURIComponent(key)}${wasSample ? "&sample=1" : ""}`).then((response) => response.json());
    next = body?.error ? { lines: [], note: body.error, error: true } : { lines: body?.lines || [], note: body?.note || "" };
  } catch {
    next = { lines: [], note: "the logs did not load", error: true };
  }
  if (wasSample !== sample) return;
  vaultLogState.set(key, { ...next, loading: false, at: Date.now() });
  repaintPanels();
}

function repaintPanels() {
  panelsShown = "";
  chromeFor = { placed: null, data: null };
  renderChrome();
  draw();
}

function stackFact(vault) {
  if (!vault.stack) return "";
  const info = vault.stackInfo;
  const which = vault.stack.name === "*" ? "every stack" : vault.stack.name;
  if (info?.error) return `${which} in ${vault.stack.dir} · ${info.error}`;
  if (info && !info.stacks.length) return `${which} in ${vault.stack.dir} · not up`;
  const names = info?.stacks?.length && vault.stack.name.includes("*") ? ` (${info.stacks.join(", ")})` : "";
  return `LIVE · ${which}${names} in ${vault.stack.dir}${info ? ` · ${info.resources} resource${info.resources === 1 ? "" : "s"}` : ""}`;
}

function vaultPanel(cell) {
  const vault = cell.vault;
  const section = vel("section", `vault-panel${vault.damaged ? " damaged" : ""}`);
  section.dataset.key = vault.key;
  section.setAttribute("aria-label", `${plateText(vault.number)} ${vault.title || vault.name}`);
  const head = vel("div", "vp-title");
  const img = vel("img", "px");
  img.src = iconURL("vault", 1);
  img.alt = "";
  head.append(img, vel("span", "vp-name", vault.damaged ? `DAMAGED VAULT · ${vault.file}` : `${plateText(vault.number)} · ${vault.title || vault.name}`));
  const close = vel("button", "vp-close", "CLOSE");
  close.type = "button";
  close.title = "close the vault door";
  close.addEventListener("click", () => toggleVault(vault.key));
  head.append(close);
  section.append(head);
  const body = vel("div", "vp-body");
  if (vault.damaged) {
    body.append(vel("p", "vp-desc", "This vault file did not pass the cloudspider/v1 check. Fix the file and the door repairs itself on the next refresh."));
    const list = vel("ul", "vp-errors");
    for (const error of vault.errors || []) list.append(vel("li", "", error));
    body.append(list);
  } else {
    body.append(vel("p", "vp-desc", vault.description));
    const facts = vel("dl", "vp-facts");
    for (const [label, value] of [
      ["OWNER", vault.owner],
      ["TYPE", vault.type],
      ["TAGS", (vault.tags || []).join(", ")],
      ["STACK", stackFact(vault)],
      ["WAITING", vault.stackInfo?.waiting?.length ? `${vault.stackInfo.waiting.join(", ")}: not exported yet (pulumi up in ${vault.stack.dir})` : ""],
      ["OWNS", `${(vault.owned || []).length} resource${(vault.owned || []).length === 1 ? "" : "s"}`],
      ["FILE", vault.file],
    ]) {
      if (!value) continue;
      facts.append(vel("dt", "", label), vel("dd", "", value));
    }
    body.append(facts);
    const checks = vel("div", "vp-checks");
    checks.append(vel("h4", "", vault.checks?.length ? "CHECKS" : "NO CHECKS"));
    const list = vel("ul");
    for (const check of vault.checks || []) list.append(checkLine(check));
    checks.append(list);
    body.append(checks);
    if (vaultMetrics(vault).length) body.append(metricsBlock(vault));
    if (vault.trouble?.length) body.append(troubleBlock(vault));
    if (vault.logGroups?.length) body.append(errorLinesBlock(vault));
  }
  section.append(body);
  const nav = vel("nav", "vp-links");
  for (const [key, label] of [["view", "VIEW"], ["repo", "REPO"], ["docs", "DOCS"], ["dashboard", "DASHBOARD"]]) {
    const href = vault.links?.[key];
    if (!href) continue;
    const a = vel("a", "cmd", label);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    nav.append(a);
  }
  const ask = vel("button", "cmd vp-ask", "ASK");
  ask.type = "button";
  ask.title = "ask the terminal about this vault (fills the prompt, does not send)";
  ask.addEventListener("click", () => terminal.prefill(vaultQuestion(vault)));
  nav.append(ask);
  if (!vault.damaged && vault.checks?.length) {
    const test = vel("button", "cmd vp-test", "TEST");
    test.type = "button";
    test.addEventListener("click", () => testVault(vault.key, test));
    nav.append(test);
  }
  if (nav.children.length) section.append(nav);
  return section;
}

async function testVault(key, button) {
  button.disabled = true;
  button.textContent = "TESTING…";
  const wasSample = sample;
  try {
    const body = await fetch("/api/vaults/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ key, sample: wasSample }),
    }).then((response) => response.json());
    if (wasSample !== sample) return;
    if (body?.vault) {
      vaultsData = { ...vaultsData, vaults: vaultsData.vaults.map((item) => (item.key === key ? body.vault : item)) };
      noteSpider(`tested ${body.vault.title || body.vault.name}: ${body.vault.status}`, body.vault.status === "fail" ? "fail" : "ok");
      noteVaults();
    } else if (body?.error) noteSpider(body.error, "fail");
  } catch {
    noteSpider("the vault test did not run", "fail");
  }
  panelsShown = "";
  renderChrome();
  draw();
}

let panelsShown = "";

// HTML panels for open vaults (and the open/close-all switch) sit over the
// canvas at layout positions and scroll with the map.
let chromeFor = { placed: null, data: null };
function placeVaultChrome(placed) {
  const area = mode === "map" ? placed?.vaults : null;
  vaultAll.hidden = !area;
  vaultTemplatesButton.hidden = !area;
  if (!area) {
    vaultTemplates.hidden = true;
    if (panelsShown) vaultPanels.replaceChildren();
    panelsShown = "";
    chromeFor = { placed: null, data: null };
    return;
  }
  // Same layout, same data: nothing to do (this runs every frame).
  if (placed === chromeFor.placed && vaultsData === chromeFor.data && vaultAll.style.top) return;
  chromeFor = { placed, data: vaultsData };
  const keys = vaultKeys();
  const allOpen = vaultState.allOpen(keys);
  vaultAll.textContent = allOpen ? "CLOSE ALL" : "OPEN ALL";
  vaultAll.setAttribute("aria-pressed", String(allOpen));
  vaultAll.style.left = `${area.x + 104}px`;
  vaultAll.style.top = `${area.y + 4}px`;
  const templates = vaultsData.templates || [];
  vaultTemplatesButton.textContent = `TEMPLATES (${templates.length})`;
  vaultTemplatesButton.style.left = `${area.x + 104 + vaultAll.offsetWidth + 8}px`;
  vaultTemplatesButton.style.top = `${area.y + 4}px`;
  vaultTemplates.style.left = vaultTemplatesButton.style.left;
  vaultTemplates.style.top = `${area.y + 36}px`;
  if (!vaultTemplates.hidden) renderTemplates();
  const open = area.cells.filter((cell) => cell.open && cell.panel);
  const shown = open
    .map((cell) => `${cell.key}@${cell.panel.x},${cell.panel.y},${cell.panel.w},${cell.panel.h}:${JSON.stringify([cell.vault.checks, cell.vault.status, cell.vault.description, cell.vault.links, cell.vault.errors, (cell.vault.owned || []).length, cell.vault.stackInfo, cell.vault.trouble, vaultLogState.get(cell.key), vaultMetrics(cell.vault).map((hit) => `${hit.id}:${metricsData?.at}`)])}`)
    .join("|");
  if (shown === panelsShown) return;
  panelsShown = shown;
  vaultPanels.replaceChildren(
    ...open.map((cell) => {
      const panel = vaultPanel(cell);
      Object.assign(panel.style, {
        left: `${cell.panel.x}px`,
        top: `${cell.panel.y}px`,
        width: `${cell.panel.w}px`,
        height: `${cell.panel.h}px`,
      });
      return panel;
    }),
  );
  // Error lines load when a vault opens (cached a minute on both sides).
  for (const cell of open) if (cell.vault.logGroups?.length && !vaultLogState.has(cell.key)) loadVaultLogs(cell.key);
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
    ? layoutDiagram(clusterData.diagram, clusterData.diagram.layout === "kube" ? clusterData.diagram.columns || KUBE_COLUMNS : CLUSTER_COLUMNS, map.clientWidth || 0)
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
    placeVaultChrome(null);
    if (mode === "path") drawPath();
    else drawCluster();
    return;
  }
  
  wantVaults();
  // Layout is cached per place; flipSampleState invalidates it on mutation.
  const placed = place || vaultsData.vaults.length
    ? placedMap()
    : {
        settlements: [],
        orphans: { items: [], label: "no VPC" },
        contentWidth: 0,
        contentHeight: 0,
      };

  const { width, height } = sizeCanvas(placed.contentWidth, placed.contentHeight);
  paint(ctx, {
    placed,
    ui,
    region,
    animTime,
    width,
    height,
    reducedMotion,
    vaultDoor: (key) => vaultState.door(key, reducedMotion),
  });
  placeGrain(placed);
  placeVaultChrome(placed);
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
    if (!sample) liveMorning = view.morning || null;
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
    if (region !== metricsData?.region && metricsData && !metricsData.sample) metricsData = null;
    place = view.place;
    applyMetrics();
    if (!metricsData) pullMetrics();
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
  metricsData = null;
  pullMetrics(true);
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
  metricsData = null;
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
  showPod(null);
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
  showPod(null);
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
  showPod(null);
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
  sampleMorningData = body.morning || null;
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
    sampleMorningData = body.morning || null;
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

// Cluster view: a node's load (metrics-server) and, when the map has read
// it, its EC2 instance's CloudWatch CPU, on click.
function meter(label, pct, text) {
  const li = vel("li", pct >= 85 ? "hot" : "");
  const bar = vel("div", "kp-meter");
  const fill = vel("span");
  fill.style.width = `${Math.max(0, Math.min(100, pct || 0))}%`;
  bar.append(fill);
  li.append(vel("span", "lbl", label), bar, vel("span", "val", text));
  return li;
}

function showNode(node) {
  ++podTicket;
  const host = node.host;
  const head = vel("div", "kp-title");
  head.append(vel("span", "kp-name", `NODE · ${node.label}`));
  const close = vel("button", "vp-close", "CLOSE");
  close.type = "button";
  close.addEventListener("click", () => {
    clusterSelected = null;
    showPod(null);
    draw();
  });
  head.append(close);
  const facts = vel("dl", "vp-facts");
  for (const [label, value] of [["STATE", host.ready === null ? "not listed" : host.ready ? "Ready" : "NotReady"], ["TYPE", host.type], ["PODS", `${host.pods} running`], ["INSTANCE", host.instanceId]]) {
    if (value) facts.append(vel("dt", "", label), vel("dd", "", value));
  }
  const body = vel("div", "kp-body vp-metrics");
  body.append(facts);
  const loadHead = vel("h4");
  loadHead.append(vel("span", "", "LOAD · METRICS-SERVER · NOW"));
  body.append(loadHead);
  const load = host.load || {};
  if (load.cpuPct == null) body.append(vel("p", "vp-note", load.text || "no metrics-server: install it (RUN-ME §8) to see node load"));
  else {
    const list = vel("ul");
    list.append(meter("CPU", load.cpuPct, `${load.cpu}m / ${load.cpuOf}m`), meter("MEM", load.memPct, `${load.mem}Mi / ${load.memOf}Mi`));
    body.append(list);
  }
  const hit = host.instanceId ? metricsData?.targets?.[host.instanceId] : null;
  if (hit) {
    const cwHead = vel("h4");
    cwHead.append(vel("span", "", "EC2 · CLOUDWATCH · 3H"), vel("span", "", hit.headline));
    body.append(cwHead);
    const list = vel("ul");
    for (const item of hit.series || []) {
      const li = vel("li", metricHot(item) ? "hot" : "");
      li.append(vel("span", "lbl", item.label), sparkline(item.points || []), vel("span", "val", metricValue(item)));
      list.append(li);
    }
    body.append(list);
  }
  kubePanel.replaceChildren(head, body);
  kubePanel.hidden = false;
}

// Cluster view: a pod's last log lines and events, read-only, on click.
let podTicket = 0;
function showPod(node) {
  const ticket = ++podTicket;
  if (!node) {
    kubePanel.hidden = true;
    kubePanel.replaceChildren();
    return;
  }
  const { ns, name, containers, node: host } = node.pod;
  const head = vel("div", "kp-title");
  head.append(vel("span", "kp-name", `POD · ${ns}/${name}`));
  const close = vel("button", "vp-close", "CLOSE");
  close.type = "button";
  close.addEventListener("click", () => {
    clusterSelected = null;
    showPod(null);
    draw();
  });
  head.append(close);
  const facts = vel("dl", "vp-facts");
  for (const [label, value] of [["STATE", node.caption], ["NODE", host], ["CONTAINERS", (containers || []).join(", ")]]) {
    if (value) facts.append(vel("dt", "", label), vel("dd", "", value));
  }
  const body = vel("div", "kp-body");
  body.append(facts, vel("p", "vp-note", "reading logs and events…"));
  kubePanel.replaceChildren(head, body);
  kubePanel.hidden = false;
  const query = new URLSearchParams({ ns, name });
  if (sample) query.set("sample", "1");
  fetch(`/api/cluster/pod?${query}`)
    .then((response) => response.json())
    .catch(() => ({ error: "the pod did not answer" }))
    .then((detail) => {
      if (ticket !== podTicket) return;
      body.replaceChildren(facts);
      if (detail.error) {
        body.append(vel("p", "vp-note err", detail.error));
        return;
      }
      const logsHead = vel("h4", "", `LOG · LAST ${detail.lines?.length || 0} LINES`);
      body.append(logsHead);
      if (detail.logNote) body.append(vel("p", "vp-note err", detail.logNote));
      const lines = vel("ol", "vp-lines kp-log");
      for (const line of detail.lines || []) lines.append(vel("li", /error|fail|panic|exception|giving up/i.test(line) ? "bad" : "", line));
      body.append(lines);
      body.append(vel("h4", "", `EVENTS · ${detail.events?.length || 0}`));
      if (detail.eventNote) body.append(vel("p", "vp-note err", detail.eventNote));
      const events = vel("ul", "kp-events");
      for (const event of detail.events || []) {
        const li = vel("li", event.type === "Warning" ? "warn" : "");
        li.append(vel("span", "when", hhmm(event.time)), vel("span", "reason", `${event.reason}${event.count > 1 ? ` ×${event.count}` : ""}`), vel("span", "msg", event.message));
        events.append(li);
      }
      body.append(events);
      lines.scrollTop = lines.scrollHeight;
    });
}

canvas.addEventListener("click", async (event) => {
  if (mode === "path" || mode === "cluster") {
    const placed = mode === "path" ? placedPath() : placedCluster();
    const hit = nodeAt(placed, event.offsetX, event.offsetY);
    if (mode === "path") pathSelected = hit?.id || null;
    else {
      clusterSelected = hit?.id || null;
      if (hit?.host) showNode(hit);
      else showPod(hit?.pod ? hit : null);
    }
    draw();
    if (hit?.sentence) revealPanel(sentenceRect(hit, canvas.clientWidth, canvas.clientHeight));
    return;
  }
  if (vaultsData.vaults.length) {
    const door = vaultAt(placedMap().vaults, event.offsetX, event.offsetY);
    if (door) {
      toggleVault(door.key);
      return;
    }
  }
  if (!place && !vaultsData.vaults.length) {
    clickGround(ui);
    renderChrome();
    draw();
    return;
  }
  const placed = placedMap();
  const hit = buildingAt(placed, event.offsetX, event.offsetY);
  if (!hit) {
    const fixture = fixtureAt(placed, event.offsetX, event.offsetY);
    if (fixture) {
      clickFixture(ui, fixture, fixtureNote(fixture));
      setFacts(ui, plateFacts(fixture.id));
    } else clickGround(ui);
    renderChrome();
    draw();
    return;
  }
  const raw = place?.instances.find((item) => item.id === hit.id) || hit;
  clickBuilding(ui, raw, region, place ? blastLine(place, raw.id) : "");
  setFacts(ui, plateFacts(raw.id));
  renderChrome();
  draw();
  if (sample || !isInstanceId(raw.id)) return;
  const logs = await fetch(`/api/logs?id=${encodeURIComponent(raw.id)}`).then((response) => response.json());
  if (ui.selection?.id !== raw.id) return;
  setLogs(ui, logs.entries || logs.lines || [], logs.note || "");
  draw();
});

// A pointer over a door says it can be opened.
canvas.addEventListener("mousemove", (event) => {
  if (mode !== "map" || !vaultsData.vaults.length) {
    if (canvas.style.cursor) canvas.style.cursor = "";
    return;
  }
  const door = vaultAt(placedMap().vaults, event.offsetX, event.offsetY);
  const cursor = door ? "pointer" : "";
  if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
});

// TEMPLATES: vaults/templates/*.yaml, never drawn. NEW copies the command
// that makes a living vault from one; the server never writes vault files.
function newVaultCommand(template) {
  const name = String(template?.file || "").replace(/^templates\//, "").replace(/\.ya?ml$/i, "");
  return `npm run vaults:new -- ${name} <name>`;
}

let templatesShown = "";
function renderTemplates() {
  const templates = vaultsData.templates || [];
  const shown = JSON.stringify(templates);
  if (shown === templatesShown && vaultTemplates.children.length) return;
  templatesShown = shown;
  const head = vel("div", "vt-title");
  head.append(vel("span", "", "VAULT TEMPLATES"), vel("span", "vt-where", "vaults/templates/"));
  const list = vel("ul", "vt-list");
  if (!templates.length) list.append(vel("li", "vt-empty", "No templates. Put one in vaults/templates/."));
  for (const template of templates) {
    const li = vel("li", template.damaged ? "damaged" : "");
    const top = vel("div", "vt-row");
    top.append(vel("span", "vt-name", template.title || template.name || template.file), vel("span", "vt-type", (template.type || "").toUpperCase()));
    li.append(top);
    li.append(vel("p", "vt-desc", template.damaged ? `DAMAGED · ${(template.errors || [])[0] || template.file}` : template.description || ""));
    const command = newVaultCommand(template);
    const row = vel("div", "vt-row");
    row.append(vel("code", "vt-cmd", command));
    const copy = vel("button", "cmd vt-copy", "COPY");
    copy.type = "button";
    copy.title = "copy the command; run it in the repo, then edit vaults/<name>.yaml";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(command);
        copy.textContent = "COPIED";
      } catch {
        copy.textContent = "SELECT IT";
      }
      setTimeout(() => (copy.textContent = "COPY"), 1600);
    });
    row.append(copy);
    li.append(row);
    list.append(li);
  }
  vaultTemplates.replaceChildren(head, list);
}

vaultTemplatesButton.addEventListener("click", () => {
  vaultTemplates.hidden = !vaultTemplates.hidden;
  vaultTemplatesButton.setAttribute("aria-expanded", String(!vaultTemplates.hidden));
  if (!vaultTemplates.hidden) {
    templatesShown = "";
    renderTemplates();
  }
});

vaultAll.addEventListener("click", () => {
  const keys = vaultKeys();
  vaultState.setAll(keys, !vaultState.allOpen(keys));
  draw();
  rollDoors();
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

// ---- TERMINAL: ask the local agent. Only a button press asks. ----

function agentContext() {
  return snapshot({
    place,
    vaults: vaultsData.vaults,
    radio: [...spider, ...(ui.trail || [])].slice(0, 15),
    region: sample ? "sample" : region,
    sample,
    view: mode,
    selection: mode === "map" ? ui.selection : null,
    path: mode === "path" && pathData ? { headline: pathData.headline, host: hostInput.value.trim(), findings: pathData.findings } : null,
  });
}

function vaultQuestion(vault) {
  const name = `${plateText(vault.number)} ${vault.title || vault.name}`;
  if (vault.damaged) return `Vault file ${vault.file} is damaged. What is wrong with it and how do I fix it?`;
  const light = vault.status === "fail" ? "red" : vault.status === "slow" ? "amber" : vault.status === "ok" ? "green" : vault.status || "unknown";
  return `Why is vault ${name} ${light}? Walk through its checks and what it owns.`;
}

function askThisQuestion() {
  if (mode === "map" && ui.selection) {
    const item = ui.selection;
    return `Tell me about ${item.type || "this"} ${item.name || item.id} (${item.id}): what is it, what state is it in, and is anything wrong with it?`;
  }
  if (mode === "path" && pathData?.headline) return `Explain this path: "${pathData.headline}". Which edge is broken and what would fix it?`;
  return "";
}

function renderAskThis() {
  const question = askThisQuestion();
  askThis.hidden = !question;
  if (question) askThis.title = question;
  askThis.lastChild.textContent = mode === "path" ? "ASK ABOUT THIS PATH" : "ASK ABOUT THIS";
}

// A proposed action goes through the page's own flow: stop/start becomes the
// usual Y/N line, up opens the Stacks card. Nothing runs from here.
async function agentAction(action) {
  if (action.verb === "up") {
    if (!pipOpen) await toggleUpgrade();
    if (pipModules.some((item) => item.id === action.module)) {
      openCard = action.module;
      drawPipForm();
      refreshUpgrade(true);
      setStatus(ui, `Stacks: check the ${action.module} card, then press run`);
    } else setStatus(ui, `there is no ${action.module} stack`);
    renderChrome();
    return;
  }
  if (mode !== "map") goOverview();
  const raw = place?.instances.find((item) => item.id === action.id);
  if (!raw) {
    setStatus(ui, `${action.id} is not on the map`);
    renderChrome();
    return;
  }
  clickBuilding(ui, raw, region, blastLine(place, raw.id));
  setFacts(ui, plateFacts(raw.id));
  if (ui.confirmation && ui.confirmation.verb !== action.verb) {
    ui.confirmation = null;
    setStatus(ui, `${action.id} is ${raw.state}; there is nothing to ${action.verb}`);
  }
  renderChrome();
  draw();
}

const terminal = createTerminal({
  root: termEl,
  toggleButton: askTab,
  iconURL,
  getContext: agentContext,
  isSample: () => sample,
  onAction: agentAction,
  reducedMotion: () => reducedMotion,
});

termReady = true;
askTab.addEventListener("click", () => terminal.toggle());
askThis.addEventListener("click", () => {
  const question = askThisQuestion();
  if (question) terminal.prefill(question);
});

// ---- Stacks: Pulumi upgrade cards in a Pip-Boy panel over the map ----

const CARD_ICON = {
  eks: "cluster", signal: "radio", barrel: "stack", camp: "bucket",
  rds: "database", pgcluster: "database", shopapi: "pod", site: "url", worker: "queue", "tf-rds": "terraform",
};

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

// The head of a card: icon, title, the hourly cost chip and the engine plate.
function cardHead(spec) {
  const head = el(
    "button",
    { type: "button", className: "card-head" },
    iconImg(CARD_ICON[spec.id] || "stack"),
    el("span", { className: "card-title", textContent: spec.title }),
  );
  if (spec.cost) head.append(el("span", { className: "cost-chip", textContent: costLine(spec.cost).split(" · ")[0], title: `about ${costLine(spec.cost)} in ${spec.cost.region}` }));
  head.append(el("span", { className: `eng ${spec.engine === "terraform" ? "tf" : ""}`, textContent: spec.engine === "terraform" ? "TF" : "PULUMI" }));
  head.setAttribute("aria-expanded", String(openCard === spec.id));
  head.addEventListener("click", () => {
    openCard = openCard === spec.id ? null : spec.id;
    drawPipForm();
    if (openCard) refreshUpgrade(true);
  });
  return head;
}

// The bill while it is up: three counters (hour, day, month) on a dark
// readout strip, the lines that make it, the usage-billed parts and what
// must be up first.
function costBlock(spec) {
  const cost = spec.cost;
  const block = el("div", { className: "bill" });
  if (!cost) return block;
  const [hour, day, month] = costLine(cost).replace(/ \+ usage$/, "").split(" · ");
  const counter = (value, unit) => el("span", { className: "meter-cell" }, el("b", { textContent: value.replace(/\/.*$/, "") }), el("i", { textContent: unit }));
  block.append(el("div", { className: "meter", role: "group", ariaLabel: `cost in ${cost.region}` }, counter(hour, "HOUR"), counter(day, "DAY"), counter(month, "MONTH")));
  const lines = el("ul", { className: "lines" });
  for (const item of cost.items) lines.append(el("li", {}, el("span", { textContent: item.text }), el("span", { textContent: `$${item.month.toFixed(2)}/mo` })));
  for (const item of cost.usage) lines.append(el("li", { className: "usage" }, el("span", { textContent: `+ ${item}` }), el("span", { textContent: "per use" })));
  if (!cost.items.length && !cost.usage.length) lines.append(el("li", {}, el("span", { textContent: "nothing of its own: runs on what it needs" }), el("span", { textContent: "$0" })));
  block.append(lines, el("div", { className: "src", textContent: `${cost.region} on-demand, AWS price list ${cost.asOf}` }));
  if (spec.needs?.length) {
    const needs = el("div", { className: "needs" }, el("span", { textContent: "NEEDS" }));
    for (const id of spec.needs) needs.append(el("span", { className: "need", textContent: (pipModules.find((item) => item.id === id)?.title || id).toUpperCase() }));
    block.append(needs);
  }
  return block;
}

function drawPipForm() {
  const title = el("div", { className: "ptitle" }, iconImg("stack"), "STACKS");
  pipEl.replaceChildren(title);
  if (!pipModules.length && !pipTerraform.length) {
    pipEl.append(el("div", { className: "quiet", textContent: "no upgrade" }));
    return;
  }
  for (const spec of pipModules) {
    const card = el("section", { className: "card" });
    card.dataset.id = spec.id;
    card.append(cardHead(spec));
    if (openCard === spec.id) {
      card.classList.add("open");
      const body = el("div", { className: "card-body" });
      const watch = el("div", { id: "pip-watch" });
      watch.hidden = true;
      body.append(el("div", { textContent: spec.note || "" }), costBlock(spec), watch);
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
        if (parameter.name === "clusterName" || parameter.name === "name") field.addEventListener("change", () => refreshUpgrade(true));
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
  if (!pipTerraform.length) return;
  pipEl.append(el("div", { className: "pdiv", role: "separator" }, iconImg("terraform"), el("span", { textContent: "TERRAFORM" }), el("span", { className: "ro", textContent: "READ-ONLY" })));
  for (const spec of pipTerraform) {
    const card = el("section", { className: "card tf" });
    card.dataset.id = spec.id;
    card.append(cardHead(spec));
    if (openCard === spec.id) {
      card.classList.add("open");
      const body = el("div", { className: "card-body" });
      body.append(el("div", { textContent: spec.note || "" }), costBlock(spec), el("div", { id: "tf-state", className: "tf-state", textContent: "reading state…" }), el("ul", { id: "tf-outputs", className: "lines" }));
      const cmds = el("div", { className: "cmds", role: "list", ariaLabel: "commands to run yourself" });
      for (const command of spec.commands || []) {
        const copy = el("button", { type: "button", className: "cmd copy", textContent: "COPY", ariaLabel: `copy the ${command.label} command` });
        copy.addEventListener("click", () => copyCommand(command.text, copy));
        cmds.append(el("div", { className: `cmdrow ${command.label}`, role: "listitem" }, el("span", { className: "lbl", textContent: command.label.toUpperCase() }), el("code", { textContent: command.text }), copy));
      }
      body.append(cmds);
      card.append(body);
    }
    pipEl.append(card);
  }
}

async function copyCommand(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "COPIED";
  } catch {
    button.textContent = "SELECT";
  }
  setTimeout(() => {
    button.textContent = "COPY";
  }, 1500);
}

async function refreshTerraform(id, fresh) {
  const query = new URLSearchParams({ id });
  if (fresh) query.set("fresh", "1");
  if (sample) query.set("sample", "1");
  const body = await fetch(`/api/terraform/state?${query}`).then((response) => response.json()).catch(() => ({ error: "the page failed" }));
  const line = pipEl.querySelector("#tf-state");
  const outputs = pipEl.querySelector("#tf-outputs");
  if (!line || openCard !== id) return;
  line.textContent = body.error || body.text || "";
  line.classList.toggle("fail", Boolean(body.error));
  line.classList.toggle("off", !body.error && body.initialised === false);
  if (outputs) {
    outputs.replaceChildren(...Object.entries(body.outputs || {}).map(([key, value]) => el("li", {}, el("span", { textContent: key }), el("span", { textContent: value }))));
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
  if (body?.stack) lines.push(`stack ${body.stack}`);
  if (body?.error) lines.push(body.error);
  lines.push(...(body?.lines || []));
  out.textContent = lines.join("\n");
}

async function refreshUpgrade(fresh) {
  if (!pipOpen || !openCard) return;
  if (pipTerraform.some((item) => item.id === openCard)) {
    refreshTerraform(openCard, fresh);
    return;
  }
  if (sample) return;
  const query = new URLSearchParams({ module: openCard });
  if (fresh) query.set("fresh", "1");
  // Which stack to watch: the cluster (or name) typed in the card.
  const params = pipParams();
  for (const key of ["clusterName", "name"]) if (params[key]) query.set(key, params[key]);
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
    pipTerraform = body.terraform || [];
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

// The bill's details drop down from the header; a click elsewhere or Escape
// folds them back.
document.addEventListener("click", (event) => {
  if (!spendOpen || event.target.closest?.("#corner")) return;
  spendOpen = false;
  showSpend();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !spendOpen) return;
  spendOpen = false;
  showSpend();
  spendEl.focus();
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
  if (tabVisible) pullMetrics();
});

// Metrics: the server caches 5 minutes; this only asks when the answer is
// due (nextAt) and the tab is visible, so a hidden tab costs nothing.
setInterval(() => {
  pullMetrics();
}, METRICS_CHECK_MS);

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

// The overview reads the bill once, when the first live pull has a place
// (Overview plan R2/T2), then the server's six-hour cache. The two-second
// pull itself never asks for it.
pull().then(() => {
  if (place && !sample) queueSpend();
});
