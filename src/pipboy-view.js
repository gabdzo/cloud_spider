// @ts-check
// The Pip-Boy STAT screen (pipboy-model.js) as HTML: STAT / PODS / NET tabs,
// the namespace list (issues first, health 0-10), the selected namespace's
// figure and detail, and a bottom bar of cluster totals. Green or amber
// phosphor through CSS custom properties; both remembered per browser.
import { figureSvg } from "./pipboy-sprites.js";

export const PIP_ON_KEY = "cs.pipboy";
export const PIP_THEME_KEY = "cs.pipboy.theme";
export const PIP_SEL_KEY = "cs.pipboy.ns";

const esc = (/** @type {unknown} */ s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] || c);

export const PIP_CSS = `
#pipboy{--pb-fg:#3cff7a;--pb-dim:#1f8f45;--pb-faint:#0e3b1f;--pb-bg:#04140a;--pb-glow:rgba(60,255,122,.35);--pb-alert:#ff5a4a;--pb-alert-bg:#3a0d08;
 position:absolute;inset:0;z-index:5;overflow:auto;background:var(--pb-bg);color:var(--pb-fg);font:14px/1.35 "Share Tech Mono","Monofonto",ui-monospace,Menlo,Consolas,monospace;text-shadow:0 0 6px var(--pb-glow);display:flex;flex-direction:column;padding:10px 16px 8px;box-sizing:border-box}
#pipboy[data-theme=amber]{--pb-fg:#ffb63c;--pb-dim:#a8701a;--pb-faint:#3d2706;--pb-bg:#140b01;--pb-glow:rgba(255,182,60,.35);--pb-alert:#ff4d6d;--pb-alert-bg:#3a0614}
#pipboy::after{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.28) 0 1px,transparent 1px 3px);mix-blend-mode:multiply}
#pipboy button{font:inherit;color:inherit;background:none;border:1px solid transparent;cursor:pointer;text-shadow:inherit;padding:1px 8px}
#pipboy .pb-top{display:flex;align-items:flex-end;gap:2px;border-bottom:2px solid var(--pb-fg);padding-bottom:2px;flex-wrap:wrap}
#pipboy .pb-tab{font-size:18px;letter-spacing:1px;padding:0 12px}
#pipboy .pb-tab[aria-selected=true]{border:2px solid var(--pb-fg);border-bottom-color:var(--pb-bg);margin-bottom:-4px;background:var(--pb-bg)}
#pipboy .pb-title{margin-left:auto;color:var(--pb-dim);font-size:12px;display:flex;gap:8px;align-items:center}
#pipboy .pb-theme{border-color:var(--pb-dim)!important;font-size:11px}
#pipboy .pb-sub{color:var(--pb-dim);font-size:12px;margin:4px 0 6px;text-align:center;letter-spacing:2px}
#pipboy .pb-main{display:grid;grid-template-columns:minmax(220px,36%) 1fr;gap:18px;flex:1;min-height:0}
#pipboy .pb-list{list-style:none;margin:0;padding:0;overflow:auto;outline:none}
#pipboy .pb-row{display:flex;justify-content:space-between;gap:8px;padding:3px 8px;cursor:pointer;border-bottom:1px solid var(--pb-faint)}
#pipboy .pb-row .pb-n{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#pipboy .pb-row[aria-selected=true]{background:var(--pb-fg);color:var(--pb-bg);text-shadow:none}
#pipboy .pb-row.pb-bad:not([aria-selected=true]) .pb-v{color:var(--pb-alert);text-shadow:0 0 6px var(--pb-alert)}
#pipboy .pb-row.pb-bad .pb-n::before{content:"! "}
#pipboy .pb-sys{color:var(--pb-dim)}
#pipboy .pb-detail{overflow:auto;min-width:0}
#pipboy .pb-head{display:flex;gap:16px;align-items:center}
#pipboy .pb-detail p{margin:0}
#pipboy .pb-figbox{display:flex;flex-direction:column;align-items:center;gap:4px;min-width:110px}
#pipboy .pb-fig-broken{color:var(--pb-alert);filter:drop-shadow(0 0 4px var(--pb-alert))}
#pipboy .pb-state{font-size:12px;letter-spacing:2px;border:1px solid currentColor;padding:0 6px}
#pipboy .pb-state.broken{color:var(--pb-alert);background:var(--pb-alert-bg)}
#pipboy .pb-name{font-size:20px;letter-spacing:1px;margin:0;word-break:break-all}
#pipboy .pb-text{margin:0;color:var(--pb-fg);max-width:60ch}
#pipboy h4{margin:10px 0 3px;font-size:12px;letter-spacing:2px;color:var(--pb-dim);border-bottom:1px solid var(--pb-dim);font-weight:normal}
#pipboy .pb-items{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1px 16px}
#pipboy .pb-items.pb-wide{grid-template-columns:1fr}
#pipboy .pb-items li{display:flex;gap:8px;white-space:nowrap;overflow:hidden;min-width:0}
#pipboy .pb-items li span:first-child{overflow:hidden;text-overflow:ellipsis}
#pipboy .pb-items li .pb-r{margin-left:auto;color:var(--pb-dim)}
#pipboy .pb-items li.bad,#pipboy .pb-alert{color:var(--pb-alert);text-shadow:0 0 5px var(--pb-alert)}
#pipboy .pb-items li.bad::before{content:"✖";}
#pipboy .pb-rule{color:var(--pb-dim);padding-left:2ch;white-space:normal}
#pipboy .pb-rule.pb-alert,#pipboy .pb-items li.bad .pb-r{color:var(--pb-alert);text-shadow:none}
#pipboy .pb-badge{border:1px solid currentColor;padding:0 5px;font-size:11px;margin-left:6px}
#pipboy .pb-badge.deny{background:var(--pb-fg);color:var(--pb-bg);text-shadow:none}
#pipboy .pb-bar{display:flex;gap:6px;margin-top:8px}
#pipboy .pb-bar>span{flex:1;background:var(--pb-faint);padding:2px 10px;display:flex;justify-content:space-between;gap:8px;white-space:nowrap}
#pipboy .pb-bar .pb-meter{flex:1;max-width:180px;height:10px;border:1px solid var(--pb-fg);align-self:center;position:relative}
#pipboy .pb-bar .pb-meter i{position:absolute;inset:0 auto 0 0;background:var(--pb-fg)}
#pipboy .pb-empty{margin:auto;text-align:center;color:var(--pb-dim)}
#pipboy .pb-close{border-color:var(--pb-dim)!important}

#pipboy{background:radial-gradient(ellipse at 50% 45%,color-mix(in srgb,var(--pb-fg) 9%,var(--pb-bg)) 0%,var(--pb-bg) 70%,#000 120%);border:3px solid color-mix(in srgb,var(--pb-fg) 30%,#000);border-radius:18px;box-shadow:inset 0 0 60px rgba(0,0,0,.85),inset 0 0 12px var(--pb-glow);margin:4px;inset:0}
#pipboy::before{content:"";position:absolute;inset:0;pointer-events:none;border-radius:16px;background:linear-gradient(transparent 0,rgba(255,255,255,.035) 50%,transparent 100%);background-size:100% 6px;animation:pb-roll 7s linear infinite}
@keyframes pb-roll{from{background-position:0 0}to{background-position:0 100%}}
@media (prefers-reduced-motion:reduce){#pipboy::before{animation:none}}
#pipboy .pb-top{border-bottom:2px solid var(--pb-fg);position:relative;padding-left:14px}
#pipboy .pb-top::before,#pipboy .pb-top::after{content:"";position:absolute;bottom:-2px;width:2px;height:10px;background:var(--pb-fg)}
#pipboy .pb-top::before{left:0}#pipboy .pb-top::after{right:0}
#pipboy .pb-tab{font-size:20px;letter-spacing:2px;font-weight:bold;opacity:.7}
#pipboy .pb-tab[aria-selected=true]{opacity:1;border:0;margin:0;background:none;position:relative}
#pipboy .pb-tab[aria-selected=true]::before{content:"";position:absolute;left:0;right:0;bottom:-4px;height:8px;border:2px solid var(--pb-fg);border-bottom:0;background:var(--pb-bg)}
#pipboy .pb-sub{letter-spacing:3px;color:var(--pb-fg);opacity:.8}
#pipboy .pb-row{font-size:15px;padding:4px 10px;border-bottom:0;margin-bottom:2px}
#pipboy .pb-row[aria-selected=true]{box-shadow:0 0 10px var(--pb-glow)}
#pipboy .pb-row[aria-selected=true] .pb-n::after{content:" ◄";}
#pipboy .pb-fig{filter:drop-shadow(0 0 5px var(--pb-glow))}
#pipboy .pb-figbox{min-width:140px}
#pipboy .pb-name{font-size:24px}
#pipboy .pb-text{border-top:1px solid var(--pb-dim);border-bottom:1px solid var(--pb-dim);padding:4px 0;margin-top:4px}
#pipboy h4{color:var(--pb-fg);opacity:.85;border-bottom:1px solid var(--pb-dim)}
#pipboy .pb-bar>span{background:color-mix(in srgb,var(--pb-fg) 18%,var(--pb-bg));font-weight:bold;letter-spacing:1px;padding:3px 12px}
#pipboy .pb-bar .pb-alert{background:var(--pb-alert-bg)}

#pipboy .pb-gridwrap{position:relative;flex:1;min-height:0;overflow:auto;padding:4px 2px}
#pipboy .pb-entries{display:flex;flex-wrap:wrap;gap:6px 10px;justify-content:center;margin:2px 0 46px;position:relative;z-index:1}
#pipboy .pb-entry{border:1px solid var(--pb-fg);padding:2px 8px;font-size:12px;cursor:pointer;background:var(--pb-bg);box-shadow:0 0 8px var(--pb-glow);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#pipboy .pb-entry.pb-alert{border-color:var(--pb-alert)}
#pipboy .pb-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(176px,1fr));gap:22px 18px;position:relative;z-index:1}
#pipboy .pb-tile{display:grid;grid-template-columns:1fr auto;grid-template-rows:auto auto auto auto;gap:2px 6px;align-items:center;text-align:left;padding:8px 10px 7px!important;border:2px solid color-mix(in srgb,var(--pb-fg) 45%,#000)!important;border-radius:10px;background:radial-gradient(ellipse at 50% 40%,color-mix(in srgb,var(--pb-fg) 12%,var(--pb-bg)),var(--pb-bg) 75%)!important;box-shadow:inset 0 0 18px rgba(0,0,0,.8),0 0 0 1px #000;position:relative;overflow:hidden;min-height:118px}
#pipboy .pb-tile::after{content:"";position:absolute;inset:0;pointer-events:none;background:repeating-linear-gradient(0deg,rgba(0,0,0,.3) 0 1px,transparent 1px 3px)}
#pipboy .pb-tile .pb-tn{font-weight:bold;letter-spacing:1px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#pipboy .pb-tile .pb-th{font-size:26px;font-weight:bold;line-height:1}
#pipboy .pb-tile .pb-fig{grid-row:2/4;align-self:end}
#pipboy .pb-tile .pb-tp{grid-column:2;font-size:11px;justify-self:end}
#pipboy .pb-tile .pb-badge{grid-column:2;justify-self:end;margin:0}
#pipboy .pb-tile .pb-ti{grid-column:1/-1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.85}
#pipboy .pb-tile.broken{border-color:var(--pb-alert)!important;box-shadow:inset 0 0 18px rgba(0,0,0,.8),0 0 10px var(--pb-alert)}
#pipboy .pb-tile.broken .pb-th,#pipboy .pb-tile.hurting .pb-th{color:var(--pb-alert)}
#pipboy .pb-tile.pb-sys{opacity:.6}
#pipboy .pb-tile[aria-pressed=true],#pipboy .pb-tile:focus-visible{outline:2px solid var(--pb-fg);outline-offset:3px;box-shadow:0 0 16px var(--pb-glow)}
#pipboy .pb-tile:hover{border-color:var(--pb-fg)!important}
#pipboy .pb-links{position:absolute;left:0;top:0;pointer-events:none;z-index:2;overflow:visible}
#pipboy .pb-links path{fill:none;stroke:var(--pb-fg);stroke-width:2;filter:drop-shadow(0 0 4px var(--pb-fg))}
#pipboy .pb-links .pb-l-pol{stroke-width:2.5;stroke-dasharray:7 5;animation:pb-flow 1.6s linear infinite}
#pipboy .pb-links .pb-l-in{opacity:.55;stroke-width:1.5}
#pipboy .pb-links .pb-l-in.bad{stroke:var(--pb-alert);opacity:.9}
#pipboy .pb-links circle{fill:var(--pb-fg)}
@keyframes pb-flow{to{stroke-dashoffset:-22}}
@media (prefers-reduced-motion:reduce){#pipboy .pb-links .pb-l-pol{animation:none}}
#pipboy .pb-legend{flex:0 0 auto!important;font-weight:normal!important;gap:6px!important;align-items:center;font-size:11px}
#pipboy .pb-legend i{display:inline-block;width:18px;border-top:2px dashed var(--pb-fg)}
#pipboy .pb-legend i.pb-k-in{border-top-style:solid;opacity:.6}
#pipboy .pb-go{margin:8px 0 2px!important;display:flex;gap:8px}
#pipboy .pb-go button{border:1px solid var(--pb-fg)!important;font-size:12px}
#pipboy .pb-go button:hover{background:var(--pb-fg);color:var(--pb-bg);text-shadow:none}
#pipboy .pb-pol{padding-left:1ch;margin:1px 0}
#pipboy .pb-pol summary{cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--pb-fg)}
#pipboy .pb-pol[open] summary{white-space:normal}
#pipboy .pb-pol .pb-rule{padding-left:3ch;word-break:break-word}
`;

