// Morning cards v2: each card shows one short line; a click opens a popup
// with the whole story (rows with times, the service or pod, actions).
// Pure: browser.js draws it. Never an action on AWS or the cluster here.
import { HEALTH_KINDS } from "./kube-health.js";

const MAX = 34;
const cut = (s) => (s.length > MAX ? `${s.slice(0, MAX - 1).trimEnd()}…` : s);
// log lines carry terminal colour codes ("\u001b[90m", or "[90m" once the
// escape byte is lost); strip them and keep a row readable
const ANSI = /(\u001b)?\[[0-9;]*m/g;
export const tidy = (text, max = 160) => { const s = String(text || "").replace(ANSI, "").replace(/\s+/g, " ").trim(); return s.length > max ? `${s.slice(0, max - 1)}…` : s; };
const firstClause = (text) => String(text || "").replace(/\s+/g, " ").trim().split(/(?<=[.;])\s/)[0].replace(/[.;]$/, "");

export function shortLine(name, line = {}, { logs = null } = {}) {
  const text = String(line.text || "");
  if (name === "logs") {
    if (/did not answer|not read/i.test(text)) return "Loki: no answer";
    if (/No log store/i.test(text)) return "no log store set";
    const services = logs?.services || [];
    const errors = services.reduce((sum, s) => sum + (s.total || 0), 0);
    const svcs = services.filter((s) => s.total).length;
    if (errors) return cut(`Loki: ${errors} errors · ${svcs} svc${svcs === 1 ? "" : "s"}`);
    const m = text.match(/(\d+) errors? in (\d+) services?/);
    if (m) return cut(`Loki: ${m[1]} errors · ${m[2]} svcs`);
    if (/No errors/i.test(text)) return "Loki: no errors";
  }
  if (name.startsWith("m-pods-")) {
    if (line.counts && Object.keys(line.counts).length) {
      return cut(Object.entries(line.counts).sort((a, b) => (HEALTH_KINDS[a[0]]?.rank ?? 9) - (HEALTH_KINDS[b[0]]?.rank ?? 9)).map(([k, n]) => `${n} ${HEALTH_KINDS[k]?.short || k}`).join(" · "));
    }
    if (/every pod is healthy/.test(text)) return "all pods healthy";
    if (/did not answer/.test(text)) return "cluster: no answer";
    if (/not set up/.test(text)) return "context not set up";
  }
  const burn = text.match(/vault ([\w-]+): ([\w-]+) burning \(burn ([\d.]+)×/);
  if (burn) return cut(`${burn[1]}: SLO burning ${Math.round(Number(burn[3]))}×`);
  const targets = text.match(/(\d+) of (\d+) targets? healthy/);
  if (targets) return `${targets[1]}/${targets[2]} targets healthy`;
  if (/^Nothing idle/i.test(text)) return "nothing idle billed";
  const clause = firstClause(text);
  return cut(clause.includes(": ") && clause.indexOf(": ") < 24 ? clause : clause);
}

const TITLES = { hurting: "HURTING", changed: "CHANGED", idle: "IDLE · BILLED", logs: "LOG ERRORS" };

export function cardDetail(name, line = {}, { logs = null, label = "" } = {}) {
  const title = name.startsWith("m-pods-") ? `PODS · ${label || line.label || ""}`.trim() : TITLES[name] || name.toUpperCase();
  const rows = [];
  const actions = [];
  if (name === "logs") {
    for (const s of logs?.services || []) {
      const who = s.namespace ? `${s.namespace}/${s.service}` : s.service;
      for (const g of (s.groups || []).slice(0, 5)) rows.push({ time: g.firstSeen ?? g.lastSeen ?? null, who, text: `${g.new ? "NEW · " : g.spike ? "SPIKE · " : ""}${tidy(g.message)} ×${g.count}` });
      for (const r of s.restartPods || []) rows.push({ time: r.time ?? null, who: s.namespace ? `${s.namespace}/${r.pod}` : r.pod, text: `${r.count} restart${r.count === 1 ? "" : "s"}${r.reason ? ` · ${r.reason}` : ""}` });
    }
    if (!rows.length) rows.push({ time: line.time ?? null, who: "", text: line.text || "" });
    if (logs?.services?.length) actions.push({ kind: "investigate", label: "INVESTIGATE" });
  } else if (name.startsWith("m-pods-")) {
    for (const w of line.worst || []) rows.push({ time: line.time ?? null, who: `${w.ns}/${w.name}`, text: `${HEALTH_KINDS[w.kind]?.word || w.kind}${w.detail ? ` · ${w.detail}` : ""}` });
    if (!rows.length) rows.push({ time: line.time ?? null, who: "", text: line.text || "" });
    actions.push({ kind: "cluster", label: "OPEN CLUSTER" });
  } else {
    rows.push({ time: line.time ?? null, who: "", text: line.text || "" });
    if (line.focus) actions.push({ kind: "map", focus: line.focus, label: "SHOW ON MAP" });
  }
  return { title, status: line.status || "unknown", summary: line.text || "", rows, actions };
}
