// DIAGNOSE panel (browser): Investigate one Service, read the evidence,
// then Verify again after a fix. Opened from SERVICES (INCIDENT REVIEW and
// a selected Service) and from SNIFF's DEBUG bar. Talks to
// /api/diagnose/* only (src/diagnose/route.js); every string is escaped.
// SAMPLE runs the brother-sandbox db story offline, same schema as live.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const VERDICT = { not_run: "NOT VERIFIED", resolved: "RESOLVED", still_failing: "STILL FAILING", inconclusive: "INCONCLUSIVE" };
const CAP_TEXT = { available: "OK", "not-configured": "NOT SET UP", "not-installed": "NOT INSTALLED", forbidden: "FORBIDDEN", unavailable: "NO ANSWER" };
const SAMPLE_FIX = "Demo fix: db's code fakes \"pool exhausted\" (random.random() < 0.05). Remove that line and roll out db, then VERIFY AGAIN.";

export function capsHtml(caps = []) {
  return `<ul class="dx-caps">${caps.map((c) => `<li class="dx-cap s-${esc(c.status)}${c.role === "action" ? " r-action" : ""}" title="${esc(c.detail || "")}"><b>${esc(c.name)}</b><small>${c.role === "action" ? "OPTIONAL ACTION" : esc(CAP_TEXT[c.status] || c.status)}</small></li>`).join("")}</ul>`;
}

export function findingHtml(f, evidence = []) {
  const ev = f.evidence_refs.map((id) => evidence.find((e) => e.id === id)).filter(Boolean);
  const steps = (f.next_steps || []).map((s) => `<li><span>${esc(s.text)}</span>${s.command ? `<code>${esc(s.command)}</code><button type="button" class="dx-copy" data-copy="${esc(s.command)}" title="copy the read-only command">COPY</button>` : ""}</li>`).join("");
  return `<li class="dx-finding sev-${esc(f.severity)}"><header><b class="dx-code">${esc(f.code)}</b><span class="dx-title">${esc(f.title)}</span><small class="dx-tags"><i class="sev">${esc(f.severity)}</i><i>confidence ${esc(f.confidence)}</i><i>${esc(f.status.replace("_", " "))}</i></small></header>`
    + `<p>${esc(f.summary)}</p>`
    + `<details class="dx-ev"><summary>EVIDENCE · ${ev.length}</summary><ul>${ev.map((e) => `<li><code>${esc(e.id)}</code> <b>${esc(e.source)}</b> <time>${esc(e.observed_at)}</time><p>${esc(e.summary)}</p>${e.normalized?.lines ? `<pre>${esc(e.normalized.lines.map((l) => l.line).join("\n"))}</pre>` : ""}</li>`).join("")}</ul></details>`
    + (steps ? `<ol class="dx-steps">${steps}</ol>` : "")
    + `</li>`;
}

export function verifyHtml(v) {
  if (!v || v.status === "not_run") return "";
  const rows = (v.checks || []).map((c) => `<tr class="v-${esc(c.status)}"><td><b>${esc(c.code)}</b></td><td>${esc(c.before)}</td><td>${esc(c.after || c.why || "")}</td><td class="dx-vs">${esc(VERDICT[c.status] || c.status)}</td></tr>`).join("");
  const extra = (v.new_findings || []).map((f) => `<li>new: <b>${esc(f.code)}</b> ${esc(f.summary)}</li>`).join("");
  return `<section class="dx-verify v-${esc(v.status)}" aria-live="polite"><h4>VERIFY AGAIN · <span class="dx-vs">${esc(VERDICT[v.status])}</span>${v.verified_at ? ` <time>${esc(v.verified_at)}</time>` : ""}</h4>`
    + (rows ? `<table><thead><tr><th>RULE</th><th>BEFORE</th><th>AFTER</th><th>RESULT</th></tr></thead><tbody>${rows}</tbody></table>` : `<p>${esc(v.why || "nothing to compare")}</p>`)
    + (extra ? `<ul class="dx-new">${extra}</ul>` : "") + `</section>`;
}

