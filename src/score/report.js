// Scorecard export: Markdown, self-contained HTML (inline CSS, no scripts,
// no external requests) or JSON. Verdict before number, disclaimer always,
// and never evidence fields: only results, statuses and failing resource ids.
import { DISCLAIMER, VERDICT_LABEL } from "./scorer.js";

// Add-ons the EKS stack installs (upgrades/addons/catalog.js includedWithEks).
const EKS_INCLUDED = new Set(["pod-identity", "metrics-server"]);

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ORDER = { FAIL: 0, UNKNOWN: 1, NOT_ASSESSED: 2, PASS: 3, NOT_APPLICABLE: 4 };

export function reportModel(scan, { permissions = null } = {}) {
  const card = scan.card;
  return {
    title: `Cloud Spider scorecard: ${scan.clusterName || scan.target}`,
    verdict: VERDICT_LABEL[card.verdict] || card.verdict,
    score: card.overall == null ? "no score (not enough evidence)" : `${Math.round(card.overall)}/100 (range ${Math.round(card.lower)}–${Math.round(card.upper)})`,
    coverage: `${card.coverage}% coverage, ${card.unknown}% unknown, ${card.notAssessed}% not assessed; confidence ${card.confidence}`,
    meta: `profile ${card.profile}${scan.profileDefaulted ? " (no environment set: production assumed)" : ""} · catalog ${scan.catalogVersion} · scanned ${scan.finishedAt}`,
    reasons: card.reasons,
    gates: card.gates,
    rows: [...scan.results].sort((a, b) => ORDER[a.status] - ORDER[b.status] || a.id.localeCompare(b.id)).map((r) => ({
      id: r.id, title: r.title, status: r.status, severity: r.severity, reason: r.reason || "",
      failing: (r.resources || []).filter((x) => !x.pass).map((x) => x.id), fix: r.addon ? (EKS_INCLUDED.has(r.addon) ? `the EKS stack of ${scan.clusterName} (it installs ${r.addon})` : `add-on stack ${r.addon}-${scan.clusterName}`) : "",
    })),
    grants: permissions?.grants || [],
    disclaimer: DISCLAIMER,
  };
}

// Header- and filesystem-safe: the cluster name comes from the cluster.
const FILE_PART = (s) => String(s ?? "").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80) || "scan";
// One Markdown table cell: no row breaks, no column breaks.
const CELL = (s) => String(s ?? "").replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|");
export const FORMATS = ["md", "html", "json"];

export function renderReport(scan, format = "md", opts = {}) {
  if (!FORMATS.includes(format)) return { error: "format must be md, html or json" };
  const m = reportModel(scan, opts);
  const base = `cloudspider-scorecard-${FILE_PART(scan.clusterName || scan.target)}-${FILE_PART(String(scan.finishedAt || "").slice(0, 10))}`;
  if (format === "json") {
    const { fullEvidence, ...rest } = scan;
    return { type: "application/json; charset=utf-8", filename: `${base}.json`, body: JSON.stringify({ ...rest, disclaimer: DISCLAIMER }, null, 2) };
  }
  if (format === "html") {
    const rows = m.rows.map((r) => `<tr class="${esc(r.status)}"><td>${esc(r.status.replace("_", " "))}</td><td>${esc(r.id)}</td><td>${esc(r.title)}</td><td>${esc(r.severity)}</td><td>${esc([r.reason, r.failing.slice(0, 5).join(", "), r.fix].filter(Boolean).join(" · "))}</td></tr>`).join("\n");
    const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(m.title)}</title><style>body{font-family:ui-monospace,Menlo,monospace;margin:2em;color:#111;background:#fff}td,th{border-bottom:1px solid #ccc;padding:4px 8px;text-align:left}tr.FAIL td:first-child{color:#b00020}tr.PASS td:first-child{color:#0a7d32}tr.UNKNOWN td:first-child,tr.NOT_ASSESSED td:first-child{color:#8a6d00}.muted{color:#555}</style></head><body>
<h1>${esc(m.title)}</h1><h2>${esc(m.verdict)}: ${esc(m.score)}</h2><p>${esc(m.coverage)}</p><p class="muted">${esc(m.meta)}</p>
<ul>${m.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>${m.grants.map((g) => `<p>Refused reads: ${esc(g)}</p>`).join("")}
<table><thead><tr><th>status</th><th>control</th><th>title</th><th>severity</th><th>detail</th></tr></thead><tbody>
${rows}
</tbody></table><p class="muted">${esc(m.disclaimer)}</p></body></html>`;
    return { type: "text/html; charset=utf-8", filename: `${base}.html`, body };
  }
  const md = [
    `# ${m.title}`, "", `**${m.verdict}** · ${m.score}`, "", m.coverage, "", `_${m.meta}_`, "",
    ...m.reasons.map((r) => `- ${r}`), "",
    ...m.grants.map((g) => `> Refused reads: ${g}`), ...(m.grants.length ? [""] : []),
    "| status | control | title | severity | detail |", "|---|---|---|---|---|",
    ...m.rows.map((r) => `| ${r.status.replace("_", " ")} | ${CELL(r.id)} | ${CELL(r.title)} | ${CELL(r.severity)} | ${CELL([r.reason, r.failing.slice(0, 5).join(", "), r.fix].filter(Boolean).join(" · "))} |`),
    "", `_${m.disclaimer}_`, "",
  ].join("\n");
  return { type: "text/markdown; charset=utf-8", filename: `${base}.md`, body: md };
}
