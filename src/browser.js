import { samplePreview } from "./stack-sample.js";
import { mountScale } from "./eks-scale-view.js";
import { mountTakedown } from "./takedown-view.js";
import { CATEGORIES, stackCategory } from "./stack-resources.js";
import { shortLine, cardDetail } from "./morning-cards.js";
import { ago, driftHint, inventoryRows, nukeClusters, overviewStatus, pickLayout, rowMatches } from "./stack-overview.js";
import { ROW_LIMIT, accountLine, blastLine, foldAt, layout, newestFail, tagKeys } from "./layout.js";
import { createLayoutCache, flipSampleState } from "./layout-cache.js";
import { buildingAt, fixtureAt, focusLists, paint } from "./draw.js";
import { FILTER_AT, exposedText, filterRoutes, groupRoutes, ruleCount } from "./alb-routes.js";
import { lbExposure, routeProduct } from "./alb-exposure.js";
import { hasDock } from "./arch-layout.js";
import { mapTargets, stepTarget, targetLine } from "./map-focus.js";
import { createQuickFind, mapItem } from "./quick-find.js";
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
import { pathVerdict } from "./path-card.js";
import { drawPanHint, nodeTitle, paintDiagram, paintPath, sentenceRect } from "./path-draw.js";
import { CLUSTER_COLUMNS } from "./cluster.js";
import { KUBE_COLUMNS } from "./kube-diagram.js";
import { hoverText, kubeHit, layoutKube, middle } from "./kube-layout.js";
import { GROUP_BY, cleanGroupBy } from "./graph-group.js";
import { TOPOLOGY_GROUP_BY_KEY, groupDiagram, lanesForNamespaces } from "./kube-group.js";
import { SCOPES, TOPOLOGY_FOCUS_KEY, cleanFocus, diagnoseChoices, diagnoseTarget, focusDiagram, scopeStats, serviceDetail } from "./kube-focus.js";
import { openDiagnose } from "./diagnose-view.js";
import { countText, matchOrder, searchKube } from "./kube-search.js";
import { createK9s } from "./k9s.js";
import { paintKube } from "./kube-draw.js";
import { renderTelemetry } from "./tele-view.js";
import { createPodInspector } from "./pod-inspect-view.js";
import { renderOps } from "./ops-view.js";
import { createGraphView } from "./graph-view.js";
import { createLogErrorsView } from "./log-errors-view.js";
import { createKubeEmpty } from "./kube-empty.js";
import { addonCommands, confirmPrompt, upgradeSpiderLine } from "./upgrade-rules.js";
import { liveLine, noteLines, numberProblem, radioLine, runModel } from "./run-pane.js";
import { sourceText } from "./node-labels.js";
import { costFor, costLine, estimate } from "./stack-costs.js";
import { bundlesWith } from "./stack-bundles.js";
import {
  clockText, drawMascot, drawScope, iconURL, mapStats, scrollToShow, needleAt, paintIcons, pathStats, renderRadio, renderStats, setIcon,
  explainAbbr,
} from "./chrome.js";
import { FRAME_MS, PIP } from "./theme.js";
import { createVaultState, VPC_FOLD_KEY } from "./vault-state.js";
import { VAULT, placeVaults, vaultAt } from "./vault-layout.js";
import { badgeAt, ownedRows, parseVaultHash, vaultSummary, vaultTally } from "./vault-page.js";
import { HEALTH_CLASS, createInsightView } from "./vault-insight-view.js";
import { formatUrlState, parseUrlState } from "./url-state.js";
import { paintVaultCard } from "./vault-draw.js";
import { plateText } from "./vault-schema.js";
import { snapshot } from "./agent-text.js";
import { createTerminal } from "./terminal.js";
import { createLearnView } from "./learn-view.js";
import { createScoreView, scoreModel } from "./score/view.js";
import { groupVaults } from "./vault-perks.js";
import { clusterVaultNode } from "./perk-view.js";
import { createNetdebugView, debugBarShown } from "./netdebug/view.js";
import { metricAlerts, paintPlace } from "./metrics.js";
import { sunrise } from "./sprites/landmarks.js";
import { drawSprite } from "./draw-kit.js";
import { sloBlock, sloFacts } from "./slo-view.js";
import { renderSpend } from "./spend-view.js";
import { createSettings, readHidden, visibleModules } from "./settings-view.js";
import { nsPanelModel } from "./map-ns-panel.js";
import { pipModel } from "./pipboy-model.js";
import { PIP_ON_KEY, mountPip, readTint, setTint } from "./pipboy-view.js";
// GREEN / AMBER for the whole app, before anything paints.
if (readTint() === "amber") document.documentElement.dataset.tint = "amber";
import { KUBE_MAP_KEY, POLICIES_KEY, compoundHit, compoundHover, kubeModel, layoutKubeOnly, readKubeChoices, readPoliciesOn } from "./map-kube.js";
import { mountWhere } from "./where.js";

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
  logs: document.querySelector("#m-logs"),
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
// DEBUG: network debugging of a URL you type, docked in PATH
// (src/netdebug/view.js). SAMPLE mode debugs fixture answers.
// When an AWS load balancer answered, the PATH diagram follows the same
// host (its ALB route); other targets leave the diagram alone.
let lastDebugLink = "";
const netdebugView = createNetdebugView({
  root: document.querySelector("#netdebug"),
  hostInput,
  sample: () => sample,
  // DIAGNOSE reads the context CLUSTER shows (switcher / saved pick).
  context: () => clusterData?.context || clusterContext || "",
  choices: () => diagnoseChoices(clusterData?.diagram),
  // The Service an in-cluster SNIFF path shows (after its Ingress), so
  // INVESTIGATE works on plain Kubernetes with nothing typed in DEBUG.
  pathService: () => {
    if (mode !== "path" || !pathData?.kube) return null;
    const svc = (pathData.diagram?.nodes || []).find((node) => node.kind === "service" && !node.facts?.missing);
    const [namespace, service] = String(svc?.label || "").split("/");
    return namespace && service ? { namespace, service } : null;
  },
  onDone(report) {
    const who = report.checks?.find((c) => c.id === "L-HTTP-03")?.observed?.answeredBy;
    const host = report.target?.host || "";
    if (mode !== "path" || who !== "alb" || !host || hostInput.value.trim() === host) return;
    hostInput.value = host;
    hostInput.dispatchEvent(new Event("change"));
  },
});
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
const mapNsPanel = document.querySelector("#map-ns-panel");
const kubeTabs = document.querySelector("#kube-tabs");
const kubeCtxEl = document.querySelector("#kube-ctx");
const kubeConnectEl = document.querySelector("#kube-connect");
const kubeDockEl = document.querySelector("#kube-connect-dock");
const KC_OPEN_KEY = "cloudspider.kubeConnect.open";
const KC_TONE = { connected: "ok", "no-access": "fail", error: "fail", "not-connected": "warn", "not-listed": "warn", "clash-same": "warn", "no-cluster": "warn", outside: "warn" };
let kcChip = null;
let kcLog = null; // { wrap, bar, pane, open, state, action }
// CONNECT state (see "CONNECT" below), declared early: views use it on load.
let connectStripAt = 0;
let connectStripBody = null;
const pipKept = {};
const connectState = new Map();
let connectSeq = 0;
let connectWatch = null;
// ADD-ONS bundle: the last answer, the ticks per cluster, "with add-ons".
let bundleBody = null;
const bundleChosen = new Map();
let bundleSeq = 0;
let bundleWith = false;
const kubeSearchEl = document.querySelector("#kube-search");
const kubeSearchCount = document.querySelector("#kube-search-count");
// TOPOLOGY Group by (kube-group.js): lanes by namespace or a label; kept.
const kubeGroupBox = document.querySelector("#kube-groupby");
const kubeGroupSel = document.querySelector("#kube-groupby-sel");
const kubeGroupCustom = document.querySelector("#kube-groupby-custom");
let topologyGroupBy = "namespace";
try {
  topologyGroupBy = cleanGroupBy(window.localStorage.getItem(TOPOLOGY_GROUP_BY_KEY) || "namespace");
} catch {
  // default
}
for (const g of GROUP_BY) kubeGroupSel.append(new Option(g.label, g.id));
kubeGroupSel.append(new Option("custom label…", "custom"));
function syncTopologyGroupBy() {
  const known = GROUP_BY.some((g) => g.id === topologyGroupBy);
  kubeGroupSel.value = known ? topologyGroupBy : "custom";
  kubeGroupCustom.hidden = known;
  if (!known) kubeGroupCustom.value = topologyGroupBy;
}
function setTopologyGroupBy(raw) {
  const text = String(raw || "").trim();
  const next = cleanGroupBy(text);
  kubeGroupCustom.classList.toggle("bad", Boolean(text) && text !== "namespace" && next === "namespace");
  if (next === topologyGroupBy) return;
  topologyGroupBy = next;
  try {
    window.localStorage.setItem(TOPOLOGY_GROUP_BY_KEY, next);
  } catch {
    // not kept
  }
  syncTopologyGroupBy();
  draw();
}
syncTopologyGroupBy();
kubeGroupSel.addEventListener("change", () => {
  if (kubeGroupSel.value !== "custom") return setTopologyGroupBy(kubeGroupSel.value);
  kubeGroupCustom.hidden = false;
  kubeGroupCustom.focus();
  if (kubeGroupCustom.value) setTopologyGroupBy(kubeGroupCustom.value);
});
kubeGroupCustom.addEventListener("change", () => setTopologyGroupBy(kubeGroupCustom.value));
kubeGroupCustom.addEventListener("keydown", (event) => {
  if (event.key === "Enter") setTopologyGroupBy(kubeGroupCustom.value);
});
// TOPOLOGY focus (kube-focus.js): ISSUES (default) or ALL, a scope and a
// namespace pick; kept per browser. A search looks at everything in scope.
const kubeFocusBox = document.querySelector("#kube-focus");
const kfIssues = document.querySelector("#kf-issues");
const kfCount = document.querySelector("#kf-count");
const kfList = document.querySelector("#kf-list");
const kfAll = document.querySelector("#kf-all");
const kfScope = document.querySelector("#kf-scope");
const kfNs = document.querySelector("#kf-ns");
const kfNsPop = document.querySelector("#kf-ns-pop");
const kubeHealthy = document.querySelector("#kube-healthy");
const kubeIssues = document.querySelector("#kube-issues");
let topologyFocus = cleanFocus(null);
try {
  topologyFocus = cleanFocus(window.localStorage.getItem(TOPOLOGY_FOCUS_KEY));
} catch {
  // default
}
for (const sc of SCOPES) kfScope.append(new Option(`Scope: ${sc.label}`, sc.id));
function setTopologyFocus(patch) {
  topologyFocus = cleanFocus({ ...topologyFocus, ...patch });
  try {
    window.localStorage.setItem(TOPOLOGY_FOCUS_KEY, JSON.stringify(topologyFocus));
  } catch {
    // not kept
  }
  syncFocusBar();
  renderChrome();
  draw();
}
let focusMemo = { diagram: null, key: "", out: null };
function focusedView() {
  const diagram = clusterData?.diagram;
  // A search looks inside what is shown (ISSUES stays ISSUES).
  const f = topologyFocus;
  const key = JSON.stringify(f);
  if (focusMemo.diagram !== diagram || focusMemo.key !== key) focusMemo = { diagram, key, out: focusDiagram(diagram, f) };
  return focusMemo.out;
}
// The bottom bar under TOPOLOGY: counts for the scope (All / Apps /
// Add-ons / picked namespaces); in ISSUES, also how many cards are shown.
let scopeMemo = { diagram: null, key: "", out: null };
function scopedAll() {
  const diagram = clusterData?.diagram;
  const key = JSON.stringify({ scope: topologyFocus.scope, namespaces: topologyFocus.namespaces });
  if (scopeMemo.diagram !== diagram || scopeMemo.key !== key) scopeMemo = { diagram, key, out: focusDiagram(diagram, { ...topologyFocus, view: "all" }).diagram };
  return scopeMemo.out;
}
function topologyStats() {
  return scopeStats(pathStats(scopedAll()), focusedView(), topologyFocus);
}
function topologyShown() {
  return mode === "cluster" && clusterData?.diagram?.layout === "kube" && (!clusterHasScreens() || clusterScreen === "topology") && !kubeEmpty.isShown();
}
function placePop(pop, btn) {
  const r = btn.getBoundingClientRect();
  const w = pop.offsetWidth || 300;
  pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
  const below = window.innerHeight - r.bottom;
  if (below > 240) {
    pop.style.top = `${r.bottom + 4}px`;
    pop.style.bottom = "";
  } else {
    pop.style.top = "";
    pop.style.bottom = `${window.innerHeight - r.top + 4}px`;
  }
}
function closeFocusPops() {
  kubeIssues.hidden = true;
  kfNsPop.hidden = true;
  kfList.setAttribute("aria-expanded", "false");
  kfNs.setAttribute("aria-expanded", "false");
}
function relatedLine(refs) {
  if (!refs) return "";
  const bits = [];
  for (const c of refs.pvcs || []) bits.push(`PVC ${c.name}${c.phase ? ` ${c.phase}` : ""}${c.pv ? ` → PV ${c.pv}` : ""}`);
  if (refs.configMaps?.length) bits.push(`ConfigMap ${refs.configMaps.join(", ")}`);
  if (refs.secrets?.length) bits.push(`Secret ${refs.secrets.join(", ")}`);
  if (refs.netpols?.length) bits.push(`NetworkPolicy ${shortList(refs.netpols.map((n) => n.name))}`);
  return bits.join(" · ");
}
// Two names, then "+N" (the full list is the line's tooltip).
function shortList(names, keep = 2) {
  return names.length > keep + 1 ? `${names.slice(0, keep).join(", ")} +${names.length - keep}` : names.join(", ");
}
function fullRelated(refs) {
  return refs?.netpols?.length > 3 ? `NetworkPolicies: ${refs.netpols.map((n) => n.name).join(", ")}` : "";
}
// In ISSUES: "N healthy hidden", with a way to ALL.
function hiddenHint() {
  const view = focusedView();
  if (topologyFocus.view !== "issues" || !view?.hiddenHealthy) return null;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "kf-hint";
  btn.textContent = `${view.hiddenHealthy} healthy hidden · SHOW IN ALL`;
  btn.addEventListener("click", () => {
    closeFocusPops();
    setTopologyFocus({ view: "all" });
  });
  return btn;
}
function renderIssueList() {
  const view = focusedView();
  listedFor = view;
  const list = view?.issues || [];
  const head = document.createElement("p");
  head.className = "kh";
  head.textContent = list.length ? `${list.length} ISSUE${list.length === 1 ? "" : "S"} · broken first` : "NO ISSUES IN THIS SCOPE";
  const ol = document.createElement("ol");
  for (const it of list) {
    const li = document.createElement("li");
    const dot = document.createElement("span");
    dot.className = `kd ${it.severity}`;
    const name = document.createElement("span");
    name.className = "kn";
    const tag = document.createElement("b");
    tag.textContent = String(it.kind).toUpperCase();
    name.append(tag, it.ns ? `${it.ns}/${it.name}` : it.name);
    const why = document.createElement("span");
    why.className = `kr ${it.severity}`;
    why.textContent = it.reason;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "INVESTIGATE";
    btn.title = canDiagnose(it.id) ? "DIAGNOSE the Service in front of it (read-only: endpoints, readiness, webhooks…)" : "open it on the map";
    btn.addEventListener("click", () => investigateIssue(it.id));
    li.append(dot, name, btn, why);
    const rel = relatedLine(it.refs);
    if (rel || it.node) {
      const x = document.createElement("span");
      x.className = "kx";
      x.textContent = [it.node ? `node ${it.node.replace(/\.[a-z0-9-]+\.compute\.internal$/, "")}` : "", rel].filter(Boolean).join(" · ");
      const full = fullRelated(it.refs);
      if (full) x.title = full;
      li.append(x);
    }
    ol.append(li);
  }
  const hint = hiddenHint();
  kubeIssues.replaceChildren(...[head, ol, hint].filter(Boolean));
}
function investigateIssue(id) {
  closeFocusPops();
  const view = focusedView();
  const node = view?.diagram?.nodes?.find((n) => n.id === id) || clusterData?.diagram?.nodes?.find((n) => n.id === id);
  if (!node) return;
  if (node.ns && clusterLanes.open[node.ns] === false) clusterLanes.open = { ...clusterLanes.open, [node.ns]: true };
  if (node.owner && !clusterLanes.expanded.includes(node.owner)) clusterLanes.expanded = [...clusterLanes.expanded, node.owner];
  saveClusterLanes();
  clusterSelected = node.id;
  if (node.host) showNode(node);
  else if (node.kind === "workload") showWorkload(node);
  else if (node.kind === "service") showService(node);
  else if (node.pod) showPod(node);
  const at = (placedCluster().nodes || []).find((n) => n.id === id || n.members?.some((m) => m.id === id));
  if (at) map.scrollTo({ top: Math.max(0, at.y - 230), left: Math.max(0, at.x - 60), behavior: reducedMotion ? "auto" : "smooth" });
  draw();
  if (canDiagnose(id)) diagnoseNode(id);
}
// INVESTIGATE on a Service, pod or workload: DIAGNOSE prefilled with its
// namespace and the Service in front of it, in the context TOPOLOGY shows.
function canDiagnose(id) {
  const n = clusterData?.diagram?.nodes?.find((x) => x.id === id);
  return !!n && (n.kind === "service" || n.kind === "workload" || !!n.pod) && !!n.ns;
}
function diagnoseNode(id) {
  const t = diagnoseTarget(clusterData?.diagram, id);
  if (!t) return;
  openDiagnose({ context: clusterData?.context || clusterContext || "", namespace: t.namespace, service: t.service, choices: diagnoseChoices(clusterData?.diagram) });
}
function renderNsPop() {
  const view = focusedView();
  const picked = new Set(topologyFocus.namespaces);
  const rows = (view?.namespaces || []).filter((n) => topologyFocus.scope === "all" || (topologyFocus.scope === "addons") === n.addon);
  const boxes = rows.map((n) => {
    const label = document.createElement("label");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = n.name;
    box.checked = picked.has(n.name);
    box.addEventListener("change", () => {
      const next = new Set(topologyFocus.namespaces);
      if (box.checked) next.add(n.name);
      else next.delete(n.name);
      setTopologyFocus({ namespaces: [...next] });
    });
    const small = document.createElement("small");
    small.textContent = n.addon ? "add-on" : "";
    label.append(box, n.name, small);
    return label;
  });
  const row = document.createElement("div");
  row.className = "kf-row";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.textContent = "ALL NAMESPACES";
  clear.addEventListener("click", () => {
    setTopologyFocus({ namespaces: [] });
    renderNsPop();
  });
  row.append(clear);
  kfNsPop.replaceChildren(...(boxes.length ? boxes : [Object.assign(document.createElement("p"), { textContent: "no namespaces in this scope" })]), row);
}
let healthyKey = "";
function syncFocusBar() {
  const on = topologyShown();
  kubeFocusBox.hidden = !on;
  if (!on) {
    closeFocusPops();
    kubeHealthy.hidden = true;
    healthyKey = "";
    return;
  }
  const view = focusedView();
  const n = view?.issues?.length || 0;
  const issuesOn = topologyFocus.view === "issues";
  kfIssues.setAttribute("aria-pressed", String(issuesOn));
  kfAll.setAttribute("aria-pressed", String(!issuesOn));
  kfCount.textContent = String(n);
  kfCount.classList.toggle("zero", n === 0);
  kfList.disabled = n === 0;
  if (kfScope.value !== topologyFocus.scope) kfScope.value = topologyFocus.scope;
  const picked = topologyFocus.namespaces.length;
  kfNs.textContent = picked === 1 ? `NS: ${topologyFocus.namespaces[0]}` : picked ? `NS: ${picked}` : "NS: ALL";
  const healthy = issuesOn && n === 0;
  const key = healthy ? `${view?.healthyLanes}|${view?.hiddenHealthy}|${topologyFocus.scope}|${picked}` : "";
  if (key !== healthyKey) {
    healthyKey = key;
    if (healthy) {
      const h = document.createElement("h3");
      h.textContent = "✓ ALL HEALTHY";
      const p = document.createElement("p");
      const scope = SCOPES.find((x) => x.id === topologyFocus.scope)?.label || "All";
      p.textContent = `No issues in ${view?.healthyLanes || 0} namespace${view?.healthyLanes === 1 ? "" : "s"} (scope: ${scope}${picked ? `, ${picked} picked` : ""}). No crash loops, OOM kills, pending or not-ready pods, failed jobs, Services without ready pods or node pressure.`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "SHOW FULL VIEW";
      btn.addEventListener("click", () => setTopologyFocus({ view: "all" }));
      kubeHealthy.replaceChildren(h, p, btn);
    }
    kubeHealthy.hidden = !healthy;
  }
  if (!kubeIssues.hidden && listedFor !== view) renderIssueList();
}
let listedFor = null;
kfIssues.addEventListener("click", () => setTopologyFocus({ view: "issues" }));
kfAll.addEventListener("click", () => setTopologyFocus({ view: "all" }));
kubeSearchCount.addEventListener("click", () => {
  if (kubeSearchCount.classList.contains("to-all")) setTopologyFocus({ view: "all" });
});
kfScope.addEventListener("change", () => setTopologyFocus({ scope: kfScope.value, namespaces: [] }));
kfList.addEventListener("click", () => {
  const open = kubeIssues.hidden;
  closeFocusPops();
  if (!open) return;
  renderIssueList();
  kubeIssues.hidden = false;
  kfList.setAttribute("aria-expanded", "true");
  placePop(kubeIssues, kfList);
});
kfNs.addEventListener("click", () => {
  const open = kfNsPop.hidden;
  closeFocusPops();
  if (!open) return;
  renderNsPop();
  kfNsPop.hidden = false;
  kfNs.setAttribute("aria-expanded", "true");
  placePop(kfNsPop, kfNs);
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && (!kubeIssues.hidden || !kfNsPop.hidden)) {
    closeFocusPops();
    event.stopPropagation();
  }
}, true);
document.addEventListener("pointerdown", (event) => {
  if (kubeIssues.hidden && kfNsPop.hidden) return;
  if (kubeIssues.contains(event.target) || kfNsPop.contains(event.target) || kfList.contains(event.target) || kfNs.contains(event.target)) return;
  closeFocusPops();
});
window.addEventListener("resize", closeFocusPops);
let groupedMemo = { diagram: null, by: "", out: null };
function groupedDiagram(diagram) {
  if (groupedMemo.diagram !== diagram || groupedMemo.by !== topologyGroupBy) groupedMemo = { diagram, by: topologyGroupBy, out: groupDiagram(diagram, topologyGroupBy) };
  return groupedMemo.out;
}
const k9sEl = document.querySelector("#k9s");
const k9sBtn = document.querySelector("#k9s-btn");
const kubeTele = document.querySelector("#kube-tele");
const kubeOps = document.querySelector("#kube-ops");
// SERVICES: the service graph + incident review prototype, SAMPLE only
// (docs/plan-modules-and-service-graph.md).
const graphView = createGraphView(document.querySelector("#kube-graph"));
// No cluster to read (no kubeconfig / no such context): how to connect.
const kubeEmpty = createKubeEmpty(document.querySelector("#kube-empty"), { onRetry: () => pullCluster(), onSample: () => toggleSample(), onStacks: () => openEksCard() });
// Modules this page shows (null until /api/config answers): see applyModules.
// The server stamps <html data-modules> with the modules that are on and
// hides every [data-module] element of the rest (modules.js gateStyle); what
// the script draws itself asks moduleOn.
const serverModules = document.documentElement.dataset.modules;
let modulesVisible = serverModules ? serverModules.split(" ").filter(Boolean) : null;
function moduleOn(id) {
  return !modulesVisible || modulesVisible.includes(id);
}
// The MAP without AWS (k8s-only): the cluster itself is the map.
function kubeMapOnly() {
  return !moduleOn("map") && moduleOn("kubemap");
}
const vaultTemplatesButton = document.querySelector("#vault-templates-btn");
const vaultTemplates = document.querySelector("#vault-templates");
const tabVaults = document.querySelector("#tab-vaults");
const vaultPageEl = document.querySelector("#vault-page");
const askTab = document.querySelector("#ask");
const askThis = document.querySelector("#ask-this");
// SNIFF layout: "h" left to right (default; reads best at 1024x800, where the
// map is wide and short) or "v" top to bottom. Kept per browser.
const pathFlowButton = document.querySelector("#path-flow");
const pathProbeButton = document.querySelector("#path-probe");
// SNIFF's one real request (from this machine), per lb+host query.
let pathProbe = null;
let pathProbeKey = "";
let pathFlow = (() => { try { return localStorage.getItem("cs.sniffFlow") === "v" ? "v" : "h"; } catch { return "h"; } })();
const termEl = document.querySelector("#term");
let termReady = false;

