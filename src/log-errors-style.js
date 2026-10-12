// LOG ERRORS panel CSS: colours only through the theme role tokens
// (src/theme.js), so it follows the Pip-Boy / pro switch. Pip-Boy gets caps
// and a phosphor edge; pro gets rounded cards and the UI font.
export const LE_CSS = `
  #log-errors { position: absolute; z-index: 30; top: 6px; left: 12px; right: 12px; max-height: min(70vh, 640px); overflow: auto; padding: 10px 12px 12px; background: var(--surface); color: var(--text); border: 1px solid var(--border-strong); box-shadow: 0 14px 40px rgba(0, 0, 0, 0.55); font: 12px/1.4 var(--font-mono); }
  #log-errors[hidden] { display: none; }
  #log-errors.le-screen { z-index: 3; inset: 0; top: 0; left: 0; right: 0; max-height: none; padding-top: 50px; border: 0; box-shadow: none; background: var(--bg); }
  #log-errors .le-head { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 12px; margin-bottom: 8px; }
  #log-errors .le-head h2 { margin: 0; font-size: 13px; letter-spacing: 0.14em; color: var(--warn); }
  #log-errors .le-meta { color: var(--text3); }
  #log-errors .le-seg { display: inline-flex; gap: 4px; }
  #log-errors .le-active { color: var(--accent); font-size: 12px; letter-spacing: 0.04em; }
  #log-errors button { font: inherit; color: var(--text2); background: var(--raised); border: 1px solid var(--border); padding: 2px 8px; cursor: pointer; }
  #log-errors button:hover { color: var(--text); border-color: var(--accent); }
  #log-errors button[aria-pressed="true"] { color: var(--bg); background: var(--accent); border-color: var(--accent); }
  #log-errors button:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  #log-errors .le-close { margin-left: auto; }
  #log-errors .le-note { margin: 0 0 6px; color: var(--text3); }
  #log-errors .le-svc { margin: 6px 0 0; border: 1px solid var(--border); border-left: 3px solid var(--le-tone, var(--border)); background: var(--raised); }
  #log-errors .le-svc[data-tone="fail"] { --le-tone: var(--err); }
  #log-errors .le-svc[data-tone="warn"] { --le-tone: var(--warn); }
  #log-errors .le-svc > header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 4px 10px; padding: 6px 8px; }
  #log-errors .le-name { font-weight: 700; color: var(--text); overflow-wrap: anywhere; }
  #log-errors .le-nums { display: flex; flex-wrap: wrap; gap: 4px 10px; color: var(--text2); }
  #log-errors .le-links { display: flex; gap: 4px; align-items: start; }
  #log-errors .le-badge { display: inline-block; padding: 0 5px; font-size: 10px; letter-spacing: 0.08em; border: 1px solid currentColor; }
  #log-errors .le-badge.new { color: var(--err); }
  #log-errors .le-badge.spike { color: var(--warn); }
  #log-errors .le-badge.restart { color: var(--info); }
  #log-errors .le-badge.seen { color: var(--text3); }
  #log-errors details { border-top: 1px solid var(--border); padding: 4px 8px; }
  #log-errors summary { cursor: pointer; display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto; gap: 8px; align-items: baseline; list-style: none; }
  #log-errors summary::-webkit-details-marker { display: none; }
  #log-errors summary::before { content: "▸"; color: var(--text3); }
  #log-errors details[open] > summary::before { content: "▾"; }
  #log-errors .le-msg { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); }
  #log-errors .le-count { color: var(--text2); white-space: nowrap; }
  #log-errors .le-facts { margin: 4px 0; color: var(--text3); }
  #log-errors pre { margin: 4px 0 2px; padding: 6px 8px; max-height: 260px; overflow: auto; background: var(--bg); color: var(--text2); border: 1px solid var(--border); font: 11px/1.35 var(--font-mono); white-space: pre; }
  #log-errors .le-empty { padding: 10px; color: var(--text3); }
  :root[data-theme="pip"] #log-errors { text-transform: none; box-shadow: inset 0 0 0 1px #000, 0 0 18px rgba(20, 255, 106, 0.12), 0 14px 40px rgba(0, 0, 0, 0.6); }
  :root[data-theme="pip"] #log-errors .le-head h2 { text-shadow: 0 0 6px currentColor; }
  :root[data-theme="pip"] #log-errors .le-badge { text-transform: uppercase; }
  :root[data-theme="pro"] #log-errors { border-radius: 10px; font-family: var(--font-ui); background: var(--raised); }
  :root[data-theme="pro"] #log-errors .le-head h2 { color: var(--text); letter-spacing: 0.02em; font-weight: 600; }
  :root[data-theme="pro"] #log-errors .le-svc { border-radius: 8px; background: var(--surface); }
  :root[data-theme="pro"] #log-errors button { border-radius: 6px; }
  :root[data-theme="pro"] #log-errors .le-badge { border-radius: 999px; padding: 0 7px; font-weight: 600; letter-spacing: 0.02em; }
  :root[data-theme="pro"] #log-errors pre { border-radius: 6px; }
  @media (max-width: 820px) {
    #log-errors { left: 4px; right: 4px; }
    #log-errors .le-svc > header { grid-template-columns: minmax(0, 1fr); }
  }
`;
