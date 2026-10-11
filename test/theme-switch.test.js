import assert from "node:assert/strict";
import test from "node:test";
import { cssVars, proRemap, ROLES, THEME_NAMES } from "../src/theme.js";
import { applyLabels, configRows, pickTheme, THEME_KEY, THEMES } from "../src/settings-view.js";
import { pageFor, FILES } from "../src/server.js";
import { createApp } from "../src/app.js";
import { listen } from "../src/server.js";
import { effectiveConfig, loadConfig } from "../src/config.js";

function varsIn(block) {
  return new Map([...block.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
}

test("both themes fill the same roles, and pro remaps only vars the Pip page defines", () => {
  assert.deepEqual(THEME_NAMES, ["pip", "pro"]);
  assert.deepEqual(Object.keys(ROLES.pip).sort(), Object.keys(ROLES.pro).sort());
  const css = cssVars();
  const [pipBlock, proBlock] = css.split(':root[data-theme="pro"]');
  assert.ok(proBlock, "a pro block");
  const pip = varsIn(pipBlock);
  const pro = varsIn(proBlock);
  for (const role of ["bg", "raised", "surface", "border", "text", "text2", "text3", "accent", "ok", "warn", "err"]) {
    const name = role.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    assert.ok(pip.has(name) && pro.has(name), role);
  }
  for (const name of Object.keys(proRemap())) assert.ok(pip.has(name), `pro remaps --${name}, which the Pip root defines`);
  // The Pip root is unchanged: its ramp is still the phosphor green.
  assert.equal(pip.get("pip-bright"), "#14ff6a");
  assert.equal(pro.get("pip-bright"), "#e6e8eb");
  assert.match(pro.get("font"), /Inter/);
  assert.match(pro.get("font-mono"), /JetBrains Mono/);
  assert.match(pip.get("font"), /Share Tech Mono/);
});

test("pro text keeps WCAG AA contrast on its surfaces", () => {
  const lum = (hex) => {
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const ratio = (a, b) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  const p = ROLES.pro;
  for (const bg of [p.bg, p.raised, p.surface, p.surface2]) {
    assert.ok(ratio(p.text, bg) >= 7, `text on ${bg}`);
    assert.ok(ratio(p.text2, bg) >= 4.5, `text2 on ${bg}`);
    for (const c of [p.accent, p.ok, p.warn, p.err]) assert.ok(ratio(c, bg) >= 4.5, `${c} on ${bg}`);
  }
});

test("a stored choice wins over ui.theme; nonsense falls back", () => {
  assert.equal(THEME_KEY, "cloudspider.theme");
  assert.deepEqual(THEMES.map((t) => t.id), THEME_NAMES);
  assert.equal(pickTheme("pro", "pip"), "pro");
  assert.equal(pickTheme("", "pro"), "pro");
  assert.equal(pickTheme("neon", "pro"), "pro");
  assert.equal(pickTheme("", "neon"), "pip");
});

test("pro words swap in and the Pip words come back", () => {
  const make = (text, label) => ({ textContent: text, dataset: { proLabel: label }, getAttribute: () => "", setAttribute() {} });
  const radio = make("RADIO", "Activity");
  const caps = make("CAPS", "Cost");
  const root = { querySelectorAll: (sel) => (sel === "[data-pro-label]" ? [radio, caps] : []) };
  applyLabels(root, "pro");
  assert.deepEqual([radio.textContent, caps.textContent], ["Activity", "Cost"]);
  applyLabels(root, "pip");
  assert.deepEqual([radio.textContent, caps.textContent], ["RADIO", "CAPS"]);
});

test("the settings table lists every leaf with its source", () => {
  const rows = configRows({ server: { port: 9300, host: "127.0.0.1" }, aws: { regions: [], profile: "" } }, { "server.port": "--port" });
  assert.deepEqual(rows, [
    { key: "server.port", value: "9300", source: "--port" },
    { key: "server.host", value: "127.0.0.1", source: "default" },
    { key: "aws.regions", value: "[]", source: "default" },
    { key: "aws.profile", value: '""', source: "default" },
  ]);
});

test("the page carries ui.theme on <html>, applies a stored choice before paint, and serves the settings module", async () => {
  assert.match(pageFor("pro"), /<html lang="en" data-theme="pro" data-config-theme="pro">/);
  assert.match(pageFor("bogus"), /data-theme="pip"/);
  const page = pageFor("pip");
  assert.ok(page.indexOf('localStorage.getItem("cloudspider.theme")') < page.indexOf("<style>"), "the stored theme is applied in <head> before the CSS");
  assert.match(page, /id="settings-key"/);
  assert.match(page, /<section id="settings" role="dialog"/);
  assert.ok(FILES.has("settings-view.js"));
  const loaded = loadConfig({ argv: ["--theme", "pro"], env: {}, root: "/nowhere", home: "/nowhere" });
  const server = await listen(createApp({ ec2: {}, trail: {}, logs: {}, clock: () => 0, settings: effectiveConfig(loaded) }), 0);
  try {
    const html = await fetch(`http://127.0.0.1:${server.address().port}/`).then((r) => r.text());
    assert.match(html, /data-theme="pro" data-config-theme="pro"/);
  } finally {
    server.close();
  }
});
