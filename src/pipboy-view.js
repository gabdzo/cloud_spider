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
`;

/** @typedef {import("./pipboy-model.js").PipNs} PipNs */

function list(title, /** @type {string[]} */ items, empty) {
  return `<h4>${esc(title)}</h4>${items.length ? `<ul class="pb-items">${items.join("")}</ul>` : `<p class="pb-rule">${esc(empty)}</p>`}`;
}

/** @param {PipNs} ns @param {string} tab */
export function detailHtml(ns, tab) {
  const head = `<div class="pb-head"><div class="pb-figbox">${figureSvg(ns.state, 5)}<span class="pb-state ${ns.state}">${ns.state.toUpperCase()}</span></div><div><h3 class="pb-name">${esc(ns.name)} <small class="pb-sys">${ns.health}/10</small></h3><p class="pb-text">${esc(ns.text)}</p></div></div>`;
  const wl = list("WORKLOADS", ns.workloads.map((w) => `<li class="${w.status === "ok" ? "" : "bad"}"><span>${esc(w.name)}</span><span class="pb-r">${esc(w.kind.toLowerCase())} ${w.have}/${w.want}</span></li>`), "no workloads");
  const issues = ns.issues.length ? `<h4>ISSUES</h4>${ns.issues.map((i) => `<p class="pb-rule pb-alert">✖ ${esc(i)}</p>`).join("")}` : "";
  const sv = list("SERVICES", ns.services.map((s) => `<li class="${s.status === "ok" ? "" : "bad"}"><span>${esc(s.name)}</span><span class="pb-r">${esc(s.type)} ${esc(s.ports)}</span></li>`), "no services");
  const en = list("ENTRY POINTS", ns.entries.map((e) => `<li class="${e.status === "ok" ? "" : "bad"}" title="${esc(e.full)}"><span>${esc(e.host)}</span><span class="pb-r">${esc(e.kind)}${e.target ? ` → ${esc(e.target)}` : ""}</span></li>`), "no entry points: reachable inside the cluster only");
  const badge = ns.policy.badge.toUpperCase();
  const np = `<h4>NETWORK POLICIES <span class="pb-badge ${ns.policy.badge}">${esc(badge)}</span></h4>${ns.policy.lines.length ? ns.policy.lines.map((p) => `<p class="pb-rule"><b>${p.deny ? "DENY" : "ALLOW"}</b> ${esc(p.name)} · selects ${esc(p.selects)}${p.rules.map((r) => `<br>&nbsp;&nbsp;${esc(r)}`).join("")}</p>`).join("") : `<p class="pb-rule">no NetworkPolicy: all traffic in and out is allowed</p>`}`;
  if (tab === "pods") return head + issues + wl + sv;
  if (tab === "net") return head + en + np;
  return head + issues + wl + sv + en + np;
}

/**
 * @param {ReturnType<typeof import("./pipboy-model.js").pipModel>|null} model
 * @param {{ selected: string, tab: string, theme: string, error?: string, loading?: boolean }} state
 */
export function pipHtml(model, state) {
  const tabs = ["stat", "pods", "net"].map((t) => `<button class="pb-tab" role="tab" data-tab="${t}" aria-selected="${state.tab === t}">${t.toUpperCase()}</button>`).join("");
  const top = `<div class="pb-top" role="tablist">${tabs}<span class="pb-title">${esc(model?.cluster || "")}${model?.context ? ` · ${esc(model.context)}` : ""}<button class="pb-theme" data-theme-toggle title="switch phosphor colour">${state.theme === "amber" ? "AMBER" : "GREEN"}</button><button class="pb-close" data-close title="back to the map">✕ MAP</button></span></div>`;
  if (!model || !model.namespaces.length) return `${top}<p class="pb-empty">${esc(state.error || (state.loading ? "READING CLUSTER…" : "NO NAMESPACES VISIBLE TO THIS CONTEXT"))}</p>`;
  const sel = model.namespaces.find((n) => n.name === state.selected) || model.namespaces[0];
  const rows = model.namespaces.map((n) => `<li class="pb-row${n.state === "healthy" ? "" : " pb-bad"}${n.system ? " pb-sys" : ""}" role="option" data-ns="${esc(n.name)}" aria-selected="${n === sel}"><span class="pb-n">${esc(n.name)}</span><span class="pb-v">${n.health}</span></li>`).join("");
  const t = model.totals;
  const pct = t.pods ? Math.round((100 * t.ready) / t.pods) : 100;
  const bar = `<div class="pb-bar"><span>PODS ${t.ready}/${t.pods}<i class="pb-meter"><i style="width:${pct}%"></i></i></span><span>NODES ${t.nodesReady}/${t.nodes}</span><span class="${t.issues ? "pb-alert" : ""}">ISSUES ${t.issues}</span></div>`;
  return `${top}<p class="pb-sub">${state.tab === "stat" ? "NAMESPACES · HEALTH" : state.tab === "pods" ? "WORKLOADS · SERVICES" : "ENTRY POINTS · POLICIES"}</p><div class="pb-main"><ul class="pb-list" role="listbox" tabindex="0" aria-label="namespaces">${rows}</ul><div class="pb-detail">${detailHtml(sel, state.tab)}</div></div>${bar}`;
}

/** @param {Storage|null} store @param {string} key @param {string} fallback */
const pref = (store, key, fallback) => { try { return store?.getItem(key) || fallback; } catch { return fallback; } };
/** @param {Storage|null} store @param {string} key @param {string} value */
const keep = (store, key, value) => { try { store?.setItem(key, value); } catch { /* this page only */ } };

/**
 * The screen's controller: fetches /api/cluster, renders, keys and clicks.
 * @param {HTMLElement} el
 * @param {{ load: () => Promise<any>, model: (body: any) => any, onClose: () => void, store?: Storage|null }} io
 */
export function mountPip(el, io) {
  const store = io.store ?? null;
  const state = { selected: pref(store, PIP_SEL_KEY, ""), tab: "stat", theme: pref(store, PIP_THEME_KEY, "green") === "amber" ? "amber" : "green", error: "", loading: true };
  /** @type {any} */
  let model = null;
  let timer = 0;
  if (!document.querySelector("#pipboy-css")) document.head.append(Object.assign(document.createElement("style"), { id: "pipboy-css", textContent: PIP_CSS }));
  const render = () => {
    el.dataset.theme = state.theme;
    const listEl = el.querySelector(".pb-list");
    const focused = document.activeElement === listEl;
    el.innerHTML = pipHtml(model, state);
    const now = /** @type {HTMLElement|null} */ (el.querySelector(".pb-list"));
    if (focused) now?.focus();
    now?.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
  };
  const pull = async () => {
    const body = await io.load().catch((e) => ({ error: e?.message || "the cluster did not answer" }));
    model = body?.diagram ? io.model(body) : model;
    state.error = body?.error && !body?.diagram ? String(body.error) : "";
    state.loading = false;
    if (!el.hidden) render();
  };
  const select = (/** @type {string} */ name) => { state.selected = name; keep(store, PIP_SEL_KEY, name); render(); };
  el.addEventListener("click", (event) => {
    const t = /** @type {HTMLElement} */ (event.target);
    const row = /** @type {HTMLElement|null} */ (t.closest("[data-ns]"));
    if (row) return select(row.dataset.ns || "");
    const tab = /** @type {HTMLElement|null} */ (t.closest("[data-tab]"));
    if (tab) { state.tab = tab.dataset.tab || "stat"; return render(); }
    if (t.closest("[data-theme-toggle]")) { state.theme = state.theme === "amber" ? "green" : "amber"; keep(store, PIP_THEME_KEY, state.theme); return render(); }
    if (t.closest("[data-close]")) io.onClose();
  });
  el.addEventListener("keydown", (event) => {
    if (!model?.namespaces?.length) return;
    const names = model.namespaces.map((/** @type {any} */ n) => n.name);
    const at = Math.max(0, names.indexOf(state.selected));
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      select(names[(at + (event.key === "ArrowDown" ? 1 : names.length - 1)) % names.length]);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const tabs = ["stat", "pods", "net"];
      state.tab = tabs[(tabs.indexOf(state.tab) + (event.key === "ArrowRight" ? 1 : 2)) % 3];
      render();
    } else if (event.key === "Escape") io.onClose();
  });
  return {
    show() {
      el.hidden = false;
      render();
      pull();
      clearInterval(timer);
      timer = Number(setInterval(pull, 15000));
      /** @type {HTMLElement|null} */ (el.querySelector(".pb-list"))?.focus();
    },
    hide() { el.hidden = true; clearInterval(timer); },
  };
}
