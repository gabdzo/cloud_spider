// DIAGNOSE panel CSS (src/diagnose-view.js). Colours only through the theme
// role tokens (--bg, --surface, --raised, --text, --text2, --text3,
// --border, --accent, --ok, --warn, --err), so both themes work; the
// Pip-Boy block adds glow and brackets, pro keeps rounded cards.
export const DX_CSS = `
  .dx-overlay { position: fixed; inset: 0; z-index: 900; display: flex; align-items: flex-start; justify-content: center; padding: 4vh 2vw; background: color-mix(in srgb, var(--bg) 72%, transparent); }
  .dx-panel { width: min(1180px, 96vw); max-height: 92vh; display: flex; flex-direction: column; background: var(--surface); color: var(--text); border: 1px solid var(--border); font-size: 12px; line-height: 1.4; box-shadow: 0 0 28px color-mix(in srgb, var(--accent) 18%, transparent); }
  .dx-head { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--border); }
  .dx-head b { color: var(--accent); letter-spacing: .12em; }
  .dx-sub { color: var(--text2); flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .dx-form { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px dashed var(--border); }
  .dx-form label { display: flex; gap: 6px; align-items: center; color: var(--text2); letter-spacing: .08em; }
  .dx-form input { font: inherit; width: 200px; padding: 3px 6px; color: var(--text); background: var(--bg); border: 1px solid var(--border); }
  .dx-body { overflow: auto; padding: 10px 12px 12px; }
  .dx-btn { min-height: 26px; padding: 0 10px; font: inherit; letter-spacing: .1em; color: var(--text); background: var(--raised); border: 1px solid var(--border); cursor: pointer; }
  .dx-btn:hover, .dx-btn:focus-visible { outline: none; border-color: var(--accent); color: var(--accent); }
  .dx-btn:disabled { opacity: .55; cursor: default; }
  .dx-primary { border-color: var(--accent); color: var(--accent); }
  .dx-close { min-width: 28px; padding: 0 6px; }
  .dx-note { color: var(--text2); margin: 0 0 8px; }
  .dx-err { color: var(--err); }
  .dx-sum { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 12px; margin-bottom: 10px; }
  .dx-scope { font-weight: bold; color: var(--text); overflow-wrap: anywhere; }
  .dx-sum small { color: var(--text3); overflow-wrap: anywhere; }
  .dx-verdict { padding: 1px 8px; border: 1px solid var(--text3); color: var(--text2); letter-spacing: .12em; }
  .dx-verdict.v-resolved, .dx-verify.v-resolved .dx-vs { color: var(--ok); border-color: var(--ok); }
  .dx-verdict.v-still_failing, .dx-verify.v-still_failing .dx-vs { color: var(--err); border-color: var(--err); }
  .dx-verdict.v-inconclusive, .dx-verify.v-inconclusive .dx-vs { color: var(--warn); border-color: var(--warn); }
  .dx-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(240px, 340px); gap: 14px; }
  @media (max-width: 900px) { .dx-cols { grid-template-columns: minmax(0, 1fr); } }
  .dx-panel h4 { margin: 0 0 6px; font-size: 11px; letter-spacing: .14em; color: var(--text2); font-weight: normal; }
  .dx-panel h4 small { color: var(--text3); letter-spacing: .04em; }
  .dx-findings, .dx-steps, .dx-caps, .dx-panel section ul { list-style: none; margin: 0; padding: 0; }
  .dx-finding { margin-bottom: 8px; padding: 8px 10px; background: var(--bg); border: 1px solid var(--border); border-left: 3px solid var(--warn); }
  .dx-finding.sev-high, .dx-finding.sev-critical { border-left-color: var(--err); }
  .dx-finding.sev-low { border-left-color: var(--text3); }
  .dx-finding header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; }
  .dx-code { color: var(--accent); letter-spacing: .08em; }
  .dx-title { color: var(--text); flex: 1; min-width: 160px; }
  .dx-tags { display: flex; gap: 4px; flex-wrap: wrap; }
  .dx-tags i { font-style: normal; padding: 0 5px; border: 1px solid var(--border); color: var(--text2); font-size: 10px; }
  .dx-tags i.sev { color: var(--warn); border-color: var(--warn); }
  .sev-high .dx-tags i.sev, .sev-critical .dx-tags i.sev { color: var(--err); border-color: var(--err); }
  .dx-finding p { margin: 4px 0; overflow-wrap: anywhere; }
  .dx-ev summary { cursor: pointer; color: var(--text2); letter-spacing: .1em; font-size: 11px; }
  .dx-ev summary:hover { color: var(--accent); }
  .dx-ev li { padding: 4px 0; border-top: 1px dashed var(--border); overflow-wrap: anywhere; }
  .dx-ev time, .dx-ev code { color: var(--text3); font-size: 10px; }
  .dx-ev pre { margin: 4px 0 0; padding: 4px 6px; max-height: 120px; overflow: auto; white-space: pre-wrap; background: var(--surface); border: 1px solid var(--border); color: var(--warn); font-size: 10px; }
  .dx-steps li { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; padding: 2px 0; }
  .dx-steps span { color: var(--text2); }
  .dx-steps code { color: var(--text); background: var(--surface); padding: 1px 5px; border: 1px solid var(--border); overflow-wrap: anywhere; min-width: 0; }
  .dx-copy { font: inherit; font-size: 10px; padding: 0 6px; color: var(--text2); background: transparent; border: 1px solid var(--border); cursor: pointer; }
  .dx-copy:hover, .dx-copy:focus-visible { outline: none; color: var(--accent); border-color: var(--accent); }
  .dx-hyp li, .dx-q li, .dx-rel li { padding: 3px 0; border-bottom: 1px dashed var(--border); overflow-wrap: anywhere; }
  .dx-hyp { margin-top: 8px; }
  .dx-hyp small { display: block; color: var(--text3); }
  .dx-q li { color: var(--text2); }
  .dx-fix { margin: 8px 0; padding: 6px 8px; border: 1px dashed var(--accent); color: var(--text2); }
  .dx-none { color: var(--text2); }
  .dx-side > * + h4, .dx-side section { margin-top: 10px; }
  .dx-caps { display: grid; grid-template-columns: 1fr; gap: 2px; }
  .dx-cap { display: flex; justify-content: space-between; gap: 8px; padding: 2px 6px; border-left: 3px solid var(--text3); background: var(--bg); }
  .dx-cap small { color: var(--text3); white-space: nowrap; }
  .dx-cap.s-available { border-left-color: var(--ok); }
  .dx-cap.s-available small { color: var(--ok); }
  .dx-cap.s-forbidden { border-left-color: var(--err); }
  .dx-cap.s-forbidden small { color: var(--err); }
  .dx-cap.r-action { border-left-color: var(--accent); }
  .dx-cap.r-action small { color: var(--accent); }
  .dx-rel code { color: var(--text); }
  .dx-rel i { font-style: normal; color: var(--text3); }
  .dx-rel small { display: block; color: var(--text3); }
  .dx-rel li.p-unknown code { color: var(--warn); }
  .dx-verify { margin-top: 10px; padding: 8px 10px; border: 1px solid var(--border); background: var(--bg); }
  .dx-verify .dx-vs { padding: 0 6px; border: 1px solid var(--text3); }
  .dx-verify table { width: 100%; border-collapse: collapse; font-size: 11px; }
  .dx-verify th { text-align: left; color: var(--text3); font-weight: normal; letter-spacing: .1em; padding: 2px 6px; border-bottom: 1px solid var(--border); }
  .dx-verify td { padding: 4px 6px; vertical-align: top; border-bottom: 1px dashed var(--border); overflow-wrap: anywhere; }
  .dx-verify tr.v-resolved td.dx-vs { color: var(--ok); }
  .dx-verify tr.v-still_failing td.dx-vs { color: var(--err); }
  .dx-verify tr.v-inconclusive td.dx-vs { color: var(--warn); }
  .dx-verify td.dx-vs { border: 0; border-bottom: 1px dashed var(--border); white-space: nowrap; }
  .dx-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 12px; padding-top: 8px; border-top: 1px dashed var(--border); }
  .dx-outcome { display: flex; align-items: center; gap: 6px; color: var(--text2); letter-spacing: .08em; }
  .dx-outcome select { font: inherit; color: var(--text); background: var(--bg); border: 1px solid var(--border); }
  .dx-ro { margin-left: auto; color: var(--text3); }
  .gv-investigate { color: var(--accent); }
  :root:not([data-theme="pro"]) .dx-panel { text-transform: uppercase; letter-spacing: .02em; }
  :root:not([data-theme="pro"]) .dx-panel p, :root:not([data-theme="pro"]) .dx-panel code, :root:not([data-theme="pro"]) .dx-panel pre, :root:not([data-theme="pro"]) .dx-panel td, :root:not([data-theme="pro"]) .dx-panel li, :root:not([data-theme="pro"]) .dx-panel input, :root:not([data-theme="pro"]) .dx-sum small { text-transform: none; }
  :root:not([data-theme="pro"]) .dx-head b, :root:not([data-theme="pro"]) .dx-code, :root:not([data-theme="pro"]) .dx-verdict { text-shadow: 0 0 8px color-mix(in srgb, var(--accent) 60%, transparent); }
  :root:not([data-theme="pro"]) .dx-btn::before { content: "[ "; }
  :root:not([data-theme="pro"]) .dx-btn::after { content: " ]"; }
  :root:not([data-theme="pro"]) .dx-close::before, :root:not([data-theme="pro"]) .dx-close::after { content: ""; }
  :root[data-theme="pro"] .dx-panel { border-radius: 10px; font-family: var(--font-ui, inherit); }
  :root[data-theme="pro"] .dx-finding, :root[data-theme="pro"] .dx-verify, :root[data-theme="pro"] .dx-btn, :root[data-theme="pro"] .dx-fix { border-radius: 6px; }
`;
