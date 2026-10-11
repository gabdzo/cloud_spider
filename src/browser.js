import { ROW_LIMIT, accountLine, blastLine, foldAt, layout, newestFail, tagKeys } from "./layout.js";
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
import { hoverText, kubeHit, layoutKube } from "./kube-layout.js";
import { paintKube } from "./kube-draw.js";
import { renderTelemetry } from "./tele-view.js";
import { createPodInspector } from "./pod-inspect-view.js";
import { renderOps } from "./ops-view.js";
import { addonCommands, upgradeSpiderLine } from "./upgrade-rules.js";
import { costLine } from "./stack-costs.js";
import {
  clockText, drawMascot, drawScope, iconURL, mapStats, scrollToShow, needleAt, paintIcons, pathStats, renderRadio, renderStats, setIcon,
} from "./chrome.js";
import { FRAME_MS } from "./theme.js";
import { createVaultState, VPC_FOLD_KEY } from "./vault-state.js";
import { VAULT, placeVaults, vaultAt } from "./vault-layout.js";
import { badgeAt, ownedRows, parseVaultHash, vaultHash, vaultSummary, vaultTally } from "./vault-page.js";
import { paintVaultCard } from "./vault-draw.js";
import { plateText } from "./vault-schema.js";
import { snapshot } from "./agent-text.js";
import { createTerminal } from "./terminal.js";
import { createLearnView } from "./learn-view.js";
import { metricAlerts, paintPlace } from "./metrics.js";
import { sunrise } from "./sprites/landmarks.js";
import { drawSprite } from "./draw-kit.js";
import { sloBlock, sloFacts } from "./slo-view.js";
import { renderSpend } from "./spend-view.js";
import { KUBE_MAP_KEY, compoundHit, compoundHover, kubeModel, readKubeChoices } from "./map-kube.js";

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
const vpcFoldsEl = document.querySelector("#vpc-folds");
let foldsFor = null;
const mapViewEl = document.querySelector("#map-view");
const viewArch = document.querySelector("#view-arch");
const viewTag = document.querySelector("#view-tag");
const viewTagKey = document.querySelector("#view-tag-key");
const MAP_VIEW_KEY = "cloudspider.mapView";
const MAP_TAG_KEY = "cloudspider.mapTagKey";
const kubePanel = document.querySelector("#kube-panel");
const kubeTabs = document.querySelector("#kube-tabs");
const kubeTele = document.querySelector("#kube-tele");
const kubeOps = document.querySelector("#kube-ops");
const vaultTemplatesButton = document.querySelector("#vault-templates-btn");
const vaultTemplates = document.querySelector("#vault-templates");
const tabVaults = document.querySelector("#tab-vaults");
const vaultPageEl = document.querySelector("#vault-page");
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
// Kubernetes events worth hearing (scaling, Karpenter nodes, policy,
// warnings), from /api/cluster/ops; newest first, at most three.
let kubeRows = [];
let spiderRegion = "";
let spend = null;
let spendSample = null;
let spendOpen = false;
let spendTicket = 0;
let pipOpen = false;
let openCard = null;
let campGrain = "coarse";
// The map's picture: "arch" (VPC > AZ > subnet) or "tag" (camps per tag value).
let mapView = readPref(MAP_VIEW_KEY, "arch") === "tag" ? "tag" : "arch";
let mapTagKey = readPref(MAP_TAG_KEY, "project") || "project";
let tagKeysShown = "";

function readPref(key, fallback) {
  try {
    return window.localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function writePref(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // private mode: the choice lasts for this page only
  }
}
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
// The VAULTS view's route (#vaults, #vaults/<key>); null on the map.
let vaultRoute = parseVaultHash(location.hash);
let vaultPageShown = "";
let vaultPageFrom = null;
let vaultsFor = null; // sample flag the vaults were read for
let vaultsAt = 0;
let vaultsLoading = false;
let vaultsTicket = 0;
let vaultsShown = "";
let doorFrame = 0;
const vaultLights = new Map();
// Collapsed VPC camps (a member of this set is a closed VPC), kept like the
// vault doors.
const vpcFold = createVaultState({
  storageKey: VPC_FOLD_KEY,
  storage: (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })(),
});
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
  tabMap.setAttribute("aria-pressed", String(mode === "map" && !vaultRoute));
  tabVaults.setAttribute("aria-pressed", String(vaultPageOpen()));
  pathButton.setAttribute("aria-pressed", String(mode === "path"));
  clusterButton.setAttribute("aria-pressed", String(mode === "cluster"));
  tabRadio.setAttribute("aria-pressed", String(!radioPanel.hidden));
  upgradeButton.setAttribute("aria-pressed", String(pipOpen));
  acct.textContent = sample ? "SAMPLE" : "LIVE";
  const stats = mode === "path" ? pathStats(pathData?.diagram) : mode === "cluster" ? pathStats(clusterData?.diagram) : mapStats(place);
  renderStats(statsEl, stats);
  // The picture is a canvas; give screen readers its one-line summary.
  const view = mode === "path" ? "request path" : mode === "cluster" ? "cluster" : "survey map";
  const summary = [sample ? `${view}, sample` : view, ...(stats?.cells || []), stats?.meter?.label || "", statusEl.textContent || ""].filter(Boolean).join(", ");
  if (canvas.getAttribute("aria-label") !== summary) canvas.setAttribute("aria-label", summary);
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
  return [...pageIssue, ...spider, ...kubeRows, ...trail].slice(0, 8);
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
  // The SLOs of the vault(s) that own this piece.
  for (const vault of vaultsData.vaults) {
    if (!vault.damaged && vault.slos?.length && (vault.owned || []).includes(id)) facts.push(...sloFacts(vault.slos));
  }
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
  spendLines.hidden = !spendOpen;
  if (spendOpen) renderSpend(spendLines, spend, { iconURL });
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

// ---- the cluster on the map (map-kube.js) ----
// The kube diagram the Cluster view reads (viewer role), cached 30 s by
// the server; drawn as a compound in the nodes' subnets at the level
// chosen per cluster (1 nodes, 2 apps, 3 pods, AUTO by room), kept in
// localStorage.
const mapKube = { models: new Map(), sig: "", choices: {}, hover: null, focus: null, ticket: 0, sample: false, keepSample: false };
try {
  mapKube.choices = readKubeChoices(window.localStorage);
} catch {
  // AUTO everywhere
}

function mapKubeSignature(models) {
  const out = [];
  for (const [name, model] of models) {
    out.push(name, model.nodes.map((n) => `${n.instanceId}:${n.status}`).join(","));
    for (const app of model.apps) out.push(`${app.id}:${app.have}/${app.want}:${app.status}:${app.pods.map((p) => `${p.id}@${p.instanceId}:${p.status}`).join(",")}`);
  }
  return out.join("|");
}

async function pullMapKube() {
  if (mode !== "map" || !tabVisible) return;
  const ticket = ++mapKube.ticket;
  const wasSample = sample;
  const body = await fetch(`/api/map/kube${wasSample ? "?sample=1" : ""}`)
    .then((response) => response.json())
    .catch(() => null);
  if (!body || ticket !== mapKube.ticket || wasSample !== sample) return;
  const models = new Map();
  for (const item of body.clusters || []) if (item?.name && item.diagram) models.set(item.name, kubeModel(item.diagram, item.name));
  const sig = mapKubeSignature(models);
  mapKube.sample = wasSample;
  if (sig === mapKube.sig) return;
  mapKube.models = models;
  mapKube.sig = sig;
  if (mode === "map") draw();
}

