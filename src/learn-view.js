// LEARN: a holotape shelf over the map. Pick a track (Kubernetes/EKS or
// OpenShift EX280), pick a tape, read the task, copy the setup commands,
// reveal hints one at a time and run the read-only check. Progress lives in
// .learn/progress.json (live) or localStorage (SAMPLE). The only requests
// are GET /api/learn and the two same-origin POSTs below, each from a click.
import { rasterise } from "./draw-kit.js";
import { holotapePalette, holotapeSprite, TAPE_H, TAPE_W } from "./sprites/holotape.js";

const SAMPLE_KEY = "cloudspider.learn.sample";
const TRACK_KEY = "cloudspider.learn.track";

// `code` spans in lab text → [{ code, text }] without any HTML parsing.
export function richText(text) {
  const parts = [];
  String(text || "").split("`").forEach((piece, index) => {
    if (piece) parts.push({ code: index % 2 === 1, text: piece });
  });
  return parts;
}

export function labStatus(progress, key) {
  return progress?.[key]?.status || "new";
}

export function trackTally(labs, progress, track) {
  const mine = labs.filter((lab) => lab.track === track);
  const passed = mine.filter((lab) => labStatus(progress, lab.key) === "passed").length;
  return { passed, total: mine.length, text: `${passed}/${mine.length} PASSED` };
}

export const STATUS_WORD = { new: "NEW", started: "STARTED", failing: "FAILING", passed: "PASSED" };