let place = null;
let region = "";
let animTime = 0;
let pulling = false;
const PULL_EVERY = 2000;
const PULL_EVERY_OFF = 10_000;
let viewOff = false;
let sample = false;
// #?sample=1&doors=1, read before the page rewrites the hash (sampleDoors).
const doorsAsked = new URLSearchParams(location.hash.replace(/^#\??/, "")).get("doors") === "1";
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
// The pod health watch (kube-health.js): its newest radio rows and the
// lamps per kube context, every 30 s.
let healthRows = [];
async function pullKubeHealth() {
  if (!tabVisible || sample) return;
  const body = await fetch("/api/kube/health").then((r) => r.json()).catch(() => null);
  if (!body || sample) return;
  const rows = (Array.isArray(body.radio) ? body.radio : []).map(({ time, status, text, count }) => ({ time, status, text, issue: "", count }));
  if (JSON.stringify(rows) !== JSON.stringify(healthRows)) {
    healthRows = rows;
    renderRadioPanel();
  }
  if (Array.isArray(body.contexts) && body.contexts.length) knownContexts = body.contexts;
  if (mode === "cluster" && clusterData) renderContexts({ ...clusterData, contexts: body.contexts });
}
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
// Perks: the add-on tree and the stored score feed the cluster vaults.
let vaultAddons = { tree: [], primary: "" };
let vaultScore = null;
let perkOpen = { cluster: "", id: "" };
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

// Public load balancers on the map: a dock hung under each ALB card (the
// reach lamp, OPEN ↗, the folded ROUTES list) and "exposed: N routes via"
// under the EKS cluster it fronts. The PUBLIC tab is drawn on the card.
const albDocksEl = document.querySelector("#alb-docks");
const reachSeen = new Map();
let reachTimer = 0;
function publicEndpoints(fixtures = []) {
  return fixtures.filter((item) => item.kind === "alb" && item.public && item.url).map((item) => ({ id: item.id, name: item.ingress || item.name, url: item.url, zones: item.zones || [], healthy: item.healthyCount || 0, targets: item.targetCount || 0 }));
}
function reachLamp(url) {
  const lamp = vel("span", "reach-lamp", "…");
  lamp.dataset.url = url;
  paintLamp(lamp, reachSeen.get(url));
  return lamp;
}
function paintLamp(lamp, seen) {
  if (!seen) return;
  lamp.dataset.state = seen.ok ? "ok" : "fail";
  lamp.textContent = seen.status ? `${seen.status} · ${seen.ms} ms` : seen.error || "no answer";
  lamp.title = `GET ${seen.url} from this machine: ${lamp.textContent}`;
}
const reachPending = new Set();
async function probeReach(urls) {
  for (const url of urls) {
    if (reachPending.has(url)) continue;
    reachPending.add(url);
    const seen = await fetch(`/api/reach?url=${encodeURIComponent(url)}`).then((r) => r.json()).catch(() => null).finally(() => reachPending.delete(url));
    if (!seen) continue;
    reachSeen.set(url, seen);
    for (const lamp of document.querySelectorAll(".reach-lamp")) if (lamp.dataset.url === url) paintLamp(lamp, seen);
    for (const lamp of document.querySelectorAll(".shared-lamp")) paintShared(lamp);
  }
  // EXPOSURE's REACH reads these probes: redraw an open dock once they land.
  if (urls.length && dockOpen.size && mode === "map") {
    docksKey = "";
    placeAlbDocks(placedMap());
  }
}
// The public endpoints a stack made: public load balancers on the map tagged
// with its project (Shop API: project=shopapi).
function renderCardOpen() {
  for (const row of document.querySelectorAll(".card-open[data-project]")) {
    const list = cardEndpoints({ id: row.dataset.project });
    const key = JSON.stringify(list.map((item) => item.url));
    if (row.dataset.key === key) continue;
    row.dataset.key = key;
    row.hidden = !list.length;
    row.replaceChildren(...list.flatMap((item) => [el("span", { className: "ps-tag", textContent: "PUBLIC" }), el("span", { className: "ps-url", textContent: item.url }), reachLamp(item.url), openLink(item.url)]));
    if (list.length && !sample) probeReach(list.map((item) => item.url).filter((url) => !reachSeen.has(url)));
  }
}
function cardEndpoints(spec) {
  const project = spec.vault || spec.id;
  // Tags come as [{Key, Value}] (ELB) or { key: value } (EKS, SQS).
  const tagOf = (tags, key) => {
    if (!Array.isArray(tags)) return tags?.[key];
    const found = tags.find((tag) => (tag?.Key ?? tag?.key) === key);
    return found ? found.Value ?? found.value : undefined;
  };
  const mine = (place?.fixtures || []).filter((item) => tagOf(item.tags, "project") === project);
  return publicEndpoints(mine);
}
function hostOfUrl(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}
function openLink(url, label = "OPEN ↗") {
  const a = vel("a", "cmd", label);
  a.href = url;
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.title = `open ${url} in a new tab`;
  return a;
}
function renderChrome() {
  // The map's DOM overlays (ALB docks, VPC folds) belong to the map only:
  // SNIFF and CLUSTER draw on the same canvas and must not wear them.
  if (albDocksEl) albDocksEl.hidden = mode !== "map";
  if (vpcFoldsEl) vpcFoldsEl.hidden = mode !== "map";
  renderChromeParts();
  renderCardOpen();
  syncUrl();
}

function renderChromeParts() {
  renderTally();
  renderMorning();
  const names = troubleNames().filter((name) => !(ui.status || "").includes(name));
  const who = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  // Two sentences, not run together ("sample, not the account demo/…").
  statusEl.textContent = names.length ? `${ui.status ? `${ui.status.replace(/[.!?:]?\s*$/, ".")} ` : ""}${who} ${names.length > 1 ? "are" : "is"} in trouble` : ui.status;
  if (mode !== "path") {
    delete statusEl.dataset.tone;
    statusEl.removeAttribute("title");
  }
  const words = `${statusEl.textContent} ${!errorEl.hidden ? errorEl.textContent : ""}`;
  statusEl.classList.toggle("issue", hasTrouble() || /did not|cannot|fail|denied|broken|trouble/i.test(words));
  renderRadioPanel();
  showSpend();
  sampleButton.setAttribute("aria-checked", String(sample));
  if (debugBarShown(mode) !== netdebugView.isShown()) {
    if (debugBarShown(mode)) netdebugView.show();
    else netdebugView.hide();
  }
  // SCORE, LEARN and STACKS cover the screen: their own key is lit, so the
  // view tab under them goes dark (before, VAULTS or MAP stayed lit and
  // "where am I" pointed at a page you could not see).
  const covered = Boolean(scoreApi?.isOpen() || learnApi?.isOpen() || pipOpen);
  tabMap.setAttribute("aria-pressed", String(!covered && mode === "map" && !vaultRoute));
  tabVaults.setAttribute("aria-pressed", String(!covered && vaultPageOpen()));
  pathButton.setAttribute("aria-pressed", String(!covered && mode === "path"));
  clusterButton.setAttribute("aria-pressed", String(!covered && mode === "cluster"));
  tabRadio.setAttribute("aria-pressed", String(!radioPanel.hidden));
  upgradeButton.setAttribute("aria-pressed", String(pipOpen));
  // STACKS is a page: the morning strip and the radio step aside while it is open
  document.body.classList.toggle("stacks-page", pipOpen);
  acct.textContent = sample ? "SAMPLE" : "LIVE";
  const stats = mode === "path" ? pathStats(pathData?.diagram) : mode === "cluster" ? (topologyShown() ? topologyStats() : pathStats(clusterData?.diagram)) : mapStats(place);
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
    syncSearchBar();
    no.hidden = true;
    yes.hidden = true;
    return;
  }
  syncSearchBar();
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
  const pods = sample ? [] : healthRows.slice(0, 3);
  return [...pageIssue, ...spider, ...pods, ...kubeRows, ...trail].slice(0, 8);
}

function renderRadioPanel() {
  const rows = logRows();
  if (station >= rows.length) station = 0;
  const hadFocus = radioEl.contains(document.activeElement);
  stations = renderRadio(radioEl, rows, station);
  if (hadFocus && !radioEl.contains(document.activeElement)) radioEl.querySelector(`li[data-index="${station}"]`)?.focus({ preventScroll: true });
  const trouble = rows.some((row) => row.status === "fail");
  radioPanel.classList.toggle("issue", trouble);
  tabRadio.classList.toggle("issue", trouble);
  stationCount.textContent = stations.length ? `${stations.length} STATIONS` : "NO SIGNAL";
  needle.style.left = `${needleAt(station, stations.length)}%`;
}

// ---- the map's own readouts: tally, trouble names, the bill ----

// At >=1840px the header is one row and the tally reads on the terminal
// line instead (review R6); narrower, it stays a header gauge before CAPS.
// >=1840 (one header row) and <1200 (compact header): the tally rides on the
// terminal line instead of squeezing into the header (UX overlaps B).
const wideHeader = window.matchMedia("(min-width: 1840px), (max-width: 1199px)");
function placeTally() {
  const home = wideHeader.matches ? document.querySelector(".terminal") : document.querySelector(".gauges");
  if (tallyEl.parentElement === home) return;
  if (wideHeader.matches) home.append(tallyEl);
  else home.prepend(tallyEl);
}
placeTally();
wideHeader.addEventListener("change", placeTally);

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
// Until you choose, the report starts folded on a narrow window (≤900px),
// where open it takes a third of the height and LEARN, STACKS and ASK open
// below it. The fold key remembers your choice either way.
let morningFolded = (() => {
  const narrow = window.matchMedia?.("(max-width: 900px)").matches ?? false;
  try {
    const saved = window.localStorage.getItem(MORNING_FOLD_KEY);
    return saved === null ? narrow : saved === "1";
  } catch {
    return narrow;
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
  // On the map; with the map module off (k8s-only) on the Cluster screen,
  // PODS + LOG ERRORS only (the server gates the AWS lines out).
  const kubeOnly = !moduleOn("map");
  const report = mode === "map" || (kubeOnly && mode === "cluster" && moduleOn("kubernetes")) ? currentMorning() : null;
  ui.marks = currentMorning()?.marks || null;
  morningEl.hidden = !report;
  if (!report) return;
  const pods = sample ? [] : report.pods || [];
  ensureLogErrors();
  report.logs = logErrorsLine();
  const key = JSON.stringify([report.hurting, report.changed, report.idle, report.logs, pods, morningFolded]);
  if (key === morningShown) return;
  morningShown = key;
  morningReport = report;
  const order = kubeOnly ? ["logs"] : ["hurting", "changed", "idle", "logs"];
  // One PODS line per kube context (kube-health.js), after the three.
  const podLines = pods.map((line, index) => {
    const id = `m-pods-${index}`;
    let li = morningEl.querySelector(`#${id}`);
    if (!li) {
      li = vel("li", "m-line");
      li.id = id;
      li.setAttribute("role", "button");
      li.tabIndex = 0;
      li.setAttribute("aria-expanded", "false");
      const iconEl = document.createElement("img");
      iconEl.className = "px";
      iconEl.alt = "";
      iconEl.width = 16;
      iconEl.height = 16;
      iconEl.src = iconURL("pod");
      const ledEl = vel("i", "m-led");
      ledEl.setAttribute("aria-hidden", "true");
      li.dataset.module = "kubernetes";
      li.append(iconEl, vel("b"), vel("span", "m-text"), ledEl);
      morningLines.idle.parentElement.append(li);
    }
    li.querySelector("b").textContent = `PODS · ${String(line.label || line.context).toUpperCase()}`;
    morningLines[id] = li;
    report[id] = line;
    return id;
  });
  for (const li of [...morningEl.querySelectorAll(".m-line[id^='m-pods-']")]) {
    if (!podLines.includes(li.id)) {
      delete morningLines[li.id];
      li.remove();
    }
  }
  order.push(...podLines);
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
    // one short line on the card; the whole story is in its popup
    text.append(shortLine(name, line, { logs: logNight }));
    li.title = `${line.time ? `${hhmm24(line.time)} ` : ""}${line.text || ""} (click for details)`;
    li.dataset.focus = line.focus || "";
    li.setAttribute("aria-label", `${li.querySelector("b").textContent}: ${li.title}`);
  }
  morningWhen.textContent = sample ? "SAMPLE" : hhmm24(Date.now());
  morningEl.classList.toggle("folded", morningFolded);
  morningFold.setAttribute("aria-expanded", String(!morningFolded));
  morningFold.innerHTML = morningFolded ? "&#9660;" : "&#9650;";
  morningFold.title = morningFolded ? "open the morning report" : "fold the morning report";
}

// ---- LOG ERRORS (log-errors-view.js): the fourth card and its panel ----
const logErrorsEl = document.querySelector("#log-errors");
const LOGS_TTL = 5 * 60_000;
let logErrorsKey = "";
let logErrorsAt = 0;
let logScenario = "bare";
// The panel's window (auto: night when it has errors, else the last hour);
// the morning line always reads the night (logNight).
let logWindowPick = "auto";
let logNight = null;
const logErrorsView = createLogErrorsView(logErrorsEl, {
  onWindow: (id) => {
    logWindowPick = id;
    logErrorsAt = 0;
    ensureLogErrors(true);
  },
  onGraph: (link) => openServices(link, null),
  onTimeline: (link) => openServices(link, link),
  onScenario: (id) => {
    logScenario = id;
    logErrorsAt = 0;
    ensureLogErrors(true);
  },
  onClose: () => {
    logErrorsView.close();
    morningLines.logs.setAttribute("aria-expanded", "false");
    morningLines.logs.focus({ preventScroll: true });
  },
});

function showLogScreen(on) {
  logErrorsView.embedded = on;
  logErrorsEl.classList.toggle("le-screen", on);
  if (on) {
    ensureLogErrors();
    logErrorsView.open();
  } else logErrorsView.close();
}

function logErrorsLine() {
  const data = logNight;
  if (!data) return { status: "unknown", text: "reading last night's logs…" };
  return data.line || { status: "unknown", text: "not read." };
}

async function ensureLogErrors(force = false) {
  const keyNow = () => `${sample}|${sample ? logScenario : ""}|${logWindowPick}`;
  const key = keyNow();
  if (!force && key === logErrorsKey && Date.now() - logErrorsAt < LOGS_TTL) return;
  logErrorsKey = key;
  logErrorsAt = Date.now();
  const q = (win) => `?${new URLSearchParams({ ...(sample ? { sample: "1", scenario: logScenario } : {}), window: win })}`;
  const read = (win) => fetch(`/api/morning/logs${q(win)}`).then((r) => r.json()).catch(() => ({ line: { status: "unknown", text: "LOG ERRORS did not answer." }, services: [] }));
  const body = await read(logWindowPick);
  // The morning report stays on the night window.
  const night = (body.windowKind || body.window?.kind || "night") === "night" ? body : await read("night");
  if (key !== keyNow()) return;
  logNight = night;
  logErrorsView.set(body);
  morningShown = "";
  renderMorning();
}

// A link from LOG ERRORS: the Cluster view's SERVICES, the service's group
// focused and the node selected; with a time, the timeline event closest to it.
function openServices(link, at) {
  if (!logErrorsView.embedded) logErrorsView.close();
  morningLines.logs.setAttribute("aria-expanded", "false");
  markHistory();
  if (mode !== "cluster") enterCluster();
  setClusterScreen("graph");
  graphView.focusOn({ scenario: sample ? link.scenario : "", node: link.node || "", t: at ? hhmm24(at.time) : "", query: link.node ? link.node.split("/").pop() : "" });
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
  const eks = (place?.fixtures || []).find((item) => item.id === id && item.kind === "eks");
  if (eks?.name && !sample) facts.push(kubeFact(eks.name, id));
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
    // The workload is the useful name: its namespace and its pods break with
    // it, so list workloads first, then pods, then whatever else is broken,
    // and count what does not fit instead of dropping it silently.
    const RANK = { workload: 0, pod: 1, service: 2, node: 3, namespace: 4 };
    const broken = (clusterData?.diagram?.nodes || []).filter((node) => node.status === "broken" && (node.label || node.kind));
    broken.sort((a, b) => (RANK[a.kind] ?? 5) - (RANK[b.kind] ?? 5));
    // A broken workload already explains its pods and its namespace.
    const lead = broken.length ? RANK[broken[0].kind] ?? 5 : 5;
    if (lead === 0) broken.splice(0, broken.length, ...broken.filter((node) => node.kind === "workload" || node.kind === "service" || node.kind === "node"));
    const names = [...new Set(broken.map((node) => (node.kind === "workload" && node.ns ? `${node.ns}/${node.label}` : node.label || node.kind)))];
    const shown = names.slice(0, 2);
    if (names.length > 2) shown.push(`${names.length - 2} more`);
    return shown;
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
  // The LCD is there from the first frame (reading the bill…), so the
  // header row does not jump when the bill arrives seconds later.
  spendEl.hidden = !onMap;
  pipEl.hidden = !pipOpen;
  if (spendEl.hidden) {
    spendLines.hidden = true;
    return;
  }
  const label = spend?.label || "reading the bill…";
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
    ? layoutPath(pathData.diagram, map.clientWidth || 0, { vertical: pathFlow === "v" })
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
  mapKube.policies = readPoliciesOn(window.localStorage);
  mapKube.choices = readKubeChoices(window.localStorage);
} catch {
  // AUTO everywhere
}

function mapKubeSignature(models) {
  const out = [];
  for (const [name, model] of models) {
    out.push(name, model.nodes.map((n) => `${n.instanceId}:${n.status}`).join(","));
    out.push(`np${model.netpol?.total ?? "-"}`, Object.entries(model.netpol?.ns || {}).map(([k, v]) => `${k}:${v.badge}:${v.policies.length}`).join(","), (model.entries || []).map((e) => `${e.id}:${e.status}`).join(","));
    for (const app of model.apps) out.push(`${app.id}:${app.have}/${app.want}:${app.status}:${app.pods.map((p) => `${p.id}@${p.instanceId}:${p.status}`).join(",")}`);
  }
  return out.join("|");
}

async function pullMapKube() {
  if (mode !== "map" || !tabVisible || kubeMapOnly()) return;
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
  markHistory();
  // TOPOLOGY is the namespace's detail: a tent or pod opens its namespace,
  // everything in it (ALL), with that card focused.
  if ((hit.type === "app" || hit.type === "pod" || hit.type === "entry") && hit.ns && /^[a-z0-9-]+$/.test(hit.ns)) {
    topologyFocus = cleanFocus({ ...topologyFocus, namespaces: [hit.ns], view: "all" });
    try {
      window.localStorage.setItem(TOPOLOGY_FOCUS_KEY, JSON.stringify(topologyFocus));
    } catch {
      // not kept
    }
  }
  mapKube.focus = hit.type === "compound" ? null : { id: hit.id, type: hit.type, ns: hit.ns, app: hit.app || null };
  mapKube.hover = null;
  setClusterScreen("topology");
  mapKube.keepSample = sample;
  enterCluster();
}

// The namespace panel on the MAP (map-ns-panel.js): policies, who may
// come in and go out, what needs a look; TOPOLOGY is its detail.
function showNsPanel(cluster, ns) {
  const model = mapKube.models.get(cluster);
  if (!model || !mapNsPanel) return;
  const p = nsPanelModel(model, ns);
  const head = vel("div", "kp-title");
  head.append(vel("span", "kp-name", `NAMESPACE · ${ns}`));
  const close = vel("button", "vp-close", "CLOSE");
  close.type = "button";
  close.addEventListener("click", () => {
    mapNsPanel.hidden = true;
    mapNsPanel.replaceChildren();
  });
  head.append(close);
  const body = vel("div", "kp-body");
  body.append(vel("p", `np-head ${p.badge}`, p.headline));
  if (p.policies.length) {
    body.append(vel("p", "kp-sub", `NETWORK POLICIES · ${p.policies.length}`));
    for (const pol of p.policies) {
      const d = vel("details");
      d.append(vel("summary", "", `${pol.name} · ${pol.selects} · ${pol.pods} · ${pol.types.join("+")}`));
      for (const line of [...pol.ingress, ...pol.egress]) d.append(vel("div", "np-rule", line));
      body.append(d);
    }
  }
  const list = (title, rows, cls = "") => {
    if (!rows.length) return;
    body.append(vel("p", "kp-sub", title));
    const ul = vel("ul");
    for (const r of rows) ul.append(vel("li", cls, r));
    body.append(ul);
  };
  list(`ALLOWED IN FROM OTHER NAMESPACES / OUTSIDE · ${p.allowedIn.length}`, p.allowedIn);
  list(`ALLOWED OUT · ${p.allowedOut.length}`, p.allowedOut);
  if (p.insideCount) body.append(vel("p", "kp-sub", `${p.insideCount} allow line${p.insideCount === 1 ? "" : "s"} inside ${ns}`));
  list("ENTRY POINTS", p.entries);
  list(`NEEDS A LOOK · ${p.issues.length}`, p.issues.map((i) => `${i.label} · ${i.text}`), "np-bad");
  const acts = vel("div", "np-acts");
  const topo = vel("button", "vp-close vp-primary", "OPEN IN TOPOLOGY ›");
  topo.type = "button";
  topo.title = `TOPOLOGY, this namespace only (${ns}): pods, nodes, volumes, events`;
  topo.addEventListener("click", () => openNamespaceTopology(cluster, ns));
  acts.append(topo);
  const svc = p.issueService || p.service;
  if (svc) {
    const dx = vel("button", "vp-close", "DIAGNOSE");
    dx.type = "button";
    dx.title = `read-only investigation of ${ns}/${svc}`;
    dx.addEventListener("click", () => openDiagnose({ context: clusterContext || "", namespace: ns, service: svc }));
    const sniff = vel("a", "vp-close", "SNIFF ›");
    sniff.href = `#path?debug=${encodeURIComponent(`${ns}/${svc}`)}`;
    sniff.title = `SNIFF the in-cluster path to ${ns}/${svc}`;
    acts.append(dx, sniff);
  }
  body.append(acts);
  mapNsPanel.replaceChildren(head, body);
  mapNsPanel.hidden = false;
}

// TOPOLOGY as the namespace's detail: the focus narrowed to it, ALL view.
function openNamespaceTopology(cluster, ns) {
  if (mapNsPanel) mapNsPanel.hidden = true;
  setTopologyFocus({ namespaces: [ns], view: "all", scope: "all" });
  openInCluster({ type: "compound", cluster });
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

// SAMPLE with #?sample=1&doors=1 shows the vaults as a row of cells above
// the region (the map's other vault drawing; normally they live on VAULTS).
function sampleDoors() {
  return sample && doorsAsked;
}

// The map shortens long names (middle ellipsis); the tooltip has them whole.
function mapTitle(placed, x, y) {
  const hit = fixtureAt(placed, x, y) || buildingAt(placed, x, y);
  if (hit) return [hit.label || hit.name || hit.id, hit.caption || hit.type || hit.kind].filter(Boolean).join(" · ");
  const vpc = (placed.settlements || []).find((s) => x >= s.x && x < s.x + s.w && y >= s.y && y < s.y + 36);
  return vpc ? String(vpc.label || vpc.id || "").replace(/ {2,}/g, " · ") : "";
}

let kubeOnlyMemo = { key: "", placed: null };
function placedMap() {
  if (kubeMapOnly()) {
    const room = Math.max(320, (map.clientWidth || 960) - 16);
    const key = `${room}|${mapKube.sig}|${JSON.stringify(mapKube.choices)}|${mapKube.policies === false ? 0 : 1}`;
    if (kubeOnlyMemo.key !== key) kubeOnlyMemo = { key, placed: layoutKubeOnly(mapKube.models, { room, choice: (cluster) => mapKube.choices[cluster] || "auto", policies: mapKube.policies !== false }) };
    return kubeOnlyMemo.placed;
  }
  const width = map.clientWidth || 0;
  const rowLimit = width ? Math.min(ROW_LIMIT, width) : ROW_LIMIT;
  // At >=1600px the VPCs flow side by side across the whole map; below
  // that the map keeps its single column (760 and 1280 are unchanged).
  const flowLimit = window.innerWidth >= 1600 && width > ROW_LIMIT ? width : 0;
  const vaults = vaultsData.vaults;
  const extra = {
    key: `${flowLimit}|${sampleDoors() ? "doors" : ""}|${vaultsShown}|${vaultState.key(vaultKeys())}|${vpcFold.key((place?.vpcs || []).map((vpc) => vpc.id))}|${mapView}|${mapTagKey}|${mapKube.sig}|${JSON.stringify(mapKube.choices)}|${mapKube.policies === false ? 0 : 1}`,
    options: { flowLimit, vaults, vaultMode: "page", ...(sampleDoors() ? { vaultMode: "doors" } : {}), isOpen: (key) => vaultState.isOpen(key), isClosed: (id) => vpcFold.isOpen(id), view: mapView, groupBy: mapTagKey, kube: mapKube.models.size ? { models: mapKube.models, choice: (cluster) => mapKube.choices[cluster] || "auto", policies: mapKube.policies !== false } : null },
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
    const q = wasSample ? "?sample=1" : "";
    // Progressive: the vaults come from files and answer fast; add-ons and
    // the score read the cluster (seconds). Paint the vaults as soon as they
    // land, then fill in the add-on tree and the score when they arrive.
    const addonsRead = fetch(`/api/addons${q}`).then((response) => (response.ok ? response.json() : null)).catch(() => null);
    const scoreRead = wasSample ? Promise.resolve(null) : fetch("/api/score?target=kubernetes").then((response) => (response.ok ? response.json() : null)).catch(() => null);
    const body = await fetch(`/api/vaults${q}`).then((response) => response.json());
    if (ticket !== vaultsTicket || wasSample !== sample) return;
    vaultsData = {
      vaults: Array.isArray(body?.vaults) ? body.vaults : [],
      note: body?.note || "",
      templates: Array.isArray(body?.templates) ? body.templates : [],
    };
    vaultsShown = vaultSignature(vaultsData.vaults);
    renderChrome();
    draw();
    const [addons, score] = await Promise.all([addonsRead, scoreRead]);
    if (ticket !== vaultsTicket || wasSample !== sample) return;
    vaultAddons = { tree: Array.isArray(addons?.tree) ? addons.tree : [], primary: addons?.detectedCluster || "" };
    try {
      const model = score ? scoreModel(score, "kubernetes") : null;
      vaultScore = model?.state === "scored" ? { cluster: model.cluster, number: model.number, tone: model.tone } : null;
    } catch {
      vaultScore = null;
    }
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
    // A view behind a public load balancer on the map: OPEN ↗ with its lamp.
    const pub = key === "view" && publicEndpoints(place?.fixtures || []).some((item) => hostOfUrl(item.url) === hostOfUrl(href));
    const a = vel("a", "cmd", pub ? "OPEN ↗" : label);
    a.href = href;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.title = href;
    nav.append(a);
    if (pub && !sample) {
      nav.append(reachLamp(href));
      if (!reachSeen.has(href)) probeReach([href]);
    }
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
  const hash = formatUrlState({ ...urlState(), view: "vaults", vault: key, lb: "", host: "" });
  if (location.hash !== hash) history.pushState(null, "", `${location.pathname}${location.search}${hash}`);
  routeVaults();
}

function closeVaultPage() {
  if (!vaultRoute) return;
  history.pushState(null, "", `${location.pathname}${location.search}${formatUrlState({ ...urlState(), view: "", vault: null })}`);
  routeVaults();
}

// The VAULTS tab: from Path or Cluster, leave that view first (the vault
// page needs the map's resources for OWNED RESOURCES and SHOW).
function enterVaults() {
  if (mode === "path") leavePath();
  else if (mode === "cluster") leaveCluster();
  openVaultPage(null);
}

// The URL hash carries the view, SAMPLE, the open Learn lab, the open
// Stacks card and Path's load balancer and host (src/url-state.js), so a
// reload (RUN-ME's after-pull routine), a pasted link and back/forward all
// land on the same screen. Every render replaces the hash; a user's own
// step (a tab, a panel, SAMPLE, a pick) marks it first so it pushes a
// history entry instead. Applying a URL never pushes.
let urlPush = false;
let applyingUrl = false;
let urlLb = "";
let learnApi = null;
let scoreApi = null;
let settingsApi = null;
let urlQueue = Promise.resolve();
// Nothing writes the hash until the first URL has been applied, so the
// boot renders cannot wipe a reloaded or pasted link.
let urlReady = false;
let urlPushTimer = 0;

function urlState() {
  const path = mode === "path";
  return {
    view: path ? "path" : mode === "cluster" ? "cluster" : vaultRoute ? "vaults" : "",
    vault: vaultRoute?.key || null,
    sample,
    learn: learnApi?.isOpen() ? learnApi.current() || "1" : "",
    stacks: pipOpen ? openCard || "1" : "",
    score: Boolean(scoreApi?.isOpen()),
    lb: path ? lbSelect.value || urlLb : "",
    host: path ? hostInput.value.trim() : "",
  };
}

function markHistory() {
  if (applyingUrl) return;
  urlPush = true;
  clearTimeout(urlPushTimer);
  urlPushTimer = setTimeout(() => {
    urlPush = false;
  }, 2000);
}

function syncUrl() {
  // a panel opened or closed (SCORE, LEARN, ×, Esc): the lit tabs follow
  if (typeof renderChromeParts === "function" && learnApi && scoreApi) renderChromeParts();
  if (applyingUrl || !urlReady) return;
  const want = formatUrlState(urlState());
  if (location.hash === want) return;
  history[urlPush ? "pushState" : "replaceState"](null, "", `${location.pathname}${location.search}${want}`);
  urlPush = false;
}

function setViewHash() {
  syncUrl();
}

async function applyUrl() {
  const want = parseUrlState(location.hash);
  applyingUrl = true;
  try {
    if (want.sample !== sample) await toggleSample();
    if (want.view === "path") {
      if (mode !== "path") enterPath();
    } else if (want.view === "cluster") {
      if (mode !== "cluster") enterCluster();
    } else if (mode === "path") leavePath();
    else if (mode === "cluster") leaveCluster();
    const route = want.view === "vaults" ? want.vault || "" : null;
    const shown = vaultRoute ? vaultRoute.key || "" : null;
    if (route !== shown) routeVaults();
    if (mode === "path" && (want.lb !== (lbSelect.value || urlLb) || want.host !== hostInput.value.trim())) {
      urlLb = want.lb;
      if ([...lbSelect.options].some((option) => option.value === want.lb)) lbSelect.value = want.lb;
      hostInput.value = want.host;
      pathSelected = null;
      pullPath();
    }
    // A WHY? link (#path?debug=<url>&why=1): DEBUG runs it once, as if
    // typed and RUN pressed; the walkthrough opens with the report.
    if (mode === "path" && want.debug && want.debug !== lastDebugLink) {
      lastDebugLink = want.debug;
      if (want.inside) netdebugView.setInside({ target: want.debug, namespace: want.ns });
      else netdebugView.setTarget(want.debug, { go: true, whyOpen: want.why });
    }
    if (Boolean(want.stacks) !== pipOpen) {
      if (want.stacks && learnApi?.isOpen()) await learnApi.setOpen(false);
      await toggleUpgrade();
    }
    if (pipOpen) {
      const card = want.stacks === "1" ? null : want.stacks;
      if (card !== openCard) {
        openCard = card;
        drawPipForm();
        if (openCard) refreshUpgrade(true);
      }
    }
    if (learnApi && Boolean(want.learn) !== learnApi.isOpen()) await learnApi.setOpen(Boolean(want.learn));
    if (scoreApi && want.score !== scoreApi.isOpen()) await scoreApi.setOpen(want.score);
    if (learnApi?.isOpen() && want.learn !== "1" && want.learn !== learnApi.current()) learnApi.select(want.learn);
  } finally {
    applyingUrl = false;
    urlReady = true;
    syncUrl();
  }
}

function queueUrl() {
  urlQueue = urlQueue.then(applyUrl, applyUrl);
  return urlQueue;
}

// Path and Cluster drop the vaults route, so MAP later means the map.
function dropVaultRoute() {
  if (!vaultRoute) return;
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

window.addEventListener("hashchange", queueUrl);
window.addEventListener("popstate", queueUrl);
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
    perkOpen,
    vaultAddons.tree.map((c) => [c.cluster, c.live, (c.addons || []).map((a) => `${a.id}:${a.state}:${a.ready}`)]),
    vaultScore,
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

// Opens the add-on's card in Stacks: the same PREVIEW → APPROVE path as
// any stack. Nothing is installed from the vault page.
async function openPerkCard(id, cluster) {
  closeVaultPage();
  if (!pipOpen) await toggleUpgrade();
  openCard = `${id}@${cluster}`;
  drawPipForm();
  drawAddonTree();
  refreshUpgrade(true);
  renderChrome();
  requestAnimationFrame(() => document.querySelector(`[data-id="${CSS.escape(openCard)}"]`)?.scrollIntoView({ block: "center" }));
}

function vaultCard(vault, home = "") {
  const summary = vaultSummary(vault);
  const li = vel("li", `vpg-card ${summary.light}${summary.trouble ? " trouble" : ""}${vault.damaged ? " damaged" : ""}`);
  const button = vel("button", "vpg-open");
  button.type = "button";
  button.dataset.focus = `card:${vault.key}`;
  button.setAttribute("aria-label", `${summary.plate} ${summary.title}: ${summary.lightText}.${home ? ` In vault ${home}.` : ""} Open its page.`);
  button.addEventListener("click", () => openVaultPage(vault.key));
  const facts = vel("div", "vpg-lines");
  const stack = vel("span", `vpg-stack ${summary.stack.state}`, summary.stack.state === "live" ? (vault.auto ? "LIVE · AUTO" : "LIVE") : summary.stack.state === "down" ? (vault.gone ? "GONE" : "NOT UP") : summary.stack.state === "error" ? "STACK?" : "TAGS");
  if (vault.auto) stack.title = `listed automatically: its stack is up (${vault.file}). Copy it into vaults/ to customise: npm run vaults:new -- ${vault.name} ${vault.name}`;
  if (vault.insight) {
    // health, version and place say it; one line for what and how big
    const h = vault.insight.health;
    li.classList.add(`h-${HEALTH_CLASS[h.state]}`);
    const size = [vault.stackInfo?.resources ? `${vault.stackInfo.resources} RESOURCES` : "", vault.owned?.length ? `${vault.owned.length} ON MAP` : "", summary.checks.total ? `CHECKS ${summary.checks.ok}/${summary.checks.total}` : ""].filter(Boolean).join(" · ");
    facts.append(vel("span", "", [[vault.type, vault.owner].filter(Boolean).join(" · ").toUpperCase(), size].filter(Boolean).join(" · ")));
    button.setAttribute("aria-label", `${summary.plate} ${summary.title}: ${h.word}, ${vault.insight.version.word}${vault.insight.location.text ? `, at ${vault.insight.location.text}` : ""}.${home ? ` In vault ${home}.` : ""} Open its page.`);
    button.append(doorCanvas(vault), stack, vel("h3", "", summary.title), insightView.cardInsight(vault), facts);
  } else {
    const status = vel("p", "vpg-status");
    status.append(vel("i", "vpg-lamp"), vel("span", "", summary.lightText));
    for (const line of summary.lines) facts.append(vel("span", "", line));
    button.append(doorCanvas(vault), stack, vel("h3", "", summary.title), status, facts);
  }
  if (home) button.append(vel("span", "vpg-home", `IN VAULT ${home}`));
  li.append(button);
  return li;
}

function vaultList() {
  const vaults = vaultsData.vaults;
  const tally = vaultTally(vaults);
  const sub = vaultsFor === null
    ? "reading the vault files…"
    : [`${tally.total} VAULT${tally.total === 1 ? "" : "S"}`, `${tally.live} LIVE`, tally.ok ? `${tally.ok} OK` : "", tally.fail ? `${tally.fail} FAILING` : "", tally.trouble ? `${tally.trouble} IN TROUBLE` : "", tally.damaged ? `${tally.damaged} DAMAGED` : ""].filter(Boolean).join(" · ");
  const read = vaults.filter((vault) => vault.insight);
  const count = (state) => read.filter((vault) => vault.insight.health.state === state).length;
  const healthSub = read.length && vaultsFor !== null
    ? [`${tally.total} VAULT${tally.total === 1 ? "" : "S"}`, count("ok") ? `${count("ok")} UP OK` : "", count("issues") ? `${count("issues")} WITH ISSUES` : "", count("down") ? `${count("down")} DOWN` : "", count("unknown") ? `${count("unknown")} UNKNOWN` : "", read.filter((v) => v.insight.version.state === "outdated").length ? `${read.filter((v) => v.insight.version.state === "outdated").length} OUTDATED` : "", tally.damaged ? `${tally.damaged} DAMAGED` : ""].filter(Boolean).join(" · ")
    : sub;
  const out = [pageHead("VAULTS", healthSub, { label: "◂ MAP", go: closeVaultPage })];
  if (vaultsData.note) out.push(vel("p", "vpg-note", vaultsData.note));
  const groups = groupVaults(vaults, vaultAddons.tree, { primary: vaultAddons.primary });
  const titleOf = (key) => vaultSummary(vaults.find((vault) => vault.key === key) || { key, name: key }).title;
  if (groups.clusters.length) {
    out.push(vel("h4", "vpg-section", `CLUSTER VAULTS · ${groups.clusters.length}`));
    for (const cluster of groups.clusters) {
      out.push(clusterVaultNode(cluster, {
        door: cluster.vault ? doorCanvas({ ...cluster.vault, title: cluster.name }) : null,
        score: vaultScore && vaultScore.cluster === cluster.name ? vaultScore : null,
        selected: perkOpen.cluster === cluster.name ? perkOpen.id : "",
        appTitle: titleOf,
        vaultOf: (key) => vaults.find((vault) => vault.key === key) || null,
        cost: (id) => {
          const spec = pipModules.find((item) => item.id === id && item.addon);
          return spec?.cost ? costLine(spec.cost) : "";
        },
        onSelect: (name, id) => {
          perkOpen = { cluster: name, id };
          renderVaultPage();
        },
        onOpenVault: (key) => openVaultPage(key),
        onOpenApp: (key) => openVaultPage(key),
        onOpenCard: (id, name) => openPerkCard(id, name),
      }));
    }
  }
  const sections = [
    ["APP VAULTS", groups.apps.map((item) => [item.vault, item.cluster])],
    [groups.clusters.length ? "OTHER VAULTS" : "", groups.vaults.map((vault) => [vault, ""])],
  ];
  if (!vaults.length && vaultsFor !== null) {
    const grid = vel("ul", "vpg-grid");
    grid.append(vel("li", "vpg-empty", "No vaults yet. A vault is a YAML file in vaults/; start from a template below."));
    out.push(grid);
  }
  for (const [label, list] of sections) {
    if (!list.length) continue;
    if (label) out.push(vel("h4", "vpg-section", `${label} · ${list.length}`));
    const grid = vel("ul", "vpg-grid");
    for (const [vault, home] of list) grid.append(vaultCard(vault, home));
    out.push(grid);
  }
  const templates = vaultsData.templates || [];
  const shelf = vel("section", "vpg-templates");
  const autoCount = templates.filter((item) => item.live).length;
  shelf.append(vel("h4", "", `TEMPLATES · ${templates.length} · vaults/templates/ · ${autoCount ? `${autoCount} listed above automatically (stack up)` : "listed above automatically once their stack is up"}`));
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
  const insight = vault.insight;
  const sub = insight ? [insight.health.word, insight.version.word, insight.location.text].filter(Boolean).join(" · ") : `${summary.lightText} · ${summary.stack.text}`;
  const out = [pageHead(`${summary.plate} · ${summary.title}`, sub, back)];
  const body = vel("div", `vpg-detail ${summary.light}${insight ? ` h-${HEALTH_CLASS[insight.health.state]}` : ""}`);
  const side = vel("div", "vpg-side");
  side.append(doorCanvas(vault, 1.5));
  const stack = vel("p", `vpg-stack big ${summary.stack.state}`, summary.stack.text);
  side.append(stack);
  if (insight) side.append(insightView.sideInsight(vault));
  const panel = vaultPanel({ vault });
  panel.querySelector(".vp-close")?.remove();
  body.append(side, panel);
  out.push(body);
  if (!vault.damaged) {
    out.push(insight
      ? insightView.relations(vault, {
          mode: vaultRelMode,
          setMode: (m) => {
            vaultRelMode = m;
            vaultPageShown = "";
            renderVaultPage();
          },
          list: () => ownedBlock(vault),
        })
      : ownedBlock(vault));
  }
  if (vault.logGroups?.length && !vaultLogState.has(vault.key)) loadVaultLogs(vault.key);
  return out;
}

let vaultRelMode = "diagram";
const insightView = createInsightView({ vel, onMap: (id) => showOnMap(id), onJump: (vault) => jumpToVault(vault) });

// SHOW ON MAP from a vault's page: its own door cell when the map has one,
// else its first resource on the map, else its VPC.
function jumpToVault(vault) {
  const ids = vault.insight?.location?.mapIds || vault.owned || [];
  const placed = placedMap();
  const first = ids.find((id) => buildingAt(placed, null, null, id) || fixtureAt(placed, null, null, id));
  if (first) return showOnMap(first);
  const vpc = (vault.insight?.location?.vpcs || []).map((id) => placed.settlements?.find((s) => s.id === id)).find(Boolean);
  vaultPageFrom = null;
  closeVaultPage();
  const cell = placed.vaults?.cells.find((item) => item.key === vault.key);
  const hit = cell || vpc;
  if (hit) revealPanel({ x: hit.x, y: hit.y, w: Math.min(hit.w, map.clientWidth), h: Math.min(hit.h || 80, map.clientHeight) });
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
  });  drawPanHint(ctx, { left: map.scrollLeft, width: map.clientWidth, height: Math.min(height, map.scrollTop + map.clientHeight), contentWidth: placed.contentWidth });
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
  // SERVICES: live from the selected context, or the SAMPLE scenarios; off
  // with the graph module (modules.js).
  { id: "graph", label: "SERVICES", needs: "graph", show: () => graphView.show(), hide: () => graphView.hide() },
  // LOG ERRORS as a screen: its home when the map module is off (k8s-only).
  { id: "logs", label: "LOG ERRORS", needs: "kubernetes", show: () => showLogScreen(true), hide: () => showLogScreen(false) },
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
let screensFor = ""; // the context TELEMETRY / OPS last read for

function clusterHasScreens() {
  return mode === "cluster" && clusterData?.diagram?.layout === "kube";
}

// TELEMETRY and OPS read the context picked in the Cluster view; the
// primary one is asked without a name (it also feeds the radio).
function screenQuery() {
  if (sample) return "?sample=1";
  const name = clusterData?.context || clusterContext;
  return name && !isPrimaryContext() ? `?context=${encodeURIComponent(name)}` : "";
}

// ---- kube contexts (kube-contexts.js): one lit button per context ----
const CLUSTER_CONTEXT_KEY = "cloudspider.cluster.context";
let clusterContext = readPref(CLUSTER_CONTEXT_KEY, "");
let contextsShown = "";

function isPrimaryContext() {
  const list = clusterData?.contexts || [];
  if (!list.length || !clusterData?.context) return true;
  return list.find((item) => item.context === clusterData.context)?.primary !== false;
}

function contextScope(item) {
  if (item.scope === "*") return "ALL NAMESPACES";
  return `${item.scope.length} NS · ${item.scope.join(" ")}`;
}

// The last list of contexts the server named (cluster answers and the
// health watch): enough to draw a context's lanes before its read lands.
let knownContexts = [];

// Progressive: a context's own namespaces as "reading…" lanes, drawn at
// once on a switch, replaced by the real answer when it arrives.
function readingView(name) {
  const item = knownContexts.find((c) => c.context === name);
  if (!item || item.primary) return null;
  const cp = `cluster:${item.label}`;
  const lanes = item.scope === "*" ? [] : item.scope;
  return {
    placeholder: true,
    context: name,
    contexts: knownContexts,
    error: "",
    headline: "",
    note: `reading ${item.label}…`,
    diagram: {
      layout: "kube",
      columns: { "control-plane": 0, namespace: 1 },
      nodes: [{ id: cp, kind: "control-plane", label: item.label, caption: "reading…", status: "unknown" }, ...lanes.map((ns) => ({ id: `ns:${ns}`, kind: "namespace", label: ns, caption: "reading…", status: "unknown", system: false, noAccess: [] }))],
      edges: lanes.map((ns) => ({ from: cp, to: `ns:${ns}`, status: "ok" })),
    },
  };
}

// EKS clusters of the account Cloud Spider has no context for (made outside
// Stacks, or not CONNECTed yet): dim "+ cluster" entries in the switcher.
function unconnectedClusters() {
  return (connectStripBody?.clusters || []).filter((item) => !["connected", "no-access"].includes(item.state));
}

let contextsBody = null;
// Contexts hidden in this browser (the switcher's ×); cloudspider.yaml's
// kube.hideContexts hides them for everyone. The kubeconfig is not touched.
const HIDDEN_CONTEXTS_KEY = "cloudspider.cluster.hiddenContexts";
let hiddenContexts = new Set(parseList(readPref(HIDDEN_CONTEXTS_KEY, "")));
function parseList(text) {
  try {
    const got = JSON.parse(text || "[]");
    return Array.isArray(got) ? got.map(String) : [];
  } catch {
    return [];
  }
}
function setContextHidden(name, hide) {
  if (hide) hiddenContexts.add(name);
  else hiddenContexts.delete(name);
  writePref(HIDDEN_CONTEXTS_KEY, JSON.stringify([...hiddenContexts]));
  contextsShown = "";
  if (contextsBody) renderContexts(contextsBody);
}
// A context the page may land on by itself: not GONE, not hidden.
const REACH_WORD = { gone: "GONE", unreachable: "UNREACHABLE" };
// Only a click picks a GONE context; a stored or default pick never does.
let contextPickedByHand = false;
function renderContexts(body) {
  contextsBody = body;
  if (Array.isArray(body?.contexts) && body.contexts.length) knownContexts = body.contexts;
  const all = mode === "cluster" && !sample && Array.isArray(body?.contexts) ? body.contexts : [];
  const current = body?.context || all.find((item) => item.primary)?.context || all[0]?.context || "";
  const list = all.filter((item) => item.context === current || (!item.hidden && !hiddenContexts.has(item.context)));
  const hiddenCount = all.length - list.length;
  const here = all.find((item) => item.context === current);
  if (here && !contextPickedByHand && (here.reach === "gone" || here.hidden || hiddenContexts.has(here.context))) {
    const next = all.find((item) => item.reach !== "gone" && !item.hidden && !hiddenContexts.has(item.context));
    if (next && next.context !== current) {
      setClusterContext(next.context, { auto: true });
      return;
    }
  }
  const pending = mode === "cluster" && !sample && all.length ? unconnectedClusters() : [];
  kubeCtxEl.hidden = list.length < 2 && !pending.length && !hiddenCount;
  if (kubeCtxEl.hidden) {
    contextsShown = "";
    placeConnectChip();
    return;
  }
  const key = JSON.stringify([current, list.map((item) => [item.context, item.label, item.lamp, item.total, item.scope, item.reach]), pending.map((item) => [item.cluster, item.state]), hiddenCount]);
  if (key === contextsShown) return;
  contextsShown = key;
  const title = vel("b", "", "CONTEXT");
  const buttons = list.map((item) => {
    const word = REACH_WORD[item.reach] || "";
    const button = vel("button", word ? item.reach : item.lamp);
    button.type = "button";
    button.setAttribute("aria-pressed", String(item.context === current));
    const issues = item.total ? `${item.total} issue${item.total === 1 ? "" : "s"}: ${(item.worst || []).map((w) => w.line).join("; ")}` : item.lamp === "ok" ? "every pod healthy" : item.error || "not read yet";
    button.title = word ? `${item.context} · ${word}: ${item.reachText || "the cluster does not answer"} · × hides it in this browser (kube.hideContexts in cloudspider.yaml hides it for everyone; your kubeconfig is not changed)` : `${item.context} · ${item.scope === "*" ? "every namespace" : item.scope.join(", ")} · ${issues}`;
    button.append(vel("i"), vel("span", "", item.label.toUpperCase()), vel("small", "", word || contextScope(item)));
    if (item.total && !word) button.append(vel("em", "", String(item.total)));
    if (word) {
      const hide = vel("u", "", "×");
      hide.title = `hide ${item.context} in this browser`;
      hide.setAttribute("role", "button");
      hide.setAttribute("aria-label", `hide ${item.context}`);
      hide.addEventListener("click", (event) => {
        event.stopPropagation();
        setContextHidden(item.context, true);
      });
      button.append(hide);
    }
    button.addEventListener("click", () => {
      contextPickedByHand = true;
      setClusterContext(item.context);
    });
    return button;
  });
  for (const item of pending) {
    const button = vel("button", "warn unconnected");
    button.type = "button";
    button.title = `EKS ${item.cluster}: ${item.text}${item.hint ? ` · ${item.hint}` : ""} · click: open the EKS panel`;
    button.append(vel("i"), vel("span", "", `+ ${item.cluster.toUpperCase()}`), vel("small", "", item.state === "clash-same" ? "FOUND · USE IT" : "NOT CONNECTED · CONNECT"));
    button.addEventListener("click", () => {
      if (clusterScreen !== "topology") setClusterScreen("topology");
      setConnectStripOpen(true);
    });
    buttons.push(button);
  }
  const browserHidden = all.filter((item) => hiddenContexts.has(item.context) && item.context !== current);
  if (browserHidden.length) {
    const more = vel("button", "hidden-more");
    more.type = "button";
    more.title = `hidden in this browser: ${browserHidden.map((item) => item.context).join(", ")} · click: show them again`;
    more.append(vel("i"), vel("span", "", `+${browserHidden.length}`), vel("small", "", "HIDDEN"));
    more.addEventListener("click", () => {
      for (const item of browserHidden) hiddenContexts.delete(item.context);
      setContextHidden("", false);
    });
    buttons.push(more);
  }
  kubeCtxEl.replaceChildren(title, ...buttons);
  placeConnectChip();
}

function setClusterContext(name, { auto = false } = {}) {
  if (name === (clusterData?.context || clusterContext)) return;
  kubeSearchText.set(clusterData?.context || clusterContext, kubeSearchEl.value);
  clusterContext = name;
  // An automatic move off a GONE context is not remembered as a choice.
  if (!auto) writePref(CLUSTER_CONTEXT_KEY, name);
  kubeSearchEl.value = kubeSearchText.get(name) || "";
  searchCursor = -1;
  k9s.reset();
  // TELEMETRY / OPS: the old context's answer goes; the open one re-reads
  // once the new context's view lands (pullCluster → syncClusterScreens).
  teleData = null;
  opsData = null;
  ++teleTicket;
  ++opsTicket;
  screensFor = "";
  clusterData = readingView(name);
  if (clusterData) renderContexts(clusterData);
  clusterSelected = null;
  showPod(null);
  contextsShown = "";
  setStatus(ui, `reading ${name}`);
  renderChrome();
  draw();
  pullCluster();
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
  // SAMPLE-only screens (the SERVICES prototype) leave with sample mode.
  const screenOff = (item) => Boolean(item?.sampleOnly && !sample) || Boolean(item?.needs && modulesVisible && !modulesVisible.includes(item.needs));
  for (const button of kubeTabs.children) button.hidden = screenOff(CLUSTER_SCREENS.find((item) => item.id === button.dataset.screen));
  graphView.setLive(!sample, clusterData?.context || clusterContext || "");
  if (screenOff(CLUSTER_SCREENS.find((item) => item.id === clusterScreen))) {
    CLUSTER_SCREENS.find((item) => item.id === clusterScreen)?.hide?.();
    clusterScreen = "topology";
  }
  for (const button of kubeTabs.children) button.setAttribute("aria-pressed", String(button.dataset.screen === clusterScreen));
  // Another context picked while a screen is open: read it for that one.
  const ctxNow = clusterData?.context || clusterContext || "";
  if (on && clusterTabsShown && screensFor !== ctxNow && clusterData && !clusterData.placeholder) {
    screensFor = ctxNow;
    if (clusterScreen === "telemetry") {
      paintTelemetry();
      pullTelemetry();
    } else if (clusterScreen === "ops") {
      renderOps(kubeOps, null);
      pullOps();
    }
  }
  if (on) screensFor = ctxNow;
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
  if (connectStripBody) renderConnectStrip(connectStripBody);
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
  const body = await fetch(`/api/cluster/telemetry${screenQuery()}`).then((r) => r.json()).catch(() => ({ error: "the telemetry did not answer" }));
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
  const query = screenQuery();
  const body = await fetch(`/api/cluster/ops${query}`).then((r) => r.json()).catch(() => ({ error: "the add-ons did not answer" }));
  if (ticket !== opsTicket) return;
  if (!query.includes("context=")) takeKubeRadio(body);
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
    // A narrow window puts the context switcher under the tabs.
    // Start under the measured tabs + CONTEXT bar (--kube-top, set by
    // layoutKubeBar), so the switcher never sits on a card.
    const barTop = parseInt(kubeCtxEl.parentElement ? getComputedStyle(kubeCtxEl.parentElement).getPropertyValue("--kube-top") : "", 10);
    const fallback = !kubeCtxEl.hidden && ((map.clientWidth || 0) < 900 || kubeCtxEl.classList.contains("below")) ? 88 : 52;
    const top = Math.max(fallback, Number.isFinite(barTop) ? barTop + 4 : 0);
    const found = currentSearch();
    // A search opens the lanes and lists the folded workloads it found
    // pods in, without touching the saved lane state.
    const grouped = groupedDiagram(focusedView().diagram);
    const state = found.active
      ? { open: { ...clusterLanes.open, ...Object.fromEntries(lanesForNamespaces(grouped, found.open).map((ns) => [ns, true])) }, expanded: [...new Set([...clusterLanes.expanded, ...found.expand])] }
      : clusterLanes;
    const key = `${map.clientWidth || 0}|${top}|${topologyGroupBy}|${focusMemo.key}|${JSON.stringify(state)}`;
    if (clusterPlaced.data !== clusterData || clusterPlaced.key !== key) {
      clusterPlaced = { key, data: clusterData, placed: layoutKube(grouped, { width: map.clientWidth || 0, state, top }) };
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
    const found = currentSearch();
    paintKube(ctx, { placed, selectedId: clusterSelected, hoverId: clusterHover, animTime, width, height, reducedMotion, scrollTop: map.scrollTop || 0, stickyTop: (map.scrollTop || 0) + stickyOffset(), match: found.active ? found : null });
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

// The Pip-Boy STAT screen (pipboy-view.js): over the MAP, on a toggle.
const pipBoyButton = /** @type {HTMLButtonElement} */ (document.querySelector("#map-pipboy"));
const pipBoyEl = /** @type {HTMLElement} */ (document.querySelector("#pipboy"));
// k8s-only: the Pip-Boy wall IS the map (HUT MAP brings the drawn one back);
// with AWS it is a toggle over the AWS map.
const pipBoyKey = kubeMapOnly() ? `${PIP_ON_KEY}.k8s` : PIP_ON_KEY;
let pipBoyOn = kubeMapOnly() || readPref(pipBoyKey, "0") === "1";
const pipBoy = mountPip(pipBoyEl, {
  load: () => fetch(sample ? "/api/cluster-sample" : `/api/cluster${clusterContext ? `?context=${encodeURIComponent(clusterContext)}` : ""}`).then((r) => r.json()),
  model: pipModel,
  onClose: () => { if (!kubeMapOnly()) setPipBoy(false); },
  canClose: !kubeMapOnly(),
  openTopology: (ns) => openInCluster({ type: "entry", id: `ns:${ns}`, ns }),
  store: (() => { try { return window.localStorage; } catch { return null; } })(),
});
function setPipBoy(on) {
  pipBoyOn = on || kubeMapOnly();
  try { window.localStorage.setItem(pipBoyKey, on ? "1" : "0"); } catch { /* this page only */ }
  syncPipBoy();
}
function syncPipBoy() {
  const room = mode === "map" && moduleOn("kubernetes");
  pipBoyButton.hidden = !room || pipBoyOn;
  const show = room && pipBoyOn;
  // The screen covers #map; #map must not scroll the hut map out from under it.
  map.classList.toggle("pip-on", show);
  if (show && map.scrollTop) map.scrollTop = 0;
  if (show && pipBoyEl.hidden) pipBoy.show();
  else if (!show && !pipBoyEl.hidden) pipBoy.hide();
}
pipBoyButton.addEventListener("click", () => setPipBoy(true));
const tintKey = /** @type {HTMLButtonElement|null} */ (document.querySelector("#tint-key"));
const showTint = () => { if (!tintKey) return; const amber = readTint() === "amber"; tintKey.textContent = amber ? "GRN" : "AMB"; tintKey.setAttribute("aria-pressed", String(amber)); tintKey.title = amber ? "phosphor: back to green" : "phosphor: amber (Pip-Boy 3000), the whole app"; };
tintKey?.addEventListener("click", () => { setTint(readTint() === "amber" ? "green" : "amber"); });
window.addEventListener("cs-tint", () => { showTint(); draw(); });
showTint();

function draw() {
  syncPipBoy();
  // k8s-only: MAP is the Pip-Boy, never the drawn hut map.
  if (mode === "map" && kubeMapOnly()) return;
  syncClusterScreens();
  if (!kubeFocusBox.hidden || !kubeHealthy.hidden) syncFocusBar();
  const noCluster = mode === "cluster" && !sample && Boolean(clusterData?.unset) && !clusterData?.diagram && (!clusterTabsShown || clusterScreen === "topology");
  const noRegionCluster = mode === "cluster" && !sample && Boolean(clusterData?.emptyRegion) && !clusterData?.diagram?.nodes?.length && (!clusterTabsShown || clusterScreen === "topology");
  if (noCluster) kubeEmpty.show({ context: clusterData.context || "", reason: clusterData.reason || clusterData.note || "" });
  else if (noRegionCluster) kubeEmpty.showRegion({ region: clusterData.emptyRegion, hasContexts: !kubeCtxEl.hidden });
  else if (kubeEmpty.isShown()) kubeEmpty.hide();
  // An HTML screen covers the canvas: nothing to paint underneath.
  if (clusterTabsShown && clusterScreen !== "topology") return;
  // The VAULTS page covers the map; the map does not draw under it.
  renderVaultPage();
  if (vaultPageOpen()) return;
  if (mode === "path" || mode === "cluster") {
    if (mapNsPanel) mapNsPanel.hidden = true;
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
  const placed = kubeMapOnly() || place || vaultsData.vaults.length
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
    kube: { hover: mapKube.hover, selected: null, chip: kubeChipState },
  });
  placeGrain(placed);
  placeVaultChrome(placed);
  placeFolds(placed);
  placeAlbDocks(placed);
  placeViewSwitch(placed);
  drawMapFocus();
}

// ---- ALB docks and ROUTES ----
const albRoutes = new Map(); // id → { at, body, pending, sample }
const dockOpen = new Set();
const dockQuery = new Map();
const routeTimers = new Map();
let docksKey = "";

function placedFixtures(placed) {
  return [...(placed?.settlements || []).flatMap((item) => item.fixtures || []), ...(placed?.zones || []).flatMap((zone) => zone.nodes || [])];
}

async function pullRoutes(id) {
  const had = albRoutes.get(id);
  if (had?.pending || (had && had.sample === sample && Date.now() - had.at < 60_000)) return;
  const wasSample = sample;
  albRoutes.set(id, { ...(had || {}), pending: true });
  const body = await fetch(`/api/alb-routes?id=${encodeURIComponent(id)}${wasSample ? "&sample=1" : ""}`).then((r) => r.json()).catch(() => null);
  albRoutes.set(id, { at: Date.now(), body: body || { routes: [], error: "routes could not be read" }, pending: false, sample: wasSample });
  if (wasSample) {
    if (body?.seen) reachSeen.set(body.seen.url, body.seen);
    for (const r of body?.routes || []) if (r.seen) reachSeen.set(r.url, r.seen);
  }
  docksKey = "";
  placeAlbDocks(placedMap());
}

// Probe the open list's rows, one at a time: only rows the reach allowlist
// can GET (the ALB's own name), at most 12, again each minute while open.
function probeRoutes(id) {
  clearInterval(routeTimers.get(id));
  routeTimers.delete(id);
  if (sample || !dockOpen.has(id)) return;
  const urls = () => [...new Set((albRoutes.get(id)?.body?.routes || []).filter((r) => r.probe && (r.probeUrl || r.url)).map((r) => r.probeUrl || r.url))].slice(0, 12);
  probeReach(urls());
  routeTimers.set(id, setInterval(() => (dockOpen.has(id) ? probeReach(urls()) : probeRoutes(id)), 60_000));
}

function routeList(id, list) {
  const query = dockQuery.get(id) || "";
  const rows = filterRoutes(list, query);
  const box = vel("div", "alr-list");
  box.tabIndex = 0;
  box.setAttribute("aria-label", "routes");
  if (!rows.length) box.append(vel("p", "alr-empty", query ? `nothing matches "${query}"` : "no routes read"));
  for (const group of groupRoutes(rows)) {
    box.append(vel("h5", "alr-host", group.label));
    const ul = vel("ul");
    for (const r of group.rows) {
      const li = vel("li", `alr-route ${r.source}`);
      const where = vel("span", "alr-where");
      // Host-routed rules: the host is the route (a shared ALB's rules all say "/*").
      const shown = `${r.host ? r.host : ""}${r.port && r.port !== 80 && r.port !== 443 ? `:${r.port}` : ""}${r.path}`;
      where.append(vel("code", "alr-path", shown), vel("span", "alr-svc", r.service ? `→ ${r.service}` : ""));
      const tags = vel("span", "alr-tags");
      if (r.methods?.length) tags.append(vel("span", "alr-methods", r.methods.join(" ")));
      if (r.source !== "openapi") tags.append(vel("span", "alr-app", routeProduct(r)));
      if (r.source === "openapi") tags.append(vel("span", "alr-from", "from OpenAPI"));
      else if (r.note) tags.append(vel("span", "alr-note", r.note));
      where.append(tags);
      let lamp;
      const probe = r.probeUrl || r.url;
      if (r.probe && probe) {
        lamp = reachLamp(probe);
        if (r.host && probe.includes("#host=")) lamp.title = `GET the ALB with Host: ${r.host}`;
      } else {
        lamp = vel("span", "reach-lamp skip", "—");
        lamp.title = "nothing to probe";
      }
      let go = vel("span");
      if (r.url) {
        go = openLink(r.url, "↗");
        if (r.via) go.title = `${r.host} has no DNS: opens the same app on ${r.via}`;
      } else if (r.curl) {
        go = vel("button", "cmd alr-curl", "CURL");
        go.type = "button";
        go.title = `${r.host} has no DNS from here. Copy: ${r.curl}`;
        go.addEventListener("click", () => navigator.clipboard?.writeText(r.curl).then(() => { go.textContent = "COPIED"; }).catch(() => {}));
      }
      li.append(where, lamp, go);
      ul.append(li);
    }
    box.append(ul);
  }
  return box;
}

// EXPOSURE (alb-exposure.js): the role badge and per-product checks, with
// REACH from the routes' probes (or the sample's).
function dockExposure(alb, body) {
  const lb = { ...alb, ...(body?.lb || {}), role: undefined };
  return lbExposure(lb, body?.routes || [], (url) => reachSeen.get(url));
}

function exposureList(exp) {
  const box = vel("div", "alx-list");
  box.setAttribute("aria-label", "exposure checks");
  for (const p of exp.products) {
    const row = vel("div", "alx-row");
    const grade = vel("span", `alx-grade g-${p.grade}`, `${p.grade} ${p.score ?? "?"}`);
    grade.title = `exposure score ${p.score ?? "unknown"}/100`;
    const name = vel("b", "alx-product", p.product);
    if (p.hosts.length) name.title = p.hosts.join(", ");
    const checks = vel("span", "alx-checks");
    for (const c of p.checks) {
      const chip = vel("span", `alx-check ${c.state}`, `${c.state === "pass" ? "✓" : c.state === "fail" ? "✗" : c.state === "warn" ? "!" : "?"} ${c.label}`);
      chip.title = `${c.label} (${c.weight} pts): ${c.detail}`;
      chip.dataset.check = c.key;
      checks.append(chip);
    }
    row.dataset.product = p.product;
    row.append(grade, name, checks);
    box.append(row);
  }
  return box;
}

function albDock(alb) {
  const state = albRoutes.get(alb.id);
  const list = state?.body?.routes || [];
  const rules = ruleCount(list);
  const open = dockOpen.has(alb.id);
  const dock = vel("div", `alb-dock${open ? " open" : ""}`);
  dock.dataset.id = alb.id;
  dock.style.left = `${alb.x}px`;
  dock.style.top = `${alb.y + alb.h + 4}px`;
  dock.style.minWidth = `${alb.w}px`;
  // never wider than its card (it covered the next card's dock): it wraps
  dock.style.maxWidth = `${alb.w}px`;
  const bar = vel("div", "alr-bar");
  bar.title = alb.url ? `${alb.url}\nGET from this machine every 30 s` : `${alb.dns}\nTCP/TLS: not probed over HTTP`;
  const exp = dockExposure(alb, state?.body);
  dock.dataset.role = exp.role;
  const role = vel("span", `alr-role ${exp.role}`, exp.role === "nlb" ? "NLB" : exp.role === "shared" ? "SHARED" : "DEDICATED");
  role.title = exp.role === "shared" ? `one ALB for an IngressGroup (${alb.ingressGroup || alb.ingress}): one listener rule per app` : exp.role === "nlb" ? "network load balancer: layer 4, listeners → target groups" : "one ALB for one Ingress";
  const grade = vel("span", `alr-grade g-${exp.grade}`, `${exp.grade}`);
  grade.title = `exposure: worst product ${exp.score ?? "unknown"}/100`;
  const toggle = vel("button", "cmd alr-routes-toggle", state?.body ? `${open ? "▾" : "▸"} ${rules} ${exp.role === "nlb" ? "listener" : "route"}${rules === 1 ? "" : "s"}${exp.role === "shared" ? ` → ${exp.products.length} apps` : ""}` : "▸ routes…");
  toggle.type = "button";
  toggle.dataset.focus = `routes:${alb.id}`;
  toggle.setAttribute("aria-expanded", String(open));
  toggle.setAttribute("aria-label", `${open ? "Hide" : "Show"} the routes of ${alb.ingress || alb.name}`);
  toggle.addEventListener("click", () => {
    if (dockOpen.has(alb.id)) dockOpen.delete(alb.id);
    else dockOpen.add(alb.id);
    docksKey = "";
    placeAlbDocks(placedMap());
    probeRoutes(alb.id);
    albDocksEl.querySelector(`[data-focus="routes:${CSS.escape(alb.id)}"]`)?.focus();
  });
  // A shared ALB's own name only hits the default rule (404 by design): its
  // apps answer per host, so the bar shows how many of them answer instead.
  if (alb.url && exp.role === "shared") bar.append(role, grade, sharedLamp(list), toggle);
  else if (alb.url) bar.append(role, grade, reachLamp(alb.url), openLink(alb.url), toggle);
  else bar.append(role, grade, vel("span", "reach-lamp skip", alb.lbType === "network" ? "TCP" : "—"), toggle);
  dock.append(bar);
  if (open) {
    const panel = vel("div", "alr-panel");
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", `routes of ${alb.ingress || alb.name}`);
    const head = vel("div", "alr-head");
    head.append(vel("b", "", "ROUTES"), vel("span", "alr-src", state?.body?.from === "listener" ? "from listener rules" : state?.body?.from === "ingress" ? `from Ingress${state.body.openapi ? " + OpenAPI" : ""}` : state?.body?.error || "reading…"));
    panel.append(head);
    const xh = vel("div", "alx-head");
    xh.append(vel("b", "", "EXPOSURE"), vel("span", "alr-src", exp.role === "shared" ? `${exp.label} · IngressGroup ${alb.ingressGroup || alb.ingress} · ${rules} rules → ${exp.products.length} apps` : exp.label));
    panel.append(xh, exposureList(exp));
    let listEl = routeList(alb.id, list);
    if (list.length > FILTER_AT) {
      const search = vel("input", "alr-search");
      search.type = "search";
      search.placeholder = `filter ${list.length} routes`;
      search.setAttribute("aria-label", "filter routes");
      search.value = dockQuery.get(alb.id) || "";
      search.addEventListener("input", () => {
        dockQuery.set(alb.id, search.value);
        const next = routeList(alb.id, list);
        listEl.replaceWith(next);
        listEl = next;
      });
      panel.append(search);
    }
    panel.append(listEl);
    dock.append(panel);
  }
  return dock;
}

function sharedLamp(list) {
  const lamp = vel("span", "reach-lamp shared-lamp");
  lamp._rows = list.filter((r) => r.probe && r.host && r.source !== "openapi");
  paintShared(lamp);
  return lamp;
}
function paintShared(lamp) {
  const rows = lamp._rows || [];
  const seen = rows.map((r) => reachSeen.get(r.probeUrl || r.url)).filter(Boolean);
  lamp.textContent = seen.length ? `${seen.filter((x) => x.ok).length}/${rows.length} apps up` : `${rows.length} apps`;
  if (seen.length) lamp.dataset.state = seen.every((x) => x.ok) && seen.length === rows.length ? "ok" : "fail";
  lamp.title = "each app GET with its own Host header (the ALB's bare name only reaches the default rule)";
}

function exposedLine(eks, albs) {
  const mine = albs.filter((alb) => alb.cluster && alb.cluster === eks.name);
  if (!mine.length) return null;
  const b = vel("button", "alb-exposed", exposedText(mine, (id) => albRoutes.get(id)?.body));
  b.type = "button";
  b.dataset.focus = `exposed:${eks.id}`;
  b.title = "show the load balancer on the map";
  b.style.left = `${eks.x}px`;
  b.style.top = `${eks.y + eks.h + 4}px`;
  b.style.maxWidth = `${eks.w}px`;
  b.addEventListener("click", () => {
    showOnMap(mine[0].id);
    albDocksEl.querySelector(`[data-focus="routes:${CSS.escape(mine[0].id)}"]`)?.focus({ preventScroll: true });
  });
  return b;
}

function placeAlbDocks(placed) {
  if (!albDocksEl) return;
  const fixtures = mode === "map" ? placedFixtures(placed) : [];
  const albs = fixtures.filter(hasDock);
  const clusters = fixtures.filter((item) => item.kind === "eks");
  const key = JSON.stringify([sample, albs.map((a) => [a.id, a.x, a.y, a.w, a.h, a.url, albRoutes.get(a.id)?.at]), clusters.map((c) => [c.id, c.x, c.y, c.w, c.h]), [...dockOpen]]);
  for (const alb of albs) pullRoutes(alb.id);
  if (key === docksKey) return;
  docksKey = key;
  const focused = albDocksEl.contains(document.activeElement) ? document.activeElement.dataset.focus : "";
  albDocksEl.replaceChildren(...albs.map(albDock), ...clusters.map((c) => exposedLine(c, albs)).filter(Boolean));
  if (focused) albDocksEl.querySelector(`[data-focus="${CSS.escape(focused)}"]`)?.focus({ preventScroll: true });
  clearInterval(reachTimer);
  if (!albs.length || sample) return;
  const urls = albs.map((item) => item.url);
  probeReach(urls.filter((url) => !reachSeen.has(url)));
  reachTimer = setInterval(() => probeReach(urls), 30_000);
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
      button.title = `${camp.closed ? "open" : "fold"} ${camp.label}`;
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

// One /api/view read at a time, shared: a caller that arrives while one is
// in flight awaits that same read (so `await pull()` really waits), and the
// two-second tick skips when a read just finished or the tab is hidden.
let pullShared = null;
let pullDoneAt = 0;
function pull({ tick = false } = {}) {
  if (pullShared) return pullShared;
  // With nothing to refresh (viewOff) poll slowly instead of every 2 s.
  const every = viewOff ? PULL_EVERY_OFF : PULL_EVERY;
  if (tick && (document.hidden || Date.now() - pullDoneAt < every - PULL_EVERY / 2)) return Promise.resolve();
  pullShared = pullOnce().finally(() => {
    pullShared = null;
    pullDoneAt = Date.now();
  });
  return pullShared;
}

async function pullOnce() {
  pulling = true;
  try {
    const query = new URLSearchParams({ grain: campGrain });
    if (sample) query.set("sample", "1");
    const view = await fetch(`/api/view?${query}`).then((response) => response.json());
    // The map module is off: nothing to read, and no error to show.
    // Nothing to refresh: the map module is off, or the read failed with no
    // place (a config or credentials problem a 2 s poll cannot fix).
    viewOff = view.off === "map" || Boolean(view.error && !view.place);
    if (view.off === "map") {
      if (!sample) liveMorning = view.morning || null;
      renderChrome();
      return;
    }
    setRadio(ui, view.radio || "");
    setTrail(ui, sample ? sampleTrail : view.trail || []);
    if (!sample) liveMorning = view.morning || null;
    if (mode === "path" || mode === "cluster") {
      if (!sample) syncRegions(view.regions || [], view.region);
      renderChrome();
      return;
    }
    if (sample) {
      // SAMPLE reads nothing from AWS: the live read's error (no profile,
      // no region) is not this screen's; it shows again when SAMPLE goes off.
      errorEl.hidden = true;
      errorEl.textContent = "";
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
  errorEl.hidden = true;
  errorEl.textContent = "";
  clickGround(ui);
  setStatus(ui, "sample, not the account");
  scoreApi?.refresh();
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
  scoreApi?.refresh();
}

// SNIFF's status line is the verdict; the longer notes go on its hover.
function pathStatus(body) {
  const words = [body.hostNote, body.headline].filter(Boolean).join(" ");
  const verdict = pathVerdict(body.diagram, sample ? null : pathProbe);
  statusEl.title = [verdict.title, words].filter(Boolean).join("\n\n");
  statusEl.dataset.tone = verdict.text ? verdict.tone : "";
  const line = verdict.text || words;
  return sample ? `sample, not the account. ${line}` : line;
}

// One GET from this machine to the path's own ALB (server: path-probe.js,
// cached ~30 s there). A new lb/host shows "probing…" until it answers.
async function probePath(asked, fresh = false) {
  if (asked !== pathProbeKey) {
    pathProbeKey = asked;
    pathProbe = "pending";
  }
  if (fresh) pathProbe = "pending";
  renderPathProbe();
  try {
    const response = await fetch(`/api/path/probe?${asked}${fresh ? "&fresh=1" : ""}`);
    const body = await readBody(response);
    if (pathProbeKey !== asked) return;
    pathProbe = body?.result ? body : { result: { skipped: body?.error || "no answer" } };
  } catch (error) {
    if (pathProbeKey !== asked) return;
    pathProbe = { result: { skipped: error?.message || String(error) } };
  }
  renderPathProbe();
  if (mode === "path" && pathData && pathQuery() === asked) {
    setStatus(ui, pathStatus(pathData));
    renderChrome();
  }
}

function renderPathProbe() {
  if (!pathProbeButton) return;
  pathProbeButton.hidden = mode !== "path" || sample || Boolean(pathData?.kube);
  pathProbeButton.disabled = pathProbe === "pending";
  pathProbeButton.textContent = pathProbe === "pending" ? "…" : "↻";
}
pathProbeButton?.addEventListener("click", () => probePath(pathQuery(), true));

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
  return new URLSearchParams({ lb: lbSelect.value || urlLb, host: hostInput.value.trim() }).toString();
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
    // In-cluster paths read the context picked in the Cluster view.
    const ctxParam = clusterContext ? `&context=${encodeURIComponent(clusterContext)}` : "";
    const response = await fetch(`${wasSample ? "/api/path-sample" : "/api/path"}?${asked}${ctxParam}`);
    const body = await readBody(response);
    if (body.stale || mode !== "path" || wasSample !== sample) return;
    if (pathQuery() !== asked) {
      pathAgain = true;
      return;
    }
    pathData = body;
    pathFailure = "";
    // SNIFF's DEBUG starts on the picked load balancer's public URL (Shop
    // API: http://<alb>/items), so RUN probes the internet → ALB → pod path.
    const picked = (body.loadBalancers || []).find((item) => item.arn === body.selected);
    if (picked?.public && picked.url && !netdebugView.target()) netdebugView.setTarget(picked.url);
    syncLoadBalancers(body.loadBalancers || [], body.selected || "");
    // In-cluster paths (and k8s-only, no AWS) have no load balancer to pick.
    lbSelect.hidden = Boolean(body.kube) && !(body.loadBalancers || []).length;
    if (pathSelected && !body.diagram?.nodes?.some((node) => node.id === pathSelected)) pathSelected = null;
    if (body.kube) {
      pathProbe = null;
      pathProbeKey = "";
    } else if (!wasSample && !body.error && body.diagram) probePath(asked);
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
  setViewHash("path");
  kubeCtxEl.hidden = true;
  if (kubeConnectEl) hideConnectStrip();
  contextsShown = "";
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
  netdebugView.show();
  setStatus(ui, "reading the path");
  renderChrome();
  draw();
  pullPath();
}

function leavePath() {
  setViewHash("");
  showRadioFor("map");
  mode = "map";
  pathData = null;
  pathSelected = null;
  lbSelect.hidden = true;
  hostInput.hidden = true;
  netdebugView.hide();
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
    const asked = clusterContext;
    const response = await fetch(wasSample ? "/api/cluster-sample" : `/api/cluster${asked ? `?context=${encodeURIComponent(asked)}` : ""}`);
    const body = await readBody(response);
    if (body.stale || mode !== "cluster" || wasSample !== sample || asked !== clusterContext) return;
    renderContexts(body);
    pullConnectStrip();
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
  setViewHash("cluster");
  // Sample stays on across views (from a map compound as from the tab).
  mapKube.keepSample = false;
  showRadioFor("cluster");
  mode = "cluster";
  clusterData = (!sample && clusterContext && readingView(clusterContext)) || null;
  if (clusterData) renderContexts(clusterData);
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
  setViewHash("");
  kubeCtxEl.hidden = true;
  if (kubeConnectEl) hideConnectStrip();
  contextsShown = "";
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
  markHistory();
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
      netdebugView.reset();
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
  for (const [label, value] of [["STATE", host.ready === null ? "not listed" : host.ready ? "Ready" : "NotReady"], ["TYPE", host.type], ["ZONE", host.zone], ["CAPACITY", host.capacity], ["SOURCE", sourceText(host.source)], ["PODS", `${host.pods} running`], ["INSTANCE", host.instanceId]]) {
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

// A Service: selector, ports, ready endpoints and the pods behind it
// (serviceDetail, kube-focus.js); a pod row opens that pod.
function showService(node) {
  ++podTicket;
  podInspector.close();
  const d = serviceDetail(clusterData?.diagram, node.id);
  if (!d) return;
  const head = vel("div", "kp-title");
  head.append(vel("span", "kp-name", `SERVICE · ${d.ns}/${d.name}`));
  const close = vel("button", "vp-close", "CLOSE");
  close.type = "button";
  close.addEventListener("click", () => {
    clusterSelected = null;
    showPod(null);
    draw();
  });
  const dx = vel("button", "vp-close vp-primary", "▶ DIAGNOSE");
  dx.type = "button";
  dx.title = "read-only investigation of this Service (DIAGNOSE)";
  dx.addEventListener("click", () => diagnoseNode(node.id));
  head.append(dx, close);
  const facts = vel("dl", "vp-facts");
  const rows = [
    ["TYPE", d.type],
    ["SELECTOR", d.selector.join(", ") || "none (endpoints set by hand)"],
    ["PORTS", d.ports.join(" · ") || "none"],
    ["READY", `${d.ready} endpoint${d.ready === 1 ? "" : "s"} (from ${d.readFrom})`],
  ];
  if (d.issue) rows.push(["ISSUE", d.issue]);
  for (const [label, value] of rows) facts.append(vel("dt", "", label), vel("dd", "", value));
  const body = vel("div", "kp-body vp-metrics");
  body.append(facts, vel("p", "kp-sub", d.pods.length ? `PODS BEHIND IT · ${d.pods.length}` : "NO PODS MATCH THE SELECTOR"));
  const list = vel("ul", "svc-pods");
  for (const p of d.pods) {
    const li = vel("li", `svc-pod ${p.status}`);
    const b = vel("button", "cmd svc-pod-btn", middle(p.name, 40));
    b.type = "button";
    b.title = [p.name, p.caption, p.node].filter(Boolean).join(" · ");
    b.addEventListener("click", () => investigateIssue(p.id));
    li.append(b, vel("span", "svc-pod-why", p.caption || p.status));
    list.append(li);
  }
  body.append(list);
  kubePanel.replaceChildren(head, body);
  kubePanel.hidden = false;
}

// Cluster view: click a pod for the deep-inspect panel (pod-inspect-view.js).
let podTicket = 0;
const podInspector = createPodInspector(kubePanel, {
  sample: () => sample,
  context: () => (clusterData?.context && !isPrimaryContext() ? clusterData.context : ""),
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

// ---- K9S window (k9s.js): a read-only, keyboard-driven resource table ----
const k9s = createK9s({
  root: k9sEl,
  getJson: (url) => fetch(url).then(readBody),
  context: () => clusterData?.context || clusterContext,
  sample: () => sample,
  onToggle: (on) => {
    k9sBtn.setAttribute("aria-pressed", String(on));
    if (!on) canvas.focus({ preventScroll: true });
  },
  // Enter: the pod's deep-inspect panel, as a click on its card would.
  onInspect: (row) => {
    const id = `pod:${row.ns}/${row.name}`;
    const node = clusterData?.diagram?.nodes?.find((n) => n.id === id) || { id, kind: "pod", label: row.name, ns: row.ns, status: row.status, caption: "", pod: { ns: row.ns, name: row.name, containers: row.containers || [], node: "" } };
    clusterSelected = node.id;
    showPod(node);
    draw();
  },
});
// Top-nav K9S tab: from any view it jumps to the Cluster view and opens.
k9sBtn.addEventListener("click", async () => {
  if (mode !== "cluster") {
    markHistory();
    await enterCluster();
    k9s.open();
    return;
  }
  k9s.toggle();
});
// ":" opens (or focuses) it from anywhere in the Cluster view, unless typing.
document.addEventListener("keydown", (event) => {
  if (event.key !== ":" || event.ctrlKey || event.metaKey || event.altKey || mode !== "cluster" || !moduleOn("kubernetes")) return;
  const t = event.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (k9sEl.contains(t)) return;
  event.preventDefault();
  if (k9s.isOpen()) k9s.focus();
  else k9s.open();
});

// ---- cluster search (kube-search.js): the prompt bar filters the lanes ----
const kubeSearchText = new Map(); // per kube context
let searchCursor = -1;
let searchMemo = { diagram: null, text: "", result: null };

function searchable() {
  return mode === "cluster" && clusterData?.diagram?.layout === "kube" && (!clusterHasScreens() || clusterScreen === "topology");
}

function currentSearch() {
  const text = searchable() ? kubeSearchEl.value : "";
  // TOPOLOGY searches the focused diagram (scope, ISSUES): a match that is
  // not shown is not counted.
  const diagram = clusterData?.diagram?.layout === "kube" ? focusedView()?.diagram : clusterData?.diagram;
  if (searchMemo.diagram !== diagram || searchMemo.text !== text) {
    searchMemo = { diagram, text, result: searchKube(diagram, text) };
  }
  return searchMemo.result;
}

function syncSearchBar() {
  // The K9S window lives in the Cluster view; its tab sits in the top nav
  // (shown whenever the kubernetes module is on) and leaving closes it.
  const kubeView = mode === "cluster" && clusterData?.diagram?.layout === "kube";
  if (mode !== "cluster" && k9s.isOpen()) k9s.close();
  const on = searchable();
  kubeSearchEl.hidden = !on;
  kubeGroupBox.hidden = !on;
  syncFocusBar();
  statusEl.hidden = on;
  confirmEl.classList.toggle("caption", on);
  const found = on ? currentSearch() : null;
  kubeSearchCount.hidden = !found?.active;
  // In ISSUES a miss may only be hidden: say how many ALL would find.
  const elsewhere = found?.active && !found.count && topologyFocus.view === "issues" ? searchKube(scopedAll(), kubeSearchEl.value).count : 0;
  kubeSearchCount.textContent = elsewhere ? `no match in ISSUES · ${elsewhere} healthy in ALL (click)` : countText(found);
  kubeSearchCount.classList.toggle("none", Boolean(found?.active && !found.count));
  kubeSearchCount.classList.toggle("to-all", Boolean(elsewhere));
}

function jumpToMatch(step = 1) {
  const found = currentSearch();
  if (!found.active) return;
  const order = matchOrder(placedCluster(), found.ids);
  if (!order.length) return;
  searchCursor = (searchCursor + step + order.length) % order.length;
  const n = order[searchCursor];
  clusterSelected = n.id;
  // Bring it into view below the pinned lane head.
  map.scrollTo({ top: Math.max(0, n.y - 230), left: Math.max(0, n.x - 60), behavior: reducedMotion ? "auto" : "smooth" });
  kubeSearchCount.textContent = `${searchCursor + 1} of ${order.length}  ·  Enter next, Shift+Enter back`;
  draw();
}

kubeSearchEl.addEventListener("input", () => {
  searchCursor = -1;
  kubeSearchText.set(clusterData?.context || clusterContext, kubeSearchEl.value);
  syncSearchBar();
  renderChrome();
  draw();
});
kubeSearchEl.addEventListener("keydown", (event) => {
  // Keys typed here stay here: map keyboard nav never sees them.
  event.stopPropagation();
  if (event.key === "Enter") {
    event.preventDefault();
    jumpToMatch(event.shiftKey ? -1 : 1);
  } else if (event.key === "Escape") {
    event.preventDefault();
    kubeSearchEl.value = "";
    kubeSearchText.set(clusterData?.context || clusterContext, "");
    searchCursor = -1;
    kubeSearchEl.blur();
    syncSearchBar();
    draw();
  }
});
// "/" focuses the search in the Cluster view, unless something is typed.
// Everywhere else it opens quick-find (quick-find.js): on MAP the map's
// own resources, elsewhere GO TO over the tabs and the map's resources.
// The top tabs and console keys, read from the page (both themes' labels).
function quickTabs() {
  const name = (b) => (b.querySelector("[data-pro-label]")?.textContent || b.querySelector(".tag")?.textContent || b.textContent || "").trim();
  return [...document.querySelectorAll(".tabs .tab, .keys .key")].filter((b) => b.id && !b.hidden && b.getClientRects().length).map((b) => {
    const pro = b.querySelector("[data-pro-label]")?.textContent?.trim() || "";
    return { key: `#${b.id}`, kind: "tab", label: name(b), hint: [pro && pro !== name(b) ? pro : "", b.title || ""].filter(Boolean).join(" · ").slice(0, 60) || "tab", id: b.id };
  });
}
// The map is what is on screen: no console key (SCORE, STACKS…) covers it.
const mapOnScreen = () => mode === "map" && !vaultPageOpen() && ![...document.querySelectorAll(".keys .key:not(#tab-radio)")].some((b) => b.getAttribute("aria-pressed") === "true" && !b.hidden);
function quickMapTargets() {
  if (!place && !vaultsData.vaults.length) return [];
  const placed = placedMap();
  return mapTargets(placed, focusLists(placed));
}
function quickPickMap(key) {
  const go = () => {
    const targets = mapFocusTargets();
    const index = targets.findIndex((t) => t.key === key);
    if (index < 0) return;
    mapKeyboard = true;
    canvas.focus({ preventScroll: true });
    focusMapTarget(targets, index);
  };
  if (mapOnScreen()) go();
  else {
    const key = [...document.querySelectorAll(".keys .key:not(#tab-radio)")].find((b) => b.getAttribute("aria-pressed") === "true" && !b.hidden);
    if (key) key.click();
    if (mode !== "map" || vaultPageOpen()) tabMap?.click();
    requestAnimationFrame(() => requestAnimationFrame(go));
  }
}
const quickFind = createQuickFind({
  onPick(it) {
    if (it.kind === "tab") {
      const b = document.querySelector(it.key);
      // A top tab under a lit console key (SCORE, STACKS…) stays covered:
      // close the key first, as clicking it again would.
      const lit = [...document.querySelectorAll(".keys .key:not(#tab-radio)")].find((k) => k.getAttribute("aria-pressed") === "true" && !k.hidden);
      if (b?.matches(".tabs .tab") && lit) lit.click();
      if (b && b.getAttribute("aria-pressed") !== "true") b.click();
    }
    else quickPickMap(it.key);
  },
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey) return;
  const t = event.target;
  if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  if (k9s.isOpen() || quickFind.isOpen()) return;
  event.preventDefault();
  if (searchable() && !kubeSearchEl.hidden) {
    kubeSearchEl.focus();
    kubeSearchEl.select();
    return;
  }
  const mapEntries = quickMapTargets().map(mapItem);
  if (mapOnScreen()) return quickFind.open({ title: "MAP", entries: mapEntries });
  quickFind.open({ title: "GO TO", entries: [...quickTabs(), ...mapEntries.map((e) => ({ ...e, hint: `map · ${e.hint}` }))] });
});

// Pinned lane heads sit under the floating context switcher, not behind it.
function stickyOffset() {
  if (!kubeCtxEl || kubeCtxEl.hidden || !map.scrollTop) return 0;
  const r = kubeCtxEl.getBoundingClientRect();
  const m = map.getBoundingClientRect();
  return Math.max(0, Math.round(r.bottom - m.top + 4));
}

// Sticky lane heads follow the scroll (kube-draw.js).
map.addEventListener("scroll", () => {
  if (mode === "cluster" && clusterData?.diagram?.layout === "kube") draw();
  if (mode === "path") draw(); // the pan hint follows the visible edge
}, { passive: true });

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
      else if (node?.kind === "service" && !node.members) showService(node);
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
    if (kubeHitNow?.type === "policies") {
      mapKube.policies = !kubeHitNow.on;
      try {
        window.localStorage.setItem(POLICIES_KEY, mapKube.policies ? "1" : "0");
      } catch {
        // this page only
      }
      draw();
      return;
    }
    if (kubeHitNow?.type === "netpol") {
      showNsPanel(kubeHitNow.cluster, kubeHitNow.ns);
      return;
    }
    if (kubeHitNow?.type === "policy-source") return;
    if (kubeHitNow?.type === "lod") {
      setKubeLevel(kubeHitNow.cluster, kubeHitNow.value);
      return;
    }
    if (kubeHitNow?.type === "kube") {
      const item = kubeChipState(kubeHitNow.cluster).item;
      if (item) openEksCard(item.cluster);
      else openInCluster({ type: "compound", cluster: kubeHitNow.cluster });
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
      openFixture(fixture);
      return;
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
  await openBuilding(hit);
});

// A fixture's plate (load balancer, gateway, vault card): click or Enter.
function openFixture(fixture) {
  clickFixture(ui, fixture, fixtureNote(fixture));
  setFacts(ui, plateFacts(fixture.id));
  renderChrome();
  draw();
}

// A resource's plate, then its last log lines: click or Enter.
// ask: false (a morning line) opens the plate only, no STOP/START Y/N armed.
async function openBuilding(hit, { ask = true } = {}) {
  const raw = place?.instances.find((item) => item.id === hit.id) || hit;
  clickBuilding(ui, raw, region, place ? blastLine(place, raw.id) : "");
  if (!ask) ui.confirmation = null;
  setFacts(ui, plateFacts(raw.id));
  renderChrome();
  draw();
  if (sample || !isInstanceId(raw.id)) return;
  const logs = await fetch(`/api/logs?id=${encodeURIComponent(raw.id)}`).then((response) => response.json()).catch(() => ({}));
  if (ui.selection?.id !== raw.id) return;
  setLogs(ui, logs.entries || logs.lines || [], logs.note || "");
  draw();
}

// ---- KEYBOARD ON THE MAP ----
// The canvas is one tab stop. Inside it Tab and the arrow keys walk what a
// click can open (src/map-focus.js); a Pip-Boy ring marks the focused one
// and #map-say reads it out. Enter or Space presses it, Escape closes the
// plate (the page's Escape handler). A mouse focus draws no ring.
const mapSay = document.querySelector("#map-say");
const MAP_KEYS = new Set(["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"]);
let mapFocusKey = "";
let mapKeyboard = false;

function mapFocusTargets() {
  if (mode !== "map" || vaultPageOpen() || (!place && !vaultsData.vaults.length)) return [];
  const placed = placedMap();
  return mapTargets(placed, focusLists(placed));
}

function scrollMapTo(rect) {
  const pad = 24;
  if (rect.y - pad < map.scrollTop || rect.y + rect.h + pad > map.scrollTop + map.clientHeight) map.scrollTop = Math.max(0, rect.y - map.clientHeight / 3);
  if (rect.x - pad < map.scrollLeft || rect.x + rect.w + pad > map.scrollLeft + map.clientWidth) map.scrollLeft = Math.max(0, rect.x - map.clientWidth / 3);
}

function focusMapTarget(targets, index) {
  const target = targets[index];
  if (!target) return;
  mapFocusKey = target.key;
  mapSay.textContent = targetLine(target, index, targets.length);
  scrollMapTo(target.rect);
  draw();
}

function drawMapFocus() {
  if (!mapKeyboard || !mapFocusKey || document.activeElement !== canvas) return;
  const target = mapFocusTargets().find((item) => item.key === mapFocusKey);
  if (!target) return;
  const gap = 4;
  const x = Math.round(target.rect.x) - gap;
  const y = Math.round(target.rect.y) - gap;
  const w = Math.round(target.rect.w) + gap * 2;
  const h = Math.round(target.rect.h) + gap * 2;
  const arm = Math.min(16, Math.floor(w / 2), Math.floor(h / 2));
  const t = 4;
  ctx.save();
  ctx.lineWidth = 6;
  ctx.strokeStyle = PIP.ink;
  ctx.strokeRect(x, y, w, h);
  ctx.lineWidth = 2;
  ctx.strokeStyle = PIP.bright;
  ctx.strokeRect(x, y, w, h);
  // Hot corner brackets, outside the line, so the ring reads on any tile.
  ctx.fillStyle = PIP.hot;
  const left = x - t;
  const top = y - t;
  const right = x + w;
  const bottom = y + h;
  ctx.fillRect(left, top, arm, t);
  ctx.fillRect(left, top, t, arm);
  ctx.fillRect(right + t - arm, top, arm, t);
  ctx.fillRect(right, top, t, arm);
  ctx.fillRect(left, bottom, arm, t);
  ctx.fillRect(left, bottom + t - arm, t, arm);
  ctx.fillRect(right + t - arm, bottom, arm, t);
  ctx.fillRect(right, bottom + t - arm, t, arm);
  ctx.restore();
}

function pressMapTarget(target) {
  const { item } = target;
  if (target.kind === "vault") {
    toggleVault(item.key);
    mapSay.textContent = `vault ${item.vault?.name || item.key} ${item.open ? "closing" : "opening"}.`;
    return;
  }
  if (target.kind === "app") {
    openInCluster(item);
    return;
  }
  if (target.kind === "fixture") openFixture(item);
  else openBuilding(item);
  mapSay.textContent = `${ui.selection?.name || "the"} plate is open. Escape closes it.`;
}

canvas.addEventListener("mousedown", () => {
  mapKeyboard = false;
});

canvas.addEventListener("focus", () => {
  if (!canvas.matches(":focus-visible")) return;
  mapKeyboard = true;
  const targets = mapFocusTargets();
  if (!targets.length) {
    mapSay.textContent = mode === "map" ? "survey map: nothing to walk yet." : "";
    return;
  }
  const index = targets.findIndex((item) => item.key === mapFocusKey);
  focusMapTarget(targets, index < 0 ? 0 : index);
});

canvas.addEventListener("blur", () => {
  if (mode === "map") draw();
});

canvas.addEventListener("keydown", (event) => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const targets = mapFocusTargets();
  if (!targets.length) return;
  mapKeyboard = true;
  const index = targets.findIndex((item) => item.key === mapFocusKey);
  if (event.key === "Tab") {
    const next = index < 0 ? (event.shiftKey ? targets.length - 1 : 0) : index + (event.shiftKey ? -1 : 1);
    // Past either end, Tab leaves the map as usual.
    if (next < 0 || next >= targets.length) return;
    event.preventDefault();
    focusMapTarget(targets, next);
    return;
  }
  if (event.key === "Enter" || event.key === " ") {
    if (index < 0) return;
    event.preventDefault();
    pressMapTarget(targets[index]);
    return;
  }
  if (!MAP_KEYS.has(event.key)) return;
  event.preventDefault();
  focusMapTarget(targets, stepTarget(targets, index, event.key));
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
    const id = hit ? (hit.type === "lod" ? `lod:${hit.cluster}:${hit.value}` : hit.type === "kube" ? `kube:${hit.cluster}` : hit.type === "netpol" ? `netpol:${hit.cluster}:${hit.ns}` : hit.type === "policies" ? `policies:${hit.cluster}` : hit.id || `compound:${hit.cluster}`) : null;
    if (hit?.type === "kube") hit.text = kubeChipState(hit.cluster).text;
    if (id !== mapKube.hover) {
      mapKube.hover = id;
      draw();
    }
    if (hit) {
      const title = explainAbbr(compoundHover(hit));
      if (canvas.title !== title) canvas.title = title;
      if (canvas.style.cursor !== "pointer") canvas.style.cursor = "pointer";
      return;
    }
  }
  if (mode === "path") {
    // Narrow windows clip the cards: the full label rides in the tooltip.
    const hit = nodeAt(placedPath(), event.offsetX, event.offsetY);
    const title = nodeTitle(hit);
    if (canvas.title !== title) canvas.title = title;
    const cursor = hit ? "pointer" : "";
    if (canvas.style.cursor !== cursor) canvas.style.cursor = cursor;
    return;
  }
  const title = mode === "map" ? explainAbbr(mapTitle(placedMap(), event.offsetX, event.offsetY)) : "";
  if (canvas.title !== title) canvas.title = title;
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
  if (mode !== "map" || !moduleOn("stacks")) return;
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
  markHistory();
  await toggleSample();
  syncUrl();
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
  markHistory();
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

function renderPathFlow() {
  if (!pathFlowButton) return;
  pathFlowButton.hidden = mode !== "path";
  // Compact so the SNIFF row (picker, URL, ↔, ↻, ASK) stays one row at 1024.
  pathFlowButton.textContent = pathFlow === "v" ? "↕" : "↔";
  pathFlowButton.title = pathFlow === "v" ? "SNIFF layout: top to bottom (click for left to right)" : "SNIFF layout: left to right (click for top to bottom)";
  pathFlowButton.setAttribute("aria-pressed", String(pathFlow === "v"));
}
pathFlowButton?.addEventListener("click", () => {
  pathFlow = pathFlow === "v" ? "h" : "v";
  try { localStorage.setItem("cs.sniffFlow", pathFlow); } catch {}
  renderPathFlow();
  draw();
});

function renderAskThis() {
  renderPathFlow();
  renderPathProbe();
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
  if (!terminal.isOpen() && scoreApi?.isOpen()) scoreApi.setOpen(false);
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
  onChange: () => syncUrl(),
  onPick: () => {
    markHistory();
    syncUrl();
  },
  onNote(text, status) {
    noteSpider(text, status);
    renderRadioPanel();
  },
});
learnApi = learnView;
// SCORE: the scorecard panel over the map (src/score/view.js).
// SCAN reads the cluster picked in the Cluster view (an auto-CONNECTed EKS
// cluster is listed there; the current kubeconfig context is not changed).
// OPEN EKS CARD (K8S-REL-004): the card on this cluster, its live instance
// type, and the control's params (nodeCount 2) on top.
function openScoreCard(card, cluster) {
  if (card?.id !== "eks") return;
  liveWant = { cluster, values: Object.fromEntries(Object.entries(card.params || {}).map(([k, v]) => [k, String(v)])) };
  openEksCard(cluster);
}
const scoreView = createScoreView({ root: document.querySelector("#score"), toggleButton: document.querySelector("#score-key"), context: () => clusterData?.context || clusterContext, openCard: openScoreCard, onChange: () => syncUrl(), sample: () => sample });
scoreApi = scoreView;
// SCORE covers the map like LEARN: one big panel at a time. Opening it folds
// LEARN, STACKS and ASK; opening any of those folds SCORE (before, SCORE
// stayed on top and their keys lit with nothing to see).
document.querySelector("#score-key").addEventListener("click", () => {
  markHistory();
  if (!scoreView.isOpen()) {
    if (learnView.isOpen()) learnView.setOpen(false);
    if (pipOpen) toggleUpgrade();
    if (terminal.isOpen() && !terminal.isRunning()) terminal.setOpen(false);
  }
  Promise.resolve(scoreView.toggle()).then(renderChromeParts);
});
document.querySelector("#learn-key").addEventListener("click", () => {
  markHistory();
  if (!learnView.isOpen()) {
    if (terminal.isOpen()) terminal.setOpen(false);
    if (pipOpen) toggleUpgrade();
    if (scoreView.isOpen()) scoreView.setOpen(false);
  }
  Promise.resolve(learnView.toggle()).then(renderChromeParts);
});
askThis.addEventListener("click", () => {
  const question = askThisQuestion();
  if (question) terminal.prefill(question);
});

// ---- Stacks: Pulumi upgrade cards in a Pip-Boy panel over the map ----

const CARD_ICON = {
  eks: "cluster", signal: "radio", barrel: "stack", camp: "bucket",
  rds: "database", pgcluster: "database", shopapi: "pod", demo: "pod", showcase: "lb", observability: "radio", site: "url", worker: "queue", openshift: "openshift", observe: "radio", "tf-rds": "terraform",
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
// DEPLOYED / NOT DEPLOYED from the stack's state (GET /api/upgrade/resources,
// pulumi stack export: read-only). Filled once per panel open.
let stackStates = {};
let pipCurrentCluster = "";
let dangerOpen = false; // the DANGER ZONE fold stays as the user left it
const nukeBoxes = new Map(); // cluster → its mounted TEAR EVERYTHING DOWN box // GET /api/upgrades currentCluster
let stackStatesAt = 0;
const STATE_CHIP = {
  deployed: ["DEPLOYED", "up", (s) => `its state holds ${s.count} resource${s.count === 1 ? "" : "s"}`],
  empty: ["NOT DEPLOYED", "down", () => "the stack exists but its state is empty"],
  missing: ["NOT DEPLOYED", "down", () => "no stack state yet: never run here"],
  error: ["STATE ?", "unk", (s) => `could not read the state: ${s.error || "pulumi did not answer"}`],
};
function stateChip(st) {
  if (!st) return el("span", { className: "st-chip unk", textContent: "…", title: "reading the stack state" });
  const [word, cls, why] = STATE_CHIP[st.state] || STATE_CHIP.error;
  return el("span", { className: `st-chip ${cls}`, textContent: st.state === "deployed" ? `${word} · ${st.count}` : word, title: why(st) });
}
async function pullStackStates(force = false) {
  if (!force && Date.now() - stackStatesAt < 60_000) return;
  stackStatesAt = Date.now();
  const ids = pipModules.filter((spec) => !spec.addon).map((spec) => spec.id);
  if (!ids.length) return;
  const q = new URLSearchParams({ ids: ids.join(",") });
  if (sample) q.set("sample", "1");
  const body = await fetch(`/api/upgrade/resources?${q}`).then((r) => r.json()).catch(() => null);
  if (!body?.states) return;
  stackStates = body.states;
  if (pipOpen) drawPipForm();
}

// ---- STACKS OVERVIEW (ui.stacksLayout: overview | combined) ----
// overview: a grid of what each stack has deployed (state + last run from
// audit.jsonl); a click opens its detail; OPEN RUN CONSOLE opens the old
// card (settings, PREVIEW / RUN / TAKE IT DOWN, run log) on its own.
const LAYOUT_KEY = "cloudspider.stacks.layout";
let stackRuns = {};
let overviewPick = null;
let stacksReadSample = null;
function stacksLayout() {
  let stored = "";
  try { stored = localStorage.getItem(LAYOUT_KEY) || ""; } catch {}
  return pickLayout(pageConfig?.ui?.stacksLayout, stored);
}
function setStacksLayout(next) {
  try { localStorage.setItem(LAYOUT_KEY, next); } catch {}
  drawPipForm();
}
async function pullLastRuns() {
  stacksReadSample = sample;
  const q = sample ? "?sample=1" : "";
  const body = await fetch(`/api/stacks/last-runs${q}`).then((r) => r.json()).catch(() => null);
  if (!body?.runs) return;
  stackRuns = body.runs;
  if (pipOpen) drawPipForm();
}
// In the overview, an own stack's open card is its RUN CONSOLE.
function consoleSpec() {
  if (stacksLayout() !== "overview" || !openCard || String(openCard).includes("@")) return null;
  return pipModules.find((spec) => spec.id === openCard && !spec.addon) || null;
}
const OV_STATUS = {
  deployed: ["DEPLOYED", "up"], down: ["NOT DEPLOYED", "down"], failed: ["FAILED", "fail"], unknown: ["STATE ?", "unk"], reading: ["READING…", "unk"],
};
function layoutToggle() {
  const now = stacksLayout();
  const box = el("span", { className: "lay-tog", role: "group", ariaLabel: "STACKS layout" });
  for (const [id, word, tip] of [["overview", "OVERVIEW", "what is deployed; run controls in a separate RUN CONSOLE"], ["combined", "COMBINED", "the old cards: settings and RUN inline"]]) {
    const b = el("button", { type: "button", className: `lay-btn${now === id ? " on" : ""}`, textContent: word, title: `layout: ${tip} (ui.stacksLayout in cloudspider.yaml; this choice is kept in this browser)` });
    b.setAttribute("aria-pressed", String(now === id));
    b.addEventListener("click", () => setStacksLayout(id));
    box.append(b);
  }
  return box;
}
function runLine(run, deployed = false) {
  if (!run && deployed) return el("span", { className: "ov-run outside", textContent: "DEPLOYED OUTSIDE THE APP", title: "the stack holds resources, but no PREVIEW / RUN from this app is in audit.jsonl (made with the pulumi CLI or another checkout)" });
  if (!run) return el("span", { className: "ov-run none", textContent: "NO RUN LOGGED", title: "no PREVIEW / RUN / TAKE IT DOWN in audit.jsonl for this stack" });
  const cls = run.result === "ok" ? "ok" : run.result === "failed" ? "bad" : "warn";
  const when = new Date(run.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" });
  return el("span", { className: `ov-run ${cls}`, title: `${run.verb} ${run.result} at ${when}${run.durationMs ? ` in ${Math.round(run.durationMs / 1000)}s` : ""}${run.error ? `: ${run.error}` : ""}` },
    el("i"), el("b", { textContent: `${run.verb} ${run.result.toUpperCase()}` }), el("span", { textContent: ago(run.at) }));
}
function overviewTile(spec) {
  const st = stackStates[spec.id];
  const run = stackRuns[spec.id];
  const status = overviewStatus(st, run);
  const [word, cls] = OV_STATUS[status];
  const tile = el("button", { type: "button", className: `ov-tile ${cls}${overviewPick === spec.id ? " picked" : ""}`, title: `open ${spec.title}: what it created, its last run, and the RUN CONSOLE` });
  tile.dataset.id = spec.id;
  const where = [spec.current?.clusterName, spec.cost?.region].filter(Boolean).join(" · ");
  const top = (st?.top || []).map((g) => `${g.label} ×${g.count}`).join(" · ");
  const hint = driftHint(st, run);
  tile.append(
    el("span", { className: "ov-top" }, iconImg(CARD_ICON[spec.id] || "stack"), el("b", { className: "ov-name", textContent: spec.title }), el("span", { className: `ov-stat ${cls}`, textContent: status === "deployed" ? `${word} · ${st.count}` : word }), el("span", { className: "ov-go", ariaHidden: "true", textContent: "OPEN ›" })),
    el("span", { className: "ov-res", textContent: top || (status === "deployed" ? "" : "nothing created") }),
    el("span", { className: "ov-foot" }, runLine(run, status === "deployed"), where ? el("span", { className: "ov-where", textContent: where }) : ""),
  );
  if (hint) tile.append(el("span", { className: "ov-drift", textContent: `⚠ ${hint}` }));
  tile.addEventListener("click", () => {
    overviewPick = overviewPick === spec.id ? null : spec.id;
    drawPipForm();
    pipEl.querySelector(".ov-detail")?.scrollIntoView({ block: "nearest" });
  });
  return tile;
}
function overviewDetail(spec) {
  const st = stackStates[spec.id];
  const run = stackRuns[spec.id];
  const box = el("section", { className: "ov-detail", ariaLabel: `${spec.title}: deployed` });
  const close = el("button", { type: "button", className: "ov-close", textContent: "✕ CLOSE", title: "back to the overview" });
  close.addEventListener("click", () => { overviewPick = null; drawPipForm(); });
  box.append(el("header", { className: "ov-dhead" }, iconImg(CARD_ICON[spec.id] || "stack"), el("b", { textContent: spec.title }), stateChip(st), close));
  const facts = el("ul", { className: "lines ov-facts" });
  const fact = (k, v) => facts.append(el("li", {}, el("span", { textContent: k }), el("span", { textContent: v })));
  fact("stack", st?.stack || spec.stack || spec.id);
  if (spec.current?.clusterName) fact("cluster", spec.current.clusterName);
  if (spec.cost?.region) fact("region", spec.cost.region);
  fact("state updated", st?.updated ? new Date(st.updated).toLocaleString([], { dateStyle: "short", timeStyle: "short" }) : "—");
  fact("last run", run ? `${run.verb} ${run.result} · ${ago(run.at)}` : "none logged");
  if (run?.error) fact("error", run.error);
  const hint = driftHint(st, run);
  if (hint) fact("drift hint", hint);
  box.append(facts, resourcesBlock(spec));
  const go = el("button", { type: "button", className: "ov-console", title: `settings, PREVIEW, RUN, TAKE IT DOWN and the run log for ${spec.title}` }, iconImg("terminal"), el("span", { textContent: "OPEN RUN CONSOLE ›" }));
  go.addEventListener("click", () => {
    openCard = spec.id;
    markHistory();
    syncUrl();
    drawPipForm();
    refreshUpgrade(true);
  });
  box.append(go);
  return box;
}
function drawRunConsole(spec, title) {
  const back = el("button", { type: "button", className: "ov-back", title: "close the run console, back to what is deployed" }, el("span", { textContent: "‹ BACK TO OVERVIEW" }));
  back.addEventListener("click", () => {
    overviewPick = spec.id;
    openCard = null;
    markHistory();
    syncUrl();
    drawPipForm();
  });
  title.querySelector(".pcount").textContent = `RUN CONSOLE · ${spec.title.toUpperCase()}`;
  const card = el("section", { className: "card open run-console" });
  card.dataset.id = spec.id;
  card.append(cardHead(spec), cardBody(spec));
  pipEl.append(el("div", { className: "ov-bar" }, back), card);
}
function drawOverview(own, groups, order) {
  const all = own.length;
  const up = own.filter((spec) => overviewStatus(stackStates[spec.id], stackRuns[spec.id]) === "deployed").length;
  const failed = own.filter((spec) => overviewStatus(stackStates[spec.id], stackRuns[spec.id]) === "failed").length;
  const rows = invRows(own);
  const n = (v) => rows.filter((r) => r.status === v).length;
  const kBtn = (view, cls, word) => {
    const on = inventoryView === view;
    const b = el("button", { type: "button", className: `ov-k ${cls}${on ? " on" : ""}`, title: on ? "close the list, back to the tiles" : `list the ${word} stacks${view === "deployed" ? " with everything each one created" : ""} (add-ons included)` },
      el("b", { textContent: String(n(view)) }), el("i", { textContent: word }), el("span", { className: "ov-kgo", ariaHidden: "true", textContent: on ? "✕" : "›" }));
    b.dataset.view = view;
    b.setAttribute("aria-pressed", String(on));
    b.addEventListener("click", () => { inventoryView = on ? null : view; inventoryQuery = ""; drawPipForm(); });
    return b;
  };
  void all; void up; void failed;
  pipEl.append(el("div", { className: "ov-sum" },
    kBtn("deployed", "up", "DEPLOYED"), kBtn("down", "down", "NOT DEPLOYED"), kBtn("failed", "fail", "FAILED"),
    el("span", { className: "ov-tip", textContent: inventoryView ? "CLICK A STACK TO OPEN IT" : sample ? "SAMPLE DATA · CLICK A COUNT OR A STACK" : "CLICK A COUNT FOR THE LIST · A STACK FOR ITS RESOURCES" })));
  if (inventoryView) return drawInventory(rows);
  for (const { id, icon, label, list } of [...groups.values()].sort((a, b) => order(a.id) - order(b.id))) {
    pipEl.append(sectionHead(id, icon, label, "", list));
    if (foldedSections.has(id)) continue;
    const grid = el("div", { className: "ov-grid" });
    for (const spec of list) grid.append(overviewTile(spec));
    pipEl.append(grid);
    const picked = list.find((spec) => spec.id === overviewPick);
    if (picked) pipEl.append(overviewDetail(picked));
  }
  // TEAR EVERYTHING DOWN per cluster (takedown-view.js): plan, typed name,
  // run. Folded at the bottom: findable, not the first thing on the page.
  const eksSpec = own.find((spec) => spec.id === "eks");
  const clusters = nukeClusters({
    eksDeployed: Boolean(eksSpec) && overviewStatus(stackStates.eks, stackRuns.eks) === "deployed",
    eksCluster: eksSpec?.current?.clusterName || stackRuns.eks?.cluster || "",
    current: pipCurrentCluster,
    runs: stackRuns,
  });
  if (clusters.length) {
    const fold = el("details", { className: "ov-danger", open: dangerOpen }, el("summary", { textContent: `DANGER ZONE · TEAR A CLUSTER DOWN (${clusters.join(", ")})` }));
    const strip = el("div", { className: "ov-nukes", role: "group", ariaLabel: "tear a cluster down with every stack on it" });
    fold.addEventListener("toggle", () => { dangerOpen = fold.open; });
    // the same box per cluster across redraws (state polls redraw the page),
    // so an open plan and a half-typed name survive
    for (const cluster of clusters) {
      let box = nukeBoxes.get(cluster);
      if (!box) {
        box = el("div", { className: "scale-row ov-nuke" });
        nukeBoxes.set(cluster, box);
        mountTakedown(box, () => ({ cluster, sample }), { onStarted: () => { nukeBoxes.delete(cluster); openCard = "eks"; markHistory(); syncUrl(); drawPipForm(); refreshUpgrade(true); } });
      }
      strip.append(box);
    }
    fold.append(strip);
    return fold; // the caller puts it last, under add-ons and Terraform
  }
  return null;
}

// DEPLOYED INVENTORY (a click on a DEPLOYED / NOT DEPLOYED / FAILED count):
// every stack in that state, add-ons included, each with what it created
// grouped by type (the stack state, read-only), a filter on top.
let inventoryView = null;
let inventoryQuery = "";
const INV_TITLE = { deployed: "DEPLOYED INVENTORY", down: "NOT DEPLOYED", failed: "FAILED STACKS" };
function invRows(own) {
  return inventoryRows({ own, states: stackStates, runs: stackRuns, addonTree: addonData?.tree || [], category: stackCategory });
}
function invResourceText(row) {
  const r = resourceCache.get(`${row.id}|${row.resourceStack}|${sample ? 1 : 0}`);
  return r?.groups ? r.groups.map((g) => `${g.label} ${g.service} ${g.items.map((it) => `${it.name} ${it.id}`).join(" ")}`).join(" ") : "";
}
function openInventoryRow(row) {
  inventoryView = null;
  if (row.kind === "addon") {
    openCard = row.key;
    markHistory();
    syncUrl();
    drawPipForm();
    setTimeout(() => pipEl.querySelector(`.card[data-id="${CSS.escape(row.key)}"]`)?.scrollIntoView({ block: "nearest" }), 50);
    return;
  }
  overviewPick = row.id;
  drawPipForm();
  pipEl.querySelector(".ov-detail")?.scrollIntoView({ block: "nearest" });
}
function drawInventory(all) {
  const rows = all.filter((r) => r.status === inventoryView);
  const box = el("section", { className: `inv inv-${inventoryView}`, ariaLabel: INV_TITLE[inventoryView] });
  const total = rows.reduce((a, r) => a + r.count, 0);
  const close = el("button", { type: "button", className: "ov-close", textContent: "✕ CLOSE", title: "back to the tiles" });
  close.addEventListener("click", () => { inventoryView = null; drawPipForm(); });
  const shown = el("span", { className: "inv-n" });
  box.append(el("header", { className: "ov-dhead" }, iconImg("stack"), el("b", { textContent: INV_TITLE[inventoryView] }),
    el("span", { className: "inv-sum", textContent: `${rows.length} STACK${rows.length === 1 ? "" : "S"}${inventoryView === "deployed" ? ` · ${total} RESOURCES` : ""}${sample ? " · SAMPLE" : ""}` }), close));
  const input = el("input", { type: "search", className: "inv-q", placeholder: "filter: stack, cluster, type, resource name…", value: inventoryQuery, ariaLabel: "filter the list" });
  box.append(el("div", { className: "inv-bar" }, input, shown));
  const list = el("div", { className: "inv-list" });
  const empty = el("p", { className: "res-empty inv-empty" });
  const items = rows.map((row) => {
    const item = el("article", { className: `inv-row ${row.status}` });
    item.dataset.key = row.key;
    const where = [row.cluster, row.region].filter(Boolean).join(" · ");
    const head = el("button", { type: "button", className: "inv-head", title: row.kind === "addon" ? `open the ${row.title} add-on card on ${row.cluster}` : `open ${row.title}: detail and RUN CONSOLE` },
      iconImg(CARD_ICON[row.id] || (row.kind === "addon" ? "addon" : "stack")),
      el("b", { className: "inv-name", textContent: row.title }),
      el("span", { className: "inv-cat", textContent: row.category }),
      where ? el("span", { className: "inv-where", textContent: where }) : "",
      el("span", { className: "inv-stack", textContent: row.stack, title: "Pulumi stack" }),
      runLine(row.run, row.kind === "stack" && stackStates[row.id]?.state === "deployed"),
      row.status === "deployed" ? el("span", { className: "inv-cnt", textContent: `${row.count} RES` }) : "",
      el("span", { className: "ov-go", ariaHidden: "true", textContent: "OPEN ›" }));
    head.addEventListener("click", () => openInventoryRow(row));
    item.append(head);
    if (row.note) item.append(el("span", { className: "ov-drift", textContent: row.note }));
    if (row.run?.error) item.append(el("span", { className: "ov-drift", textContent: `⚠ ${row.run.error}` }));
    const hint = row.kind === "stack" ? driftHint(stackStates[row.id], row.run) : "";
    if (hint && row.status !== "deployed") item.append(el("span", { className: "ov-drift", textContent: `⚠ ${hint}` }));
    if (row.status !== "down") {
      const spec = pipModules.find((s) => s.id === row.id && (row.kind === "addon" ? s.addon : !s.addon)) || { id: row.id, title: row.title };
      item.append(resourcesBlock(spec, row.resourceStack, () => apply()));
    }
    list.append(item);
    return [row, item];
  });
  const apply = () => {
    let hits = 0;
    for (const [row, item] of items) {
      const on = rowMatches(row, inventoryQuery, invResourceText(row));
      item.hidden = !on;
      if (on) hits += 1;
    }
    shown.textContent = inventoryQuery ? `${hits} / ${rows.length} MATCH` : "";
    empty.hidden = hits > 0;
    empty.textContent = rows.length ? `nothing matches "${inventoryQuery}"` : inventoryView === "deployed" ? "No stack has resources yet: PREVIEW then RUN one from its RUN CONSOLE." : inventoryView === "failed" ? "No failed RUN or TAKE IT DOWN in the audit log." : "Every stack is deployed.";
  };
  input.addEventListener("input", () => { inventoryQuery = input.value; apply(); });
  box.append(list, empty);
  pipEl.append(box);
  apply();
}

// RESOURCES CREATED: the open card's stack state grouped by type.
const resourceCache = new Map();
function resourcesBlock(spec, stack = "", onRead = null) {
  const box = el("section", { className: "res-block", ariaLabel: "resources created" });
  const head = el("div", { className: "res-head" }, iconImg("stack"), el("b", { textContent: "RESOURCES CREATED" }), el("span", { className: "res-sum", textContent: "reading the stack state…" }));
  const list = el("div", { className: "res-list" });
  box.append(head, list);
  const key = `${spec.id}|${stack}|${sample ? 1 : 0}`;
  const paint = (r) => {
    const sum = head.querySelector(".res-sum");
    if (r.state === "error") {
      sum.textContent = "STATE NOT READABLE";
      list.replaceChildren(el("p", { className: "res-empty bad", textContent: `${r.error || "pulumi did not answer"}. Cloud Spider reads it with pulumi stack export (read-only); pulumi must be on PATH and logged in to this stack's backend.` }));
      return;
    }
    if (!r.deployed) {
      sum.textContent = "NOT DEPLOYED";
      list.replaceChildren(el("p", { className: "res-empty", textContent: r.state === "empty" ? `Stack ${r.stack} exists but holds nothing: it was never run, or it was destroyed. PREVIEW shows what RUN would create.` : `No state for stack ${r.stack || spec.stack || spec.id}: nothing was created yet. PREVIEW shows what RUN would create.` }));
      return;
    }
    sum.textContent = `${r.count} IN ${r.groups.length} TYPE${r.groups.length === 1 ? "" : "S"}${r.sample ? " · SAMPLE" : ""}${r.updated ? ` · ${new Date(r.updated).toLocaleString([], { dateStyle: "short", timeStyle: "short" })}` : ""}`;
    const targets = mapFocusTargets();
    list.replaceChildren(...r.groups.map((g) => {
      const det = el("details", { className: "res-group" });
      det.append(el("summary", { title: g.type }, el("span", { className: "res-type", textContent: g.label }), el("small", { className: "res-svc", textContent: g.service }), el("span", { className: "res-n", textContent: `×${g.count}` })));
      det.append(el("ul", {}, ...g.items.map((it) => {
        const hit = targets.find((t) => [t.item?.id, t.item?.arn, t.item?.name].filter(Boolean).some((v) => it.handles.includes(v) || v === it.id));
        const li = el("li", {}, el("span", { className: "res-name", textContent: it.name, title: it.urn }));
        if (hit) {
          const go = el("button", { type: "button", className: "res-go", textContent: "MAP ›", title: `show ${it.name} on the map` });
          go.addEventListener("click", () => {
            mapKeyboard = true;
            canvas.focus({ preventScroll: true });
            const all = mapFocusTargets();
            focusMapTarget(all, all.findIndex((t) => t.key === hit.key));
          });
          li.append(go);
        } else if (it.id && it.id !== it.name) li.append(el("small", { className: "res-id", textContent: it.id.length > 34 ? `…${it.id.slice(-32)}` : it.id, title: it.id }));
        return li;
      })));
      return det;
    }));
  };
  if (resourceCache.has(key)) paint(resourceCache.get(key));
  else {
    const q = new URLSearchParams({ id: spec.id });
    if (stack) q.set("stack", stack);
    if (sample) q.set("sample", "1");
    fetch(`/api/upgrade/resources?${q}`).then((r) => r.json()).catch(() => ({ state: "error", error: "the page failed" })).then((r) => {
      resourceCache.set(key, r);
      setTimeout(() => resourceCache.delete(key), 60_000);
      if (box.isConnected) { paint(r); onRead?.(); }
    });
  }
  return box;
}

// Collapsible sections in the STACKS panel (kept in localStorage).
const FOLD_KEY = "cloudspider.stacks.folded";
const foldedSections = new Set((() => { try { return JSON.parse(localStorage.getItem(FOLD_KEY) || "[]"); } catch { return []; } })());
function sectionHead(id, icon, label, note, list) {
  const folded = foldedSections.has(id);
  const up = list ? list.filter((spec) => stackStates[spec.id]?.state === "deployed").length : null;
  const head = el("button", { type: "button", className: "pdiv psec", ariaExpanded: String(!folded), title: folded ? `show ${label}` : `fold ${label}` },
    el("span", { className: "card-chev", ariaHidden: "true", textContent: "›" }), iconImg(icon), el("span", { textContent: label }),
    el("span", { className: "ro" }, ...(list ? [el("b", { className: "sec-n", textContent: String(list.length) }), up ? el("span", { className: "sec-up", textContent: `${up} UP` }) : ""] : []), note ? el("span", { textContent: note }) : ""));
  head.addEventListener("click", () => {
    if (foldedSections.has(id)) foldedSections.delete(id);
    else foldedSections.add(id);
    try { localStorage.setItem(FOLD_KEY, JSON.stringify([...foldedSections])); } catch {}
    drawPipForm();
  });
  return head;
}

// A stack's note: the first lines, MORE for the rest (some run to a page).
function noteBlock(text) {
  const box = el("div", { className: "card-note" }, el("p", { textContent: text }));
  if (text.length > 240) {
    box.classList.add("clamped");
    const more = el("button", { type: "button", className: "note-more", textContent: "MORE ▾", title: "show the whole note" });
    more.addEventListener("click", () => {
      const open = box.classList.toggle("clamped");
      more.textContent = open ? "MORE ▾" : "LESS ▴";
    });
    box.append(more);
  }
  return box;
}

function cardHead(spec) {
  const head = el(
    "button",
    { type: "button", className: "card-head" },
    iconImg(CARD_ICON[spec.id] || "stack"),
  );
  const main = el("span", { className: "card-main" }, el("span", { className: "card-title", textContent: spec.title }));
  head.append(main);
  // Status chips: CONFIGURED (a Pulumi.<stack>.yaml with values on disk;
  // not a claim that it is up) and what it needs first.
  const chips = el("span", { className: "card-chips" });
  chips.append(stateChip(stackStates[spec.id]));
  const needs = (spec.needs || []).map(String);
  if (needs.length) chips.append(el("span", { className: "st-chip need", textContent: `NEEDS ${needs[0].toUpperCase()}${needs.length > 1 ? ` +${needs.length - 1}` : ""}`, title: `needs first: ${needs.join(", ")}` }));
  if (chips.children.length) main.append(chips);
  if (spec.cost) head.append(el("span", { className: "cost-chip", textContent: costLine(spec.cost).split(" · ")[0], title: `about ${costLine(spec.cost)} in ${spec.cost.region}` }));
  head.append(el("span", { className: `eng ${spec.engine === "terraform" ? "tf" : ""}`, textContent: spec.engine === "terraform" ? "TF" : "PULUMI" }));
  head.append(el("span", { className: "card-chev", ariaHidden: "true", textContent: "›" }));
  head.title = openCard === spec.id ? `fold ${spec.title}` : `open ${spec.title}: cost, settings, PREVIEW and RUN`;
  head.setAttribute("aria-expanded", String(openCard === spec.id));
  head.addEventListener("click", () => {
    openCard = openCard === spec.id ? null : spec.id;
    markHistory();
    syncUrl();
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
  return block;
}

// NEEDS chips (src/stack-needs.js): what the card needs on its cluster, read
// from the cluster: green there, red missing (RUN and PREVIEW are refused),
// dim when it could not be read. A click opens the card that makes it.
let needsSeq = 0;
function needsRow(spec, preset = {}) {
  const row = el("div", { className: "needs", id: "pip-needs" }, el("span", { textContent: "NEEDS" }));
  for (const id of spec.needs || []) row.append(el("span", { className: "need unknown", textContent: (pipModules.find((item) => item.id === id)?.title || id).toUpperCase() }));
  row.hidden = !spec.needs?.length;
  if (spec.needs?.length && !sample) queueMicrotask(() => refreshNeeds(spec, preset));
  return row;
}

async function refreshNeeds(spec, preset = {}) {
  const row = pipEl.querySelector(".card.open #pip-needs");
  if (!row || openModule() !== spec.id) return;
  const params = { ...pipParams(), ...preset };
  const query = { module: spec.id, clusterName: params.clusterName || "" };
  for (const when of spec.needsWhen || []) if (params[when.param]) query[when.param] = params[when.param];
  const seq = ++needsSeq;
  const got = await upgradeJson(`/api/upgrade/needs?${new URLSearchParams(query)}`);
  if (seq !== needsSeq || !row.isConnected || !Array.isArray(got?.needs)) return;
  const word = { ok: "there", missing: "missing: RUN and PREVIEW are refused until it is up", unknown: "could not be read (CONNECT the cluster): not checked" };
  row.replaceChildren(el("span", { textContent: "NEEDS" }));
  for (const need of got.needs) {
    const chip = el("button", { type: "button", className: `need ${need.state}`, textContent: `${need.state === "ok" ? "✓ " : need.state === "missing" ? "✗ " : ""}${need.title.toUpperCase()}` });
    chip.title = `${need.title} on ${need.cluster}${need.because ? ` (${need.because})` : ""}: ${word[need.state] || need.state}. Click to open ${need.open.card === "eks" ? "the EKS card" : "its card"}.`;
    chip.addEventListener("click", () => openNeed(need));
    row.append(chip);
  }
  if (got.refusal) row.append(el("em", { className: "need-why", textContent: got.refusal }));
  row.hidden = !got.needs.length;
}

// Stack bundles (src/stack-bundles.js) on each card in one: PLAN shows the
// order and the bill in one line (nothing runs), RUN BUNDLE is the one
// approval for all of it. The run shows on the last step's card.
function bundleRows(spec, preset = {}) {
  const rows = el("div", { className: "sbundles" });
  for (const bundle of bundlesWith(spec.id)) {
    const row = el("div", { className: "sbundle", role: "group", ariaLabel: bundle.title });
    const plan = el("em", { className: "sb-plan", textContent: bundle.note });
    const planButton = el("button", { type: "button", className: "cmd", textContent: "plan", title: "what the bundle would run, in order, and its bill; changes nothing" });
    const runButton = el("button", { type: "button", className: "cmd", textContent: "run bundle", disabled: true, title: "PLAN first: then this runs every step in order (preview, up), stopping at the first failure" });
    const ask = () => {
      const params = { ...pipParams(), ...preset };
      return { bundle: bundle.id, cluster: params.clusterName || fallbackCluster(), params: Object.fromEntries(Object.entries(params).filter(([key]) => ["expose"].includes(key))) };
    };
    planButton.addEventListener("click", async () => {
      plan.textContent = "planning…";
      const got = await upgradeJson("/api/stacks/bundle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...ask(), plan: true }) });
      plan.textContent = got.confirm || got.error || "no answer";
      plan.classList.toggle("refused", Boolean(got.plan?.refusal || got.error));
      runButton.disabled = Boolean(got.error || got.plan?.refusal || !got.plan?.order?.length);
      runButton.dataset.cluster = got.cluster || "";
    });
    runButton.addEventListener("click", async () => {
      runButton.disabled = true;
      const got = await upgradeJson("/api/stacks/bundle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ask()) });
      if (got.error) {
        plan.textContent = got.error;
        plan.classList.add("refused");
        return;
      }
      const last = got.module || "";
      const cluster = runButton.dataset.cluster || fallbackCluster();
      if (last && last !== spec.id) {
        if (!pipModules.find((item) => item.id === last)?.addon) pipKept[last] = { ...(pipKept[last] || {}), clusterName: cluster };
        openCard = pipModules.find((item) => item.id === last)?.addon ? `${last}@${cluster}` : last;
        drawPipForm();
      }
      refreshUpgrade(true);
      renderChrome();
    });
    row.append(el("b", { textContent: bundle.title.toUpperCase() }), planButton, runButton, plan);
    rows.append(row);
  }
  return rows;
}

async function openNeed(need) {
  const { card, cluster } = need.open || {};
  if (!card) return;
  if (card === "eks") return openEksCard(cluster);
  const module = card.split("@")[0];
  if (!card.includes("@")) pipKept[module] = { ...(pipKept[module] || {}), clusterName: cluster };
  openCard = card;
  markHistory();
  syncUrl();
  drawPipForm();
  refreshUpgrade(true);
  renderChrome();
}

// The body of an open Pulumi card: note, bill, watch line, parameters, the
// three buttons (PREVIEW changes nothing) and, for a cluster add-on, the
// commands to run it yourself. `preset` fixes parameters (an add-on row
// knows its cluster).
function cardBody(spec, preset = {}) {
  const body = el("div", { className: "card-body" });
  const watch = el("div", { id: "pip-watch" });
  watch.hidden = true;
  body.append(noteBlock(spec.note || ""), resourcesBlock(spec, spec.addon && preset.clusterName ? `${spec.id}-${preset.clusterName}` : ""), costBlock(spec), needsRow(spec, preset), bundleRows(spec, preset));
  // PUBLIC · URL · lamp · OPEN, filled when the map knows the stack's public
  // load balancers (renderCardOpen, on every chrome render).
  const openRow = el("div", { className: "card-open" });
  openRow.dataset.project = spec.vault || spec.id;
  openRow.hidden = true;
  body.append(openRow);
  if (spec.nodeCost) body.append(nodeCostBlock(spec.nodeCost));
  body.append(watch);
  if (spec.id === "eks") {
    // SCALE DOWN / SCALE UP (eks-scale-view.js): chip, buttons, warning, dialog.
    const scaleBox = el("div", { id: "pip-scale", className: "scale-row", role: "group", ariaLabel: "scale the cluster down or up" });
    body.append(scaleBox);
    const scale = mountScale(scaleBox, () => ({ cluster: pipParams().clusterName || spec.current?.clusterName || fallbackCluster(), sample }));
    queueMicrotask(() => scale.refresh());
    // TAKE DOWN CLUSTER (takedown-view.js): plan, typed name, run in this pane.
    const downBox = el("div", { id: "pip-takedown", className: "scale-row", role: "group", ariaLabel: "take the cluster down with every stack on it" });
    body.append(downBox);
    mountTakedown(downBox, () => ({ cluster: pipParams().clusterName || spec.current?.clusterName || fallbackCluster(), sample }), { onStarted: (out) => { paintUpgrade(out); refreshUpgrade(true); } });
  }
  if (spec.id === "eks") body.append(connectRow("pip-connect"), el("div", { id: "pip-live", className: "live-line", hidden: true }, el("span", { className: "live-what" }), el("em", { className: "field-note live-warn" })));
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
    // Set by Cloud Spider from the cluster (scaling-demo's demoApp), not typed.
    if (parameter.auto) continue;
    let field;
    const fixed = preset[parameter.name];
    // What was typed stays when the panel redraws (and CONNECT can open the
    // card on a cluster).
    // Else what the stack runs with now (Pulumi.<stack>.yaml), else the default.
    const kept = pipKept[spec.id]?.[parameter.name] ?? spec.current?.[parameter.name];
    if (parameter.choices) {
      field = el("select");
      for (const choice of parameter.choices) {
        field.append(el("option", { value: choice, textContent: parameter.labels?.[choice] || choice, selected: choice === (kept ?? parameter.default) }));
      }
    } else {
      field = el("input", { value: fixed ?? kept ?? parameter.default ?? "" });
      if (fixed !== undefined) field.readOnly = true;
    }
    field.name = parameter.name;
    if (fixed === undefined) {
      field.addEventListener("change", () => {
        pipKept[spec.id] = { ...(pipKept[spec.id] || {}), [parameter.name]: field.value };
      });
    }
    if (spec.id === "eks" && ["instanceType", "kubernetesVersion"].includes(parameter.name)) field.addEventListener("change", () => paintLive());
    if (spec.id === "eks" && parameter.name === "clusterName") field.addEventListener("change", () => {
      refreshLive(true);
      refreshConnect(true);
      refreshBundle(true);
    });
    if (parameter.name === "clusterName" || spec.needsWhen?.some((when) => when.param === parameter.name)) field.addEventListener("change", () => refreshNeeds(spec, preset));
    if (parameter.name === "clusterName" || parameter.name === "name") {
      field.addEventListener("change", () => refreshUpgrade(true));
      field.addEventListener("input", () => promptConfirm(spec, body));
    }
    // The bill follows the instance type and node count picked here.
    if (spec.costLines?.some((line) => line.param === parameter.name || (line.perNode && parameter.name === "nodeCount") || (line.when && parameter.name in line.when) || line.spot === parameter.name || line.extended === parameter.name)) {
      field.addEventListener("change", () => repriceCard(spec));
      field.addEventListener("input", () => repriceCard(spec));
    }
    body.append(el("label", {}, `${parameter.name} `, field));
    // A choice's meaning under the field (Shop API expose: none warns that
    // nothing is reachable from the internet).
    if (parameter.notes) {
      const note = el("em", { className: "field-note choice-note", role: "status" });
      const say = () => {
        note.textContent = parameter.notes[field.value] || "";
        note.classList.toggle("warn", [].concat(parameter.warn ?? []).includes(field.value));
      };
      field.addEventListener("change", say);
      say();
      body.append(note);
    }
    if (parameter.type === "number") {
      // The allowed range, said while typing (RUN would be refused anyway).
      if (fixed === undefined) Object.assign(field, { type: "number", min: parameter.min, max: parameter.max, step: 1 });
      const note = el("em", { className: "field-note", role: "status" });
      const check = () => {
        note.textContent = numberProblem(parameter, field.value);
      };
      field.addEventListener("input", check);
      check();
      body.append(note);
    }
  }
  const confirm = el("input", { name: "confirmName", className: "confirm-name", autocomplete: "off" });
  const preview = el("button", { type: "button", className: "cmd", textContent: "preview", title: "pulumi preview --diff: shows what run would change, changes nothing" });
  preview.addEventListener("click", () => postUpgrade("preview"));
  const run = el("button", { type: "button", className: "cmd", textContent: "run" });
  run.addEventListener("click", () => postUpgrade("up"));
  const down = el("button", { type: "button", className: "cmd danger", textContent: "take it down" });
  down.addEventListener("click", () => postUpgrade("destroy"));
  body.append(el("div", { className: "actions" }, confirm, preview, run, down));
  promptConfirm(spec, body);
  if (spec.addon) body.append(commandRows(addonCommands(spec, preset.clusterName)));
  body.append(runPane());
  if (spec.id === "eks") body.append(bundleBlock());
  if (pipKept[spec.id] && spec.costLines) queueMicrotask(() => repriceCard(spec));
  return body;
}

// The confirm field says which name TAKE IT DOWN wants: the card's name or
// its stack name (both are accepted).
function promptConfirm(spec, body) {
  const confirm = body.querySelector("input.confirm-name");
  if (!confirm) return;
  const values = {};
  for (const field of body.querySelectorAll("input, select")) if (field.name && field.name !== "confirmName") values[field.name] = field.value;
  const text = confirmPrompt(spec, values);
  confirm.placeholder = text;
  confirm.title = `${text} to take it down`;
  confirm.setAttribute("aria-label", `${text} to take it down`);
}

// The open card's cost for the parameters in its fields: the chip in its
// head and the bill block.
function cardCost(spec, params = pipParams()) {
  if (!spec?.costLines?.length) return spec?.cost;
  try {
    // auto: the extended-support fee follows the live cluster's version.
    const liveVersion = spec.id === "eks" ? liveState.get(params.clusterName || "")?.clusterVersion || "" : "";
    return estimate(costFor(spec.costLines, { ...params, liveVersion }));
  } catch {
    return spec.cost;
  }
}

function repriceCard(spec) {
  const card = pipEl.querySelector(".card.open");
  if (!card) return;
  const cost = cardCost(spec);
  const chip = card.querySelector(".card-head .cost-chip");
  if (chip && cost) {
    chip.textContent = costLine(cost).split(" · ")[0];
    chip.title = `about ${costLine(cost)} in ${cost.region}`;
  }
  const bill = card.querySelector(".card-body > .bill");
  if (bill) bill.replaceWith(costBlock({ ...spec, cost }));
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
  const sig = (d) => (d?.tree || []).flatMap((c) => c.addons.map((a) => `${a.id}@${c.cluster}:${a.state}:${a.resources}`)).join(",");
  const changed = sig(addonData) !== sig(body);
  addonData = body;
  // the DEPLOYED / NOT DEPLOYED counts include the add-on stacks
  if (changed && stacksLayout() === "overview" && !consoleSpec()) drawPipForm();
  else drawAddonTree();
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
    el("span", { className: "card-chev", ariaHidden: "true", textContent: spec ? "›" : "" }),
  );
  head.setAttribute("aria-expanded", String(openCard === key));
  head.addEventListener("click", () => {
    openCard = openCard === key ? null : key;
    markHistory();
    syncUrl();
    drawPipForm();
    if (openCard) refreshUpgrade(true);
  });
  card.append(head);
  const tags = [];
  if (item.included) tags.push(el("span", { className: "ad-tag", textContent: item.state === "installed" ? "INCLUDED WITH EKS · THIS OLD STACK STILL HOLDS IT: scripts/migrate-eks-addons.mjs HANDS IT OVER" : "INCLUDED WITH EKS: THE EKS STACK INSTALLS IT" }));
  else if (item.state === "present") tags.push(el("span", { className: "ad-tag warn", textContent: "NOT FROM ITS STACK: UP IS REFUSED" }));
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
        el("span", { className: `ad-live ${cluster.live ? "on" : "off"}`, textContent: addonData.sample ? (cluster.live ? "SAMPLE" : "SAMPLE · NO CLUSTER") : cluster.live ? "LIVE" : "NO CLUSTER", title: addonData.sample ? "sample data: no cluster is read" : "" }),
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
  const own = pipModules.filter((spec) => !spec.addon);
  const overview = stacksLayout() === "overview";
  // SAMPLE flipped since the last read: the states and runs are re-read.
  if (stacksReadSample !== null && stacksReadSample !== sample) {
    stacksReadSample = sample;
    stackStates = {};
    stackRuns = {};
    pullStackStates(true);
    pullLastRuns();
  }
  const title = el("div", { className: "ptitle" }, iconImg("stack"), el("span", { textContent: "STACKS" }), el("span", { className: "pcount", textContent: overview ? `${own.length + pipTerraform.length} STACKS` : `${own.length + pipTerraform.length} STACKS · CLICK ONE TO OPEN` }), layoutToggle());
  pipEl.replaceChildren(title);
  pipEl.classList.toggle("ov-mode", overview);
  if (!pipModules.length && !pipTerraform.length) {
    pipEl.append(el("div", { className: "quiet pempty", textContent: "No stacks found: the upgrades/ folder has no Pulumi or Terraform stack." }));
    return;
  }
  const groups = new Map();
  for (const spec of own) {
    const cat = stackCategory(spec.id);
    if (!groups.has(cat.id)) groups.set(cat.id, { ...cat, list: [] });
    groups.get(cat.id).list.push(spec);
  }
  const order = (id) => { const i = CATEGORIES.findIndex((c) => c[0] === id); return i < 0 ? 99 : i; };
  const runConsole = consoleSpec();
  if (runConsole) return drawRunConsole(runConsole, title);
  const danger = overview ? drawOverview(own, groups, order) : null;
  try {
  // the inventory lists the add-on stacks itself
  if (overview && inventoryView) return;
  else for (const { id, icon, label, list } of [...groups.values()].sort((a, b) => order(a.id) - order(b.id))) {
    pipEl.append(sectionHead(id, icon, label, "", list));
    if (foldedSections.has(id)) continue;
    for (const spec of list) {
      const card = el("section", { className: "card" });
      card.dataset.id = spec.id;
      card.append(cardHead(spec));
      if (openCard === spec.id) {
        card.classList.add("open");
        card.append(cardBody(spec));
      }
      pipEl.append(card);
    }
  }
  if (pipModules.some((spec) => spec.addon)) {
    const addons = pipModules.filter((spec) => spec.addon);
    pipEl.append(sectionHead("addons", "addon", "CLUSTER ADD-ONS", "ONE STACK EACH", addons));
    if (!foldedSections.has("addons")) {
      pipEl.append(el("div", { id: "addon-tree" }));
      drawAddonTree();
    }
  }
  if (!pipTerraform.length) return;
  pipEl.append(sectionHead("terraform", "terraform", "TERRAFORM", "READ-ONLY", pipTerraform));
  if (foldedSections.has("terraform")) return;
  for (const spec of pipTerraform) {
    const card = el("section", { className: "card tf" });
    card.dataset.id = spec.id;
    card.append(cardHead(spec));
    if (openCard === spec.id) {
      card.classList.add("open");
      const body = el("div", { className: "card-body" });
      body.append(noteBlock(spec.note || ""), el("section", { className: "res-block" }, el("div", { className: "res-head" }, iconImg("terraform"), el("b", { textContent: "STATE & OUTPUTS" }), el("span", { id: "tf-state", className: "res-sum tf-state", textContent: "reading state…" })), el("ul", { id: "tf-outputs", className: "lines res-outputs" })), costBlock(spec));
      body.append(commandRows(spec.commands || []));
      card.append(body);
    }
    pipEl.append(card);
  }
  } finally {
    if (danger) pipEl.append(danger);
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

// The cluster the server found (selected context or live EKS stack); "" none.
let pipCluster = "";
const LEGACY_NAME = "cloudspider-up";
const fallbackCluster = () => pipCluster || LEGACY_NAME;
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

// The run pane: a Pip-Boy terminal in the open card. It shows the card's
// own stack: the run going on it or its last run (kept on disk by the
// server), and a refusal stays until the next run instead of flashing for
// one poll.
let runLocal = null;
let runPolledAt = 0;
const runRadioSeen = new Set();

function runCardKey() {
  const params = pipParams();
  return `${openCard}|${params.clusterName || params.name || ""}`;
}

// UNLOCK on a lock plate: pulumi cancel for that stack (server: typed name,
// same origin, a stack a run found locked).
async function pressUnlock(stack, confirmName, button) {
  button.disabled = true;
  const body = await upgradeJson("/api/upgrade/unlock", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ stack, confirmName }),
  });
  noteSpider(body?.error ? `UNLOCK ${stack}: ${body.error}` : `UNLOCK ${stack}: pulumi cancel started`, body?.error ? "fail" : "ok");
  renderRadioPanel();
  if (body?.error) {
    button.disabled = false;
    button.title = `${body.error}${body.hint ? ` · ${body.hint}` : ""}`;
  }
  refreshUpgrade(true);
}

function runPane(id = "pip-run") {
  const pane = el("div", { id, className: "runpane", hidden: true, role: "region", ariaLabel: "stack run" });
  const head = el("div", { className: "run-head" }, el("i", { className: "run-lamp" }), el("b", { className: "run-title" }), el("span", { className: "run-word" }), el("span", { className: "run-time" }));
  const plate = el("div", { className: "run-plate", hidden: true, role: "alert" });
  const offer = el("div", { className: "run-offer", hidden: true });
  const notes = el("ul", { className: "run-notes", hidden: true, role: "status" });
  const steps = el("ol", { className: "run-steps" });
  const out = el("pre", { className: "run-out", tabIndex: 0, ariaLabel: "run log" });
  if (id === "pip-run") out.id = "pip-out";
  out.addEventListener("scroll", () => {
    pane.dataset.stick = out.scrollTop + out.clientHeight >= out.scrollHeight - 8 ? "1" : "0";
  });
  const foot = el("div", { className: "run-foot" }, el("span", { className: "run-busy" }), el("a", { className: "run-log", target: "_blank", rel: "noopener" }));
  pane.append(head, plate, offer, notes, steps, out, foot);
  return pane;
}

function paintRun(body) {
  const pane = pipEl.querySelector("#pip-run");
  if (!pane) return;
  const local = runLocal && runLocal.card === runCardKey() ? runLocal : null;
  const query = new URLSearchParams({ module: openModule() });
  const params = pipParams();
  for (const key of ["clusterName", "name"]) if (params[key]) query.set(key, params[key]);
  const model = drawRun(pane, body, { local, query });
  // A cluster that just came up: CONNECT is one press away.
  const offer = pane.querySelector(".run-offer");
  const cluster = params.clusterName || "";
  const fresh = model.state === "done" && body?.module === "eks" && body?.action === "up" && openModule() === "eks";
  const want = fresh && connectState.get(cluster)?.state && !["connected"].includes(connectState.get(cluster).state);
  offer.hidden = !want;
  if (want && offer.dataset.cluster !== cluster) {
    offer.dataset.cluster = cluster;
    const press = el("button", { type: "button", className: "cmd", textContent: "CONNECT NOW" });
    press.addEventListener("click", () => startConnect(cluster, "connect"));
    offer.replaceChildren(el("span", { textContent: `${cluster} is up. Connect kubectl and Cloud Spider to it (viewer role, read-only).` }), press);
  }
}

// One run, drawn into a pane (the Stacks card's or the Cluster view's).
function drawRun(pane, body, { local = null, query = null } = {}) {
  const model = runModel(body, { local, polledAt: runPolledAt, now: Date.now() });
  const busy = pane.querySelector(".run-busy");
  pane.hidden = !model.show && !model.busy;
  pane.dataset.state = model.state;
  if (busy) busy.textContent = model.busy || "";
  if (!model.show) {
    for (const part of pane.querySelectorAll(".run-head, .run-plate, .run-notes, .run-steps, .run-out, .run-log")) part.hidden = true;
    return model;
  }
  for (const part of pane.querySelectorAll(".run-head, .run-steps, .run-out")) part.hidden = false;
  pane.querySelector(".run-lamp").className = `run-lamp ${model.lamp}`;
  pane.querySelector(".run-title").textContent = model.title;
  pane.querySelector(".run-word").textContent = model.fromDisk ? `${model.word} · LAST RUN` : model.word;
  pane.querySelector(".run-time").textContent = model.elapsed;
  const steps = pane.querySelector(".run-steps");
  steps.replaceChildren(...model.steps.map((step) => el("li", { className: step.status }, el("span", { className: "mark", textContent: step.mark }), el("code", { textContent: step.text.replace(/ --non-interactive/g, "") }))));
  steps.hidden = !model.steps.length;
  const plate = pane.querySelector(".run-plate");
  plate.hidden = !model.plate;
  if (model.plate) {
    const parts = [el("div", { className: "plate-title", textContent: model.plate.title })];
    if (model.plate.step) parts.push(el("div", { className: "plate-step", textContent: `at: ${model.plate.step.replace(/ --non-interactive/g, "")}` }));
    parts.push(el("pre", { className: "plate-lines", textContent: model.plate.lines.join("\n") }));
    if (model.plate.hint) parts.push(el("p", { className: "plate-hint" }, el("b", { textContent: "WHAT TO DO " }), document.createTextNode(model.plate.hint)));
    if (model.plate.command) {
      const copy = el("button", { type: "button", className: "cmd copy", textContent: "COPY", title: "copy the command to run it in a terminal" });
      copy.addEventListener("click", () => copyCommand(model.plate.command, copy));
      parts.push(el("div", { className: "cmdrow plate-cmd" }, el("span", { className: "lbl", textContent: "BY HAND" }), el("code", { textContent: model.plate.command }), copy));
    }
    // Locked by a live run or another computer: UNLOCK, with the stack's
    // name typed (the server checks it too).
    if (model.plate.unlock) {
      const stack = model.plate.unlock;
      const typed = el("input", { className: "confirm-name", autocomplete: "off", placeholder: `type ${stack}`, ariaLabel: `type ${stack} to remove its lock` });
      const press = el("button", { type: "button", className: "cmd danger", textContent: "UNLOCK", title: `pulumi cancel --stack ${stack}: removes the stack's lock. Only when no pulumi runs on it anywhere.` });
      press.disabled = true;
      typed.addEventListener("input", () => {
        press.disabled = typed.value.trim() !== stack;
      });
      press.addEventListener("click", () => pressUnlock(stack, typed.value.trim(), press));
      parts.push(el("div", { className: "cmdrow plate-unlock" }, el("span", { className: "lbl", textContent: "UNLOCK" }), typed, press));
    }
    plate.replaceChildren(...parts);
  }
  const notes = pane.querySelector(".run-notes");
  if (notes) {
    notes.hidden = !model.notes?.length;
    notes.replaceChildren(...(model.notes || []).map((note) => {
      const item = el("li", { className: `run-note ${note.status}` }, el("b", { textContent: note.status === "warn" ? "NOTE " : "" }), document.createTextNode(note.text));
      if (note.command) {
        const copy = el("button", { type: "button", className: "cmd copy", textContent: "COPY", title: "copy the command to run it in a terminal" });
        copy.addEventListener("click", () => copyCommand(note.command, copy));
        item.append(el("div", { className: "cmdrow" }, el("span", { className: "lbl", textContent: "BY HAND" }), el("code", { textContent: note.command }), copy));
      }
      return item;
    }));
  }
  const out = pane.querySelector(".run-out");
  if (out.textContent !== model.log) {
    out.textContent = model.log;
    if (pane.dataset.stick !== "0" || pane.dataset.runId !== model.id) out.scrollTop = out.scrollHeight;
  }
  pane.dataset.runId = model.id;
  const link = pane.querySelector(".run-log");
  link.hidden = !model.logPath || !query;
  if (model.logPath && query) {
    link.href = `/api/upgrade/log?${query}`;
    link.textContent = `log: ${model.logPath}`;
  }
  for (const line of noteLines(model)) {
    if (runRadioSeen.has(line.key)) continue;
    runRadioSeen.add(line.key);
    if (noteSpider(line.text, line.status)) renderRadioPanel();
  }
  const radio = radioLine(model);
  if (radio && !runRadioSeen.has(radio.key)) {
    runRadioSeen.add(radio.key);
    if (noteSpider(radio.text, radio.status)) renderRadioPanel();
  }
  return model;
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
  runPolledAt = Date.now();
  upgradeRunning = Boolean(body?.running);
  paintRun(body);
}

let upgradeRunning = false;
let upgradeSeq = 0;

// Any answer, even a 500 or no answer at all, is JSON with an error.
async function upgradeJson(url, init) {
  try {
    const response = await fetch(url, init);
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      return { error: `the server answered ${response.status} without JSON${text ? `: ${text.slice(0, 160)}` : ""}` };
    }
  } catch (failure) {
    return { error: `the page failed: the server did not answer (${failure?.message || "no network"})` };
  }
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
  if (openModule() === "eks" && (fresh || upgradeTicks % 10 === 0)) {
    if (fresh) refreshLive(false);
    refreshConnect(fresh);
    refreshBundle(fresh);
  }
  // Which stack to watch: the cluster (or name) typed in the card.
  const params = pipParams();
  for (const key of ["clusterName", "name"]) if (params[key]) query.set(key, params[key]);
  // Only the newest answer paints: an older poll for the name that was in
  // the field before must not paint its cluster over the new one.
  const seq = ++upgradeSeq;
  const card = runCardKey();
  const body = await upgradeJson(`/api/upgrade?${query}`);
  if (seq !== upgradeSeq || card !== runCardKey()) return;
  paintUpgrade(body);
}

async function postUpgrade(action) {
  const spec = openSpec();
  if (!spec) return;
  if (sample && action === "preview") {
    runLocal = null;
    const body = samplePreview(spec.id, spec.title);
    noteSpider(`PREVIEW ${spec.title} (sample): ${body.counts.create} to create, ${body.counts.update} to update, ${body.counts.replace} to replace${body.blocked ? ", 1 blocked" : ""}`, "ok");
    renderRadioPanel();
    paintRun(body);
    return;
  }
  if (sample) {
    const line = upgradeSpiderLine({ action, title: spec.title, sample: true });
    noteSpider(line.text, line.status);
    renderRadioPanel();
    runLocal = null;
    paintRun({ state: "refused", action, stack: "sample", error: line.text, hint: "Switch SAMPLE off to run stacks against the account.", lines: [] });
    return;
  }
  runLocal = null;
  const values = pipParams();
  const problem = spec.parameters.map((parameter) => numberProblem(parameter, values[parameter.name])).find(Boolean);
  if (problem && action !== "destroy") {
    const where = spec.id === "eks" ? " (stacks.eks.maxNodes in cloudspider.yaml sets the most)" : "";
    runLocal = { error: `${problem}${where}`, hint: "Fix the field; nothing ran.", action, at: Date.now(), card: runCardKey() };
    paintUpgrade({ action, stack: "", lines: [] });
    return;
  }
  let replaceNodeGroup = false;
  if (spec.id === "eks" && action === "up") {
    const warn = liveLine(liveState.get(values.clusterName || ""), values).warn;
    if (warn) {
      if (!window.confirm(`${warn}.\n\nNew nodes come up and every pod on the old ones restarts. RUN anyway?`)) return;
      replaceNodeGroup = true;
    }
  }
  const body = await upgradeJson("/api/upgrade", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ module: spec.id, action, params: pipParams(), ...(replaceNodeGroup ? { replaceNodeGroup: true } : {}), ...(spec.id === "eks" && action === "up" && bundleWith ? { withAddons: bundlePicked(pipParams().clusterName || ""), confirmKubeconfig: window.confirm(`RUN with add-ons CONNECTs ${pipParams().clusterName || "the cluster"} first: it writes kube context ${pipParams().clusterName || "<cluster>"}-viewer (read-only) to your kubeconfig after a backup; your current context is kept. OK? (Cancel: the add-ons wait until you press CONNECT.)`) } : {}) }),
  });
  const line = upgradeSpiderLine({ action, title: spec.title, response: body });
  noteSpider(line.text, line.status);
  renderRadioPanel();
  if (body?.error) console.warn(`[stacks] ${action} ${spec.id}: ${body.error}${body.hint ? `\nhint: ${body.hint}` : ""}`);
  // A refusal the server did not keep (it could not be reached) stays
  // here until the next press.
  const kept = body?.state === "refused" && body.stack;
  if (body?.error && !kept) runLocal = { error: body.error, hint: body.hint || "", action, at: Date.now(), card: runCardKey() };
  paintUpgrade(body?.error && !kept ? { action, stack: body.stack || "", lines: [] } : body);
  refreshUpgrade(true);
  if (spec.addon) setTimeout(() => pullAddons(true), 1500);
}

// ---- ADD-ONS bundle (addon-bundle.js on the server) ----
// The EKS card's checklist: tick add-ons, see their cost and pod slots and
// the cluster's free slots, INSTALL SELECTED (one confirm, one run).

function bundleBlock() {
  const block = el("section", { id: "pip-bundle", className: "bundle", ariaLabel: "add-ons for this cluster" });
  block.append(el("div", { className: "bhead" }, el("b", { textContent: "ADD-ONS" }), el("span", { className: "bwho" }), el("em", { className: "bsum" })));
  block.append(el("div", { className: "blist", role: "list" }));
  block.append(el("div", { className: "bline" }), el("div", { className: "bhint" }), el("div", { className: "bqueue" }));
  const withBox = el("input", { type: "checkbox", checked: bundleWith });
  withBox.addEventListener("change", () => {
    bundleWith = withBox.checked;
  });
  const install = el("button", { type: "button", className: "cmd", textContent: "install selected", title: "each ticked add-on, in order: preview, then up; stops at the first failure" });
  install.addEventListener("click", () => installBundle());
  block.append(el("div", { className: "bact" }, el("label", { title: "RUN makes the cluster; when it is DONE, CONNECT runs, then these add-ons install" }, withBox, "with add-ons: after RUN is DONE, CONNECT and install these"), install));
  return block;
}

function bundlePicked(cluster) {
  const chosen = bundleChosen.get(cluster);
  if (chosen) return [...chosen];
  return (bundleBody?.cluster === cluster ? bundleBody.items : []).filter((item) => item.selected).map((item) => item.id);
}

async function refreshBundle(force = false) {
  if (!pipOpen || openModule() !== "eks" || sample) return;
  const cluster = pipParams().clusterName || "";
  if (!cluster) return;
  const seq = ++bundleSeq;
  const query = new URLSearchParams({ cluster });
  if (bundleChosen.has(cluster)) query.set("items", [...bundleChosen.get(cluster)].join(","));
  if (force) query.set("fresh", "1");
  const body = await upgradeJson(`/api/addons/bundle?${query}`);
  if (seq !== bundleSeq || (pipParams().clusterName || "") !== cluster) return;
  bundleBody = body;
  paintBundle(body);
}

function paintBundle(body) {
  const block = pipEl.querySelector("#pip-bundle");
  if (!block) return;
  block.querySelector(".bwho").textContent = body?.cluster || "";
  const list = block.querySelector(".blist");
  if (body?.error) {
    list.replaceChildren(el("div", { className: "bhint", textContent: body.error }));
    return;
  }
  const chosen = new Set(bundlePicked(body.cluster));
  const STATE = { installed: "INSTALLED", present: "PRESENT", busy: "BUSY" };
  list.replaceChildren(...(body.items || []).map((item) => {
    // Included with EKS: the EKS stack installs it, not this checklist.
    const box = el("input", { type: "checkbox", checked: item.state === "absent" && !item.included && chosen.has(item.id), disabled: item.state !== "absent" || item.included, ariaLabel: item.title });
    box.addEventListener("change", () => {
      const now = new Set(bundlePicked(body.cluster));
      if (box.checked) now.add(item.id);
      else now.delete(item.id);
      bundleChosen.set(body.cluster, now);
      refreshBundle(false);
    });
    const lacking = item.needs.filter((need) => (body.items || []).find((other) => other.id === need)?.state === "absent");
    const nodes = item.cost.perNode ? `each node it launches ≈ $${item.cost.perNode.toFixed(4)}/h` : "";
    const state = item.included ? `INCLUDED WITH EKS · ${item.state === "absent" ? "not on the cluster: RUN the EKS stack" : item.where || "on the cluster"}` : STATE[item.state] ? `${STATE[item.state]}${item.where ? ` · ${item.where}` : ""}` : [lacking.length ? `needs ${lacking.join(", ")} (installed first)` : "", nodes].filter(Boolean).join(" · ");
    const row = el("div", { className: "brow", role: "listitem", title: `${item.title}: ${item.cost.text}${item.cost.usage.length ? ` (billed by use: ${item.cost.usage.join("; ")})` : ""}` },
      box,
      el("span", { className: "name", textContent: item.title }),
      el("span", { className: "cost", textContent: item.cost.short }),
      el("span", { className: "pods", textContent: `${item.pods} pod${item.pods === 1 ? "" : "s"}` }),
      el("span", { className: "state", textContent: state }));
    row.dataset.state = item.state;
    return row;
  }));
  const plan = body.plan || {};
  block.querySelector(".bsum").textContent = plan.order?.length ? `${plan.order.length} to install · ${plan.hour ? `+$${plan.hour.toFixed(4)}/h` : "no hourly cost"}${plan.perNode ? " (+ Karpenter's nodes)" : ""}` : "";
  const line = block.querySelector(".bline");
  line.textContent = body.line || "";
  line.dataset.tight = plan.free != null && plan.need > plan.free ? "1" : "0";
  const hints = [];
  if (plan.added?.length) hints.push(`added: ${plan.added.map((add) => `${add.id} (${add.for} needs it)`).join(", ")}`);
  if (plan.refusal && plan.order?.length) hints.push(plan.refusal);
  else if (plan.free == null && plan.order?.length) hints.push(body.connected ? "The cluster did not answer; the add-ons that check slots (Kyverno) still check before their up." : "CONNECT the cluster above so Cloud Spider can count its free pod slots.");
  block.querySelector(".bhint").textContent = hints.join(" · ");
  block.querySelector(".bqueue").textContent = body.queued ? `QUEUED · ${body.queued.text}` : "";
  const install = block.querySelector(".bact button");
  install.disabled = !plan.order?.length;
}

async function installBundle() {
  const cluster = pipParams().clusterName || "";
  if (!cluster || sample) return;
  const items = bundlePicked(cluster);
  const planned = await upgradeJson("/api/addons/bundle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cluster, items, plan: true }) });
  if (planned.error) {
    runLocal = { error: planned.error, hint: planned.hint || "", action: "add-ons", at: Date.now(), card: runCardKey() };
    paintUpgrade({ action: "add-ons", stack: "", lines: [] });
    return;
  }
  if (planned.plan?.refusal) {
    runLocal = { error: planned.plan.refusal, hint: "", action: "add-ons", at: Date.now(), card: runCardKey() };
    paintUpgrade({ action: "add-ons", stack: "", lines: [] });
    return;
  }
  if (!window.confirm(planned.confirm)) return;
  runLocal = null;
  const body = await upgradeJson("/api/addons/bundle", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cluster, items }) });
  const line = body.error ? { status: "fail", text: `add-ons on ${cluster}: ${body.error}` } : { status: "ok", text: `installing ${planned.plan.order.length} add-ons on ${cluster}` };
  if (noteSpider(line.text, line.status)) renderRadioPanel();
  const kept = body?.state === "refused" && body.stack;
  if (body.error && !kept) runLocal = { error: body.error, hint: body.hint || "", action: "add-ons", at: Date.now(), card: runCardKey() };
  paintUpgrade(body.error && !kept ? { action: "add-ons", stack: body.stack || "", lines: [] } : body);
  refreshUpgrade(true);
}

// ---- CONNECT (kube-connect.js on the server) ----
// One lamp per EKS cluster: NOT CONNECTED, CONNECTED, NO ACCESS. CONNECT
// runs as a stack run of the cluster's eks stack, so the card's run pane
// shows its commands and its ERROR plate.

const CONNECT_WORD = { connected: "CONNECTED", "not-connected": "NOT CONNECTED", "not-listed": "NOT LISTED", "no-access": "NO ACCESS", "no-cluster": "NOT UP", "clash-same": "FOUND", outside: "NOT CONNECTED", error: "CANNOT CONNECT" };

function connectRow(id) {
  const row = el("div", { id, className: "connect-row", hidden: true, role: "group", ariaLabel: "kube connection" });
  row.append(el("i", { className: "lamp" }), el("span", { className: "what" }), el("span", { className: "act" }), el("span", { className: "hint" }));
  return row;
}

function paintConnect(row, status, { onPress } = {}) {
  if (!row) return;
  row.hidden = !status;
  if (!status) return;
  row.dataset.state = status.state;
  const word = CONNECT_WORD[status.state] || status.state.toUpperCase();
  const what = status.state === "connected" ? `${word} · ${status.context}` : ["no-cluster", "clash-same"].includes(status.state) ? `${word} · ${status.text}` : status.state === "error" ? status.text : `${word}${status.context ? ` · ${status.context}` : ""}`;
  row.querySelector(".what").textContent = what;
  row.querySelector(".hint").textContent = status.hint || "";
  const act = row.querySelector(".act");
  const buttons = [];
  const button = (label, action, title) => {
    const b = el("button", { type: "button", className: `cmd${action === "disconnect" ? " danger" : ""}`, textContent: label, title });
    b.addEventListener("click", () => (onPress || startConnect)(status.cluster, action));
    buttons.push(b);
  };
  if (["not-connected", "not-listed"].includes(status.state)) button("CONNECT", "connect", `aws eks update-kubeconfig … --alias ${status.alias} (writes ~/.kube/config only)`);
  if (status.state === "no-access") button("CHECK AGAIN", "connect", "run CONNECT again: nothing is rewritten, the access check runs again");
  if (status.state === "clash-same") button("USE IT", "adopt", `one GET with ${status.adopt}; if it can read ${status.cluster}, Cloud Spider lists it (the kubeconfig is not touched)`);
  if (status.state === "connected" && status.ours) button("DISCONNECT", "disconnect", `remove ${status.alias} from ~/.kube/config and from Cloud Spider`);
  act.replaceChildren(...buttons);
}

// ---- LIVE (GET /api/upgrade/live): the EKS card's fields as the stack has
// them, so RUN never changes the instance type (a node group replace) or the
// node count by accident. Filled once per cluster; typing wins after that.
const liveState = new Map();
let liveSeq = 0;
// Values a SCORE suggestion asks for, set after the live fill (once).
let liveWant = null;

function applyLiveWant() {
  const cluster = pipParams().clusterName || "";
  const card = pipEl.querySelector(".card.open");
  if (!liveWant || liveWant.cluster !== cluster || !card) return;
  for (const [name, value] of Object.entries(liveWant.values)) {
    const field = card.querySelector(`[name="${name}"]`);
    if (!field) continue;
    field.value = value;
    pipKept.eks = { ...(pipKept.eks || {}), [name]: value };
    field.dispatchEvent(new Event("input"));
  }
  liveWant = null;
  repriceCard(openSpec());
}

async function refreshLive(force = false) {
  if (!pipOpen || openModule() !== "eks" || sample) return;
  const cluster = pipParams().clusterName || "";
  if (!cluster) return;
  if (!force && liveState.has(cluster)) {
    applyLiveWant();
    return paintLive();
  }
  const seq = ++liveSeq;
  const live = await upgradeJson(`/api/upgrade/live?${new URLSearchParams({ module: "eks", clusterName: cluster })}`);
  if (seq !== liveSeq || (pipParams().clusterName || "") !== cluster) return;
  const first = !liveState.has(cluster);
  liveState.set(cluster, live);
  const card = pipEl.querySelector(".card.open");
  if (card && (first || force) && !live?.error) {
    // Every field the stack saved (vpcCidr, maxPods, logs...), not only the
    // node group's: PREVIEW and RUN then start from what the stack runs.
    for (const name of Object.keys(live?.values || {})) {
      if (name === "clusterName") continue;
      const value = live?.values?.[name];
      const field = card.querySelector(`[name="${name}"]`);
      if (!value || !field || field.value === value) continue;
      field.value = value;
      pipKept.eks = { ...(pipKept.eks || {}), [name]: value };
      field.dispatchEvent(new Event("input"));
    }
    repriceCard(openSpec());
  }
  applyLiveWant();
  paintLive();
}

function paintLive() {
  const row = pipEl.querySelector("#pip-live");
  if (!row) return;
  const line = liveLine(liveState.get(pipParams().clusterName || ""), pipParams());
  row.hidden = !line.text && !line.version;
  row.querySelector(".live-what").textContent = line.text;
  row.querySelector(".live-warn").textContent = [line.warn, line.version].filter(Boolean).join(" · ");
}

async function refreshConnect(force = false) {
  if (!pipOpen || openModule() !== "eks" || sample) return;
  const cluster = pipParams().clusterName || "";
  if (!cluster) return;
  const seq = ++connectSeq;
  if (!force && connectState.has(cluster)) paintConnect(pipEl.querySelector("#pip-connect"), connectState.get(cluster));
  const status = await upgradeJson(`/api/kube/connect?cluster=${encodeURIComponent(cluster)}`);
  if (seq !== connectSeq || (pipParams().clusterName || "") !== cluster) return;
  connectState.set(cluster, status);
  paintConnect(pipEl.querySelector("#pip-connect"), status);
}

// CONNECT / DISCONNECT from anywhere: the run goes to the cluster's EKS
// card (opened on that cluster) and, in the Cluster view, to its strip.
async function startConnect(cluster, action = "connect") {
  if (sample) return;
  if (action === "disconnect" && !window.confirm(`Remove kube context ${cluster}-viewer from ~/.kube/config and from Cloud Spider? (a backup is kept)`)) return;
  const post = (extra = {}) => upgradeJson("/api/kube/connect", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cluster, action, ...extra }),
  });
  let body = await post();
  // CONNECT that writes the kubeconfig: the server says exactly what, and
  // nothing happens without this yes.
  if (body.needsConfirm) {
    if (!window.confirm(body.confirm)) return;
    body = await post({ confirmKubeconfig: true });
  }
  const doing = { connect: "connecting", disconnect: "disconnecting", adopt: "checking the existing context of" }[action] || action;
  const line = body.error ? { status: "fail", text: `${action === "adopt" ? "use it" : action} ${cluster}: ${body.error}` } : { status: "ok", text: `${doing} ${cluster}` };
  if (noteSpider(line.text, line.status)) renderRadioPanel();
  connectWatch = { cluster, until: Date.now() + 120_000 };
  if (mode === "cluster") paintConnectStrip(body, cluster);
  if (pipOpen && openModule() === "eks" && (pipParams().clusterName || "") === cluster) {
    if (body.error && !(body.state === "refused" && body.stack)) runLocal = { error: body.error, hint: body.hint || "", action, at: Date.now(), card: runCardKey() };
    paintUpgrade(body.error && !(body.state === "refused" && body.stack) ? { action, stack: body.stack || "", lines: [] } : body);
    refreshUpgrade(true);
  }
}


// While a CONNECT runs: follow it, then read the lamps again.
setInterval(async () => {
  if (!connectWatch || sample) return;
  if (Date.now() > connectWatch.until) {
    connectWatch = null;
    return;
  }
  const { cluster } = connectWatch;
  const run = await upgradeJson(`/api/upgrade?${new URLSearchParams({ module: "eks", clusterName: cluster })}`);
  if (mode === "cluster") paintConnectStrip(run, cluster);
  if (!run.running && ["connect", "disconnect", "use it"].includes(run.action)) {
    connectWatch = null;
    connectState.delete(cluster);
    if (pipOpen) refreshConnect(true);
    if (mode === "cluster") {
      pullConnectStrip(true);
      // The context list may have changed (CONNECT, USE IT, DISCONNECT).
      pullCluster();
    }
  }
}, 1000);

// The Cluster view's EKS strip: every EKS cluster of the account with its
// lamp; a press connects, a connected one switches the view to it.

let connectListing = null;
async function fetchConnectList(force = false) {
  if (!force && Date.now() - connectStripAt < 30_000 && connectStripBody) return connectStripBody;
  if (connectListing) return connectListing;
  connectStripAt = Date.now();
  connectListing = upgradeJson("/api/kube/connect").then((body) => {
    connectStripBody = body;
    for (const item of body.clusters || []) connectState.set(item.cluster, item);
    if (contextsBody && mode === "cluster") renderContexts(contextsBody);
    return body;
  }).finally(() => {
    connectListing = null;
  });
  return connectListing;
}

async function pullConnectStrip(force = false) {
  if (!kubeConnectEl || mode !== "cluster" || sample) {
    if (kubeConnectEl) hideConnectStrip();
    return;
  }
  renderConnectStrip(await fetchConnectList(force));
}

// The map compound's KUBE chip: which EKS cluster the context is, and its
// lamp. Asks the server at most once a minute while compounds are shown.
function kubeChipState(context) {
  if (!connectListing && !sample && Date.now() - connectStripAt > 60_000) fetchConnectList(true).then(() => draw());
  const item = (connectStripBody?.clusters || []).find((entry) => entry.cluster === context) || (connectStripBody?.clusters || []).find((entry) => entry.context === context);
  if (!item) return { label: "KUBE", tone: "unknown", text: `${context}: kube context (no EKS card for it) · click: open the Cluster view`, item: null };
  const tone = { connected: "ok", "no-access": "fail", error: "fail" }[item.state] || (item.state ? "warn" : "unknown");
  return { label: "KUBE", tone, text: `EKS ${item.cluster}: ${item.text}${item.hint ? ` · ${item.hint}` : ""} · click: open its card on Stacks (CONNECT / DISCONNECT)`, item };
}

// The EKS plate's KUBE line: is this cluster in kubectl and Cloud Spider.
function kubeFact(cluster, id) {
  const item = connectState.get(cluster);
  if (!item) {
    fetchConnectList().then(() => {
      if (connectState.has(cluster) && ui.selection?.id === id) {
        setFacts(ui, plateFacts(id));
        renderChrome();
      }
    });
    return { label: "KUBE", text: "checking the kube context", tone: "unknown" };
  }
  const where = "press CONNECT on Stacks › EKS";
  if (item.state === "connected") return { label: "KUBE", text: item.text, tone: "" };
  if (item.state === "no-access") return { label: "KUBE", text: `NO ACCESS · ${item.hint || ""}`.trim(), tone: "fail" };
  if (item.state === "not-connected" || item.state === "not-listed") return { label: "KUBE", text: `NOT CONNECTED · CONNECT: ${where}`, tone: "warn" };
  if (item.state === "clash-same") return { label: "KUBE", text: `NOT CONNECTED · ${item.adopt} found: USE IT on Stacks › EKS or the Cluster view's EKS panel`, tone: "warn" };
  if (item.state === "outside") return { label: "KUBE", text: `NOT CONNECTED · made outside Stacks: ${item.hint || ""}`.trim(), tone: "warn" };
  if (item.state === "no-cluster") return { label: "KUBE", text: `NOT CONNECTED · ${item.text || ""}`.trim(), tone: "warn" };
  return { label: "KUBE", text: item.text || "unknown", tone: "unknown" };
}

async function openEksCard(cluster) {
  if (cluster) pipKept.eks = { ...(pipKept.eks || {}), clusterName: cluster };
  if (!pipOpen) await toggleUpgrade();
  if (!pipModules.some((item) => item.id === "eks")) return;
  openCard = "eks";
  drawPipForm();
  refreshUpgrade(true);
  renderChrome();
}

// Open or folded, remembered (localStorage). Nothing stored: open only when
// a cluster needs attention. A fold by hand stays folded.

function connectWorst(clusters, error) {
  if (error) return "fail";
  const tones = clusters.map((item) => KC_TONE[item.state] || "warn");
  return tones.includes("fail") ? "fail" : tones.includes("warn") ? "warn" : "ok";
}

function connectStripOpen(attention) {
  const stored = readPref(KC_OPEN_KEY, "");
  return stored === "1" || (stored === "" && attention);
}

function setConnectStripOpen(open) {
  writePref(KC_OPEN_KEY, open ? "1" : "0");
  if (connectStripBody) renderConnectStrip(connectStripBody);
}

// The folded chip sits right of the TOPOLOGY / TELEMETRY / OPS buttons (or
// top right when there are neither screens nor contexts), and the context
// switcher keeps clear of it, so it never covers the tabs, node cards or K9S.
function connectChip() {
  if (!kcChip) {
    kcChip = el("button", { type: "button", id: "kube-connect-chip", className: "kc-chip" });
    kcChip.append(el("i"), el("b", { textContent: "EKS" }), el("span"), el("small"));
    kcChip.addEventListener("click", () => setConnectStripOpen(kubeConnectEl.hidden));
    kubeDockEl.append(kcChip);
  }
  return kcChip;
}

function placeConnectChip() {
  if (!kcChip || mode !== "cluster" || kubeDockEl.hidden) {
    kubeCtxEl.style.maxWidth = "";
    kubeCtxEl.classList.remove("below");
    return;
  }
  const room = kubeDockEl.parentElement?.clientWidth || window.innerWidth;
  if (!kubeTabs.hidden) {
    kubeDockEl.style.left = `${kubeTabs.offsetLeft + kubeTabs.offsetWidth + 8}px`;
    kubeDockEl.style.top = `${kubeTabs.offsetTop}px`;
    kubeDockEl.style.right = "auto";
  } else if (kubeCtxEl.hidden) {
    kubeDockEl.style.left = "auto";
    kubeDockEl.style.right = "14px";
    kubeDockEl.style.top = "8px";
  } else {
    kubeDockEl.style.left = "14px";
    kubeDockEl.style.right = "auto";
    kubeDockEl.style.top = "8px";
  }
  const leftSide = kubeDockEl.style.left !== "auto";
  // Not enough room right of the tabs and the EKS chip (a 1024 window): the
  // context switcher drops to its own row instead of covering them.
  const free = room - (kubeDockEl.offsetLeft + kubeDockEl.offsetWidth) - 22;
  kubeCtxEl.style.maxWidth = "";
  const below = leftSide && free < kubeCtxEl.scrollWidth;
  if (kubeCtxEl.classList.contains("below") !== below) {
    kubeCtxEl.classList.toggle("below", below);
    draw();
  }
}

function hideConnectStrip() {
  kubeConnectEl.hidden = true;
  kubeDockEl.hidden = true;
  kubeCtxEl.style.maxWidth = "";
  kubeCtxEl.classList.remove("below");
}

function renderConnectStrip(body) {
  // EKS CONNECT needs the aws module (modules.js); k8s-only has no EKS list.
  if (mode !== "cluster" || sample || clusterScreen !== "topology" || (modulesVisible && !modulesVisible.includes("aws")) || kubeEmpty.isShown()) {
    hideConnectStrip();
    return;
  }
  const clusters = body?.clusters || [];
  if (!clusters.length && !body?.error) {
    hideConnectStrip();
    return;
  }
  const ok = clusters.filter((item) => item.state === "connected").length;
  const worst = connectWorst(clusters, body?.error);
  const running = Boolean(kcLog?.state === "running");
  const open = running || connectStripOpen(worst !== "ok");
  const chip = connectChip();
  chip.dataset.tone = worst;
  chip.setAttribute("aria-expanded", String(open));
  chip.title = `${body?.error ? `the EKS clusters did not list: ${body.error}` : `${ok} of ${clusters.length} EKS clusters connected${worst !== "ok" ? "; one needs attention" : ""}`} · click to ${open ? "fold" : "open"} (Esc folds)`;
  chip.querySelector("span").textContent = body?.error ? "!" : `${ok}/${clusters.length}`;
  chip.querySelector("small").textContent = open ? "▴" : "▾";
  kubeDockEl.hidden = false;
  placeConnectChip();
  kubeConnectEl.hidden = !open;
  if (!open) return;
  // Below the screen buttons, the chip and the context switcher (never over
  // them), from the chip's left edge; full width when narrow.
  const bottom = (item) => (item && !item.hidden ? item.offsetTop + item.offsetHeight : 0);
  const top = Math.max(bottom(kubeTabs), bottom(kubeCtxEl), bottom(kubeDockEl), 8) + 6;
  const room = kubeConnectEl.parentElement?.clientWidth || window.innerWidth;
  const narrow = room < 820;
  kubeConnectEl.classList.toggle("narrow", narrow);
  const left = Math.min(kubeDockEl.offsetLeft, Math.max(14, room - 474));
  kubeConnectEl.style.left = narrow ? "" : kubeDockEl.style.left === "auto" ? "" : `${left}px`;
  kubeConnectEl.style.right = narrow || kubeDockEl.style.left === "auto" ? "" : "auto";
  kubeConnectEl.style.top = `${top}px`;
  kubeConnectEl.style.maxHeight = `calc(100% - ${top + 64}px)`;
  const fold = el("button", { type: "button", className: "kc-fold", textContent: "FOLD ▴", title: "fold the EKS panel (Esc)", ariaLabel: "fold the EKS panel" });
  fold.addEventListener("click", (event) => {
    event.stopPropagation();
    setConnectStripOpen(false);
  });
  const head = el("div", { className: "kc-head", role: "button", tabIndex: 0, title: "click to fold (Esc)" },
    el("i", { className: `kc-lamp ${worst}` }),
    el("b", { textContent: "EKS" }),
    el("span", { textContent: body?.error ? `the clusters did not list: ${body.error}` : "kube connection · viewer role" }),
    el("em", { textContent: `${ok}/${clusters.length} CONNECTED` }),
    fold);
  head.addEventListener("click", () => setConnectStripOpen(false));
  head.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setConnectStripOpen(false);
    }
  });
  const rows = clusters.map((status) => {
    const row = connectRow("");
    row.removeAttribute("id");
    paintConnect(row, status);
    row.querySelector(".what").textContent = `${status.cluster} · ${row.querySelector(".what").textContent}`;
    if (status.state === "connected" && status.context) {
      const go = el("button", { type: "button", className: "cmd", textContent: "VIEW", title: `show ${status.context} in the Cluster view` });
      go.addEventListener("click", () => setClusterContext(status.context));
      row.querySelector(".act").prepend(go);
    }
    return row;
  });
  const body2 = el("div", { className: "kc-body" }, ...rows);
  if (kcLog) body2.append(kcLog.wrap);
  kubeConnectEl.replaceChildren(head, body2);
}