/** @typedef {import("./pipboy-model.js").PipNs} PipNs */

/** "to ns kube-system · k8s-app=kube-dns | … → UDP 53, TCP 53" as "to kube-system · kube-dns :53 +1". */
export function ruleShort(/** @type {string} */ rule) {
  const [who, ports = ""] = rule.split(" → ");
  const peers = who.replace(/kubernetes\.io\/metadata\.name=/g, "").replace(/\b(ns|app|k8s-app|app\.kubernetes\.io\/name)[= ]/g, "").split(" | ");
  const nums = [...new Set((ports.match(/\d+/g) || []))];
  const p = nums.length ? ` :${nums.slice(0, 2).join(",")}${nums.length > 2 ? "…" : ""}` : "";
  const first = peers[0].length > 34 ? `${peers[0].slice(0, 33)}…` : peers[0];
  return `${first}${peers.length > 1 ? ` +${peers.length - 1}` : ""}${p}`;
}

function list(title, /** @type {string[]} */ items, empty, wide = false) {
  return `<h4>${esc(title)}</h4>${items.length ? `<ul class="pb-items${wide ? " pb-wide" : ""}">${items.join("")}</ul>` : `<p class="pb-rule">${esc(empty)}</p>`}`;
}

/** @param {PipNs} ns @param {string} tab */
export function detailHtml(ns, tab) {
  const head = `<div class="pb-head"><div class="pb-figbox">${figureSvg(ns.state, 6)}<span class="pb-state ${ns.state}">${ns.state.toUpperCase()}</span></div><div><h3 class="pb-name">${esc(ns.name)} <small class="pb-sys">${ns.health}/10</small></h3><p class="pb-text">${esc(ns.text)}</p></div></div>`;
  const wl = list("WORKLOADS", ns.workloads.map((w) => `<li class="${w.status === "ok" ? "" : "bad"}"><span>${esc(w.name)}</span><span class="pb-r">${esc(w.kind.toLowerCase())} ${w.have}/${w.want}</span></li>`), "no workloads");
  const issues = ns.issues.length ? `<h4>ISSUES</h4>${ns.issues.map((i) => `<p class="pb-rule pb-alert">✖ ${esc(i)}</p>`).join("")}` : "";
  const sv = list("SERVICES", ns.services.map((s) => `<li class="${s.status === "ok" ? "" : "bad"}"><span>${esc(s.name)}</span><span class="pb-r">${esc(s.type)} ${esc(s.ports)}</span></li>`), "no services");
  const en = list("ENTRY POINTS", ns.entries.map((e) => `<li class="${e.status === "ok" ? "" : "bad"}" title="${esc(e.full)}"><span>${esc(e.host)}</span><span class="pb-r">${esc(e.kind)}${e.target ? ` → ${esc(e.target)}` : ""}</span></li>`), "no entry points: reachable inside the cluster only", true);
  const badge = ns.policy.badge.toUpperCase();
  const np = `<h4>NETWORK POLICIES <span class="pb-badge ${ns.policy.badge}">${esc(badge)}</span></h4>${ns.policy.lines.length ? ns.policy.lines.map((p) => `<details class="pb-pol"><summary><b>${p.deny ? "DENY" : "ALLOW"}</b> ${esc(p.name)} · ${esc(p.rules.map(ruleShort).join("; ") || `selects ${p.selects}`)}</summary><p class="pb-rule">selects ${esc(p.selects)}${p.rules.map((r) => `<br>${esc(r)}`).join("")}</p></details>`).join("") : `<p class="pb-rule">no NetworkPolicy: all traffic in and out is allowed</p>`}`;
  const go = `<p class="pb-go"><button data-topology="${esc(ns.name)}" title="Enter">▶ OPEN IN TOPOLOGY</button> <button data-grid title="Backspace">◄ ALL NAMESPACES</button></p>`;
  if (tab === "pods") return head + go + issues + wl + sv;
  if (tab === "net") return head + go + en + np;
  return head + go + issues + wl + sv + en + np;
}

