// The TERMINAL panel: a RobCo-style CRT that asks Gabriel's local Cursor
// agent about what is on screen. Nothing here runs on its own: the only
// request is in ask(), and ask() is only called from the ASK button, the
// prompt's Enter key, or a quick-question chip. "Ask about this" buttons
// only fill the prompt.
import { parseAnswer } from "./agent-text.js";

export const CHIPS = ["Why is a vault red?", "What changed today?", "Explain this path", "Cost summary"];
const HISTORY_KEY = "cloudspider.terminal";
const HISTORY_MAX = 30;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(className, text, onClick) {
  const node = el("button", className, text);
  node.type = "button";
  node.addEventListener("click", onClick);
  return node;
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = el("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {}
    area.remove();
    return ok;
  }
}

export function actionLabel(action) {
  if (action.verb === "up") return `OPEN STACKS · ${action.module.toUpperCase()}`;
  return `${action.verb.toUpperCase()} ${action.id} · Y/N`;
}

export function createTerminal({ root, toggleButton, iconURL, getContext, isSample, onAction, reducedMotion, onChange = () => {} }) {
  let open = false;
  let running = false;
  let light = "idle";
  let entries = [];
  let current = null;
  let shown = "";
  let pending = "";
  let ticking = null;

  try {
    entries = JSON.parse(sessionStorage.getItem(HISTORY_KEY) || "[]").slice(-HISTORY_MAX);
  } catch {
    entries = [];
  }

  root.replaceChildren();
  root.setAttribute("aria-label", "terminal");
  const head = el("div", "term-head");
  const icon = el("img", "px");
  icon.alt = "";
  icon.src = iconURL("terminal");
  const title = el("span", "term-title", "ROBCO TERMLINK · ASK");
  const lightEl = el("span", "term-light");
  const lightText = el("span", "term-state", "IDLE");
  const close = button("term-close", "CLOSE", () => setOpen(false));
  head.append(icon, title, lightEl, lightText, close);
  const note = el("p", "term-note");
  const log = el("div", "term-log");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  const chips = el("div", "term-chips");
  for (const text of CHIPS) chips.append(button("chip", text, () => ask(text)));
  const form = el("form", "term-form");
  const prompt = el("span", "term-prompt", ">");
  const input = el("input", "term-input");
  input.type = "text";
  input.maxLength = 2000;
  input.autocomplete = "off";
  input.spellcheck = false;
  input.placeholder = "ask about the map…";
  input.setAttribute("aria-label", "question for the agent");
  const askButton = el("button", "cmd term-ask", "ASK");
  askButton.type = "submit";
  const cancelButton = button("cmd term-cancel", "CANCEL", () => cancel());
  form.append(prompt, input, askButton, cancelButton);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    ask(input.value);
  });
  root.append(head, note, log, chips, form);

  function save() {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(-HISTORY_MAX)));
    } catch {}
  }

  function setLight(next) {
    light = next;
    lightEl.dataset.state = next;
    lightText.textContent = next.toUpperCase();
    root.dataset.state = next;
  }

  function paintStatic() {
    note.textContent = isSample() ? "SAMPLE: canned answers, no agent runs." : "Runs your local agent, read-only. It never acts; you confirm.";
    askButton.disabled = running;
    cancelButton.disabled = !running;
    input.disabled = running;
    for (const chip of chips.children) chip.disabled = running;
  }

  function blockEl(part) {
    const box = el("div", `term-block${part.lang === "cloudspider" ? " actions" : ""}`);
    const bar = el("div", "term-block-head");
    bar.append(el("span", "", part.lang === "cloudspider" ? "PROPOSED · CLOUD SPIDER" : part.lang ? `PROPOSED · ${part.lang.toUpperCase()}` : "PROPOSED"));
    const copy = button("cmd term-copy", "COPY", async () => {
      copy.textContent = (await copyText(part.text)) ? "COPIED" : "COPY FAILED";
      setTimeout(() => (copy.textContent = "COPY"), 1500);
    });
    bar.append(copy);
    box.append(bar, el("pre", "", part.text));
    if (part.actions.length) {
      const row = el("div", "term-actions");
      for (const action of part.actions) row.append(button("cmd term-act", actionLabel(action), () => onAction(action)));
      box.append(row);
    }
    return box;
  }

  function answerEl(entry, text, live) {
    const box = el("div", "term-answer");
    for (const part of parseAnswer(text)) {
      if (part.kind === "text") box.append(el("p", "term-text", part.text));
      else box.append(blockEl(part));
    }
    for (const tool of entry.tools || []) box.append(el("p", "term-tool", `· ${tool}`));
    if (live) box.append(el("span", "term-cursor"));
    if (entry.error) {
      const error = el("div", `term-error ${entry.error.kind || ""}`);
      error.append(el("span", "term-error-text", entry.error.text));
      if (entry.error.fix) error.append(el("span", "term-fix", `FIX: ${entry.error.fix}`));
      box.append(error);
    }
    return box;
  }

  function entryEl(entry, live) {
    const wrap = el("div", "term-entry");
    wrap.append(el("p", "term-q", `> ${entry.q}`));
    wrap.append(answerEl(entry, live ? shown : entry.a, live));
    return wrap;
  }

  function paintLog() {
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
    const nodes = entries.map((entry) => entryEl(entry, entry === current && running));
    if (!entries.length) {
      const hello = el("div", "term-hello");
      hello.append(el("p", "", "ROBCO INDUSTRIES (TM) TERMLINK PROTOCOL"), el("p", "", "> ASK ABOUT THE MAP, A VAULT, A PATH OR THE BILL."), el("span", "term-cursor"));
      nodes.push(hello);
    }
    log.replaceChildren(...nodes);
    if (nearBottom || running) log.scrollTop = log.scrollHeight;
  }

  // Typewriter: reveal the streamed text a few characters a tick, faster
  // when it falls behind; at once under reduced motion.
  function tick() {
    if (!current) return;
    if (reducedMotion() || !pending) {
      shown += pending;
      pending = "";
    } else {
      const step = Math.max(2, Math.ceil(pending.length / 12));
      shown += pending.slice(0, step);
      pending = pending.slice(step);
    }
    current.a = shown;
    paintCurrent();
    if (!pending) stopTicking();
  }

  // While streaming only the newest entry changes.
  function paintCurrent() {
    const last = log.lastElementChild;
    if (!last || !last.classList.contains("term-entry")) return paintLog();
    last.replaceWith(entryEl(current, running));
    log.scrollTop = log.scrollHeight;
  }

  function startTicking() {
    if (!ticking) ticking = setInterval(tick, 30);
  }

  function stopTicking() {
    clearInterval(ticking);
    ticking = null;
  }

  function finish(error) {
    running = false;
    if (current) {
      shown += pending;
      pending = "";
      current.a = shown;
      if (error) current.error = error;
    }
    stopTicking();
    setLight(error && error.kind !== "cancelled" ? "error" : "idle");
    save();
    paintStatic();
    paintLog();
    onChange();
    if (open) input.focus();
  }

  function handle(event) {
    if (event.type === "text") {
      pending += event.text;
      startTicking();
    } else if (event.type === "tool") {
      current.tools = [...(current.tools || []), event.text].slice(-6);
      paintCurrent();
    } else if (event.type === "error") {
      current.pendingError = event;
    }
  }

  // The one place a request to the agent is made.
  async function ask(question) {
    const text = String(question || "").trim();
    if (!text || running) return;
    current = { q: text, a: "", tools: [] };
    entries.push(current);
    if (entries.length > HISTORY_MAX) entries = entries.slice(-HISTORY_MAX);
    shown = "";
    pending = "";
    running = true;
    input.value = "";
    setLight("running");
    paintStatic();
    paintLog();
    onChange();
    let response;
    try {
      response = await fetch("/api/agent", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text, context: getContext(), sample: isSample() }),
      });
    } catch (error) {
      finish({ kind: "failed", text: `the page could not reach the server: ${error?.message || error}` });
      return;
    }
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      finish({ kind: "failed", text: body.error || `the server answered ${response.status}` });
      return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            handle(JSON.parse(line));
          } catch {}
        }
      }
    } catch (error) {
      current.pendingError = { kind: "failed", text: `the stream broke: ${error?.message || error}` };
    }
    const error = current.pendingError;
    delete current.pendingError;
    finish(error ? { kind: error.kind, text: error.text, fix: error.fix } : null);
  }

  async function cancel() {
    if (!running) return;
    cancelButton.disabled = true;
    await fetch("/api/agent/cancel", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }).catch(() => {});
  }

  function setOpen(next) {
    open = Boolean(next);
    root.hidden = !open;
    toggleButton.setAttribute("aria-pressed", String(open));
    if (open) {
      paintStatic();
      paintLog();
      input.focus();
    }
    onChange();
  }

  setLight("idle");
  paintStatic();
  root.hidden = true;

  return {
    toggle() {
      setOpen(!open);
    },
    setOpen,
    isOpen: () => open,
    isRunning: () => running,
    light: () => light,
    // Fill the prompt; never sends.
    prefill(text) {
      setOpen(true);
      if (running) return;
      input.value = text;
      input.focus();
      input.setSelectionRange(text.length, text.length);
    },
    refresh() {
      paintStatic();
    },
  };
}
