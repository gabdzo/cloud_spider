// Scorecard CSS. Colours only through the theme role tokens from
// src/theme.js (cssVars: --bg, --surface, --text, --accent, --ok, ...), which
// both themes fill (:root for Pip-Boy, :root[data-theme="pro"] for the pro
// dark theme), so the panel follows the theme switch. The two theme blocks
// below change shape and type only (glow, caps and brackets for Pip-Boy;
// rounded cards and Inter for pro), never colour literals
// (test/score-view.test.js checks). Rename tokens in SCORE_TOKENS only.
export const SCORE_TOKENS = {
  "--s-bg": "var(--surface)",
  "--s-ink": "var(--bg)",
  "--s-raised": "var(--raised)",
  "--s-card": "var(--surface2)",
  "--s-hover": "var(--hover)",
  "--s-text": "var(--text)",
  "--s-text2": "var(--text2)",
  "--s-muted": "var(--text3)",
  "--s-line": "var(--border)",
  "--s-strong": "var(--border-strong)",
  "--s-accent": "var(--accent)",
  "--s-ok": "var(--ok)",
  "--s-warn": "var(--warn)",
  "--s-bad": "var(--err)",
  "--s-info": "var(--info)",
  "--s-font": "var(--font-mono)",
  "--s-num": "var(--font-mono)",
};

const TONES = `
  #score [data-tone="ok"] { --s-tone: var(--s-ok); }
  #score [data-tone="warn"] { --s-tone: var(--s-warn); }
  #score [data-tone="bad"] { --s-tone: var(--s-bad); }
  #score [data-tone="muted"] { --s-tone: var(--s-muted); }
  #score [data-status="FAIL"] { --s-tone: var(--s-bad); }
  #score [data-status="PASS"] { --s-tone: var(--s-ok); }
  #score [data-status="UNKNOWN"] { --s-tone: var(--s-warn); }
  #score [data-status="NOT_ASSESSED"] { --s-tone: var(--s-info); }
  #score [data-status="NOT_APPLICABLE"] { --s-tone: var(--s-muted); }
`;

