// Module gating (modules.js): a module that is off is not drawn anywhere —
// no tab, sub-tab, header button, drawer, STACKS card, morning card,
// settings row or shortcut. The server stamps the page (pageFor) so nothing
// depends on a script race or on this browser's localStorage.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MODULE_IDS, PROFILES, configModule, gateStyle, resolveModules, stackModule } from "../src/modules.js";
import { pageFor } from "../src/server.js";

test("pageFor stamps the enabled modules and hides the rest by CSS", () => {
  const html = pageFor("pro", ["kubernetes", "graph"]);
  assert.match(html, /<html lang="en" data-theme="pro" data-config-theme="pro" data-modules="kubernetes graph">/);
  assert.match(html, /\[data-module~="map"\]/);
  assert.doesNotMatch(gateStyle(["kubernetes", "graph"]), /data-module~="kubernetes"/);
  assert.equal(gateStyle(MODULE_IDS), '<style id="module-gate"></style>');
  // Every static entry point carries its module.
  for (const id of ["tab-map", "path", "cluster", "tab-vaults", "tab-radio", "upgrade", "learn-key", "score-key", "ask", "spend", "morning", "m-logs", "k9s-btn", "kube-tabs", "radio-panel"]) {
    assert.match(html, new RegExp(`id="${id}"[^>]*data-module="`), id);
  }
});

test("stack cards and config rows map to their module", () => {
  assert.equal(stackModule("observe"), "observe");
  assert.equal(stackModule("karpenter"), "stacks");
  assert.equal(configModule("kube.contexts"), "kubernetes");
  assert.equal(configModule("aws.region"), "aws");
  assert.equal(configModule("ui.theme"), "");
});

const CHROME = ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find(existsSync);
let puppeteer = null;
try { puppeteer = (await import("puppeteer-core")).default; } catch { puppeteer = null; }

async function freePort() {
  const srv = createServer();
  await new Promise((done) => srv.listen(0, "127.0.0.1", done));
  const { port } = srv.address();
  await new Promise((done) => srv.close(done));
  return port;
}

async function boot(yaml) {
  const home = mkdtempSync(join(tmpdir(), "cs-gate-"));
  const port = await freePort();
  writeFileSync(join(home, "c.yaml"), yaml);
  const env = { PATH: process.env.PATH, HOME: home, PORT: String(port), CLOUDSPIDER_STATE_DIR: join(home, "state"), KUBECONFIG: join(home, "none"), CLOUDSPIDER_CONFIG: join(home, "c.yaml"), CLOUDSPIDER_VAULTS_DIR: join(home, "vaults") };
  const child = spawn(process.execPath, ["src/main.js"], { env, cwd: new URL("..", import.meta.url).pathname, stdio: ["ignore", "pipe", "pipe"] });
  let out = "";
  child.stdout.on("data", (d) => (out += d));
  child.stderr.on("data", (d) => (out += d));
  const deadline = Date.now() + 20_000;
  while (!/cloud spider http/.test(out)) {
    if (child.exitCode != null || Date.now() > deadline) { child.kill(); rmSync(home, { recursive: true, force: true }); throw new Error(`no start:\n${out}`); }
    await new Promise((done) => setTimeout(done, 50));
  }
  const stop = async () => {
    child.kill();
    await new Promise((done) => (child.exitCode != null ? done() : child.once("exit", done)));
    rmSync(home, { recursive: true, force: true });
  };
  return { base: `http://127.0.0.1:${port}`, stop };
}

// The words a header button of each module shows.
const WORDS = { map: /^MAP\b/, network: /^PATH\b/, kubernetes: /^CLUSTER\b/, vaults: /^VAULTS?\b/, radio: /^RADIO\b/, stacks: /^STACKS\b/, learn: /^LEARN\b/, score: /^SCORE/, ask: /^ASK\b/ };
const SCREEN_NEEDS = { graph: "graph", logs: "kubernetes" };

async function audit(page, base, off) {
  return page.evaluate(async ({ off, words, needs }) => {
    const seen = (n) => Boolean(n && n.getClientRects().length && getComputedStyle(n).visibility !== "hidden");
    const bad = [];
    for (const id of off) {
      for (const n of document.querySelectorAll(`[data-module~="${id}"]`)) if (seen(n)) bad.push(`${id}: #${n.id || n.className}`);
    }
    for (const n of document.querySelectorAll("header button, header a, nav button, #kube-tabs button")) {
      if (!seen(n)) continue;
      const text = n.textContent.trim().toUpperCase();
      for (const id of off) if (words[id] && new RegExp(words[id]).test(text)) bad.push(`${id}: button "${text}"`);
      const need = needs[n.dataset.screen];
      if (need && off.includes(need)) bad.push(`${need}: sub-tab ${n.dataset.screen}`);
    }
    // Shortcuts: ":" (k9s) must stay closed when Kubernetes is off.
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: ":", bubbles: true }));
    await new Promise((r) => setTimeout(r, 150));
    if (off.includes("kubernetes") && seen(document.querySelector("#k9s"))) bad.push("kubernetes: ':' opened k9s");
    // STACKS cards.
    const up = await fetch("/api/upgrades").then((r) => (r.ok ? r.json() : { modules: [] })).catch(() => ({ modules: [] }));
    for (const m of up.modules || []) {
      if (m.id === "observe" && off.includes("observe")) bad.push("observe: STACKS card");
      if (m.id !== "observe" && off.includes("stacks")) bad.push(`stacks: card ${m.id}`);
    }
    return bad;
  }, { off, words: Object.fromEntries(Object.entries(WORDS).map(([k, v]) => [k, v.source])), needs: SCREEN_NEEDS });
}

const CASES = [
  ...Object.keys(PROFILES).map((profile) => ({ name: `profile ${profile}`, yaml: `modules:\n  profile: ${profile}\n` })),
  ...MODULE_IDS.map((id) => ({ name: `full without ${id}`, yaml: `modules:\n  profile: full\n  enable: [observe]\n  disable: [${id}]\n` })),
];

test("no visible element or shortcut of a module that is off", { skip: !CHROME || !puppeteer ? "no chrome/puppeteer-core" : false, timeout: 300_000 }, async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const c of CASES) {
      const app = await boot(c.yaml);
      try {
        const cfg = await fetch(`${app.base}/api/config`).then((r) => r.json());
        const on = cfg.modules.enabled;
        const off = MODULE_IDS.filter((id) => !on.includes(id));
        assert.ok(off.length, c.name);
        for (const hash of ["", "#cluster", "#path", "#vaults"]) {
          const page = await browser.newPage();
          await page.setViewport({ width: 1440, height: 900 });
          await page.goto(`${app.base}/${hash}`, { waitUntil: "domcontentloaded" });
          await new Promise((r) => setTimeout(r, 900));
          const bad = await audit(page, app.base, off);
          await page.close();
          assert.deepEqual(bad, [], `${c.name} ${hash || "home"}`);
        }
      } finally {
        await app.stop();
      }
    }
  } finally {
    await browser.close();
  }
});

test("resolveModules honours enable/disable on a profile", () => {
  const m = resolveModules({ modules: { profile: "full", enable: ["observe"], disable: ["map"] } });
  assert.ok(m.has("observe") && !m.has("map"));
});