/** One namespace as a small Pip-Boy screen. @param {PipNs} n @param {boolean} sel */
function tileHtml(n, sel) {
  const top = n.issues[0] || (n.pods ? `all ${n.pods} pod${n.pods === 1 ? "" : "s"} ready` : "no pods");
  return `<button class="pb-tile ${n.state}${n.system ? " pb-sys" : ""}" data-tile="${esc(n.name)}" aria-pressed="${sel}" title="${esc(n.name)}: ${esc(top)}"><span class="pb-tn">${esc(n.name)}</span><span class="pb-th">${n.health}</span>${figureSvg(n.state, 2)}<span class="pb-tp">PODS ${n.ready}/${n.pods}</span><span class="pb-badge ${n.policy.badge}">${esc(n.policy.badge.toUpperCase())}</span><span class="pb-ti${n.state === "healthy" ? "" : " pb-alert"}">${esc(top)}</span></button>`;
}

/** The cluster as a wall of small Pip-Boys, with entry points on top. */
export function gridHtml(/** @type {any} */ model, /** @type {{ selected: string }} */ state) {
  const entries = (model.entries || []).map((/** @type {any} */ e, /** @type {number} */ i) => `<span class="pb-entry${e.status === "ok" ? "" : " pb-alert"}" data-entry="${i}" data-entry-ns="${esc(e.ns)}" title="${esc(e.full)}">${esc(e.kind)} ${esc(e.host)}</span>`).join("");
  return `<div class="pb-gridwrap"><div class="pb-entries">${entries || `<span class="pb-entry pb-sys">no entry points: in-cluster only</span>`}</div><div class="pb-grid">${model.namespaces.map((/** @type {PipNs} */ n) => tileHtml(n, n.name === state.selected)).join("")}</div><svg class="pb-links" aria-hidden="true"></svg></div>`;
}