// The CONNECT log in the panel: a bar that folds it; open while it runs or
// when it failed, folded by itself once it is DONE.
function connectLog() {
  if (kcLog) return kcLog;
  const bar = el("button", { type: "button", className: "kc-logbar" });
  const pane = runPane("kube-connect-run");
  const wrap = el("div", { className: "kc-log" }, bar, pane);
  kcLog = { wrap, bar, pane, open: true, state: "", action: "connect" };
  bar.addEventListener("click", () => {
    kcLog.open = !kcLog.open;
    paintConnectLog();
  });
  return kcLog;
}

function paintConnectLog() {
  if (!kcLog) return;
  const word = { running: "RUNNING", done: "DONE", failed: "FAILED", refused: "REFUSED" }[kcLog.state] || "";
  kcLog.bar.textContent = `${String(kcLog.action || "connect").toUpperCase()} LOG${word ? ` · ${word}` : ""} ${kcLog.open ? "▴" : "▾"}`;
  kcLog.bar.dataset.state = kcLog.state;
  kcLog.bar.setAttribute("aria-expanded", String(kcLog.open));
  kcLog.pane.hidden = !kcLog.open;
}

function paintConnectStrip(run, cluster) {
  if (!kubeConnectEl) return;
  const log = connectLog();
  const local = run?.error && !(run.state === "refused" && run.stack) ? { error: run.error, hint: run.hint || "", action: "connect", at: Date.now() } : null;
  const state = local ? "failed" : run?.running ? "running" : run?.state || (run?.error ? "failed" : "done");
  if (state !== log.state) {
    // Open while it runs or when it went wrong; DONE folds it.
    log.open = state !== "done";
    log.state = state;
  }
  log.action = run?.action || "connect";
  runPolledAt = Date.now();
  drawRun(log.pane, local ? { action: "connect", stack: run.stack || cluster, lines: [] } : run, { local, query: new URLSearchParams({ module: "eks", clusterName: cluster }) });
  paintConnectLog();
  if (connectStripBody) renderConnectStrip(connectStripBody);
  else if (!log.wrap.isConnected) kubeConnectEl.append(log.wrap);
}