// SAMPLE progress: the same shape as the server's, kept in the browser.
export function createSampleProgress(storage) {
  const read = () => {
    try {
      return JSON.parse(storage?.getItem(SAMPLE_KEY) || "{}") || {};
    } catch {
      return {};
    }
  };
  return {
    all: read,
    update(key, change) {
      const all = read();
      const entry = all[key] || { status: "new", hints: 0, checks: [] };
      if (typeof change.hints === "number") entry.hints = Math.max(entry.hints || 0, change.hints);
      if (change.started && entry.status === "new") entry.status = "started";
      if (change.check) {
        entry.checks = [...(entry.checks || []), { passed: change.check.passed, failed: change.check.failed, ok: change.check.ok }].slice(-5);
        entry.status = change.check.ok ? "passed" : entry.status === "passed" ? "passed" : "failing";
      }
      if (change.reset) Object.assign(entry, { status: "new", hints: 0, checks: [] });
      all[key] = entry;
      try {
        storage?.setItem(SAMPLE_KEY, JSON.stringify(all));
      } catch {}
      return entry;
    },
  };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function rich(tag, className, text) {
  const node = el(tag, className);
  for (const part of richText(text)) node.append(part.code ? el("code", "", part.text) : document.createTextNode(part.text));
  return node;
}

function button(className, text, onClick, title = "") {
  const node = el("button", className, text);
  node.type = "button";
  if (title) node.title = title;
  node.addEventListener("click", onClick);
  return node;
}

export function drawHolotape(canvas, { track, status, frame = 0, scale = 2 }) {
  canvas.width = TAPE_W * scale;
  canvas.height = TAPE_H * scale;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  rasterise(ctx, holotapeSprite(frame), 0, 0, scale, holotapePalette(track, status));
}

export function createLearnView({ root, toggleButton, iconURL, isSample, storage, onNote = () => {}, onChange = () => {}, reducedMotion = () => false }) {
  let open = false;
  let data = { tracks: [], labs: [], progress: {} };
  let loadedFor = null;
  let track = storage?.getItem(TRACK_KEY) || "k8s";
  let selected = "";
  let results = new Map();
  let running = "";
  let spin = null;
  let frame = 0;
  const sampleProgress = createSampleProgress(storage);
  const attempts = new Map();

  const progress = () => (isSample() ? sampleProgress.all() : data.progress || {});
  const labsOf = (id) => data.labs.filter((lab) => lab.track === id);
  const current = () => data.labs.find((lab) => lab.key === selected);

  async function load(force = false) {
    const want = isSample();
    if (!force && loadedFor === want && data.labs.length) return;
    const body = await fetch(`/api/learn${want ? "?sample=1" : ""}`).then((response) => response.json()).catch(() => null);
    data = body && Array.isArray(body.labs) ? body : { tracks: [], labs: [], progress: {}, error: "the labs did not load" };
    loadedFor = want;
    if (!data.tracks.some((item) => item.id === track)) track = data.tracks[0]?.id || "k8s";
    if (!labsOf(track).some((lab) => lab.key === selected)) selected = labsOf(track)[0]?.key || "";
  }

  async function post(path, body) {
    return fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then((response) => response.json())
      .catch(() => ({ error: "the page failed" }));
  }

  async function saveProgress(key, change) {
    if (isSample()) {
      sampleProgress.update(key, change);
      return;
    }
    const body = await post("/api/learn/progress", { key, ...change });
    if (body?.entry) data.progress = { ...data.progress, [key]: body.entry };
  }

  async function copy(text, node) {
    try {
      await navigator.clipboard.writeText(text);
      node.textContent = "COPIED";
    } catch {
      node.textContent = "SELECT";
    }
    setTimeout(() => {
      node.textContent = "COPY";
    }, 1400);
  }

  function commandRows(lines, label, onCopy = () => {}) {
    const box = el("div", "lx-cmds");
    for (const line of lines) {
      const row = el("div", "lx-cmd");
      row.append(el("span", "lx-lbl", label), el("code", "", line));
      row.append(button("cmd lx-copy", "COPY", (event) => {
        copy(line, event.currentTarget);
        onCopy();
      }, `copy: ${line}`));
      box.append(row);
    }
    return box;
  }

  function sectionHead(text, extra) {
    const head = el("div", "lx-sec");
    head.append(el("b", "", text));
    if (extra) head.append(extra);
    return head;
  }

  function tapeCanvas(lab, scale) {
    const canvas = el("canvas", "lx-tape");
    canvas.setAttribute("aria-hidden", "true");
    drawHolotape(canvas, { track: lab.track, status: labStatus(progress(), lab.key), frame: running === lab.key ? frame : 0, scale });
    canvas.dataset.key = lab.key;
    canvas.dataset.scale = String(scale);
    return canvas;
  }

  function paintShelf(shelf) {
    const list = el("ol", "lx-rack");
    for (const lab of labsOf(track)) {
      const status = labStatus(progress(), lab.key);
      const item = el("li");
      const pick = el("button", `lx-slot ${status}`);
      pick.type = "button";
      pick.setAttribute("aria-pressed", String(lab.key === selected));
      pick.setAttribute("aria-label", `${lab.mock ? "mock" : "lab"} ${lab.num} ${lab.title}, ${STATUS_WORD[status].toLowerCase()}`);
      pick.title = `${lab.num} ${lab.title}`;
      pick.append(tapeCanvas(lab, 2), el("span", "lx-num", lab.num), el("span", "lx-name", lab.title));
      pick.addEventListener("click", () => {
        selected = lab.key;
        paint();
        root.querySelector(".lx-player")?.scrollTo?.({ top: 0 });
      });
      item.append(pick);
      list.append(item);
    }
    shelf.replaceChildren(list);
  }

  function paintResult(box, lab) {
    const result = results.get(lab.key);
    box.replaceChildren();
    if (running === lab.key) {
      box.append(el("p", "lx-run", "RUNNING CHECK…"));
      return;
    }
    if (!result) return;
    if (result.error) {
      box.append(el("p", "lx-note fail", result.error));
      for (const reason of result.reasons || []) box.append(el("p", "lx-why", reason));
      return;
    }
    const r = result.result;
    const sum = el("p", `lx-sum ${r.ok ? "ok" : "fail"}`, `${r.ok ? "ALL CLEAR" : "NOT YET"} · ${r.passed} passed, ${r.failed} failed`);
    box.append(sum);
    const list = el("ul", "lx-results");
    for (const line of r.lines) {
      const item = el("li", line.ok ? "ok" : "fail");
      item.append(el("i", "lx-lamp"), el("span", "lx-word", line.ok ? "PASS" : "FAIL"), rich("span", "", line.text));
      list.append(item);
    }
    box.append(list);
    if (r.note) box.append(el("p", "lx-note", r.note));
  }

  function paintPlayer(player) {
    const lab = current();
    player.replaceChildren();
    if (!lab) {
      player.append(el("p", "lx-note", data.error || "No labs on this shelf."));
      return;
    }
    const entry = progress()[lab.key] || { status: "new", hints: 0 };
    const status = entry.status || "new";

    const head = el("div", "lx-head");
    head.append(tapeCanvas(lab, 4));
    const name = el("div", "lx-title");
    name.append(el("small", "", `${lab.track === "ex280" ? "OPENSHIFT" : lab.track === "k8s" ? "KUBERNETES" : "CLOUD"} · ${lab.mock ? "MOCK EXAM" : "LAB"} ${lab.num}`), el("h3", "", lab.title));
    const state = el("span", `lx-state ${status}`);
    state.append(el("i", "lx-lamp"), document.createTextNode(STATUS_WORD[status] || "NEW"));
    name.append(state);
    head.append(name);
    if (lab.twin && data.labs.some((other) => other.key === lab.twin)) {
      const twinTrack = lab.twin.split("/")[0];
      head.append(button("cmd lx-twin", twinTrack === "ex280" ? "OPENSHIFT VERSION" : "K8S VERSION", () => {
        track = twinTrack;
        selected = lab.twin;
        storage?.setItem(TRACK_KEY, track);
        paint();
      }));
    }
    player.append(head);

    player.append(sectionHead("TASK"), rich("p", "lx-task", lab.task));
    if (lab.requirements.length) {
      const list = el("ul", "lx-reqs");
      for (const text of lab.requirements) list.append(rich("li", "", text));
      player.append(sectionHead("REQUIREMENTS"), list);
    }
    if (lab.note) player.append(rich("p", "lx-note", lab.note));

    player.append(sectionHead("SETUP", el("span", "lx-needs", `needs ${lab.needs.join(", ")}`)), commandRows(lab.setup, "SETUP", () => {
      if (status === "new") saveProgress(lab.key, { started: true }).then(paint);
    }));

    const shown = Math.min(entry.hints || 0, lab.hints.length);
    const hintList = el("ol", "lx-hints");
    lab.hints.forEach((text, index) => {
      const item = index < shown ? rich("li", "", text) : el("li", "lx-hidden", "▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒");
      hintList.append(item);
    });
    const more = shown < lab.hints.length
      ? button("cmd lx-hint", `HINT ${shown + 1}/${lab.hints.length}`, () => saveProgress(lab.key, { hints: shown + 1, started: true }).then(paint))
      : el("span", "lx-needs", lab.hints.length ? "all hints shown" : "no hints");
    player.append(sectionHead("HINTS", more), hintList);

    const checkBox = el("div", "lx-check");
    const runButton = button("cmd lx-run-btn", isSample() ? "RUN CHECK (SAMPLE)" : "RUN CHECK", async () => {
      if (running) return;
      running = lab.key;
      startSpin();
      paint();
      const attempt = attempts.get(lab.key) || 0;
      attempts.set(lab.key, attempt + 1);
      const body = await post("/api/learn/check", { key: lab.key, sample: isSample(), attempt });
      running = "";
      stopSpin();
      results.set(lab.key, body);
      if (body?.result) {
        if (isSample()) sampleProgress.update(lab.key, { check: body.result });
        else if (body.entry) data.progress = { ...data.progress, [lab.key]: body.entry };
        onNote(`${lab.title}: ${body.result.passed} passed, ${body.result.failed} failed`, body.result.ok ? "ok" : "hang");
      }
      paint();
    }, lab.check.runnable ? "runs the read-only check script on this machine" : "this check runs inside pods or changes objects; copy it and run it yourself");
    runButton.disabled = Boolean(running) || (!lab.check.runnable && !isSample());
    const checkHead = sectionHead("CHECK", runButton);
    player.append(checkHead, commandRows([lab.check.command], "CHECK"));
    if (!lab.check.runnable) player.append(el("p", "lx-why", "Cloud Spider will not run this one: it execs into pods or writes to the cluster. Copy it into your terminal."));
    paintResult(checkBox, lab);
    player.append(checkBox);

    if (lab.mapping.length) {
      const table = el("table", "lx-map");
      const top = el("tr");
      top.append(el("th", "", "OPENSHIFT"), el("th", "", "KUBERNETES / EKS"));
      table.append(top);
      for (const row of lab.mapping) {
        const line = el("tr");
        line.append(rich("td", "", row.openshift), rich("td", "", row.kubernetes));
        table.append(line);
      }
      player.append(sectionHead("OC → KUBECTL"), table);
    }
    if (lab.noEquivalent.length) {
      const list = el("ul", "lx-noeq");
      for (const text of lab.noEquivalent) list.append(rich("li", "", text));
      player.append(sectionHead("NO EQUIVALENT"), list);
    }
    player.append(sectionHead("RESET · CLEAN UP", button("cmd lx-forget", "FORGET PROGRESS", () => {
      results.delete(lab.key);
      saveProgress(lab.key, { reset: true }).then(paint);
    })), commandRows(lab.reset, "RESET"), commandRows(lab.cleanup, "CLEAN"));
  }

  function paint() {
    if (!open) return;
    const prog = progress();
    const head = el("div", "lx-top");
    const title = el("div", "ptitle");
    const icon = el("img", "px");
    icon.alt = "";
    icon.src = iconURL("learn");
    title.append(icon, document.createTextNode("LEARN · HOLOTAPES"));
    head.append(title);
    const switcher = el("div", "lx-tracks");
    switcher.setAttribute("role", "group");
    switcher.setAttribute("aria-label", "track");
    for (const item of data.tracks) {
      const tally = trackTally(data.labs, prog, item.id);
      const pick = button(`lx-track ${item.id}`, "", () => {
        track = item.id;
        storage?.setItem(TRACK_KEY, track);
        if (!labsOf(track).some((lab) => lab.key === selected)) selected = labsOf(track)[0]?.key || "";
        paint();
      }, item.note);
      pick.setAttribute("aria-pressed", String(item.id === track));
      pick.append(el("i", "lx-band"), el("b", "", item.title), el("small", "", tally.text));
      switcher.append(pick);
    }
    head.append(switcher);
    head.append(button("cmd lx-close", "×", () => setOpen(false), "close LEARN"));
    const shelf = el("div", "lx-shelf");
    shelf.setAttribute("aria-label", "labs");
    const player = el("div", "lx-player");
    paintShelf(shelf);
    paintPlayer(player);
    const body = el("div", "lx-body");
    body.append(shelf, player);
    root.replaceChildren(head, body);
  }

  function redrawTapes() {
    for (const canvas of root.querySelectorAll(`canvas.lx-tape`)) {
      if (canvas.dataset.key !== running) continue;
      const lab = data.labs.find((item) => item.key === canvas.dataset.key);
      if (lab) drawHolotape(canvas, { track: lab.track, status: labStatus(progress(), lab.key), frame, scale: Number(canvas.dataset.scale) || 2 });
    }
  }

  function startSpin() {
    if (reducedMotion() || spin) return;
    spin = setInterval(() => {
      frame += 1;
      redrawTapes();
    }, 160);
  }

  function stopSpin() {
    clearInterval(spin);
    spin = null;
    frame = 0;
  }

  async function setOpen(next) {
    open = Boolean(next);
    root.hidden = !open;
    toggleButton.setAttribute("aria-pressed", String(open));
    onChange();
    if (!open) return;
    await load();
    paint();
  }

  root.hidden = true;
  return {
    toggle: () => setOpen(!open),
    setOpen,
    isOpen: () => open,
    // SAMPLE flipped: progress comes from a different store.
    async refresh() {
      if (!open) return;
      await load();
      paint();
    },
    select(key) {
      const lab = data.labs.find((item) => item.key === key);
      if (!lab) return;
      track = lab.track;
      selected = key;
      paint();
    },
  };
}