function setKubeLevel(cluster, value) {
  mapKube.choices = { ...mapKube.choices, [cluster]: value };
  try {
    window.localStorage.setItem(KUBE_MAP_KEY, JSON.stringify(mapKube.choices));
  } catch {
    // kept for this page only
  }
  draw();
}

// Opens the Cluster view on an app or pod clicked on the map; the focus is
// applied when the cluster's diagram arrives.
function openInCluster(hit) {
  mapKube.focus = hit.type === "compound" ? null : { id: hit.id, type: hit.type, ns: hit.ns, app: hit.app || null };
  mapKube.hover = null;
  setClusterScreen("topology");
  mapKube.keepSample = sample;
  enterCluster();
}

function applyClusterFocus() {
  const focus = mapKube.focus;
  if (!focus || !clusterData?.diagram) return;
  mapKube.focus = null;
  const nodes = clusterData.diagram.nodes || [];
  const node = nodes.find((item) => item.id === focus.id);
  if (!node) {
    setStatus(ui, `${focus.id.replace(/^[^:]+:/, "")} is no longer in the cluster`);
    return;
  }
  if (focus.ns && clusterLanes.open[focus.ns] === false) clusterLanes.open = { ...clusterLanes.open, [focus.ns]: true };
  if (node.owner && !clusterLanes.expanded.includes(node.owner)) clusterLanes.expanded = [...clusterLanes.expanded, node.owner];
  saveClusterLanes();
  clusterSelected = node.id;
  if (node.kind === "workload") showWorkload(node);
  else if (node.pod) showPod(node);
}

function placedMap() {
  const width = map.clientWidth || 0;
  const rowLimit = width ? Math.min(ROW_LIMIT, width) : ROW_LIMIT;
  const vaults = vaultsData.vaults;
  const extra = {
    key: `${vaultsShown}|${vaultState.key(vaultKeys())}|${vpcFold.key((place?.vpcs || []).map((vpc) => vpc.id))}|${mapView}|${mapTagKey}|${mapKube.sig}|${JSON.stringify(mapKube.choices)}`,
    options: { vaults, vaultMode: "page", isOpen: (key) => vaultState.isOpen(key), isClosed: (id) => vpcFold.isOpen(id), view: mapView, groupBy: mapTagKey, kube: mapKube.models.size ? { models: mapKube.models, choice: (cluster) => mapKube.choices[cluster] || "auto" } : null },
  };
  const placed = layoutCache.get(place || EMPTY_PLACE, rowLimit, extra);
  // A reload with the same vaults keeps the layout but brings new check
  // results: point the cells at the fresh records.
  if (placed.vaults && placed.vaults.boundTo !== vaultsData) {
    const byKey = new Map(vaults.map((vault) => [vault.key, vault]));
    for (const cell of placed.vaults.cells) cell.vault = byKey.get(cell.key) || cell.vault;
    placed.vaults.boundTo = vaultsData;
  }
  if (placed.badges?.length && placed.badgesBoundTo !== vaultsData) {
    const byKey = new Map(vaults.map((vault) => [vault.key, vault]));
    for (const badge of placed.badges || []) badge.vault = byKey.get(badge.key) || badge.vault;
    placed.badgesBoundTo = vaultsData;
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
    if (vault.slos?.length) body.append(sloBlock(vault.slos, { title: "SLOS" }));
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
// The vaults are their own view now (the VAULTS tab): nothing of theirs
// sits over the map but the badges, which the canvas draws.
function placeVaultChrome() {
  vaultAll.hidden = true;
  vaultTemplatesButton.hidden = true;
  vaultTemplates.hidden = true;
}

// ---- the VAULTS view (the fourth tab; #vaults, #vaults/<key>) ----
// A view like Path and Cluster: the tab is lit and the map stops drawing. The list: a door per
// vault on its hill with plate and lamp, status, stack and counts; then the
// templates. One vault: the door, the panel (description, facts, checks,
// METRICS, TROUBLE, ERROR LINES, links) and what it owns, each with SHOW.

function vaultPageOpen() {
  return Boolean(vaultRoute) && mode === "map";
}

function openVaultPage(key) {
  vaultPageFrom = document.activeElement;
  const hash = vaultHash(key);
  if (location.hash !== hash) location.hash = hash;
  else routeVaults();
}

function closeVaultPage() {
  if (!vaultRoute) return;
  history.pushState(null, "", `${location.pathname}${location.search}`);
  routeVaults();
}

// The VAULTS tab: from Path or Cluster, leave that view first (the vault
// page needs the map's resources for OWNED RESOURCES and SHOW).
function enterVaults() {
  if (mode === "path") leavePath();
  else if (mode === "cluster") leaveCluster();
  openVaultPage(null);
}

// Path and Cluster drop the vaults route, so MAP later means the map.
function dropVaultRoute() {
  if (!vaultRoute) return;
  history.replaceState(null, "", `${location.pathname}${location.search}`);
  vaultRoute = null;
  vaultPageShown = "";
  renderVaultPage();
}

function routeVaults() {
  const before = vaultRoute;
  vaultRoute = parseVaultHash(location.hash);
  if (vaultRoute && mode !== "map") {
    if (mode === "path") leavePath();
    else if (mode === "cluster") leaveCluster();
  }
  vaultPageShown = "";
  renderVaultPage();
  renderChrome();
  if (!vaultRoute && before) {
    draw();
    if (vaultPageFrom?.isConnected) vaultPageFrom.focus();
  } else if (vaultRoute) {
    vaultPageEl.scrollTop = 0;
    vaultPageEl.querySelector("h2, .vpg-back")?.focus({ preventScroll: true });
  }
}

window.addEventListener("hashchange", routeVaults);
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !vaultPageOpen()) return;
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
  event.preventDefault();
  if (vaultRoute.key) openVaultPage(null);
  else closeVaultPage();
});

// A door on its hill, drawn once into a small canvas.
function doorCanvas(vault, scale = 1) {
  const area = placeVaults([vault], { top: -VAULT.label, left: 0, rowLimit: VAULT.cellW });
  const cell = area.cells[0];
  const height = cell.plate.y + cell.plate.h + 8;
  const dpr = Math.max(1, Math.ceil((window.devicePixelRatio || 1) * scale));
  const node = document.createElement("canvas");
  node.className = "vpg-door";
  node.width = cell.w * dpr;
  node.height = height * dpr;
  node.style.width = `${cell.w * scale}px`;
  node.style.height = `${height * scale}px`;
  node.setAttribute("aria-hidden", "true");
  const g = node.getContext("2d");
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.imageSmoothingEnabled = false;
  paintVaultCard(g, cell);
  return node;
}

function vaultPageSignature() {
  const route = vaultRoute?.key ? vaultsData.vaults.find((vault) => vault.key === vaultRoute.key) : null;
  return JSON.stringify([
    vaultRoute,
    vaultsFor,
    vaultsData.vaults.map((vault) => [vault.key, vault.status, vault.damaged, (vault.slos || []).map((slo) => [slo.flag, slo.sliPct, slo.budgetPct, slo.burn]), (vault.checks || []).map((check) => [check.status, check.code, check.ms]), vault.stackInfo, (vault.trouble || []).length, (vault.owned || []).length]),
    (vaultsData.templates || []).length,
    route ? [route.description, route.links, route.trouble, vaultLogState.get(route.key), vaultMetrics(route).map((hit) => `${hit.id}:${metricsData?.at}`), (route.owned || []).map((id) => place?.instances?.find((item) => item.id === id)?.state)] : null,
  ]);
}