// Esc folds the open panel (unless K9S or a field has the key).
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || mode !== "cluster" || !kubeConnectEl || kubeConnectEl.hidden) return;
  const t = event.target;
  if (k9sEl.contains(t) || (!k9sEl.hidden && !kubeConnectEl.contains(t))) return;
  if (t && !kubeConnectEl.contains(t) && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
  setConnectStripOpen(false);
});

async function toggleUpgrade() {
  pipOpen = !pipOpen;
  renderChrome();
  if (!pipOpen) return;
  if (!pipModules.length) {
    pipEl.replaceChildren(el("p", { className: "quiet pip-reading", textContent: "READING THE STACKS… (pulumi, can take a few seconds)" }));
    const body = await fetch("/api/upgrades").then((response) => response.json()).catch(() => ({}));
    pipModules = body.modules || [];
    pipCluster = body.currentCluster || "";
    pipTerraform = body.terraform || [];
    pipCurrentCluster = body.currentCluster || "";
  }
  drawPipForm();
  refreshUpgrade(true);
  pullStackStates();
  pullLastRuns();
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
  markHistory();
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
  if (settingsApi?.isOpen()) {
    // Settings closes on its own Escape when the key is inside it; this is
    // the gear pressed and the focus still outside (render not back yet).
    settingsApi.setOpen(false);
  } else if (terminal.isOpen()) {
    if (terminal.isRunning()) return;
    terminal.setOpen(false);
    askTab.focus();
  } else if (learnView.isOpen()) {
    learnView.setOpen(false);
    document.querySelector("#learn-key").focus();
  } else if (scoreView.isOpen()) {
    markHistory();
    scoreView.setOpen(false);
    document.querySelector("#score-key").focus();
  } else if (pipOpen) {
    toggleUpgrade();
    upgradeButton.focus();
  } else if (mode === "cluster" && clusterSelected) {
    clusterSelected = null;
    showPod(null);
    draw();
  } else if (mode === "map" && ui.selection) {
    // Escape closes the plate; a pending Y/N goes with it, as N would.
    if (document.activeElement === canvas) mapSay.textContent = "plate closed.";
    clickGround(ui);
    renderChrome();
    draw();
  } else return;
  event.preventDefault();
});

