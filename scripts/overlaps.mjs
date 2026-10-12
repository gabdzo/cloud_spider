#!/usr/bin/env node
// Overlap detector: opens each view with SAMPLE data at several window sizes
// in both themes and runs test/helpers/overlap-probe.js in the page.
//   node scripts/overlaps.mjs <base-url> <out-dir> [view-prefix] [--sizes=1280x800,...]
// Writes <out-dir>/findings.json (+ a PNG per view) and prints TOTAL n {byKind}.
// test/overlaps.test.js runs it against test/overlaps-baseline.json.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { overlapProbe } from "../test/helpers/overlap-probe.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const click = (sel) => async (p) => { await p.evaluate((s) => document.querySelector(s)?.click(), sel); await wait(1200); };
const sub = (t) => async (p) => { await p.evaluate((t) => [...document.querySelectorAll("#kube-tabs button")].find((x) => x.textContent.trim().toUpperCase().startsWith(t))?.click(), t); await wait(1500); };
export const VIEWS = {
  map: [],
  sniff: [click("#path")],
  "cl-topology": [click("#cluster"), sub("TOPOLOGY")],
  "cl-telemetry": [click("#cluster"), sub("TELEMETRY")],
  "cl-ops": [click("#cluster"), sub("OPS")],
  "cl-services": [click("#cluster"), sub("SERVICES")],
  "cl-services-side": [click("#cluster"), sub("SERVICES"), async (p) => { await p.evaluate(() => document.querySelector("#kube-graph .gv-card")?.click()); await wait(1000); }],
  "cl-services-nimbus": [click("#cluster"), sub("SERVICES"), async (p) => { await p.evaluate(() => [...document.querySelectorAll("#kube-graph [data-scenario]")].find((b) => b.dataset.scenario !== "bare")?.click()); await wait(2000); }],
  // the opened demo group scrolled into view: cards and rate badges inside one group
  "cl-services-demo": [click("#cluster"), sub("SERVICES"), async (p) => { await p.evaluate(() => { const g = [...document.querySelectorAll("#kube-graph .gv-group")].find((x) => x.querySelector(".gv-glabel")?.textContent === "demo"); const o = g?.querySelector(".gv-open"); if (o && o.getAttribute("aria-expanded") !== "true") o.click(); }); await wait(1200); await p.evaluate(() => [...document.querySelectorAll("#kube-graph .gv-group")].find((x) => x.querySelector(".gv-glabel")?.textContent === "demo")?.scrollIntoView({ block: "start" })); await wait(1000); }],
  "cl-logs": [click("#cluster"), sub("LOG ERRORS")],
  k9s: [click("#cluster"), click("#k9s-btn")],
  vaults: [click("#tab-vaults")],
  stacks: [click("#upgrade")],
  learn: [click("#learn-key")],
  score: [click("#score-key")],
  ask: [click("#ask")],
  settings: [click("#settings-key")],
};
export const SIZES = [[1024, 768], [1280, 800], [1440, 900], [1920, 1080]];
export const THEMES = ["pip", "pro"];
export const CHROMES = [process.env.CHROME, "/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"].filter(Boolean);
export const findChrome = () => CHROMES.find((p) => existsSync(p)) || "";

export async function runOverlaps({ base, dir = "", only = [], sizes = SIZES, themes = THEMES, shots = !!dir, settle = false }) {
  const { default: puppeteer } = await import("puppeteer-core");
  if (dir) mkdirSync(dir, { recursive: true });
  const b = await puppeteer.launch({ executablePath: findChrome(), args: ["--no-sandbox", "--disable-gpu"] });
  const all = {};
  try {
    for (const theme of themes) for (const [w, h] of sizes) for (const [name, steps] of Object.entries(VIEWS)) {
      if (only.length && !only.some((o) => name === o || name.startsWith(`${o}-`) || (o.endsWith("*") && name.startsWith(o.slice(0, -1))))) continue;
      const p = await b.newPage();
      await p.setViewport({ width: w, height: h });
      await p.evaluateOnNewDocument((t) => { localStorage.clear(); localStorage.setItem("cloudspider.theme", t); localStorage.setItem("cloudspider.cluster.screen", "topology"); }, theme);
      await p.goto(`${base}/#map?sample=1`, { waitUntil: "networkidle2", timeout: 60000 });
      await wait(2000);
      for (const s of steps) await s(p);
      await wait(500);
      const key = `${name}-${theme}-${w}`;
      all[key] = await p.evaluate(overlapProbe);
      // settle: views that are still laying out (fonts, late data) get a
      // second look; the calmer reading counts.
      if (settle && all[key].length) { await wait(1500); const again = await p.evaluate(overlapProbe); if (again.length < all[key].length) all[key] = again; }
      if (shots && dir) await p.screenshot({ path: `${dir}/${key}.png` });
      await p.close();
    }
  } finally {
    await b.close();
  }
  return all;
}

export const summary = (all) => {
  const byKind = {};
  for (const f of Object.values(all).flat()) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  return { total: Object.values(all).reduce((n, f) => n + f.length, 0), byKind };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const flags = Object.fromEntries(args.filter((a) => a.startsWith("--")).map((a) => a.slice(2).split("=")));
  const [base, dir, only = ""] = args.filter((a) => !a.startsWith("--"));
  const sizes = flags.sizes ? flags.sizes.split(",").map((s) => s.split("x").map(Number)) : SIZES;
  const all = await runOverlaps({ base, dir, only: only ? only.split(",") : [], sizes });
  if (dir) writeFileSync(`${dir}/findings.json`, JSON.stringify(all, null, 1));
  const s = summary(all);
  console.log("TOTAL", s.total, JSON.stringify(s.byKind));
}
