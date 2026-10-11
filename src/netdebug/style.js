// DEBUG panel CSS. Colours only through the theme role tokens from
// src/theme.js (--bg, --surface, --raised, --text, --text2, --text3,
// --border, --accent, --ok, --warn, --err, --info), which both themes fill,
// so the panel follows the theme switch. The theme blocks at the end change
// shape and type only (glow, caps and brackets for Pip-Boy; rounded cards
// and Inter for pro). test/netdebug-ui.test.js checks: no colour literals.
export const ND_TOKENS = {
  "--n-bg": "var(--surface)",
  "--n-ink": "var(--bg)",
  "--n-raised": "var(--raised)",
  "--n-hover": "var(--hover)",
  "--n-text": "var(--text)",
  "--n-text2": "var(--text2)",
  "--n-muted": "var(--text3)",
  "--n-line": "var(--border)",
  "--n-strong": "var(--border-strong)",
  "--n-accent": "var(--accent)",
  "--n-ok": "var(--ok)",
  "--n-warn": "var(--warn)",
  "--n-bad": "var(--err)",
  "--n-info": "var(--info)",
  "--n-font": "var(--font-mono)",
};

const TONES = `
  #netdebug [data-status="PASS"] { --n-tone: var(--n-ok); }
  #netdebug [data-status="FAIL"] { --n-tone: var(--n-bad); }
  #netdebug [data-status="UNKNOWN"] { --n-tone: var(--n-warn); }
  #netdebug [data-status="NOT_ASSESSED"], #netdebug [data-status="NOT_APPLICABLE"] { --n-tone: var(--n-muted); }
  #netdebug [data-confidence="high"] { --n-tone: var(--n-bad); }
  #netdebug [data-confidence="medium"] { --n-tone: var(--n-warn); }
  #netdebug [data-confidence="low"] { --n-tone: var(--n-muted); }
`;