upgradeButton.addEventListener("click", () => {
  markHistory();
  // One side panel at a time, as the LEARN key already does for Stacks.
  if (!pipOpen && learnView.isOpen()) learnView.setOpen(false);
  if (!pipOpen && scoreApi?.isOpen()) scoreApi.setOpen(false);
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

// The stations are a listbox: one tab stop, Up/Down/Home/End tune (the
// selection follows focus), and focus stays on the tuned row through the
// re-render.
radioEl.addEventListener("keydown", (event) => {
  const step = { ArrowDown: 1, ArrowUp: -1, Home: -Infinity, End: Infinity }[event.key];
  if (step === undefined || !stations.length) return;
  event.preventDefault();
  station = Math.max(0, Math.min(stations.length - 1, station + step));
  renderChrome();
  const row = radioEl.querySelector(`li[data-index="${station}"]`);
  row?.focus();
  row?.scrollIntoView({ block: "nearest" });
});

// Morning cards are buttons: press one to read its whole sentence and, when
// it names something on the map, open that thing's plate. A PODS card opens
// Cluster.
function pressMorning(li) {
  // A card opens its popup, nothing else: no plate, no STOP/START Y/N.
  openMorningCard(li.id.startsWith("m-pods-") ? li.id : li.id.replace(/^m-/, ""), li);
}

// ---- MORNING POPUP (morning-cards.js): the whole story of one card ----
const morningModal = document.querySelector("#m-modal");
let morningReport = null;
let morningOpener = null;
function closeMorningCard() {
  if (morningModal.open) morningModal.close();
}
function morningShowOnMap(id) {
  if (mode !== "map") return;
  const placed = placedMap();
  const building = buildingAt(placed, 0, 0, id);
  const fixture = building ? null : fixtureAt(placed, 0, 0, id);
  if (building) openBuilding(building, { ask: false });
  else if (fixture) openFixture(fixture);
  else return;
  scrollMapTo(building || fixture);
  mapFocusKey = `${building ? "building" : "fixture"}:${id}`;
  mapSay.textContent = `${ui.selection?.name || id} plate is open. Escape closes it.`;
}
function openMorningCard(name, li) {
  const line = morningReport?.[name] || { status: "unknown", text: "not checked." };
  const label = li?.querySelector("b")?.textContent || "";
  const d = cardDetail(name, line, { logs: logNight, label: label.replace(/^PODS · /, "") });
  morningOpener = li || null;
  const head = vel("header", `mm-head ${d.status}`);
  const close = vel("button", "cmd mm-close", "✕ CLOSE");
  close.type = "button";
  close.addEventListener("click", closeMorningCard);
  head.append(vel("b", "", d.title), vel("span", "mm-sum", d.summary), close);
  const list = vel("ul", "mm-rows");
  for (const row of d.rows) {
    const item = vel("li", "mm-row");
    const when = vel("time", "", row.time ? hhmm24(row.time) : "");
    if (row.time) when.dateTime = new Date(row.time).toISOString();
    item.append(when, vel("b", "", row.who || ""), vel("span", "", row.text));
    list.append(item);
  }
  const acts = vel("div", "mm-actions");
  for (const a of d.actions) {
    const btn = vel("button", "cmd", a.label);
    btn.type = "button";
    btn.addEventListener("click", () => {
      closeMorningCard();
      if (a.kind === "map") morningShowOnMap(a.focus);
      else if (a.kind === "investigate") logErrorsView.open();
      else if (a.kind === "cluster") { markHistory(); if (mode !== "cluster") enterCluster(); }
    });
    acts.append(btn);
  }
  morningModal.replaceChildren(head, list, acts);
  morningModal.showModal();
  close.focus();
}
morningModal.addEventListener("click", (event) => { if (event.target === morningModal) closeMorningCard(); });
// Esc closes the popup only: the page's other Escape handlers (plates,
// STACKS, panels) do not see it.
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || !morningModal.open) return;
  event.stopImmediatePropagation();
  event.preventDefault();
  closeMorningCard();
}, true);
morningModal.addEventListener("close", () => { morningOpener?.focus?.(); morningOpener = null; });

