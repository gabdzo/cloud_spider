// The cluster TELEMETRY screen (DOM). Data from /api/cluster/telemetry
// (kube-telemetry.js); instruments from tele-draw.js; colours via theme CSS
// variables only.
import { drawCapacity, drawChart, drawGauge } from "./tele-draw.js";
import { STATUS, PIP, WORLD } from "./theme.js";
import { topPods } from "./kube-telemetry.js";

const SVG = "http://www.w3.org/2000/svg";
const CHIPS = [PIP.bright, WORLD.amber, WORLD.vault, WORLD.toxic, WORLD.flame, WORLD.tan, WORLD.glow];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Same look as the vault METRICS sparklines.
export function spark(points) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 100 16");
  svg.setAttribute("preserveAspectRatio", "none");
  const values = (points || []).map((p) => (p == null ? null : Number(p)));
  const seen = values.filter((v) => v != null);
  const top = Math.max(...seen, 0) || 1;
  const step = values.length > 1 ? 100 / (values.length - 1) : 100;
  const line = document.createElementNS(SVG, "polyline");
  line.setAttribute("points", values.map((v, i) => (v == null ? null : `${(i * step).toFixed(1)},${(15 - (v / top) * 13).toFixed(1)}`)).filter(Boolean).join(" "));
  svg.append(line);
  return svg;
}

function lamp(label, state) {
  const span = el("span", `kt-lamp ${state}`);
  span.append(el("i"), el("b", "", label));
  return span;
}

const SOURCE = {
  otel: ["on", "OTEL COLLECTOR", "kubeletstats + hostmetrics via the otel-metrics Service (kube API proxy, read-only)"],
  "metrics-server": ["warn", "METRICS-SERVER", "fallback: CPU and memory only. Disk, load and network need the OTel metrics (RUN-ME §14)"],
  none: ["off", "NO METRICS", "neither the OTel gateway nor metrics-server answered (RUN-ME §8, §14)"],
};

