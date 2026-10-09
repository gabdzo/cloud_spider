import { layout } from "./layout.js";
import { buildingAt, paint } from "./draw.js";
import { isInstanceId } from "./ids.js";
import {
  clickBuilding,
  clickGround,
  createUi,
  pressN,
  pressY,
  setLogs,
  setRadio,
  setStatus,
  switchRegion,
} from "./ui.js";

const ui = createUi();
const canvas = document.querySelector("#place");
const ctx = canvas.getContext("2d");
const regionSelect = document.querySelector("#region");
const statusEl = document.querySelector("#status");
const radioEl = document.querySelector("#radio");
const confirmEl = document.querySelector("#confirm");
const errorEl = document.querySelector("#error");
const yes = document.querySelector("#yes");
const no = document.querySelector("#no");
const sampleButton = document.querySelector("#sample");
const map = document.querySelector("#map");

let place = null;
let region = "";
let phase = 0;
let pulling = false;
let sample = false;

function renderChrome() {
  statusEl.textContent = ui.status;
  radioEl.textContent = ui.radio || "";
  confirmEl.textContent = ui.confirmation?.line || "";
  no.hidden = !ui.confirmation;
  yes.hidden = !ui.confirmation?.allowsY;
  yes.textContent = ui.confirmation?.verb === "start" ? "bring it back" : "put it down";
}

function draw() {
  const placed = place
    ? layout(place)
    : {
        settlements: [],
        orphans: { items: [], label: "no VPC" },
        contentWidth: 960,
        contentHeight: 640,
      };
  const width = Math.max(placed.contentWidth, map.clientWidth || 960);
  const height = Math.max(placed.contentHeight, map.clientHeight || 640);
  const dpr = window.devicePixelRatio || 1;
  if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  paint(ctx, { placed, ui, region, phase, width, height });
}

function syncSelection() {
  if (!ui.selection || !place) return;
  const found = place.instances.find((item) => item.id === ui.selection.id);
  if (!found) return;
  ui.selection = {
    ...ui.selection,
    state: found.state,
    type: found.type,
    name: found.name,
    tags: found.tags,
  };
}

function syncRegions(regions, current) {
  const shown = [...regionSelect.options].map((option) => option.value).join();
  if (shown !== regions.join()) {
    regionSelect.replaceChildren(
      ...regions.map((name) => {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        return option;
      }),
    );
  }
  if (current && regionSelect.value !== current) regionSelect.value = current;
}

async function pull() {
  if (pulling) return;
  pulling = true;
  try {
    const view = await fetch("/api/view").then((response) => response.json());
    setRadio(ui, view.radio || "");
    if (sample) {
      if (view.error) {
        errorEl.hidden = false;
        errorEl.textContent = view.error;
      }
      renderChrome();
      draw();
      return;
    }
    region = view.region || "";
    place = view.place;
    setStatus(ui, view.status || "");
    errorEl.hidden = !view.error;
    errorEl.textContent = view.error || "";
    syncRegions(view.regions || [], view.region);
    syncSelection();
    renderChrome();
    draw();
  } finally {
    pulling = false;
  }
}

function showSample(next) {
  sample = true;
  ui.sample = true;
  place = next;
  regionSelect.disabled = true;
  clickGround(ui);
  setStatus(ui, "sample, not the account");
  renderChrome();
  draw();
}

function leaveSample() {
  sample = false;
  ui.sample = false;
  regionSelect.disabled = false;
  clickGround(ui);
  setStatus(ui, "");
  pull();
}

async function toggleSample() {
  if (sample) {
    leaveSample();
    return;
  }
  try {
    const response = await fetch("/api/sample");
    if (!response.ok) throw new Error("the page failed");
    const body = await response.json();
    if (!body?.place) throw new Error("the page failed");
    showSample(body.place);
  } catch {
    errorEl.hidden = false;
    if (!errorEl.textContent) errorEl.textContent = "the page failed";
  }
}

canvas.addEventListener("click", async (event) => {
  if (!place) {
    clickGround(ui);
    renderChrome();
    draw();
    return;
  }
  const hit = buildingAt(layout(place), event.offsetX, event.offsetY);
  if (!hit) {
    clickGround(ui);
    renderChrome();
    draw();
    return;
  }
  const raw = place.instances.find((item) => item.id === hit.id) || hit;
  clickBuilding(ui, raw, region);
  renderChrome();
  draw();
  if (sample || !isInstanceId(raw.id)) return;
  const logs = await fetch(`/api/logs?id=${encodeURIComponent(raw.id)}`).then((response) => response.json());
  if (ui.selection?.id !== raw.id) return;
  setLogs(ui, logs.lines || [], logs.note || "");
  draw();
});

yes.addEventListener("click", () => act(pressY(ui)));
no.addEventListener("click", () => {
  pressN(ui);
  renderChrome();
  draw();
});

window.addEventListener("keydown", (event) => {
  if (!ui.confirmation) return;
  const key = event.key.toLowerCase();
  if (key !== "y" && key !== "n") return;
  event.preventDefault();
  if (key === "y") act(pressY(ui));
  else {
    pressN(ui);
    renderChrome();
    draw();
  }
});

function flipSample(action) {
  const found = place?.instances?.find((item) => item.id === action.id);
  if (!found) return;
  found.state = action.verb === "stop" ? "stopped" : "running";
  if (ui.selection?.id === found.id) ui.selection = { ...ui.selection, state: found.state };
  setStatus(ui, "sample, not the account");
}

async function act(action) {
  renderChrome();
  draw();
  if (!action) return;
  if (action.local) {
    flipSample(action);
    renderChrome();
    draw();
    return;
  }
  const path = action.verb === "start" ? "/api/start" : "/api/stop";
  const body = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id: action.id }),
  }).then((response) => response.json());
  if (body.status) setStatus(ui, body.status);
  renderChrome();
  await pull();
}

sampleButton.addEventListener("click", () => {
  toggleSample();
});

regionSelect.addEventListener("change", async () => {
  if (sample) return;
  switchRegion(ui);
  renderChrome();
  draw();
  const body = await fetch("/api/region", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ region: regionSelect.value }),
  }).then((response) => response.json());
  if (body.status) setStatus(ui, body.status);
  await pull();
});

setInterval(() => {
  phase = (phase + 1) % 2;
  if (canvas.width) draw();
}, 420);

window.addEventListener("resize", () => draw());

setInterval(() => {
  pull();
}, 2000);

pull();