function renderVaultPage() {
  const open = vaultPageOpen();
  vaultPageEl.hidden = !open;
  map.toggleAttribute("inert", open);
  if (!open) {
    if (vaultPageEl.firstChild) vaultPageEl.replaceChildren();
    vaultPageShown = "";
    return;
  }
  wantVaults();
  const shown = vaultPageSignature();
  if (shown === vaultPageShown) return;
  vaultPageShown = shown;
  const keep = vaultPageEl.scrollTop;
  const focusKey = document.activeElement?.closest?.("#vault-page") ? document.activeElement.dataset.focus : null;
  const vault = vaultRoute.key ? vaultsData.vaults.find((item) => item.key === vaultRoute.key) : null;
  vaultPageEl.replaceChildren(...(vaultRoute.key ? vaultDetail(vault, vaultRoute.key) : vaultList()));
  vaultPageEl.scrollTop = keep;
  if (focusKey) vaultPageEl.querySelector(`[data-focus="${CSS.escape(focusKey)}"]`)?.focus({ preventScroll: true });
}

function pageHead(title, sub, back) {
  const head = vel("header", "vpg-head");
  const backButton = vel("button", "cmd vpg-back", back.label);
  backButton.type = "button";
  backButton.dataset.focus = "back";
  backButton.addEventListener("click", back.go);
  const h2 = vel("h2", "", title);
  h2.tabIndex = -1;
  head.append(backButton, h2, vel("span", "vpg-sub", sub));
  return head;
}

function vaultList() {
  const vaults = vaultsData.vaults;
  const tally = vaultTally(vaults);
  const sub = vaultsFor === null
    ? "reading the vault files…"
    : [`${tally.total} VAULT${tally.total === 1 ? "" : "S"}`, `${tally.live} LIVE`, tally.ok ? `${tally.ok} OK` : "", tally.fail ? `${tally.fail} FAILING` : "", tally.trouble ? `${tally.trouble} IN TROUBLE` : "", tally.damaged ? `${tally.damaged} DAMAGED` : ""].filter(Boolean).join(" · ");
  const out = [pageHead("VAULTS", sub, { label: "◂ MAP", go: closeVaultPage })];
  if (vaultsData.note) out.push(vel("p", "vpg-note", vaultsData.note));
  const grid = vel("ul", "vpg-grid");
  if (!vaults.length && vaultsFor !== null) grid.append(vel("li", "vpg-empty", "No vaults yet. A vault is a YAML file in vaults/; start from a template below."));
  for (const vault of vaults) {
    const summary = vaultSummary(vault);
    const li = vel("li", `vpg-card ${summary.light}${summary.trouble ? " trouble" : ""}${vault.damaged ? " damaged" : ""}`);
    const button = vel("button", "vpg-open");
    button.type = "button";
    button.dataset.focus = `card:${vault.key}`;
    button.setAttribute("aria-label", `${summary.plate} ${summary.title}: ${summary.lightText}. Open its page.`);
    button.addEventListener("click", () => openVaultPage(vault.key));
    const status = vel("p", "vpg-status");
    status.append(vel("i", "vpg-lamp"), vel("span", "", summary.lightText));
    const facts = vel("div", "vpg-lines");
    for (const line of summary.lines) facts.append(vel("span", "", line));
    const stack = vel("span", `vpg-stack ${summary.stack.state}`, summary.stack.state === "live" ? "LIVE" : summary.stack.state === "down" ? "NOT UP" : summary.stack.state === "error" ? "STACK?" : "TAGS");
    button.append(doorCanvas(vault), stack, vel("h3", "", summary.title), status, facts);
    li.append(button);
    grid.append(li);
  }
  out.push(grid);
  const templates = vaultsData.templates || [];
  const shelf = vel("section", "vpg-templates");
  shelf.append(vel("h4", "", `TEMPLATES · ${templates.length} · vaults/templates/ · not drawn, never live`));
  shelf.append(templateList(templates));
  out.push(shelf);
  return out;
}

function vaultDetail(vault, key) {
  const back = { label: "◂ VAULTS", go: () => openVaultPage(null) };
  if (!vault) {
    return [pageHead("VAULT NOT FOUND", vaultsFor === null ? "reading the vault files…" : `no vault called ${key}`, back)];
  }
  const summary = vaultSummary(vault);
  const out = [pageHead(`${summary.plate} · ${summary.title}`, `${summary.lightText} · ${summary.stack.text}`, back)];
  const body = vel("div", `vpg-detail ${summary.light}`);
  const side = vel("div", "vpg-side");
  side.append(doorCanvas(vault, 1.5));
  const stack = vel("p", `vpg-stack big ${summary.stack.state}`, summary.stack.text);
  side.append(stack);
  const panel = vaultPanel({ vault });
  panel.querySelector(".vp-close")?.remove();
  body.append(side, panel);
  out.push(body);
  if (!vault.damaged) out.push(ownedBlock(vault));
  if (vault.logGroups?.length && !vaultLogState.has(vault.key)) loadVaultLogs(vault.key);
  return out;
}

function ownedBlock(vault) {
  const rows = ownedRows(vault, place);
  const block = vel("section", "vpg-owned");
  block.append(vel("h4", "", rows.length ? `OWNED RESOURCES · ${rows.length}` : "OWNS NOTHING ON THE MAP RIGHT NOW"));
  const list = vel("ul");
  for (const row of rows) {
    const li = vel("li", row.onMap ? "" : "off");
    li.append(vel("b", "kind", row.kind), vel("span", "name", row.name), vel("span", "state", row.state), vel("span", "where", row.where));
    if (row.onMap) {
      const show = vel("button", "cmd", "SHOW");
      show.type = "button";
      show.dataset.focus = `show:${row.id}`;
      show.title = `back to the map, ${row.name} selected`;
      show.addEventListener("click", () => showOnMap(row.id));
      li.append(show);
    }
    list.append(li);
  }
  block.append(list);
  return block;
}

// Back to the map with the resource selected and scrolled into view.
function showOnMap(id) {
  vaultPageFrom = null;
  closeVaultPage();
  const placed = placedMap();
  const building = buildingAt(placed, null, null, id);
  const fixture = building ? null : fixtureAt(placed, null, null, id);
  if (building) {
    const raw = place?.instances.find((item) => item.id === id) || building;
    clickBuilding(ui, raw, region, place ? blastLine(place, raw.id) : "");
  } else if (fixture) clickFixture(ui, fixture, fixtureNote(fixture));
  else return;
  setFacts(ui, plateFacts(id));
  renderChrome();
  draw();
  const hit = building || fixture;
  revealPanel({ x: hit.x - 40, y: hit.y - 40, w: hit.w + 80, h: hit.h + 80 });
}

// On a narrow window the diagnosis can land past the edge of the scrolled
// map; scroll just enough to show it, keeping its left edge in view.
function revealPanel(rect) {
  const left = scrollToShow(map.scrollLeft, map.clientWidth, rect.x, rect.w);
  const top = scrollToShow(map.scrollTop, map.clientHeight, rect.y, rect.h);
  if (left !== map.scrollLeft || top !== map.scrollTop) map.scrollTo({ left, top, behavior: reducedMotion ? "auto" : "smooth" });
}

