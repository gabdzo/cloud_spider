// The Pip-Boy chrome around the canvas: pixel icons in the HTML, the mascot,
// the radio panel (stations, oscilloscope, dial), the clock and the status
// bar. Pure helpers are exported for tests; the DOM ones take elements.
import { icon } from "./sprites/icons.js";
import { mascot } from "./sprites/mascot.js";
import { PIP, rgba } from "./theme.js";
import { drawSprite, rasterise } from "./draw-kit.js";

const urls = new Map();

export function iconURL(name, scale = 1) {
  const key = `${name}@${scale}`;
  if (urls.has(key)) return urls.get(key);
  const sprite = icon(name);
  const canvas = document.createElement("canvas");
  canvas.width = sprite[0].length * scale;
  canvas.height = sprite.length * scale;
  rasterise(canvas.getContext("2d"), sprite, 0, 0, scale);
  const url = canvas.toDataURL();
  urls.set(key, url);
  return url;
}

function img(name) {
  const el = document.createElement("img");
  el.className = "px";
  el.alt = "";
  el.width = 16;
  el.height = 16;
  el.src = iconURL(name);
  return el;
}

// Every element with data-icon gets its pixel icon: <img> elements get a
// src, anything else gets an <img> in front of its text.
export function paintIcons(root = document) {
  for (const el of root.querySelectorAll("[data-icon]")) {
    if (el.tagName === "IMG") {
      el.src = iconURL(el.dataset.icon);
      continue;
    }
    const first = el.querySelector("img.px");
    if (first) first.src = iconURL(el.dataset.icon);
    else el.prepend(img(el.dataset.icon));
  }
}

export function setIcon(el, name) {
  el.dataset.icon = name;
  const first = el.querySelector("img.px");
  if (first) first.src = iconURL(name);
}

export function drawMascot(canvas, frame = 0) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawSprite(ctx, mascot(frame), 0, 0, 1);
}

// Radio: one station per CloudTrail change. Quiet and error lines are not
// stations.
export function stationsFrom(text) {
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter(Boolean);
  if (!lines.length || lines[0] === "the radio is quiet" || lines[0].startsWith("the radio cannot")) {
    return { stations: [], note: lines[0] || "" };
  }
  return { stations: lines.map((line) => ({ line, kind: stationKind(line) })), note: "" };
}

export function stationKind(line) {
  const verb = String(line).split(" ")[0];
  if (/^Stop/.test(verb)) return "stop";
  if (/^(Start|Run|Create)/.test(verb)) return "start";
  if (/^(Terminate|Delete|Revoke|Detach|Disassociate)/.test(verb)) return "warn";
  if (/^(Authorize|Attach|Associate|Modify|Put|Update)/.test(verb)) return "refresh";
  return "radio";
}

// Where the dial needle sits, 4%..96%, for station `index` of `count`.
export function needleAt(index, count) {
  if (!count) return 8;
  return 8 + (84 * (index + 0.5)) / count;
}

export function renderRadio(list, text, current = 0) {
  const { stations, note } = stationsFrom(text);
  const shownKey = `${text}|${current}`;
  if (list.dataset.shown === shownKey) return stations;
  list.dataset.shown = shownKey;
  if (!stations.length) {
    const li = document.createElement("li");
    li.className = "quiet";
    li.textContent = note ? `${note}. only static on the band.` : "no signal. only static on the band.";
    list.replaceChildren(li);
    return stations;
  }
  list.replaceChildren(
    ...stations.map((station, index) => {
      const li = document.createElement("li");
      li.dataset.index = String(index);
      if (index === current) li.setAttribute("aria-current", "true");
      li.append(img(station.kind), document.createTextNode(station.line));
      return li;
    }),
  );
  return stations;
}

// Oscilloscope: a phosphor trace whose amplitude follows radio activity. A
// quiet band is a low hiss. Static (time 0) under reduced motion.
export function drawScope(canvas, time, activity) {
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
  if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = rgba(PIP.bright, 0.08);
  for (let x = 0; x < w; x += 20) ctx.fillRect(x, 0, 1, h);
  for (let y = h / 2 % 18; y < h; y += 18) ctx.fillRect(0, y, w, 1);
  ctx.fillStyle = rgba(PIP.bright, 0.18);
  ctx.fillRect(0, Math.floor(h / 2), w, 1);

  const amp = activity ? Math.min(0.42, 0.14 + activity * 0.035) * h : 0.04 * h;
  const t = time / 1000;
  const trace = (alpha, width, offset) => {
    ctx.strokeStyle = rgba(PIP.bright, alpha);
    ctx.lineWidth = width;
    ctx.beginPath();
    for (let x = 0; x <= w; x += 2) {
      const k = x / w;
      const env = Math.sin(Math.PI * k);
      const y =
        h / 2 +
        env *
          amp *
          (Math.sin(k * 18 + t * 5 + offset) * 0.6 +
            Math.sin(k * 41 - t * 9) * 0.3 +
            (activity ? Math.sin(k * 7 + t * 2) * 0.35 : Math.sin(k * 97 + t * 23) * 0.5));
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  trace(0.25, 5, 0);
  trace(1, 1.5, 0);
}

export function clockText(date) {
  return [date.getHours(), date.getMinutes()].map((n) => String(n).padStart(2, "0")).join(":");
}

// Status bar: counts as Pip-Boy readouts plus a "running" meter.
export function mapStats(place) {
  if (!place) return null;
  const instances = place.instances || [];
  const running = instances.filter((item) => item.state === "running").length;
  return {
    cells: [`VPC ${place.vpcs?.length || 0}`, `SUBNETS ${place.subnets?.length || 0}`, `SHACKS ${instances.length}`],
    meter: { label: `LIT ${running}/${instances.length}`, fill: instances.length ? running / instances.length : 0 },
  };
}

export function pathStats(diagram) {
  if (!diagram?.nodes?.length) return null;
  const nodes = diagram.nodes;
  const ok = nodes.filter((node) => node.status === "ok").length;
  const broken = nodes.filter((node) => node.status === "broken").length;
  return {
    cells: [`NODES ${nodes.length}`, `BROKEN ${broken}`, `HANGING ${nodes.filter((node) => node.status === "hang").length}`],
    meter: { label: `HEALTHY ${ok}/${nodes.length}`, fill: ok / nodes.length },
  };
}

export function renderStats(el, stats) {
  if (!stats) {
    el.replaceChildren();
    return;
  }
  const key = JSON.stringify(stats);
  if (el.dataset.shown === key) return;
  el.dataset.shown = key;
  const cells = stats.cells.map((text) => {
    const span = document.createElement("span");
    span.textContent = text;
    return span;
  });
  const meter = document.createElement("span");
  meter.className = "meter";
  const bar = document.createElement("i");
  bar.style.setProperty("--fill", `${Math.round(stats.meter.fill * 100)}%`);
  meter.append(document.createTextNode(stats.meter.label), bar);
  el.replaceChildren(...cells, meter);
}

// The scroll offset that brings [start, start + size) into a viewport of
// `view` pixels scrolled to `scroll`, moving as little as possible. When the
// thing is wider than the view, its start wins.
export function scrollToShow(scroll, view, start, size) {
  if (start < scroll) return Math.max(0, start - 8);
  if (start + size > scroll + view) return Math.max(0, Math.min(start - 8, start + size + 8 - view));
  return scroll;
}