/** Draws the glowing lines once the tiles are laid out. @param {HTMLElement} el @param {any} model */
export function drawLinks(el, model) {
  const wrap = /** @type {HTMLElement|null} */ (el.querySelector(".pb-gridwrap"));
  const svg = el.querySelector(".pb-links");
  if (!wrap || !svg || !model) return;
  const box = wrap.getBoundingClientRect();
  const at = (/** @type {Element|null} */ node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: r.left - box.left + r.width / 2, y: r.top - box.top + r.height / 2, top: r.top - box.top, bottom: r.bottom - box.top, h: r.height }; };
  const tile = (/** @type {string} */ ns) => at(wrap.querySelector(`[data-tile="${CSS.escape(ns)}"]`));
  const parts = [];
  for (const link of model.links || []) {
    const a = tile(link.from), b = tile(link.to);
    if (!a || !b) continue;
    const ax = a.x + (b.x > a.x ? 24 : -24), bx = b.x + (a.x > b.x ? 24 : -24);
    const my = Math.min(a.top, b.top) - 34;
    parts.push(`<path class="pb-l-pol" d="M${ax} ${a.top} C${ax} ${my} ${bx} ${my} ${bx} ${b.top}"><title>${esc(link.from)} → ${esc(link.to)} ${esc(link.ports.join(", "))} (${esc(link.policies.join(", "))})</title></path><circle class="pb-l-dot" r="3.5" cx="${bx}" cy="${b.top}"/>`);
  }
  wrap.querySelectorAll("[data-entry-ns]").forEach((chip) => {
    const a = at(chip), b = tile(/** @type {HTMLElement} */ (chip).dataset.entryNs || "");
    if (!a || !b) return;
    const bad = chip.classList.contains("pb-alert");
    parts.push(`<path class="pb-l-in${bad ? " bad" : ""}" d="M${a.x} ${a.bottom} C${a.x} ${a.bottom + 40} ${b.x} ${b.top - 40} ${b.x} ${b.top}"/>`);
  });
  svg.setAttribute("width", String(wrap.scrollWidth));
  svg.setAttribute("height", String(wrap.scrollHeight));
  svg.innerHTML = parts.join("");
}