export const ND_CSS = `
  #netdebug { ${Object.entries(ND_TOKENS).map(([k, v]) => `${k}: ${v};`).join(" ")}
    position: absolute; left: 12px; right: 12px; bottom: 12px; max-height: 66%; z-index: 5;
    display: flex; flex-direction: column; overflow: hidden;
    background: var(--n-bg); color: var(--n-text); border: 1px solid var(--n-strong); font-family: var(--n-font); font-size: 12.5px; line-height: 1.45; }
  #netdebug[hidden] { display: none; }
  ${TONES}
  #netdebug .nd-label { font-size: 10.5px; letter-spacing: .14em; text-transform: uppercase; color: var(--n-text2); white-space: nowrap; }
  #netdebug .nd-quiet { color: var(--n-muted); margin: 0; }
  #netdebug .nd-bar { display: flex; align-items: center; gap: 10px; padding: 8px 12px; border-bottom: 1px solid var(--n-line); background: var(--n-raised); flex-wrap: wrap; }
  #netdebug[data-open="0"] .nd-bar { border-bottom: 0; }
  #netdebug .nd-title { font-size: 12px; letter-spacing: .18em; color: var(--n-accent); }
  #netdebug .nd-url { flex: 1 1 320px; min-width: 200px; font: inherit; font-size: 13px; padding: 5px 9px; color: var(--n-text); background: var(--n-ink); border: 1px solid var(--n-strong); outline: none; }
  #netdebug .nd-url:focus { border-color: var(--n-accent); }
  #netdebug .nd-url::placeholder { color: var(--n-muted); }
  #netdebug .nd-modes { display: inline-flex; gap: 6px; }
  #netdebug .nd-mode { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; font-size: 10.5px; letter-spacing: .12em; color: var(--n-muted); border: 1px solid var(--n-line); background: var(--n-ink); white-space: nowrap; }
  #netdebug .nd-mode i { width: 7px; height: 7px; border-radius: 50%; border: 1px solid var(--n-muted); }
  #netdebug .nd-mode[data-on="1"] { color: var(--n-text); border-color: var(--n-strong); }
  #netdebug .nd-mode[data-on="1"] i { background: var(--n-ok); border-color: var(--n-ok); }
  #netdebug .nd-btn { font: inherit; font-size: 11.5px; letter-spacing: .08em; padding: 4px 12px; cursor: pointer; color: var(--n-accent); background: var(--n-ink); border: 1px solid var(--n-accent); text-decoration: none; white-space: nowrap; }
  #netdebug .nd-btn:hover:not(:disabled) { background: var(--n-hover); }
  #netdebug .nd-btn:disabled { color: var(--n-muted); border-color: var(--n-line); cursor: default; }
  #netdebug .nd-primary:not(:disabled) { color: var(--n-ink); background: var(--n-accent); }
  #netdebug .nd-meta { font-size: 11px; color: var(--n-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 340px; }
  #netdebug .nd-exports { display: inline-flex; gap: 6px; }
  #netdebug .nd-fold { font: inherit; cursor: pointer; color: var(--n-text2); background: transparent; border: 1px solid var(--n-line); padding: 2px 8px; }
  #netdebug .nd-body { overflow: auto; padding: 10px 12px 12px; display: flex; flex-direction: column; gap: 10px; }
  #netdebug[data-open="0"] .nd-body { display: none; }
  #netdebug .nd-body > * { flex-shrink: 0; }
  #netdebug .nd-empty { display: flex; flex-direction: column; gap: 6px; color: var(--n-text2); }
  #netdebug .nd-empty p { margin: 0; max-width: 980px; }
  #netdebug .nd-tries { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-top: 4px; }
  #netdebug .nd-error { display: flex; gap: 10px; align-items: baseline; color: var(--n-bad); border-left: 3px solid var(--n-bad); padding: 6px 10px; background: var(--n-raised); }
  #netdebug .nd-error small { color: var(--n-text2); }
  #netdebug .nd-steps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
  #netdebug .nd-steps li { display: flex; gap: 8px; color: var(--n-text2); }
  #netdebug .nd-steps li[data-state="running"] { color: var(--n-text); }
  #netdebug .nd-steps li[data-state="done"] .nd-glyph { color: var(--n-ok); }
  #netdebug .nd-steps li[data-state="failed"] .nd-glyph { color: var(--n-bad); }
  #netdebug .nd-verdict { display: flex; align-items: center; gap: 12px; font-size: 11.5px; color: var(--n-text2); }
  #netdebug .nd-verdict b { color: var(--n-tone); border: 1px solid var(--n-tone); padding: 1px 10px; letter-spacing: .14em; font-size: 11.5px; }
  #netdebug .nd-chain { list-style: none; margin: 0; padding: 2px 0 4px; display: flex; align-items: stretch; gap: 0; overflow-x: auto; }
  #netdebug .nd-node { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 7px; align-items: center; min-width: 116px; padding: 6px 10px; cursor: pointer;
    background: var(--n-raised); border: 1px solid var(--n-line); border-top: 2px solid var(--n-tone); }
  #netdebug .nd-node:hover, #netdebug .nd-node[aria-pressed="true"] { background: var(--n-hover); border-color: var(--n-strong); border-top-color: var(--n-tone); }
  #netdebug .nd-node .nd-glyph { grid-row: 1 / 3; color: var(--n-tone); font-size: 15px; }
  #netdebug .nd-node b { font-size: 11px; letter-spacing: .12em; }
  #netdebug .nd-node small { font-size: 11px; color: var(--n-text2); white-space: nowrap; }
  #netdebug .nd-edge { flex: 0 0 26px; display: flex; align-items: center; }
  #netdebug .nd-edge i { flex: 1; height: 2px; background: var(--n-ok); position: relative; }
  #netdebug .nd-edge i::after { content: ""; position: absolute; right: -1px; top: -4px; border: 5px solid transparent; border-left-color: inherit; border-left: 6px solid var(--n-ok); border-right: 0; }
  #netdebug .nd-edge[data-edge="broken"] i { background: repeating-linear-gradient(90deg, var(--n-bad) 0 5px, transparent 5px 8px); }
  #netdebug .nd-edge[data-edge="broken"] i::after { border-left-color: var(--n-bad); }
  #netdebug .nd-edge[data-edge="after"] i { background: var(--n-muted); opacity: .6; }
  #netdebug .nd-edge[data-edge="after"] i::after { border-left-color: var(--n-muted); }
  #netdebug .nd-timing { display: grid; grid-template-columns: auto 1fr; grid-template-rows: auto auto; column-gap: 12px; row-gap: 3px; align-items: center; }
  #netdebug .nd-timing .nd-label { grid-row: 1 / 3; }
  #netdebug .nd-tbar { display: flex; height: 10px; background: var(--n-ink); border: 1px solid var(--n-line); overflow: hidden; }
  #netdebug .nd-tbar i { display: block; height: 100%; flex-basis: 0; }
  #netdebug [data-part="dns"] { --n-part: var(--n-info); }
  #netdebug [data-part="connect"] { --n-part: var(--n-ok); }
  #netdebug [data-part="tls"] { --n-part: var(--n-accent); }
  #netdebug [data-part="wait"] { --n-part: var(--n-warn); }
  #netdebug [data-part="transfer"] { --n-part: var(--n-text2); }
  #netdebug .nd-tbar i { background: var(--n-part); }
  #netdebug .nd-tbar i + i { border-left: 1px solid var(--n-ink); }
  #netdebug .nd-tlegend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11px; color: var(--n-text2); }
  #netdebug .nd-tlegend span::before { content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 5px; background: var(--n-part); }
  #netdebug .nd-tlegend b { margin-left: auto; color: var(--n-text); font-weight: 500; }
  #netdebug .nd-main { display: grid; grid-template-columns: minmax(0, 1fr) minmax(280px, 36%); gap: 12px; align-items: start; }
  #netdebug .nd-checks, #netdebug .nd-findings { background: var(--n-raised); border: 1px solid var(--n-line); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  #netdebug .nd-filters { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  #netdebug .nd-chip { font: inherit; font-size: 11px; padding: 1px 9px; cursor: pointer; color: var(--n-text2); background: var(--n-ink); border: 1px solid var(--n-line); }
  #netdebug .nd-chip[data-status] { color: var(--n-tone, var(--n-text2)); }
  #netdebug .nd-chip[aria-pressed="true"] { border-color: var(--n-accent); color: var(--n-text); }
  #netdebug .nd-list { list-style: none; margin: 0; padding: 0; }
  #netdebug .nd-row { display: grid; grid-template-columns: 16px 78px minmax(0, 1fr) auto auto; gap: 8px; align-items: center; padding: 3px 4px; border-top: 1px solid var(--n-line); }
  #netdebug .nd-row .nd-glyph { color: var(--n-tone); text-align: center; }
  #netdebug .nd-row[data-status="NOT_ASSESSED"], #netdebug .nd-row[data-status="NOT_APPLICABLE"] { color: var(--n-muted); }
  #netdebug .nd-id { font-size: 11px; color: var(--n-text2); }
  #netdebug .nd-text { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #netdebug .nd-tool { font-size: 10.5px; color: var(--n-muted); white-space: nowrap; }
  #netdebug .nd-copy { font: inherit; font-size: 10px; letter-spacing: .08em; padding: 0 7px; cursor: pointer; color: var(--n-text2); background: transparent; border: 1px solid var(--n-line); }
  #netdebug .nd-copy:hover { color: var(--n-accent); border-color: var(--n-accent); }
  #netdebug .nd-finding { border-left: 3px solid var(--n-tone); padding: 6px 8px 6px 10px; background: var(--n-ink); display: flex; flex-direction: column; gap: 5px; }
  #netdebug .nd-finding p { margin: 0; }
  #netdebug .nd-fhead { display: flex; gap: 8px; align-items: center; }
  #netdebug .nd-conf { font-size: 10.5px; letter-spacing: .14em; color: var(--n-tone); border: 1px solid var(--n-tone); padding: 0 6px; }
  #netdebug .nd-kind { font-size: 10.5px; color: var(--n-muted); }
  #netdebug .nd-supports, #netdebug .nd-next, #netdebug .nd-verify { display: flex; gap: 6px; align-items: baseline; flex-wrap: wrap; font-size: 11.5px; }
  #netdebug .nd-supports code { font-size: 10.5px; padding: 0 5px; border: 1px solid var(--n-line); color: var(--n-text2); }
  #netdebug .nd-next code { color: var(--n-text); overflow-wrap: anywhere; }
  #netdebug .nd-contra { color: var(--n-warn); }
  #netdebug .nd-whybtn { margin-left: auto; font-size: 10.5px; padding: 0 8px; color: var(--n-accent); border-color: var(--n-accent); }
  #netdebug .nd-why { border: 1px solid var(--n-accent); background: var(--n-raised); padding: 8px 12px 10px; display: flex; flex-direction: column; gap: 8px; }
  #netdebug .nd-whyhead { display: flex; gap: 12px; align-items: baseline; }
  #netdebug .nd-whyhead b { color: var(--n-accent); letter-spacing: .06em; }
  #netdebug .nd-whyhead .nd-fold { margin-left: auto; }
  #netdebug .nd-wsteps { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  #netdebug .nd-wstep { display: grid; grid-template-columns: 26px minmax(0, 1fr); gap: 10px; position: relative; padding-bottom: 8px; }
  #netdebug .nd-wstep::before { content: ""; position: absolute; left: 12px; top: 24px; bottom: 0; border-left: 1px dashed var(--n-strong); }
  #netdebug .nd-wstep[data-last="1"]::before { display: none; }
  #netdebug .nd-wn { width: 24px; height: 24px; display: grid; place-items: center; border: 1px solid var(--n-accent); color: var(--n-accent); font-weight: 600; background: var(--n-ink); }
  #netdebug .nd-wstep[data-state="unknown"] .nd-wn { border-color: var(--n-warn); color: var(--n-warn); }
  #netdebug .nd-wstep[data-last="1"] .nd-wn { background: var(--n-accent); color: var(--n-ink); }
  #netdebug .nd-wbody { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  #netdebug .nd-wbody p { margin: 0; color: var(--n-text2); }
  #netdebug .nd-supports code[data-status] { color: var(--n-tone); border-color: color-mix(in srgb, var(--n-tone) 55%, transparent); }
  #netdebug .nd-wnext { font-size: 11px; color: var(--n-accent); }
  #netdebug .nd-wverdict { border-left: 3px solid var(--n-accent); background: var(--n-ink); padding: 8px 10px; display: flex; flex-direction: column; gap: 6px; }
  #netdebug .nd-wverdict > p { margin: 0; color: var(--n-text); font-weight: 500; }
  #netdebug .nd-wverify { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; font-size: 11.5px; color: var(--n-text2); }
  #netdebug .nd-wverify .nd-lamp { width: 9px; height: 9px; border-radius: 50%; background: var(--n-warn); }
  #netdebug .nd-wverify[data-ok="1"] .nd-lamp { background: var(--n-ok); }
  #netdebug .nd-wverify .nd-btn { margin-left: auto; }
  #netdebug .nd-drill { border: 1px solid var(--n-line); background: var(--n-raised); }
  #netdebug .nd-drill summary { display: flex; gap: 10px; align-items: center; padding: 6px 10px; cursor: pointer; list-style: none; }
  #netdebug .nd-drill summary::-webkit-details-marker { display: none; }
  #netdebug .nd-drill summary::before { content: "▸"; color: var(--n-text2); }
  #netdebug .nd-drill[open] summary::before { content: "▾"; }
  #netdebug .nd-drillpeek { flex: 1; color: var(--n-text2); font-size: 11.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #netdebug .nd-drill ol { margin: 0; padding: 4px 10px 8px 34px; display: flex; flex-direction: column; gap: 3px; }
  #netdebug .nd-drill li { display: flex; gap: 8px; align-items: baseline; }
  #netdebug .nd-drill li code { flex: 1; overflow-wrap: anywhere; color: var(--n-text); }

  /* Pip-Boy: caps, glow, bracketed buttons. */
  :root:not([data-theme="pro"]) #netdebug { text-transform: uppercase; letter-spacing: .03em; box-shadow: inset 0 0 28px color-mix(in srgb, var(--n-text) 6%, transparent); }
  :root:not([data-theme="pro"]) #netdebug .nd-wbody p, :root:not([data-theme="pro"]) #netdebug .nd-wverdict > p, :root:not([data-theme="pro"]) #netdebug .nd-wverify > span:not(.nd-label) { text-transform: none; }
  :root:not([data-theme="pro"]) #netdebug .nd-why { box-shadow: inset 0 0 18px color-mix(in srgb, var(--n-accent) 10%, transparent); }
  :root:not([data-theme="pro"]) #netdebug .nd-wn { box-shadow: 0 0 8px color-mix(in srgb, var(--n-accent) 40%, transparent); }
  :root:not([data-theme="pro"]) #netdebug .nd-url, :root:not([data-theme="pro"]) #netdebug code, :root:not([data-theme="pro"]) #netdebug .nd-next, :root:not([data-theme="pro"]) #netdebug .nd-drill li, :root:not([data-theme="pro"]) #netdebug .nd-finding p { text-transform: none; }
  :root:not([data-theme="pro"]) #netdebug .nd-title, :root:not([data-theme="pro"]) #netdebug .nd-verdict b, :root:not([data-theme="pro"]) #netdebug .nd-node .nd-glyph { text-shadow: 0 0 8px color-mix(in srgb, var(--n-tone, var(--n-accent)) 60%, transparent); }
  :root:not([data-theme="pro"]) #netdebug .nd-btn::before { content: "[ "; }
  :root:not([data-theme="pro"]) #netdebug .nd-btn::after { content: " ]"; }
  :root:not([data-theme="pro"]) #netdebug .nd-primary:not(:disabled) { box-shadow: 0 0 10px color-mix(in srgb, var(--n-accent) 45%, transparent); }
  :root:not([data-theme="pro"]) #netdebug .nd-node { box-shadow: inset 0 0 14px color-mix(in srgb, var(--n-tone) 12%, transparent); }
  :root:not([data-theme="pro"]) #netdebug .nd-edge[data-edge="ok"] i { box-shadow: 0 0 6px color-mix(in srgb, var(--n-ok) 70%, transparent); }
  :root:not([data-theme="pro"]) #netdebug .nd-row:nth-of-type(odd) { background: color-mix(in srgb, var(--n-text) 3%, transparent); }

  /* Pro: Inter, rounded cards, pills. */
  :root[data-theme="pro"] #netdebug { --n-font: var(--font-ui); border-radius: 10px; border-color: var(--n-line); font-size: 13px; box-shadow: 0 8px 28px color-mix(in srgb, var(--n-ink) 70%, transparent); }
  :root[data-theme="pro"] #netdebug code, :root[data-theme="pro"] #netdebug .nd-url, :root[data-theme="pro"] #netdebug .nd-meta, :root[data-theme="pro"] #netdebug .nd-node small, :root[data-theme="pro"] #netdebug .nd-tlegend { font-family: var(--font-mono); }
  :root[data-theme="pro"] #netdebug .nd-bar { border-radius: 10px 10px 0 0; }
  :root[data-theme="pro"] #netdebug .nd-url, :root[data-theme="pro"] #netdebug .nd-btn, :root[data-theme="pro"] #netdebug .nd-fold { border-radius: 6px; }
  :root[data-theme="pro"] #netdebug .nd-btn { font-weight: 600; letter-spacing: .04em; }
  :root[data-theme="pro"] #netdebug .nd-mode, :root[data-theme="pro"] #netdebug .nd-chip, :root[data-theme="pro"] #netdebug .nd-conf, :root[data-theme="pro"] #netdebug .nd-verdict b, :root[data-theme="pro"] #netdebug .nd-supports code { border-radius: 999px; }
  :root[data-theme="pro"] #netdebug .nd-verdict b { background: color-mix(in srgb, var(--n-tone) 14%, transparent); font-weight: 600; }
  :root[data-theme="pro"] #netdebug .nd-node { border-radius: 8px; border-top-width: 1px; box-shadow: inset 0 2px 0 var(--n-tone); }
  :root[data-theme="pro"] #netdebug .nd-checks, :root[data-theme="pro"] #netdebug .nd-findings, :root[data-theme="pro"] #netdebug .nd-drill, :root[data-theme="pro"] #netdebug .nd-error { border-radius: 8px; }
  :root[data-theme="pro"] #netdebug .nd-finding { border-radius: 0 6px 6px 0; }
  :root[data-theme="pro"] #netdebug .nd-tbar { border-radius: 6px; }
  :root[data-theme="pro"] #netdebug .nd-copy { border-radius: 4px; }
  :root[data-theme="pro"] #netdebug .nd-why { border-radius: 8px; }
  :root[data-theme="pro"] #netdebug .nd-wn { border-radius: 50%; }
  :root[data-theme="pro"] #netdebug .nd-wverdict { border-radius: 0 6px 6px 0; }
`;
