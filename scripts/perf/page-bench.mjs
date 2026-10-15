#!/usr/bin/env node
// Page load bench: one headless Chrome, a fresh profile, the page at --url
// (--width, default 1024), --runs times. Prints per-run timings, every
// request the page made (count, bytes, duplicates), main-thread cost
// (Script/Layout/Recalc/Task ms from CDP) and long tasks. The browser is
// always closed in finally (no leftover headless Chrome).
//   node scripts/perf/page-bench.mjs --url http://127.0.0.1:9301/ [--hash cluster] [--runs 3] [--chrome /usr/bin/google-chrome] [--pptr path]
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const URL_ = arg("url", "http://127.0.0.1:9301/"), RUNS = Number(arg("runs", 3)), W = Number(arg("width", 1024));
const ready = arg("ready", "");
const { default: puppeteer } = await import(arg("pptr", "puppeteer-core"));
const browser = await puppeteer.launch({ executablePath: arg("chrome", "/usr/bin/google-chrome"), headless: true, args: ["--no-sandbox", "--disable-gpu"] });
const out = [];
try {
  for (let r = 0; r < RUNS; r++) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: W, height: 768 });
    await page.evaluateOnNewDocument(() => {
      window.__long = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(e.duration); }).observe({ type: "longtask", buffered: true });
    });
    const reqs = new Map();
    const cdp = await page.createCDPSession();
    await cdp.send("Network.enable");
    cdp.on("Network.requestWillBeSent", (e) => reqs.set(e.requestId, { url: e.request.url, t0: e.timestamp }));
    cdp.on("Network.loadingFinished", (e) => { const q = reqs.get(e.requestId); if (q) { q.t1 = e.timestamp; q.bytes = e.encodedDataLength; } });
    const t0 = Date.now();
    await page.goto(URL_, { waitUntil: "load", timeout: 120000 });
    const load = Date.now() - t0;
    if (ready) await page.waitForSelector(ready, { timeout: 120000 }).catch(() => {});
    const readyMs = Date.now() - t0;
    await page.waitForNetworkIdle({ idleTime: 1500, timeout: 120000 }).catch(() => {});
    const idle = Date.now() - t0 - 1500;
    const m = await page.metrics();
    const longs = await page.evaluate(() => window.__long);
    const list = [...reqs.values()];
    const api = list.filter((q) => /\/api\//.test(q.url));
    const counts = {};
    for (const q of api) { const k = q.url.replace(/^https?:\/\/[^/]+/, ""); counts[k] = (counts[k] || 0) + 1; }
    const first = Math.min(...list.map((q) => q.t0));
    const row = {
      run: r + 1, loadMs: load, readyMs: ready ? readyMs : undefined, idleMs: idle,
      requests: list.length, kb: Math.round(list.reduce((s, q) => s + (q.bytes || 0), 0) / 1024),
      js: list.filter((q) => /\.js(\?|$)/.test(q.url)).length,
      api: api.length, dupApi: Object.entries(counts).filter(([, n]) => n > 1),
      slowestApi: api.filter((q) => q.t1).map((q) => ({ u: q.url.replace(/^https?:\/\/[^/]+/, "").slice(0, 70), startMs: Math.round((q.t0 - first) * 1000), ms: Math.round((q.t1 - q.t0) * 1000) })).sort((a, b) => b.ms - a.ms).slice(0, 8),
      scriptMs: Math.round(m.ScriptDuration * 1000), layoutMs: Math.round(m.LayoutDuration * 1000), recalcMs: Math.round(m.RecalcStyleDuration * 1000), taskMs: Math.round(m.TaskDuration * 1000),
      longTasks: longs.length, longMax: Math.round(Math.max(0, ...longs)), longSum: Math.round(longs.reduce((a, b) => a + b, 0)),
    };
    out.push(row);
    console.log(JSON.stringify(row));
    await ctx.close();
  }
} finally {
  await browser.close();
}