/**
 * @param {ReturnType<typeof import("./pipboy-model.js").pipModel>|null} model
 * @param {{ selected: string, tab: string, theme: string, view?: string, error?: string, loading?: boolean, hutMap?: boolean }} state
 */
export function pipHtml(model, state) {
  const grid = state.view !== "one";
  const tabs = grid ? `<button class="pb-tab" aria-selected="true">CLUSTER</button>` : ["stat", "pods", "net"].map((t) => `<button class="pb-tab" role="tab" data-tab="${t}" aria-selected="${state.tab === t}">${t.toUpperCase()}</button>`).join("");
  const top = `<div class="pb-top" role="tablist">${tabs}<span class="pb-title">${esc(model?.cluster || "")}${model?.context ? ` · ${esc(model.context)}` : ""}<button class="pb-theme" data-theme-toggle title="switch phosphor colour">${state.theme === "amber" ? "AMBER" : "GREEN"}</button><button class="pb-close" data-close title="the old drawn map (huts)">HUT MAP</button></span></div>`;
  if (!model || !model.namespaces.length) return `${top}<p class="pb-empty">${esc(state.error || (state.loading ? "READING CLUSTER…" : "NO NAMESPACES VISIBLE TO THIS CONTEXT"))}</p>`;
  const t = model.totals;
  const pct = t.pods ? Math.round((100 * t.ready) / t.pods) : 100;
  const legend = grid ? `<span class="pb-legend"><i class="pb-k-pol"></i>policy allow <i class="pb-k-in"></i>entry → ns</span>` : "";
  const bar = `<div class="pb-bar"><span>HP · PODS ${t.ready}/${t.pods}<i class="pb-meter"><i style="width:${pct}%"></i></i></span><span>LEVEL · NODES ${t.nodesReady}/${t.nodes}</span><span class="${t.issues ? "pb-alert" : ""}">AP · ISSUES ${t.issues}</span>${legend}</div>`;
  if (grid) return `${top}${gridHtml(model, state)}${bar}`;
  const sel = model.namespaces.find((n) => n.name === state.selected) || model.namespaces[0];
  const rows = model.namespaces.map((n) => `<li class="pb-row${n.state === "healthy" ? "" : " pb-bad"}${n.system ? " pb-sys" : ""}" role="option" data-ns="${esc(n.name)}" aria-selected="${n === sel}"><span class="pb-n">${esc(n.name)}</span><span class="pb-v">${n.health}</span></li>`).join("");
  return `${top}<p class="pb-sub">${state.tab === "stat" ? "NAMESPACES · HEALTH" : state.tab === "pods" ? "WORKLOADS · SERVICES" : "ENTRY POINTS · POLICIES"}</p><div class="pb-main"><ul class="pb-list" role="listbox" tabindex="0" aria-label="namespaces">${rows}</ul><div class="pb-detail">${detailHtml(sel, state.tab)}</div></div>${bar}`;
}