morningEl.addEventListener("click", (event) => {
  const li = event.target.closest(".m-line");
  if (li) pressMorning(li);
});
morningEl.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  const li = event.target.closest(".m-line");
  if (!li || event.target !== li) return;
  event.preventDefault();
  pressMorning(li);
});

lbSelect.addEventListener("change", () => {
  urlLb = "";
  markHistory();
  hostInput.value = "";
  syncUrl();
  pathSelected = null;
  pullPath();
});

hostInput.addEventListener("change", () => {
  markHistory();
  syncUrl();
  pathSelected = null;
  pullPath();
});

setInterval(() => {
  if (mode === "path") pullPath();
  if (mode === "cluster") pullCluster();
}, 15_000);

// Live while a run goes (every second), every two seconds otherwise.
let upgradeTicks = 0;
setInterval(() => {
  upgradeTicks += 1;
  if (pipOpen && openCard && (upgradeRunning || upgradeTicks % 2 === 0)) refreshUpgrade(false);
}, 1000);

setInterval(() => {
  pullKubeRadio();
  pullMapKube();
  pullKubeHealth();
}, 30_000);
setTimeout(pullKubeHealth, 2500);
// The cluster layer on the map: as soon as the first /api/view answer has
// painted (progressive), or at 1.5 s, whichever is first; once.
let mapKubeKicked = false;
function kickMapKube() {
  if (mapKubeKicked) return;
  mapKubeKicked = true;
  pullMapKube();
}
setTimeout(kickMapKube, 1500);
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

