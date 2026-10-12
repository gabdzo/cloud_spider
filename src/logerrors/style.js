// LOG ERRORS panel CSS. Colours only through the theme role tokens
// (src/theme.js), so both themes fill it; the theme blocks at the end change
// shape and type only (caps, glow and square corners for Pip-Boy; rounded
// cards and the UI font for pro). test/log-errors.test.js: no colour literals.
export const LOG_CSS = `
  #log-errors {
    --l-tone: var(--text3);
    position: relative;
    max-height: min(58vh, 640px);
    overflow: auto;
    padding: 10px 14px 12px;
    border-bottom: 2px solid var(--border-strong);
    background: var(--surface);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  #log-errors[hidden] { display: none; }
  #log-errors .le-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-bottom: 8px; }
  #log-errors .le-head b { color: var(--accent); letter-spacing: 0.14em; font-size: 13px; }
  #log-errors .le-meta { color: var(--text2); }
  #log-errors .le-seg { display: inline-flex; gap: 0; }
  #log-errors .le-btn { font: inherit; font-size: 11px; color: var(--text2); background: var(--raised); border: 1px solid var(--border); padding: 3px 8px; cursor: pointer; }
  #log-errors .le-btn:hover { background: var(--hover); color: var(--text); }
  #log-errors .le-btn[aria-pressed="true"] { color: var(--bg); background: var(--accent); border-color: var(--accent); }
  #log-errors .le-close { margin-left: auto; }
  #log-errors .le-note { color: var(--text3); margin: 4px 0 8px; }
  #log-errors .le-totals { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; }
  #log-errors .le-total { border: 1px solid var(--border); background: var(--raised); padding: 3px 8px; color: var(--text2); }
  #log-errors .le-total strong { color: var(--text); margin-right: 4px; }
  #log-errors .le-total.bad strong { color: var(--err); }
  #log-errors .le-total.warn strong { color: var(--warn); }
  #log-errors ol { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  #log-errors .le-svc { border: 1px solid var(--border); background: var(--raised); box-shadow: inset 3px 0 0 var(--l-tone); }
  #log-errors .le-svc[data-tone="bad"] { --l-tone: var(--err); }
  #log-errors .le-svc[data-tone="warn"] { --l-tone: var(--warn); }
  #log-errors .le-svc[data-tone="ok"] { --l-tone: var(--ok); }
  #log-errors .le-svc > summary { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 4px 10px; padding: 6px 10px 6px 12px; cursor: pointer; list-style: none; }
  #log-errors .le-svc > summary::-webkit-details-marker { display: none; }
  #log-errors .le-svc > summary:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
  #log-errors .le-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #log-errors .le-name b { color: var(--text); }
  #log-errors .le-name small { color: var(--text3); margin-left: 6px; }
  #log-errors .le-nums { display: flex; gap: 6px; align-items: center; color: var(--text2); white-space: nowrap; }
  #log-errors .le-count { color: var(--text); font-weight: 700; }
  #log-errors .le-tag { font-size: 10px; letter-spacing: 0.1em; padding: 1px 5px; border: 1px solid currentColor; }
  #log-errors .le-tag.new { color: var(--err); }
  #log-errors .le-tag.spike { color: var(--warn); }
  #log-errors .le-tag.rst { color: var(--info); }
  #log-errors .le-tag.kind { color: var(--text3); }
  #log-errors .le-body { padding: 0 10px 8px 12px; display: grid; grid-template-columns: minmax(0, 1fr); gap: 6px; }
  #log-errors .le-fp, #log-errors .le-fp details { min-width: 0; }
  #log-errors .le-links { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; color: var(--text3); }
  #log-errors .le-fp { border-top: 1px dashed var(--border); padding-top: 6px; }
  #log-errors .le-fp-head { display: grid; grid-template-columns: 52px minmax(0, 1fr) auto; gap: 8px; align-items: baseline; }
  #log-errors .le-fp-head .le-count { text-align: right; }
  #log-errors .le-msg { min-width: 0; overflow-wrap: anywhere; color: var(--text); }
  #log-errors .le-when { color: var(--text3); white-space: nowrap; }
  #log-errors .le-fp details { margin: 4px 0 0 60px; }
  #log-errors .le-fp summary { color: var(--text2); cursor: pointer; }
  #log-errors pre { margin: 4px 0 0; padding: 8px; max-height: 280px; overflow: auto; background: var(--bg); color: var(--text2); border: 1px solid var(--border); font: 11px/1.4 var(--font-mono); white-space: pre; }
  #log-errors .le-empty { color: var(--text2); padding: 8px 0; }
  @media (max-width: 820px) {
    #log-errors { padding: 8px 10px; max-height: 70vh; }
    #log-errors .le-svc > summary { grid-template-columns: minmax(0, 1fr); }
    #log-errors .le-fp-head { grid-template-columns: 40px minmax(0, 1fr); }
    #log-errors .le-fp-head .le-when { grid-column: 2; }
    #log-errors .le-fp details { margin-left: 0; }
  }
  /* Pip-Boy: caps, glow, square. */
  :root:not([data-theme="pro"]) #log-errors .le-head b { text-shadow: 0 0 6px var(--glow-soft); }
  :root:not([data-theme="pro"]) #log-errors .le-btn { text-transform: uppercase; letter-spacing: 0.08em; }
  :root:not([data-theme="pro"]) #log-errors .le-name b { text-transform: uppercase; letter-spacing: 0.06em; }
  /* PRO: rounded cards, the UI font, no glow. */
  :root[data-theme="pro"] #log-errors { font-family: var(--font-ui); font-size: 13px; border-bottom-width: 1px; }
  :root[data-theme="pro"] #log-errors .le-head b { letter-spacing: 0.04em; }
  :root[data-theme="pro"] #log-errors .le-svc { border-radius: 8px; box-shadow: none; border-left: 3px solid var(--l-tone); }
  :root[data-theme="pro"] #log-errors .le-btn { border-radius: 6px; margin-right: 4px; }
  :root[data-theme="pro"] #log-errors .le-total, :root[data-theme="pro"] #log-errors .le-tag { border-radius: 999px; }
  :root[data-theme="pro"] #log-errors pre { border-radius: 6px; }
  :root[data-theme="pro"] #log-errors .le-msg, :root[data-theme="pro"] #log-errors .le-count { font-family: var(--font-mono); font-size: 12px; }
`;