export function investigationHtml(rec, { sample = false, verification = null, outcome = "" } = {}) {
  if (!rec) return "";
  if (rec.error) return `<p class="dx-err">${esc(rec.error)}</p>`;
  const v = verification || rec.verification;
  const s = rec.scope || {};
  const findings = rec.findings.length ? `<ol class="dx-findings">${rec.findings.map((f) => findingHtml(f, rec.evidence)).join("")}</ol>` : `<p class="dx-none">No rule fired on the evidence that could be read.${rec.coverage.complete ? "" : " Coverage is partial: that is not the same as healthy."}</p>`;
  const hyp = rec.hypotheses.length ? `<section class="dx-hyp"><h4>HYPOTHESES <small>not facts · based on the evidence listed</small></h4><ul>${rec.hypotheses.map((x) => `<li><span>${esc(x.text)}</span><small>${esc(x.confidence)} · ${esc(x.based_on.join(", "))}</small></li>`).join("")}</ul></section>` : "";
  const qs = rec.questions.length ? `<section class="dx-q"><h4>OPEN QUESTIONS · ${rec.questions.length}</h4><ul>${rec.questions.map((q) => `<li>${esc(q)}</li>`).join("")}</ul></section>` : "";
  const rel = rec.relationships.length ? `<section class="dx-rel"><h4>PATH</h4><ul>${rec.relationships.map((r) => `<li class="p-${esc(r.provenance)}"><code>${esc(r.from.replace(/^\w+:\/\/[^/]+\//, ""))}</code> <i>${esc(r.type)}</i> <code>${esc(r.to.replace(/^\w+:\/\/[^/]+\//, ""))}</code> <small>${esc(r.provenance)} · ${esc(r.how)}</small></li>`).join("")}</ul></section>` : "";
  const outcomes = sample ? `<label class="dx-outcome" title="SAMPLE only: which 'after' the demo verifies against">AFTER <select data-dx-outcome>${[["", "FIXED"], ["still", "NOT FIXED"], ["gone", "EVIDENCE GONE"]].map(([k, t]) => `<option value="${k}"${k === outcome ? " selected" : ""}>${t}</option>`).join("")}</select></label>` : "";
  return `<div class="dx-sum"><span class="dx-scope">${esc(s.cluster)} · ${esc(s.namespace)}/${esc(s.service)}</span><span class="dx-verdict v-${esc(v.status)}">${esc(VERDICT[v.status])}</span><small>${rec.findings.length} finding${rec.findings.length === 1 ? "" : "s"} · coverage ${rec.coverage.complete ? "complete" : `partial (${esc(rec.coverage.missing.join(", "))})`} · ${esc(rec.observed_at)}</small></div>`
    + `<div class="dx-cols"><div class="dx-main"><h4>FINDINGS</h4>${findings}${hyp}${sample ? `<p class="dx-fix">${esc(SAMPLE_FIX)}</p>` : ""}${verifyHtml(v)}</div>`
    + `<aside class="dx-side"><h4>CAPABILITIES</h4>${capsHtml(rec.capabilities)}${rel}${qs}</aside></div>`
    + `<div class="dx-actions"><button type="button" class="dx-btn dx-primary" data-dx-verify title="re-run the same read-only checks and compare with this investigation">VERIFY AGAIN</button>${outcomes}<button type="button" class="dx-btn" data-dx-json title="download the investigation record (schema ${esc(rec.schema_version)})">EXPORT JSON</button><small class="dx-ro">read-only · nothing installed · schema ${esc(rec.schema_version)}</small></div>`;
}

const fetchJsonDefault = (u, o) => fetch(u, o).then((r) => r.json());

// openDiagnose({ sample, context, namespace, service }): one panel at a time.
export function openDiagnose(opts = {}, { fetchJson = fetchJsonDefault, doc = globalThis.document } = {}) {
  doc.querySelector(".dx-overlay")?.remove();
  const sample = !!opts.sample;
  const st = { rec: null, verification: null, outcome: "", busy: false, ns: opts.namespace || "", svc: opts.service || "" };
  const overlay = doc.createElement("div");
  overlay.className = "dx-overlay";
  overlay.innerHTML = `<section class="dx-panel" role="dialog" aria-modal="true" aria-label="diagnose"><header class="dx-head"><b>◎ DIAGNOSE</b><span class="dx-sub"></span><button type="button" class="dx-btn dx-close" aria-label="close" title="close (Esc)">×</button></header><div class="dx-form"></div><div class="dx-body" aria-live="polite"></div></section>`;
  // A real modal: the page behind is inert and hidden from screen readers
  // until the panel closes (only what this panel changed is restored).
  const behind = [...doc.body.children].filter((el) => el.getAttribute("aria-hidden") !== "true" && !el.inert);
  for (const el of behind) { el.setAttribute("aria-hidden", "true"); el.inert = true; }
  doc.body.append(overlay);
  const $ = (sel) => overlay.querySelector(sel);
  const close = () => {
    overlay.remove();
    for (const el of behind) { el.removeAttribute("aria-hidden"); el.inert = false; }
    doc.removeEventListener("keydown", onKey);
  };
  const onKey = (ev) => ev.key === "Escape" && close();
  doc.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (ev) => ev.target === overlay && close());
  $(".dx-close").addEventListener("click", close);
  $(".dx-sub").textContent = sample ? "SAMPLE · brother-sandbox/db · offline fixture" : `LIVE · ${opts.context || "primary context"} · GETs only`;
  if (!sample) {
    $(".dx-form").innerHTML = `<label>NAMESPACE <input name="dxNs" spellcheck="false" autocomplete="off" value="${esc(st.ns)}"></label><label>SERVICE <input name="dxSvc" spellcheck="false" autocomplete="off" value="${esc(st.svc)}"></label><button type="button" class="dx-btn dx-primary" data-dx-go>INVESTIGATE</button>`;
    $("[data-dx-go]").addEventListener("click", () => { st.ns = $("[name=dxNs]").value.trim(); st.svc = $("[name=dxSvc]").value.trim(); investigate(); });
  } else $(".dx-form").remove();
  function paint(note = "") {
    $(".dx-body").innerHTML = (note ? `<p class="dx-note">${esc(note)}</p>` : "") + investigationHtml(st.rec, { sample, verification: st.verification, outcome: st.outcome });
    $("[data-dx-verify]")?.addEventListener("click", verifyAgain);
    $("[data-dx-outcome]")?.addEventListener("change", (ev) => (st.outcome = ev.target.value));
    $("[data-dx-json]")?.addEventListener("click", exportJson);
    for (const b of overlay.querySelectorAll("[data-copy]")) b.addEventListener("click", () => { globalThis.navigator?.clipboard?.writeText(b.dataset.copy).catch(() => {}); b.textContent = "COPIED"; });
    if (st.busy) for (const b of overlay.querySelectorAll(".dx-btn:not(.dx-close)")) b.disabled = true;
  }
  async function investigate() {
    if (!sample && (!st.ns || !st.svc)) return paint("Name a namespace and a Service.");
    st.busy = true; st.verification = null;
    paint(sample ? "Investigating the SAMPLE incident…" : `Reading ${st.ns}/${st.svc} (GETs only, about 10 reads, each up to 8 s)…`);
    const body = sample ? { sample: true } : { context: opts.context || "", namespace: st.ns, service: st.svc };
    st.rec = await fetchJson("/api/diagnose/investigate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch((e) => ({ error: String(e.message || e) }));
    st.busy = false;
    paint();
  }
  async function verifyAgain() {
    if (!st.rec?.investigation_id) return;
    st.busy = true; paint("Verifying: the same checks, on fresh evidence…");
    const out = await fetchJson("/api/diagnose/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ investigation_id: st.rec.investigation_id, ...(sample ? { sample: true, outcome: st.outcome } : {}) }) }).catch((e) => ({ error: String(e.message || e) }));
    st.busy = false;
    if (out.error) return paint(out.error);
    st.verification = out;
    paint();
  }
  function exportJson() {
    const blob = new Blob([JSON.stringify({ ...st.rec, verification: st.verification ? (({ after, ...v }) => v)(st.verification) : st.rec.verification }, null, 2)], { type: "application/json" });
    const a = doc.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${st.rec.investigation_id}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  overlay.querySelector(".dx-close").focus();
  if (sample || (st.ns && st.svc)) investigate();
  else paint();
  return { close, overlay };
}