// Path with nothing to draw: say why, and what would give it something.
function pathEmptyText() {
  if (pathData && !pathData.error && !pathData.loadBalancers?.length) {
    return [
      pathData.headline || "no load balancers here",
      "Path follows one request through an ALB or NLB: listener, rule, target group, targets.",
      "Pick another region, paste a host that resolves to a load balancer, or turn SAMPLE on to see one.",
    ].join("\n");
  }
  return pathData?.headline || pathData?.error || pathFailure || "reading the path";
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
    empty: pathEmptyText(),
    reducedMotion,
  });
}

// Cluster lanes: which namespaces are open and which workloads list their
// pods one by one, kept across reloads like the vault doors.
const CLUSTER_LANES_KEY = "cloudspider.cluster.lanes";
let clusterLanes = { open: {}, expanded: [] };
try {
  const saved = JSON.parse(window.localStorage.getItem(CLUSTER_LANES_KEY) || "null");
  if (saved && typeof saved === "object") clusterLanes = { open: saved.open || {}, expanded: Array.isArray(saved.expanded) ? saved.expanded : [] };
} catch {
  // private mode or a bad value: start with the defaults
}
let clusterHover = null;
let clusterPlaced = { key: null, data: null, placed: null };

function saveClusterLanes() {
  try {
    window.localStorage.setItem(CLUSTER_LANES_KEY, JSON.stringify(clusterLanes));
  } catch {
    // not kept, still works for this page
  }
  clusterPlaced = { key: null, data: null, placed: null };
}

// Cluster screens: tabs over the Cluster view. TOPOLOGY is the lane
// picture; every other screen is an HTML section over the map. To add one
// (events, policies…): push { id, label, show(), hide() } here.
const CLUSTER_SCREENS = [
  { id: "topology", label: "TOPOLOGY" },
  { id: "telemetry", label: "TELEMETRY", show: showTelemetry, hide: hideTelemetry },
  { id: "ops", label: "OPS", show: showOps, hide: hideOps },
];
const CLUSTER_SCREEN_KEY = "cloudspider.cluster.screen";
let clusterScreen = "topology";
try {
  const saved = window.localStorage.getItem(CLUSTER_SCREEN_KEY);
  if (CLUSTER_SCREENS.some((item) => item.id === saved)) clusterScreen = saved;
} catch {
  // default screen
}
let clusterTabsShown = false;

function clusterHasScreens() {
  return mode === "cluster" && clusterData?.diagram?.layout === "kube";
}

function syncClusterScreens() {
  const on = clusterHasScreens();
  if (on && !kubeTabs.children.length) {
    for (const item of CLUSTER_SCREENS) {
      const button = vel("button", "", item.label);
      button.type = "button";
      button.dataset.screen = item.id;
      button.addEventListener("click", () => setClusterScreen(item.id));
      kubeTabs.append(button);
    }
  }
  for (const button of kubeTabs.children) button.setAttribute("aria-pressed", String(button.dataset.screen === clusterScreen));
  if (on === clusterTabsShown) return;
  clusterTabsShown = on;
  kubeTabs.hidden = !on;
  const screen = CLUSTER_SCREENS.find((item) => item.id === clusterScreen);
  if (on) screen?.show?.();
  else for (const item of CLUSTER_SCREENS) item.hide?.();
}

function setClusterScreen(id) {
  if (id === clusterScreen) return;
  CLUSTER_SCREENS.find((item) => item.id === clusterScreen)?.hide?.();
  clusterScreen = id;
  try {
    window.localStorage.setItem(CLUSTER_SCREEN_KEY, id);
  } catch {
    // not kept
  }
  for (const button of kubeTabs.children) button.setAttribute("aria-pressed", String(button.dataset.screen === id));
  if (clusterTabsShown) CLUSTER_SCREENS.find((item) => item.id === id)?.show?.();
  draw();
}

// TELEMETRY: asks every 30 s while shown (the server samples at most that
// often and keeps an hour in memory). Nothing is read while hidden.
let teleData = null;
let teleTimer = 0;
let teleTicket = 0;
function showTelemetry() {
  kubeTele.hidden = false;
  showPod(null);
  paintTelemetry();
  pullTelemetry();
  clearInterval(teleTimer);
  teleTimer = setInterval(() => {
    if (tabVisible) pullTelemetry();
  }, 30_000);
}
function hideTelemetry() {
  kubeTele.hidden = true;
  clearInterval(teleTimer);
  teleTimer = 0;
}
function paintTelemetry() {
  renderTelemetry(kubeTele, teleData, { width: kubeTele.clientWidth || map.clientWidth || 1200, cloudwatch: metricsData?.targets || {}, metricValue });
}
async function pullTelemetry() {
  const ticket = ++teleTicket;
  const body = await fetch(`/api/cluster/telemetry${sample ? "?sample=1" : ""}`).then((r) => r.json()).catch(() => ({ error: "the telemetry did not answer" }));
  if (ticket !== teleTicket || kubeTele.hidden) return;
  teleData = body;
  paintTelemetry();
}

// OPS: what the add-ons report (Kyverno, HPA, Karpenter, KEDA, events).
// Asks every 15 s while shown.
let opsData = null;
let opsTimer = 0;
let opsTicket = 0;
function showOps() {
  kubeOps.hidden = false;
  showPod(null);
  renderOps(kubeOps, opsData);
  pullOps();
  clearInterval(opsTimer);
  opsTimer = setInterval(() => {
    if (tabVisible) pullOps();
  }, 15_000);
}
function hideOps() {
  kubeOps.hidden = true;
  clearInterval(opsTimer);
  opsTimer = 0;
}
async function pullOps() {
  const ticket = ++opsTicket;
  const body = await fetch(`/api/cluster/ops${sample ? "?sample=1" : ""}`).then((r) => r.json()).catch(() => ({ error: "the add-ons did not answer" }));
  if (ticket !== opsTicket) return;
  takeKubeRadio(body);
  if (kubeOps.hidden) return;
  opsData = body;
  renderOps(kubeOps, opsData);
}

// The radio hears the cluster's events whether or not OPS is open: every
// 30 s, only when a kube context answers.
function takeKubeRadio(body) {
  const rows = Array.isArray(body?.radio) ? body.radio : [];
  if (JSON.stringify(rows) === JSON.stringify(kubeRows)) return;
  kubeRows = rows;
  renderRadioPanel();
}
let kubeRadioOff = false;
async function pullKubeRadio() {
  if (!tabVisible || (kubeRadioOff && !sample)) return;
  const body = await fetch(`/api/cluster/ops${sample ? "?sample=1" : ""}`).then((r) => r.json()).catch(() => null);
  if (!body) return;
  if (body.unset) {
    kubeRadioOff = true;
    return;
  }
  takeKubeRadio(body);
}

function placedCluster() {
  if (clusterData?.diagram?.layout === "kube") {
    // Laid out once per answer, width and lane state; frames only paint.
    const key = `${map.clientWidth || 0}|${JSON.stringify(clusterLanes)}`;
    if (clusterPlaced.data !== clusterData || clusterPlaced.key !== key) {
      clusterPlaced = { key, data: clusterData, placed: layoutKube(clusterData.diagram, { width: map.clientWidth || 0, state: clusterLanes, top: 52 }) };
    }
    return clusterPlaced.placed;
  }
  return clusterData?.diagram
    ? layoutDiagram(clusterData.diagram, clusterData.diagram.layout === "kube" ? clusterData.diagram.columns || KUBE_COLUMNS : CLUSTER_COLUMNS, map.clientWidth || 0)
    : { nodes: [], edges: [], contentWidth: 0, contentHeight: 0 };
}