// The bundled Share Tech Mono arrives after the first frames (font-display:
// swap). Canvas text drawn before it used the fallback; redraw once it is in.
document.fonts?.load?.('bold 14px "Share Tech Mono"').then(() => {
  vaultPageShown = "";
  renderVaultPage();
  renderChrome();
  draw();
  if (!kubeTele.hidden) paintTelemetry();
}).catch(() => {});

window.addEventListener("resize", () => {
  draw();
  if (!kubeTele.hidden) paintTelemetry();
  if (!radioPanel.hidden) drawScope(scope, reducedMotion ? 0 : animTime, stations.length);
});

setInterval(() => {
  pull({ tick: true });
}, PULL_EVERY);

// The overview reads the bill once, when the first live pull has a place
// (Overview plan R2/T2), then the server's six-hour cache. The two-second
// pull itself never asks for it.
pull().then(() => {
  kickMapKube();
  if (place && !sample) queueSpend();
});

// cloudspider.yaml (/api/config): a bare URL opens on ui.defaultView, and a
// surface switched off under features is not offered (the server refuses it
// too). Then a reload (or a pasted link) comes back to the view and panels
// in the hash.
// Theme and the effective config: the gear opens settings (settings-view.js).
// Canvases keep the Pip palette in phase 1; a switch repaints them once the
// page's colours around them have changed.
settingsApi = createSettings({
  root: document.querySelector("#settings"),
  button: document.querySelector("#settings-key"),
  storage: (() => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  })(),
  onTheme: () => requestAnimationFrame(() => draw()),
  onModules: (visible) => applyModules(visible),
});
// Modules (modules.js): the tab or key of a module that is off at the server
// or hidden in this browser is not offered. Cost is the CAPS gauge.
const MODULE_UI = { network: "#path", kubernetes: "#cluster, #k9s-btn", vaults: "#tab-vaults", radio: "#tab-radio", stacks: "#upgrade", learn: "#learn-key", score: "#score-key", ask: "#ask" };
function settingsStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
function applyModules(visible) {
  modulesVisible = visible;
  for (const [id, sel] of Object.entries(MODULE_UI)) {
    for (const node of document.querySelectorAll(sel)) node.hidden = !visible.includes(id);
  }
  tabMap.hidden = !visible.includes("map") && !visible.includes("kubemap");
  if (!visible.includes("cost")) document.querySelector("#spend").hidden = true;
  const regionLabel = document.querySelector("#region")?.closest("label");
  if (regionLabel) regionLabel.hidden = !visible.includes("aws");
  document.documentElement.dataset.modules = visible.join(" ");
}
let pageConfig = null;
fetch("/api/config")
  .then((response) => response.json())
  .catch(() => null)
  .then((body) => {
    pageConfig = body?.config || null;
    if (body?.modules?.enabled) {
      const visible = visibleModules(body.modules.enabled, readHidden(settingsStorage()));
      applyModules(visible);
      // No map: a bare URL opens on the first view that is on.
      if (!visible.includes("map") && !visible.includes("kubemap") && !location.hash) {
        const first = ["cluster", "path", "vaults"].find((v) => visible.includes({ cluster: "kubernetes", path: "network", vaults: "vaults" }[v]));
        if (first) history.replaceState(null, "", `${location.pathname}${location.search}#${first}`);
      }
    }
    const features = pageConfig?.features || {};
    if (features.ask === false) askTab.hidden = true;
    if (features.learn === false) document.querySelector("#learn-key").hidden = true;
    if (features.scorecard === false) document.querySelector("#score-key").hidden = true;
    const view = pageConfig?.ui?.defaultView;
    if (!location.hash && view && view !== "map") history.replaceState(null, "", `${location.pathname}${location.search}#${view}`);
  })
  .finally(() => queueUrl());