export const SCORE_CSS = `
  #score { ${Object.entries(SCORE_TOKENS).map(([k, v]) => `${k}: ${v};`).join(" ")}
    position: absolute; inset: 12px; overflow: auto; padding: 18px 20px 14px; z-index: 6;
    background: var(--s-bg); color: var(--s-text); border: 1px solid var(--s-strong); font-family: var(--s-font); font-size: 13px; line-height: 1.45;
    display: flex; flex-direction: column; gap: 14px; }
  #score[hidden] { display: none; }
  ${TONES}
  #score .sc-label { font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: var(--s-text2); }
  #score .sc-muted { color: var(--s-muted); }
  #score .sc-small { font-size: 11.5px; }
  #score .sc-top { display: grid; grid-template-columns: minmax(210px, 260px) 1fr minmax(190px, 240px); gap: 14px; }
  #score .sc-gauge, #score .sc-meta, #score .sc-side, #score .sc-cat, #score .sc-pane, #score .sc-nextcard, #score .sc-empty { background: var(--s-raised); border: 1px solid var(--s-line); padding: 12px 14px; }
  #score .sc-gauge { display: flex; flex-direction: column; gap: 6px; border-left: 3px solid var(--s-tone); }
  #score .sc-verdict { align-self: flex-start; color: var(--s-tone); border: 1px solid var(--s-tone); padding: 2px 10px; font-size: 12px; letter-spacing: .14em; }
  #score .sc-number { display: flex; align-items: baseline; gap: 4px; color: var(--s-tone); font-family: var(--s-num); }
  #score .sc-number b { font-size: 52px; line-height: 1; font-weight: 600; }
  #score .sc-number small { font-size: 16px; color: var(--s-muted); }
  #score .sc-meta { display: flex; flex-direction: column; gap: 8px; justify-content: center; min-width: 0; }
  #score .sc-meter { display: flex; height: 10px; background: var(--s-ink); border: 1px solid var(--s-line); overflow: hidden; }
  #score .sc-meter i { display: block; height: 100%; }
  #score .sc-meter i[data-part="assessed"], #score .sc-legend [data-part="assessed"]::before { background: var(--s-accent); }
  #score .sc-meter i[data-part="unknown"], #score .sc-legend [data-part="unknown"]::before { background: var(--s-warn); }
  #score .sc-meter i[data-part="not"], #score .sc-legend [data-part="not"]::before { background: var(--s-info); }
  #score .sc-legend { display: flex; gap: 14px; flex-wrap: wrap; font-size: 11.5px; color: var(--s-text2); }
  #score .sc-legend span::before { content: ""; display: inline-block; width: 8px; height: 8px; margin-right: 6px; }
  #score .sc-side { display: flex; flex-direction: column; gap: 8px; }
  #score .sc-spark { display: flex; gap: 3px; align-items: flex-end; height: 44px; padding: 4px; background: var(--s-ink); border: 1px solid var(--s-line); }
  #score .sc-spark i { display: block; flex: 1; max-width: 14px; background: var(--s-tone); opacity: .85; }
  #score .sc-spark i:last-child { opacity: 1; }
  #score .sc-delta[data-up="1"] { color: var(--s-ok); }
  #score .sc-delta[data-up="0"] { color: var(--s-bad); }
  #score .sc-reasons { margin: 0; color: var(--s-text2); }
  #score .sc-cats { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
  #score .sc-cat { display: flex; flex-direction: column; gap: 6px; }
  #score .sc-cat b { font-size: 22px; font-weight: 600; color: var(--s-tone); font-family: var(--s-num); }
  #score .sc-cat[data-tone="muted"] b { font-size: 13px; font-weight: 400; padding: 6px 0 5px; font-family: var(--s-font); }
  #score .sc-catbar { height: 4px; background: var(--s-ink); }
  #score .sc-catbar i { display: block; height: 100%; background: var(--s-tone); }
  #score .sc-btn { font: inherit; font-size: 12px; letter-spacing: .06em; padding: 4px 12px; cursor: pointer; color: var(--s-accent); background: var(--s-ink); border: 1px solid var(--s-accent); white-space: nowrap; }
  #score .sc-btn:hover:not(:disabled) { background: var(--s-hover); }
  #score .sc-btn:disabled { color: var(--s-muted); border-color: var(--s-line); cursor: default; }
  #score .sc-side .sc-btn { margin-top: auto; }
  #score .sc-next { display: flex; flex-direction: column; gap: 8px; }
  #score .sc-nextlist { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 10px; }
  #score .sc-nextcard { display: grid; grid-template-columns: auto 1fr; gap: 4px 10px; align-items: center; border-left: 3px solid var(--s-bad); }
  #score .sc-nextcard .sc-nexttitle { font-weight: 600; }
  #score .sc-nextcard .sc-small { grid-column: 1 / -1; }
  #score .sc-nextcard .sc-btn { grid-column: 1 / -1; justify-self: start; }
  #score .sc-sev { font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase; color: var(--s-text2); border: 1px solid var(--s-line); padding: 1px 6px; justify-self: start; }
  #score .sc-pane { display: flex; flex-direction: column; gap: 10px; border-left: 3px solid var(--s-accent); }
  #score .sc-pane[data-step="refused"], #score .sc-pane[data-step="failed"] { border-left-color: var(--s-bad); }
  #score .sc-pane[data-step="done"] { border-left-color: var(--s-ok); }
  #score .sc-steps { display: flex; gap: 0; margin: 0; padding: 0; list-style: none; counter-reset: st; }
  #score .sc-steps li { flex: 1; counter-increment: st; padding: 6px 8px; font-size: 11.5px; letter-spacing: .08em; text-transform: uppercase; color: var(--s-muted); border-top: 3px solid var(--s-line); }
  #score .sc-steps li::before { content: counter(st) "  "; }
  #score .sc-steps li[data-state="done"] { color: var(--s-ok); border-top-color: var(--s-ok); }
  #score .sc-steps li[data-state="now"] { color: var(--s-accent); border-top-color: var(--s-accent); }
  #score .sc-text { margin: 0; white-space: pre-wrap; }
  #score .sc-log { margin: 0; max-height: 160px; overflow: auto; padding: 8px 10px; font-family: var(--s-num); font-size: 11.5px; color: var(--s-text2); background: var(--s-ink); border: 1px solid var(--s-line); white-space: pre-wrap; }
  #score .sc-actions { display: flex; gap: 8px; }
  #score .sc-table { display: flex; flex-direction: column; }
  #score .sc-tablehead { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding-bottom: 8px; flex-wrap: wrap; }
  #score .sc-counts { display: flex; gap: 6px; flex-wrap: wrap; }
  #score .sc-chip { font-size: 10.5px; letter-spacing: .08em; color: var(--s-tone); border: 1px solid var(--s-tone); padding: 1px 7px; white-space: nowrap; justify-self: start; }
  #score .sc-row { display: grid; grid-template-columns: 9.5em 5.5em 1fr auto; gap: 12px; padding: 8px 4px; border-top: 1px solid var(--s-line); align-items: center; }
  #score .sc-row:hover { background: var(--s-hover); }
  #score .sc-row[data-status="NOT_APPLICABLE"] { opacity: .65; }
  #score .sc-title { display: flex; gap: 10px; align-items: baseline; flex-wrap: wrap; }
  #score .sc-id { color: var(--s-text2); font-family: var(--s-num); font-size: 12px; }
  #score .sc-gate { font-size: 10px; letter-spacing: .1em; color: var(--s-bad); border: 1px solid var(--s-bad); padding: 0 5px; }
  #score .sc-what { min-width: 0; }
  #score .sc-empty { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; max-width: 560px; }
  #score .sc-empty p { margin: 0; }
  #score .sc-disclaimer { margin: 4px 0 0; font-size: 11.5px; color: var(--s-muted); border-top: 1px dashed var(--s-line); padding-top: 10px; }
  @media (max-width: 1100px) { #score .sc-top { grid-template-columns: 1fr 1fr; } #score .sc-side { grid-column: 1 / -1; } }

  /* Pip-Boy: phosphor glow, caps, bracket buttons, scanlines. */
  :root:not([data-theme="pro"]) #score { text-transform: uppercase; letter-spacing: .03em;
    background-image: repeating-linear-gradient(0deg, transparent 0 2px, color-mix(in srgb, var(--s-text) 4%, transparent) 2px 3px); }
  :root:not([data-theme="pro"]) #score .sc-number b, :root:not([data-theme="pro"]) #score .sc-verdict, :root:not([data-theme="pro"]) #score .sc-cat b { text-shadow: 0 0 10px color-mix(in srgb, var(--s-tone) 55%, transparent); }
  :root:not([data-theme="pro"]) #score .sc-label { color: var(--s-text); text-shadow: 0 0 6px color-mix(in srgb, var(--s-text) 40%, transparent); }
  :root:not([data-theme="pro"]) #score .sc-btn::before { content: "[ "; }
  :root:not([data-theme="pro"]) #score .sc-btn::after { content: " ]"; }
  :root:not([data-theme="pro"]) #score .sc-btn.sc-primary:not(:disabled) { color: var(--s-ink); background: var(--s-accent); box-shadow: 0 0 10px color-mix(in srgb, var(--s-accent) 45%, transparent); }
  :root:not([data-theme="pro"]) #score .sc-gauge, :root:not([data-theme="pro"]) #score .sc-cat, :root:not([data-theme="pro"]) #score .sc-pane, :root:not([data-theme="pro"]) #score .sc-nextcard { box-shadow: inset 0 0 18px color-mix(in srgb, var(--s-text) 6%, transparent); }
  :root:not([data-theme="pro"]) #score .sc-row:nth-of-type(odd) { background: color-mix(in srgb, var(--s-text) 3%, transparent); }

  /* pro: neutral dashboard type, rounded cards, filled primary buttons. */
  :root[data-theme="pro"] #score { --s-font: var(--font-ui); border-radius: 10px; border-color: var(--s-line); font-size: 13.5px; }
  :root[data-theme="pro"] #score .sc-gauge, :root[data-theme="pro"] #score .sc-meta, :root[data-theme="pro"] #score .sc-side, :root[data-theme="pro"] #score .sc-cat,
  :root[data-theme="pro"] #score .sc-pane, :root[data-theme="pro"] #score .sc-nextcard, :root[data-theme="pro"] #score .sc-empty { border-radius: 8px; }
  :root[data-theme="pro"] #score .sc-verdict, :root[data-theme="pro"] #score .sc-chip, :root[data-theme="pro"] #score .sc-sev, :root[data-theme="pro"] #score .sc-gate { border-radius: 999px; }
  :root[data-theme="pro"] #score .sc-verdict { background: color-mix(in srgb, var(--s-tone) 14%, transparent); font-weight: 600; }
  :root[data-theme="pro"] #score .sc-meter, :root[data-theme="pro"] #score .sc-catbar, :root[data-theme="pro"] #score .sc-spark, :root[data-theme="pro"] #score .sc-log { border-radius: 6px; }
  :root[data-theme="pro"] #score .sc-spark i { border-radius: 2px 2px 0 0; }
  :root[data-theme="pro"] #score .sc-btn { border-radius: 6px; font-weight: 500; letter-spacing: .02em; }
  :root[data-theme="pro"] #score .sc-btn.sc-primary:not(:disabled) { color: var(--s-ink); background: var(--s-accent); }
  :root[data-theme="pro"] #score .sc-btn.sc-primary:hover:not(:disabled) { filter: brightness(1.1); }
  :root[data-theme="pro"] #score .sc-label { font-weight: 600; letter-spacing: .08em; }
`;