export function renderTelemetry(root, data, { width = 1200, cloudwatch = {}, metricValue = null } = {}) {
  root.replaceChildren();
  if (!data || data.error) {
    root.append(el("p", "kt-note err", data?.error ? `TELEMETRY · ${data.error}` : "reading telemetry…"));
    return;
  }
  const [state, name, why] = SOURCE[data.source] || SOURCE.none;
  const head = el("div", "kt-head");
  head.append(lamp(name, state), el("span", "kt-why", why));
  const filled = Math.max(0, ...data.nodes.map((n) => n.history.cpu.length));
  head.append(el("span", "kt-hist", `HISTORY ${Math.round((filled * (data.sampleMs || 30000)) / 60000)}/60 MIN · 30 S SAMPLES · IN MEMORY`));
  root.append(head);
  for (const note of [data.note, ...(data.notes || [])].filter(Boolean)) root.append(el("p", "kt-note", note));
  for (const limit of data.limits || []) root.append(el("p", "kt-note kt-limit", limit));

  const narrow = width < 900;
  const chartW = Math.max(220, Math.min(560, narrow ? width - 60 : Math.floor((width - 420) / 2)));
  data.nodes.forEach((n, i) => {
    const card = el("article", "kt-node");
    const title = el("div", "kt-title");
    const chip = el("span", "kt-chip", `N${i + 1}`);
    chip.style.color = CHIPS[i % CHIPS.length];
    chip.style.borderColor = CHIPS[i % CHIPS.length];
    title.append(chip, el("span", "kt-name", n.label), el("span", "kt-facts", [n.type, `${n.pods} pods`, n.instanceId].filter(Boolean).join(" · ")));
    card.append(title);
    const lamps = el("div", "kt-lamps");
    lamps.append(lamp("READY", n.conditions.Ready === "True" ? "on" : n.conditions.Ready === "False" ? "alarm" : "off"));
    for (const [cond, label] of [["MemoryPressure", "MEM PRESSURE"], ["DiskPressure", "DISK PRESSURE"], ["PIDPressure", "PID PRESSURE"]]) {
      lamps.append(lamp(label, n.conditions[cond] === "True" ? "alarm" : n.conditions[cond] === "False" ? "idle" : "off"));
    }
    card.append(lamps);

    const gauges = el("div", "kt-gauges");
    const g = (pct, label, value) => {
      const c = el("canvas", "kt-gauge");
      drawGauge(c, { pct, label, value });
      return c;
    };
    gauges.append(
      g(n.cpu.pct, "CPU", n.cpu.used == null ? "" : `${n.cpu.used}m`),
      g(n.mem.pct, "MEM", n.mem.used == null ? "" : `${n.mem.used}Mi`),
      g(n.disk?.pct ?? null, "DISK /", n.disk ? `${n.disk.usedGi}/${n.disk.capGi}Gi` : "needs OTel"),
    );
    const side = el("div", "kt-side");
    const cap = (r, unit, label) => {
      const c = el("canvas", "kt-cap");
      drawCapacity(c, { ...r, unit, label, w: Math.min(360, chartW) });
      return c;
    };
    side.append(cap(n.cpu, "m", "CPU"), cap(n.mem, "Mi", "MEM"));
    const facts = el("p", "kt-small", [n.load1 != null ? `LOAD 1M ${n.load1.toFixed(2)}` : "LOAD needs OTel hostmetrics", n.cpu.reqPct != null ? `CPU REQUESTED ${n.cpu.reqPct}%` : "", n.mem.reqPct != null ? `MEM REQUESTED ${n.mem.reqPct}%` : ""].filter(Boolean).join("  ·  "));
    side.append(facts);
    gauges.append(side);
    card.append(gauges);

    const charts = el("div", "kt-charts");
    const ch = (opts) => {
      const c = el("canvas", "kt-chart");
      drawChart(c, { w: chartW, ...opts });
      return c;
    };
    charts.append(ch({ label: "CPU / MEM % · 1H", lines: [{ name: "CPU", values: n.history.cpu, color: PIP.bright }, { name: "MEM", values: n.history.mem, color: WORLD.amber }] }));
    if (n.history.disk.length) charts.append(ch({ label: "DISK / % · 1H", lines: [{ name: "DISK", values: n.history.disk, color: WORLD.vault }] }));
    else charts.append(el("p", "kt-note", "Disk and load need the OTel collector's metrics (pulumi up on upgrades/demo). EC2 memory and disk in CloudWatch need the CloudWatch agent or node-exporter, which cost extra (RUN-ME §14)."));
    card.append(charts);

    const cw = n.instanceId ? cloudwatch[n.instanceId] : null;
    if (cw) {
      const block = el("div", "vp-metrics kt-cw");
      const h4 = el("h4");
      h4.append(el("span", "", "EC2 · CLOUDWATCH · 3H"), el("span", "", cw.headline || ""));
      const list = el("ul");
      for (const item of cw.series || []) {
        const li = el("li");
        li.append(el("span", "lbl", item.label), spark(item.points || []), el("span", "val", metricValue ? metricValue(item) : String(item.last ?? "—")));
        list.append(li);
      }
      block.append(h4, list);
      card.append(block);
    }
    root.append(card);
  });

  const pods = el("div", "kt-pods");
  for (const [by, label, unit] of [["cpu", "TOP PODS · CPU", "m"], ["mem", "TOP PODS · MEMORY", "Mi"]]) {
    const box = el("section", "kt-top vp-metrics");
    box.append(el("h4", "", label));
    const list = el("ul");
    const top = topPods(data.pods, by);
    if (!top.length) list.append(el("li", "kt-empty", "no pod metrics yet"));
    for (const p of top) {
      const li = el("li", p.oom || p.status === "broken" ? "hot" : "");
      const who = el("span", "lbl kt-pod");
      who.title = `${p.ns}/${p.name}${p.node ? ` on ${p.node}` : ""}`;
      who.append(el("b", "", p.name), el("small", "", p.ns));
      const flags = el("span", "kt-flags");
      if (p.restarts) flags.append(el("em", p.restarts >= 5 ? "bad" : "", `↻${p.restarts}`));
      if (p.oom) flags.append(el("em", "bad", "OOMKILLED"));
      else if (p.lastReason && p.lastReason !== "Completed") flags.append(el("em", "", p.lastReason));
      li.append(who, spark(p.history[by]), el("span", "val", `${p[by]}${unit}`), flags);
      list.append(li);
    }
    box.append(list);
    pods.append(box);
  }
  root.append(pods);
  return { status: STATUS };
}