function drawCluster() {
  const placed = placedCluster();
  const { width, height } = sizeCanvas(placed.contentWidth, placed.contentHeight);
  if (placed.kind === "kube") {
    paintKube(ctx, { placed, selectedId: clusterSelected, hoverId: clusterHover, animTime, width, height, reducedMotion });
    return;
  }
  paintDiagram(ctx, {
    placed,
    selectedId: clusterSelected,
    animTime,
    width,
    height,
    empty: clusterData?.headline || clusterData?.error || clusterFailure || "reading the cluster",
    reducedMotion,
  });
}

function draw() {
  syncClusterScreens();
  // An HTML screen covers the canvas: nothing to paint underneath.
  if (clusterTabsShown && clusterScreen !== "topology") return;
  // The VAULTS page covers the map; the map does not draw under it.
  renderVaultPage();
  if (vaultPageOpen()) return;
  if (mode === "path" || mode === "cluster") {
    wallGrain.hidden = true;
    tallyEl.hidden = true;
    placeFolds(null);
    mapViewEl.hidden = true;
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
    kube: { hover: mapKube.hover, selected: null },
  });
  placeGrain(placed);
  placeVaultChrome(placed);
  placeFolds(placed);
  placeViewSwitch(placed);
}

// One real button per VPC camp (top-right of its wall), so Tab and
// Enter/Space fold it too. Rebuilt only when the layout changes.
function placeFolds(placed) {
  const camps = mode === "map" ? (placed?.settlements || []).filter((item) => !item.empty && !item.tagCamp) : [];
  if (foldsFor === placed && vpcFoldsEl.childElementCount === camps.length) return;
  foldsFor = placed;
  const focused = document.activeElement?.dataset?.vpc || "";
  vpcFoldsEl.replaceChildren(
    ...camps.map((camp) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "cmd vpc-fold";
      button.dataset.vpc = camp.id;
      button.textContent = camp.closed ? "OPEN" : "FOLD";
      button.setAttribute("aria-expanded", String(!camp.closed));
      button.setAttribute("aria-label", `${camp.closed ? "Expand" : "Collapse"} VPC ${camp.label}`);
      button.style.left = `${camp.x + camp.w - (camp.closed ? 124 : 84)}px`;
      button.style.top = `${camp.y + 4}px`;
      button.addEventListener("click", () => toggleVpc(camp.id));
      return button;
    }),
  );
  if (focused) vpcFoldsEl.querySelector(`[data-vpc="${CSS.escape(focused)}"]`)?.focus();
}

function toggleVpc(id) {
  vpcFold.toggle(id);
  clickGround(ui);
  renderChrome();
  draw();
}

// The ARCH / BY TAG switch rides on the region fence's second row.
function placeViewSwitch(placed) {
  const region = mode === "map" ? placed?.region : null;
  mapViewEl.hidden = !region || Boolean(ui.selection);
  if (!region) return;
  const keys = tagKeys(place || {});
  if (!keys.includes(mapTagKey)) keys.push(mapTagKey);
  const sig = keys.join("|");
  if (sig !== tagKeysShown) {
    viewTagKey.replaceChildren(...keys.map((key) => Object.assign(document.createElement("option"), { value: key, textContent: key })));
    tagKeysShown = sig;
  }
  viewTagKey.value = mapTagKey;
  viewTagKey.disabled = mapView !== "tag";
  viewArch.setAttribute("aria-pressed", String(mapView === "arch"));
  viewTag.setAttribute("aria-pressed", String(mapView === "tag"));
  const width = mapViewEl.offsetWidth || 260;
  mapViewEl.style.left = `${Math.max(region.x + 8, region.x + region.w - width - 14)}px`;
  mapViewEl.style.top = `${region.y + 20}px`;
}

function setMapView(next, key = mapTagKey) {
  mapView = next === "tag" ? "tag" : "arch";
  mapTagKey = key || "project";
  writePref(MAP_VIEW_KEY, mapView);
  writePref(MAP_TAG_KEY, mapTagKey);
  clickGround(ui);
  draw();
}

viewArch.addEventListener("click", () => setMapView("arch"));
viewTag.addEventListener("click", () => setMapView("tag"));
viewTagKey.addEventListener("change", () => setMapView("tag", viewTagKey.value));

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
    if (place?.diagramNote) noteSpider(place.diagramNote, "fail");
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
  mapKube.models = new Map();
  mapKube.sig = "";
  ++mapKube.ticket;
  ui.sample = true;
  kubeRows = [];
  setTimeout(pullKubeRadio, 0);
  setTimeout(pullMapKube, 0);
  if (pipOpen) setTimeout(() => pullAddons(true), 0);
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
  mapKube.models = new Map();
  mapKube.sig = "";
  ++mapKube.ticket;
  ui.sample = false;
  regionSelect.disabled = false;
  clickGround(ui);
  setStatus(ui, "");
  setTrail(ui, []);
  metricsData = null;
  pull();
  queueSpend();
  kubeRows = [];
  kubeRadioOff = false;
  setTimeout(pullKubeRadio, 0);
  setTimeout(pullMapKube, 0);
  if (pipOpen) pullAddons(true);
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
  pathFailure = "";
  const wasSample = sample;
  const asked = pathQuery();
  try {
    const response = await fetch(`${wasSample ? "/api/path-sample" : "/api/path"}?${asked}`);
    const body = await readBody(response);
    if (body.stale || mode !== "path" || wasSample !== sample) return;
    if (pathQuery() !== asked) {
      pathAgain = true;
      return;
    }
    pathData = body;
    pathFailure = "";
    syncLoadBalancers(body.loadBalancers || [], body.selected || "");
    if (pathSelected && !body.diagram?.nodes?.some((node) => node.id === pathSelected)) pathSelected = null;
    setStatus(ui, body.error ? "" : pathStatus(body));
    errorEl.hidden = !body.error;
    errorEl.textContent = body.error || "";
    renderChrome();
    draw();
  } catch (error) {
    if (mode !== "path") return;
    setStatus(ui, "");
    errorEl.hidden = false;
    errorEl.textContent = `the path did not come back: ${error.message || "the page failed"}`;
    pathFailure = "the path did not come back. Check the server log, then pick a load balancer or paste a host to try again.";
    draw();
  } finally {
    pathPulling = false;
    if (pathAgain) {
      pathAgain = false;
      pullPath();
    }
  }
}

// A view read that failed on the server (a 500 with a status line, or not
// JSON at all) must say so instead of leaving "reading the ..." up forever.
let pathFailure = "";
let clusterFailure = "";

async function readBody(response) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) throw new Error(body?.error || body?.status || `HTTP ${response.status}`);
  if (!body || typeof body !== "object") throw new Error("the answer was not readable");
  return body;
}