/** @param {Storage|null} store @param {string} key @param {string} fallback */
const pref = (store, key, fallback) => { try { return store?.getItem(key) || fallback; } catch { return fallback; } };
/** @param {Storage|null} store @param {string} key @param {string} value */
const keep = (store, key, value) => { try { store?.setItem(key, value); } catch { /* this page only */ } };

/**
 * The screen's controller: fetches /api/cluster, renders, keys and clicks.
 * The amber tint is set on <html data-tint> so the whole app follows.
 * @param {HTMLElement} el
 * @param {{ load: () => Promise<any>, model: (body: any) => any, onClose: () => void, openTopology?: (ns: string) => void, store?: Storage|null }} io
 */
export function mountPip(el, io) {
  const store = io.store ?? null;
  const state = { selected: pref(store, PIP_SEL_KEY, ""), tab: "stat", view: "grid", theme: pref(store, PIP_THEME_KEY, "green") === "amber" ? "amber" : "green", error: "", loading: true };
  /** @type {any} */
  let model = null;
  let timer = 0;
  if (!document.querySelector("#pipboy-css")) document.head.append(Object.assign(document.createElement("style"), { id: "pipboy-css", textContent: PIP_CSS }));
  const tint = () => { if (state.theme === "amber") document.documentElement.dataset.tint = "amber"; else delete document.documentElement.dataset.tint; };
  tint();
  const render = () => {
    el.dataset.theme = state.theme;
    el.dataset.view = state.view;
    const hadFocus = el.contains(document.activeElement);
    el.innerHTML = pipHtml(model, state);
    if (state.view === "grid") {
      drawLinks(el, model);
      const sel = /** @type {HTMLElement|null} */ (el.querySelector(".pb-tile[aria-pressed=true]"));
      if (hadFocus) (sel || /** @type {HTMLElement|null} */ (el.querySelector(".pb-tile")))?.focus();
    } else {
      const list = /** @type {HTMLElement|null} */ (el.querySelector(".pb-list"));
      if (hadFocus) list?.focus();
      list?.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
    }
  };
  const pull = async () => {
    const body = await io.load().catch((e) => ({ error: e?.message || "the cluster did not answer" }));
    model = body?.diagram ? io.model(body) : model;
    state.error = body?.error && !body?.diagram ? String(body.error) : "";
    state.loading = false;
    if (!el.hidden) render();
  };
  const select = (/** @type {string} */ name) => { state.selected = name; keep(store, PIP_SEL_KEY, name); render(); };
  const zoom = (/** @type {string} */ name) => { state.view = "one"; select(name); };
  const toGrid = () => { state.view = "grid"; render(); };
  el.addEventListener("click", (event) => {
    const t = /** @type {HTMLElement} */ (event.target);
    const tileEl = /** @type {HTMLElement|null} */ (t.closest("[data-tile]"));
    if (tileEl) return zoom(tileEl.dataset.tile || "");
    const chip = /** @type {HTMLElement|null} */ (t.closest("[data-entry-ns]"));
    if (chip) return zoom(chip.dataset.entryNs || "");
    const row = /** @type {HTMLElement|null} */ (t.closest("[data-ns]"));
    if (row) return select(row.dataset.ns || "");
    const tab = /** @type {HTMLElement|null} */ (t.closest("[data-tab]"));
    if (tab) { state.tab = tab.dataset.tab || "stat"; return render(); }
    const topo = /** @type {HTMLElement|null} */ (t.closest("[data-topology]"));
    if (topo) return io.openTopology?.(topo.dataset.topology || "");
    if (t.closest("[data-grid]")) return toGrid();
    if (t.closest("[data-theme-toggle]")) { state.theme = state.theme === "amber" ? "green" : "amber"; keep(store, PIP_THEME_KEY, state.theme); tint(); return render(); }
    if (t.closest("[data-close]")) io.onClose();
  });
  el.addEventListener("keydown", (event) => {
    if (!model?.namespaces?.length) return;
    const names = model.namespaces.map((/** @type {any} */ n) => n.name);
    const at = Math.max(0, names.indexOf(state.selected));
    if (state.view === "grid") {
      const cols = Math.max(1, getComputedStyle(/** @type {Element} */ (el.querySelector(".pb-grid"))).gridTemplateColumns.split(" ").length);
      const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[event.key];
      if (step) { event.preventDefault(); select(names[Math.min(names.length - 1, Math.max(0, at + step))]); }
      else if (event.key === "Enter") { event.preventDefault(); zoom(names[at]); }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      select(names[(at + (event.key === "ArrowDown" ? 1 : names.length - 1)) % names.length]);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const tabs = ["stat", "pods", "net"];
      state.tab = tabs[(tabs.indexOf(state.tab) + (event.key === "ArrowRight" ? 1 : 2)) % 3];
      render();
    } else if (event.key === "Enter" && !(/** @type {HTMLElement} */ (event.target)).closest("button,summary")) {
      io.openTopology?.(names[at]);
    } else if (event.key === "Escape" || event.key === "Backspace") { event.preventDefault(); toGrid(); }
  });
  let resize = 0;
  window.addEventListener("resize", () => { clearTimeout(resize); resize = Number(setTimeout(() => { if (!el.hidden && state.view === "grid") drawLinks(el, model); }, 120)); });
  return {
    show() {
      el.hidden = false;
      render();
      pull();
      clearInterval(timer);
      timer = Number(setInterval(pull, 15000));
      /** @type {HTMLElement|null} */ (el.querySelector(".pb-tile,.pb-list"))?.focus();
    },
    hide() { el.hidden = true; clearInterval(timer); },
  };
}