mountWhere();

// The cluster screens' top bar: sub-tabs on the left, the CONTEXT picker on
// the right. When they would meet, the picker drops to its own row; the
// screens below start under whichever is lower (--kube-top), so neither
// ever covers a toolbar.
function layoutKubeBar() {
  const tabs = document.querySelector("#kube-tabs");
  const ctx = document.querySelector("#kube-ctx");
  const host = tabs?.parentElement;
  if (!tabs || !ctx || !host) return;
  ctx.style.top = "";
  const box = host.getBoundingClientRect();
  const t = tabs.hidden ? null : tabs.getBoundingClientRect();
  let c = ctx.hidden ? null : ctx.getBoundingClientRect();
  if (t && c && c.left < t.right + 12) {
    ctx.style.top = `${Math.round(t.bottom - box.top + 6)}px`;
    c = ctx.getBoundingClientRect();
  }
  const bottom = Math.max(t ? t.bottom : 0, c ? c.bottom : 0) - box.top;
  const top = `${Math.max(44, Math.round(bottom + 8))}px`;
  if (host.style.getPropertyValue("--kube-top") !== top) host.style.setProperty("--kube-top", top);
  // Scrolled topology cards go out of view under the bar instead of
  // sliding beneath the tabs and the CONTEXT switcher.
  const clip = t || c ? `inset(${Math.max(0, Math.round(bottom + box.top - map.getBoundingClientRect().top + 4))}px 0 0 0)` : "";
  if (map.style.clipPath !== clip) map.style.clipPath = clip;
}
{
  const kick = () => requestAnimationFrame(layoutKubeBar);
  window.addEventListener("resize", kick);
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(kick) : null;
  for (const sel of ["#kube-tabs", "#kube-ctx"]) {
    const el = document.querySelector(sel);
    if (!el) continue;
    ro?.observe(el);
    new MutationObserver(kick).observe(el, { attributes: true, attributeFilter: ["hidden"], childList: true });
  }
  kick();
}