// SAMPLE is one switch for the whole device: it stays on across Map, Path
// and Cluster. Coming back to the map in sample mode redraws the sample camp
// (Path or Cluster may have switched sample on without ever loading it).
async function restoreSampleMap() {
  place = null;
  draw();
  try {
    const response = await fetch("/api/sample");
    const body = await readBody(response);
    if (!body.place) throw new Error("the page failed");
    sampleTrail = body.trail || sampleTrail;
    sampleMorningData = body.morning || sampleMorningData;
    if (!sample || mode !== "map") return;
    setTrail(ui, sampleTrail);
    showSample(body.place);
    queueSpend();
  } catch {
    if (!sample || mode !== "map") return;
    leaveSample();
  }
}

// The radio panel remembers whether it is open per view; the path needs the
// width more, so it starts closed there unless the window is wide.
const radioOpen = { map: true, path: window.innerWidth >= 1700, cluster: window.innerWidth >= 1700 };

function showRadioFor(next) {
  radioOpen[mode] = !radioPanel.hidden;
  radioPanel.hidden = !radioOpen[next];
}

function enterPath() {
  dropVaultRoute();
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
  showRadioFor("map");
  mode = "map";
  pathData = null;
  pathSelected = null;
  lbSelect.hidden = true;
  hostInput.hidden = true;
  setStatus(ui, sample ? "sample, not the account" : "");
  renderChrome();
  if (sample) {
    restoreSampleMap();
    return;
  }
  pull();
  queueSpend();
}

async function pullCluster() {
  if (clusterPulling) {
    clusterAgain = true;
    return;
  }
  clusterPulling = true;
  clusterFailure = "";
  const wasSample = sample;
  try {
    const response = await fetch(wasSample ? "/api/cluster-sample" : "/api/cluster");
    const body = await readBody(response);
    if (body.stale || mode !== "cluster" || wasSample !== sample) return;
    clusterData = body;
    clusterFailure = "";
    if (clusterSelected && !body.diagram?.nodes?.some((node) => node.id === clusterSelected)) clusterSelected = null;
    applyClusterFocus();
    setStatus(ui, body.error ? "" : body.headline || (wasSample ? "sample, not the account" : ""));
    errorEl.hidden = !body.error;
    errorEl.textContent = body.error || "";
    renderChrome();
    draw();
  } catch (error) {
    if (mode !== "cluster") return;
    setStatus(ui, "");
    errorEl.hidden = false;
    errorEl.textContent = `the cluster did not come back: ${error.message || "the page failed"}`;
    clusterFailure = "the cluster did not come back. Check the server log and the kube context, then press CLUSTER again.";
    draw();
  } finally {
    clusterPulling = false;
    if (clusterAgain) {
      clusterAgain = false;
      pullCluster();
    }
  }
}

function enterCluster() {
  dropVaultRoute();
  // Sample stays on across views (from a map compound as from the tab).
  mapKube.keepSample = false;
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
  showRadioFor("map");
  mode = "map";
  clusterData = null;
  clusterSelected = null;
  showPod(null);
  setStatus(ui, sample ? "sample, not the account" : "");
  renderChrome();
  mapKube.focus = null;
  if (sample) {
    restoreSampleMap();
    return;
  }
  pull();
  queueSpend();
  setTimeout(pullMapKube, 0);
}

// The mascot porthole is "home": back to the map from Path or Cluster.
function goOverview() {
  if (vaultRoute) closeVaultPage();
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
    if (!sample) {
      place = null;
      kubeRows = [];
      mapKube.models = new Map();
      mapKube.sig = "";
      ++mapKube.ticket;
    }
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
  podInspector.close();
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
  const slos = clusterData?.slos?.cluster || [];
  if (slos.length) body.append(sloBlock(slos.filter((item) => item.source !== "kube:restarts"), { title: "CLUSTER SLOS" }));
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

// A workload: its readiness and its SLOs (restart rate for its own pods,
// plus the cluster's API and pod-restart objectives).
function showWorkload(node) {
  ++podTicket;
  podInspector.close();
  const head = vel("div", "kp-title");
  head.append(vel("span", "kp-name", `${String(node.workloadKind || "workload").toUpperCase()} · ${node.ns}/${node.label}`));
  const close = vel("button", "vp-close", "CLOSE");
  close.type = "button";
  close.addEventListener("click", () => {
    clusterSelected = null;
    showPod(null);
    draw();
  });
  head.append(close);
  const facts = vel("dl", "vp-facts");
  for (const [label, value] of [["READY", `${node.have ?? "?"}/${node.want ?? "?"}`], ["STATE", node.status === "broken" ? "not ready" : node.status === "hang" ? "partly ready" : "ready"], ["NAMESPACE", node.ns]]) {
    facts.append(vel("dt", "", label), vel("dd", "", value));
  }
  const body = vel("div", "kp-body vp-metrics");
  body.append(facts);
  const own = clusterData?.slos?.workloads?.[`${node.ns}/${node.label}`];
  const cluster = (clusterData?.slos?.cluster || []).filter((item) => item.source !== "kube:nodes");
  body.append(sloBlock([own, ...cluster].filter(Boolean), { title: "SLOS", empty: "no readings yet: restarts are counted from the second cluster read on" }));
  kubePanel.replaceChildren(head, body);
  kubePanel.hidden = false;
}

// Cluster view: click a pod for the deep-inspect panel (pod-inspect-view.js).
let podTicket = 0;
const podInspector = createPodInspector(kubePanel, {
  sample: () => sample,
  onClose: () => {
    clusterSelected = null;
    draw();
  },
});
function showPod(node) {
  ++podTicket;
  if (!node) {
    podInspector.close();
    kubePanel.hidden = true;
    kubePanel.replaceChildren();
    return;
  }
  podInspector.open(node);
}

canvas.addEventListener("mouseleave", () => {
  if (mapKube.hover !== null) {
    mapKube.hover = null;
    if (mode === "map") draw();
  }
  if (clusterHover === null) return;
  clusterHover = null;
  if (mode === "cluster") draw();
});

canvas.addEventListener("click", async (event) => {
  if (mode === "cluster" && placedCluster().kind === "kube") {
    const hit = kubeHit(placedCluster(), event.offsetX, event.offsetY);
    if (hit?.type === "lane") {
      clusterLanes.open = { ...clusterLanes.open, [hit.ns]: !hit.lane.open };
      saveClusterLanes();
    } else if (hit?.type === "expand") {
      const list = new Set(clusterLanes.expanded);
      if (list.has(hit.owner)) list.delete(hit.owner);
      else list.add(hit.owner);
      clusterLanes.expanded = [...list];
      saveClusterLanes();
    } else {
      const node = hit?.node || null;
      clusterSelected = node?.id || null;
      if (node?.host) showNode(node);
      else if (node?.kind === "workload") showWorkload(node);
      else showPod(node?.pod ? node : null);
    }
    draw();
    return;
  }
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
  if (mapKube.models.size) {
    const kubeHitNow = compoundHit(placedMap(), event.offsetX, event.offsetY);
    if (kubeHitNow?.type === "lod") {
      setKubeLevel(kubeHitNow.cluster, kubeHitNow.value);
      return;
    }
    if (kubeHitNow) {
      openInCluster(kubeHitNow);
      return;
    }
  }
  if (vaultsData.vaults.length) {
    const badge = badgeAt(placedMap().badges, event.offsetX, event.offsetY);
    if (badge) {
      openVaultPage(badge.key);
      return;
    }
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
    } else {
      const camp = foldAt(placed, event.offsetX, event.offsetY);
      if (camp) {
        toggleVpc(camp.id);
        return;
      }
      clickGround(ui);
    }
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
  if (mode === "cluster" && placedCluster().kind === "kube") {
    const hit = kubeHit(placedCluster(), event.offsetX, event.offsetY);
    const id = hit?.type === "lane" ? `lane:${hit.ns}` : hit?.type === "expand" && hit.node.kind === "workload" ? hit.node.id : hit?.node?.id || null;
    const cursor = hit ? "pointer" : "";
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    const title = hoverText(hit);
    if (canvas.title !== title) canvas.title = title;
    if (id !== clusterHover) {
      clusterHover = id;
      draw();
    }
    return;
  }
  if (mode === "map" && mapKube.models.size) {
    const hit = compoundHit(placedMap(), event.offsetX, event.offsetY);
    const id = hit ? (hit.type === "lod" ? `lod:${hit.cluster}:${hit.value}` : hit.id || `compound:${hit.cluster}`) : null;
    if (id !== mapKube.hover) {
      mapKube.hover = id;
      draw();
    }
    if (hit) {
      const title = compoundHover(hit);
      if (canvas.title !== title) canvas.title = title;
      if (canvas.style.cursor !== "pointer") canvas.style.cursor = "pointer";
      return;
    }
  }
  if (canvas.title) canvas.title = "";
  if (mode !== "map" || !vaultsData.vaults.length) {
    if (canvas.style.cursor) canvas.style.cursor = "";
    return;
  }
  const placed = placedMap();
  const door = vaultAt(placed.vaults, event.offsetX, event.offsetY) || badgeAt(placed.badges, event.offsetX, event.offsetY);
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
  vaultTemplates.replaceChildren(head, templateList(templates));
}

function templateList(templates) {
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
  return list;
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

sampleButton.addEventListener("click", async () => {
  await toggleSample();
  learnView.refresh();
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
askTab.addEventListener("click", () => {
  if (learnView.isOpen()) learnView.setOpen(false);
  terminal.toggle();
});

// ---- LEARN: holotape labs over the map ----
const learnView = createLearnView({
  root: document.querySelector("#learn"),
  toggleButton: document.querySelector("#learn-key"),
  iconURL,
  isSample: () => sample,
  storage: (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })(),
  reducedMotion: () => reducedMotion,
  onNote(text, status) {
    noteSpider(text, status);
    renderRadioPanel();
  },
});
document.querySelector("#learn-key").addEventListener("click", () => {
  if (!learnView.isOpen()) {
    if (terminal.isOpen()) terminal.setOpen(false);
    if (pipOpen) toggleUpgrade();
  }
  learnView.toggle();
});
askThis.addEventListener("click", () => {
  const question = askThisQuestion();
  if (question) terminal.prefill(question);
});

// ---- Stacks: Pulumi upgrade cards in a Pip-Boy panel over the map ----

const CARD_ICON = {
  eks: "cluster", signal: "radio", barrel: "stack", camp: "bucket",
  rds: "database", pgcluster: "database", shopapi: "pod", site: "url", worker: "queue", openshift: "openshift", "tf-rds": "terraform",
  "pod-identity": "secret", "metrics-server": "addon", kyverno: "policy", karpenter: "node", "scaling-demo": "scale", lbc: "lb", "cert-manager": "secret", keda: "queue",
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

// The body of an open Pulumi card: note, bill, watch line, parameters, the
// three buttons (PREVIEW changes nothing) and, for a cluster add-on, the
// commands to run it yourself. `preset` fixes parameters (an add-on row
// knows its cluster).
function cardBody(spec, preset = {}) {
  const body = el("div", { className: "card-body" });
  const watch = el("div", { id: "pip-watch" });
  watch.hidden = true;
  body.append(el("div", { textContent: spec.note || "" }), costBlock(spec));
  if (spec.nodeCost) body.append(nodeCostBlock(spec.nodeCost));
  body.append(watch);
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
    const fixed = preset[parameter.name];
    if (parameter.choices) {
      field = el("select");
      for (const choice of parameter.choices) {
        field.append(el("option", { value: choice, textContent: choice, selected: choice === parameter.default }));
      }
    } else {
      field = el("input", { value: fixed ?? parameter.default ?? "" });
      if (fixed !== undefined) field.readOnly = true;
    }
    field.name = parameter.name;
    if (parameter.name === "clusterName" || parameter.name === "name") field.addEventListener("change", () => refreshUpgrade(true));
    body.append(el("label", {}, `${parameter.name} `, field));
  }
  const confirm = el("input", { name: "confirmName", placeholder: "type the name", autocomplete: "off" });
  const preview = el("button", { type: "button", className: "cmd", textContent: "preview", title: "pulumi preview --diff: shows what run would change, changes nothing" });
  preview.addEventListener("click", () => postUpgrade("preview"));
  const run = el("button", { type: "button", className: "cmd", textContent: "run" });
  run.addEventListener("click", () => postUpgrade("up"));
  const down = el("button", { type: "button", className: "cmd danger", textContent: "take it down" });
  down.addEventListener("click", () => postUpgrade("destroy"));
  body.append(el("div", { className: "actions" }, confirm, preview, run, down));
  if (spec.addon) body.append(commandRows(addonCommands(spec, preset.clusterName)));
  body.append(el("pre", { id: "pip-out" }));
  return body;
}

// What Karpenter's nodes cost while they run (each one), apart from the
// controller's own bill.
function nodeCostBlock(cost) {
  const [hour, , month] = costLine(cost).replace(/ \+ usage$/, "").split(" · ");
  const block = el("div", { className: "bill nodebill" });
  block.append(el("div", { className: "nodebill-head" }, iconImg("node"), el("span", { textContent: "EACH NODE IT ADDS" }), el("b", { textContent: `${hour} · ${month}` })));
  const lines = el("ul", { className: "lines" });
  for (const item of cost.items) lines.append(el("li", {}, el("span", { textContent: item.text }), el("span", { textContent: `$${item.month.toFixed(2)}/mo` })));
  block.append(lines);
  return block;
}

function commandRows(commands) {
  const cmds = el("div", { className: "cmds", role: "list", ariaLabel: "commands to run yourself" });
  for (const command of commands) {
    const copy = el("button", { type: "button", className: "cmd copy", textContent: "COPY", ariaLabel: `copy the ${command.label} command` });
    copy.addEventListener("click", () => copyCommand(command.text, copy));
    cmds.append(el("div", { className: `cmdrow ${command.label}`, role: "listitem" }, el("span", { className: "lbl", textContent: command.label.toUpperCase() }), el("code", { textContent: command.text }), copy));
  }
  return cmds;
}

// ---- CLUSTER ADD-ONS: nested under their cluster in the Stacks panel ----
// From /api/addons: per cluster, every add-on with its state (installed by
// its stack, present but not ours, not installed, needs a domain) and version.
let addonData = null;
let addonTicket = 0;
const ADDON_STATE = {
  installed: { word: "INSTALLED", lamp: "on" },
  present: { word: "PRESENT", lamp: "warn" },
  absent: { word: "NOT INSTALLED", lamp: "off" },
  "n/a": { word: "NEEDS A DOMAIN", lamp: "na" },
};

async function pullAddons(fresh = false) {
  const ticket = ++addonTicket;
  const query = new URLSearchParams();
  if (sample) query.set("sample", "1");
  if (fresh) query.set("fresh", "1");
  const body = await fetch(`/api/addons?${query}`).then((response) => response.json()).catch(() => ({ tree: [], notes: ["the add-ons did not answer"] }));
  if (ticket !== addonTicket || !pipOpen) return;
  addonData = body;
  drawAddonTree();
}

function addonRow(spec, item, cluster) {
  const key = `${item.id}@${cluster.cluster}`;
  const state = ADDON_STATE[item.state] || ADDON_STATE.absent;
  const card = el("section", { className: `card addon ${item.state === "n/a" ? "na" : item.state}` });
  card.dataset.id = key;
  const sub = [item.version || item.pinned || "", spec?.cost ? costLine(spec.cost).split(" · ")[0] : ""].filter(Boolean).join(" · ");
  const head = el(
    "button",
    { type: "button", className: "card-head addon-head", disabled: !spec },
    iconImg(CARD_ICON[item.id] || "addon"),
    el("span", { className: "ad-name" }, el("span", { className: "card-title", textContent: item.title }), el("small", { className: "ad-ver", textContent: sub || "—", title: item.source ? `version from ${item.source}` : `pinned ${item.pinned || "by EKS"}` })),
    el("span", { className: `ad-state ${state.lamp}` }, el("i"), el("b", { textContent: item.busy ? "BUSY" : state.word })),
  );
  head.setAttribute("aria-expanded", String(openCard === key));
  head.addEventListener("click", () => {
    openCard = openCard === key ? null : key;
    drawPipForm();
    if (openCard) refreshUpgrade(true);
  });
  card.append(head);
  const tags = [];
  if (item.state === "present") tags.push(el("span", { className: "ad-tag warn", textContent: "NOT FROM ITS STACK: UP IS REFUSED" }));
  if (item.state === "n/a") tags.push(el("span", { className: "ad-tag dim", textContent: "NOT BUILT YET: NEEDS A DOMAIN AND A ROUTE 53 ZONE" }));
  else if (item.missing?.length && item.state !== "installed") tags.push(el("span", { className: "ad-tag", textContent: `NEEDS ${item.missing.map((id) => (addonTitle(id) || id).toUpperCase()).join(", ")} FIRST` }));
  if (!item.recommended && item.offered) tags.push(el("span", { className: "ad-tag dim", textContent: "OPTIONAL" }));
  if (tags.length) card.append(el("div", { className: "ad-tags" }, ...tags));
  if (openCard === key && spec) {
    card.classList.add("open");
    card.append(cardBody(spec, { clusterName: cluster.cluster }));
  }
  return card;
}

function addonTitle(id) {
  for (const cluster of addonData?.tree || []) for (const item of cluster.addons) if (item.id === id) return item.title;
  return "";
}

function drawAddonTree() {
  const box = pipEl.querySelector("#addon-tree");
  if (!box) return;
  // Keep an open card's body (typed confirm, the run's output) across a pull.
  const openBody = box.querySelector(".card.open > .card-body");
  const tree = addonData?.tree || [];
  const plates = [];
  if (!addonData) plates.push(el("div", { className: "quiet", textContent: "reading the clusters…" }));
  else if (!tree.length) plates.push(el("div", { className: "quiet", textContent: (addonData.notes || []).join(" · ") || "no EKS cluster yet: raise one with the EKS card" }));
  for (const cluster of tree) {
    const plate = el("section", { className: `ad-cluster${cluster.live ? "" : " gone"}` });
    const count = `${cluster.installed} INSTALLED${cluster.present ? ` · ${cluster.present} PRESENT` : ""}`;
    plate.append(
      el("header", { className: "ad-plate" },
        iconImg("cluster"),
        el("b", { textContent: cluster.cluster }),
        el("span", { className: `ad-live ${cluster.live ? "on" : "off"}`, textContent: cluster.live ? "LIVE" : "NO CLUSTER" }),
        el("span", { className: "ad-count", textContent: count }),
      ),
    );
    const rows = el("div", { className: "ad-rows" });
    for (const item of cluster.addons) rows.append(addonRow(pipModules.find((spec) => spec.id === item.id && spec.addon), item, cluster));
    plate.append(rows);
    plates.push(plate);
  }
  box.replaceChildren(...plates);
  if (openBody) {
    const fresh = box.querySelector(".card.open > .card-body");
    if (fresh) fresh.replaceWith(openBody);
  }
}

function drawPipForm() {
  const title = el("div", { className: "ptitle" }, iconImg("stack"), "STACKS");
  pipEl.replaceChildren(title);
  if (!pipModules.length && !pipTerraform.length) {
    pipEl.append(el("div", { className: "quiet", textContent: "no upgrade" }));
    return;
  }
  for (const spec of pipModules) {
    if (spec.addon) continue;
    const card = el("section", { className: "card" });
    card.dataset.id = spec.id;
    card.append(cardHead(spec));
    if (openCard === spec.id) {
      card.classList.add("open");
      card.append(cardBody(spec));
    }
    pipEl.append(card);
  }
  if (pipModules.some((spec) => spec.addon)) {
    pipEl.append(el("div", { className: "pdiv addons", role: "separator" }, iconImg("addon"), el("span", { textContent: "CLUSTER ADD-ONS" }), el("span", { className: "ro", textContent: "ONE STACK EACH" })));
    pipEl.append(el("div", { id: "addon-tree" }));
    drawAddonTree();
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
      body.append(commandRows(spec.commands || []));
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

// An add-on row's key is "<addon>@<cluster>"; the module is the part before.
function openModule() {
  return String(openCard || "").split("@")[0];
}

function openSpec() {
  return pipModules.find((item) => item.id === openModule()) || null;
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
  const query = new URLSearchParams({ module: openModule() });
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
  if (spec.addon) setTimeout(() => pullAddons(true), 1500);
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
  if (pipModules.some((spec) => spec.addon)) pullAddons(true);
}

// While the panel is open the add-on tree follows the clusters.
setInterval(() => {
  if (pipOpen && tabVisible && pipModules.some((spec) => spec.addon)) pullAddons(false);
}, 20_000);

tabMap.addEventListener("click", goOverview);
tabVaults.addEventListener("click", () => {
  if (vaultPageOpen() && !vaultRoute.key) return;
  enterVaults();
});

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
  event.preventDefault();
  spendOpen = false;
  showSpend();
  spendEl.focus();
});

// Escape folds the topmost thing that is open, one per press: the ASK
// terminal (unless a question is running), LEARN, STACKS, then the open pod
// or building plate. The bill and the vault page handle their own Escape.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.defaultPrevented) return;
  if (event.target instanceof HTMLSelectElement) return;
  if (terminal.isOpen()) {
    if (terminal.isRunning()) return;
    terminal.setOpen(false);
    askTab.focus();
  } else if (learnView.isOpen()) {
    learnView.setOpen(false);
    document.querySelector("#learn-key").focus();
  } else if (pipOpen) {
    toggleUpgrade();
    upgradeButton.focus();
  } else if (mode === "cluster" && clusterSelected) {
    clusterSelected = null;
    showPod(null);
    draw();
  } else if (mode === "map" && ui.selection && !ui.confirmation) {
    clickGround(ui);
    renderChrome();
    draw();
  } else return;
  event.preventDefault();
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

setInterval(() => {
  pullKubeRadio();
  pullMapKube();
}, 30_000);
setTimeout(pullMapKube, 1500);
setTimeout(pullKubeRadio, 4000);

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
  if (!kubeTele.hidden) paintTelemetry();
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
