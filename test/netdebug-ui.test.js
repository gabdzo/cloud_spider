// N2: the DEBUG panel in PATH. The pure model over sample runs, the theme
// rules for its CSS, and the wiring in the page.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createNetdebug } from "../src/netdebug/api.js";
import { CHAIN, debugBarShown, ndModel, timingOf } from "../src/netdebug/view.js";
import { ND_CSS, ND_TOKENS } from "../src/netdebug/style.js";
import { FILES } from "../src/server.js";

const ORIGIN = "http://127.0.0.1:9241";
const boom = async () => {
  throw new Error("a sample run touched the network");
};
const nd = () => createNetdebug({ pageOrigin: ORIGIN, probes: { systemDns: boom, dohQuery: boom, tcpConnect: boom, tlsHandshake: boom, httpRequest: boom } });

async function sampleRun(target) {
  const api = nd();
  const started = await api.start(ORIGIN, { target, sample: true });
  assert.ok(started.id, started.error);
  await api.settle(started.id);
  return api.get(started.id);
}

test("sample runs use fixtures only: no network, no audit, marked sample", async () => {
  const run = await sampleRun("https://google.com");
  assert.equal(run.state, "done", run.error);
  assert.equal(run.report.context.sample, true);
  assert.equal(run.report.summary.verdict, "PASS");
  assert.equal(run.report.audit[0].action, "netdebug.sample");
  const nx = await sampleRun("nothing.example");
  assert.equal(nx.report.checks.find((c) => c.id === "L-DNS-03").status, "FAIL");
});

test("model: google.com is a green chain with one redirect and the timing split", async () => {
  const m = ndModel(await sampleRun("https://google.com"));
  assert.equal(m.state, "done");
  assert.equal(m.verdict, "PASS");
  assert.deepEqual(m.chain.map((n) => n.label), ["CLIENT", "DNS", "TCP", "TLS", "HTTP", "ORIGIN"]);
  assert.ok(m.chain.every((n) => n.status === "PASS"));
  assert.ok(m.chain.slice(1).every((n) => n.edgeIn === "ok"));
  assert.match(m.chain.find((n) => n.label === "HTTP").fact, /200 · \d+ ms · 1↪/);
  assert.match(m.chain.find((n) => n.label === "TLS").fact, /v1\.3 · 6\d d/);
  assert.deepEqual(m.timing.parts.map((p) => p.key), ["dns", "connect", "tls", "wait", "transfer"]);
  assert.ok(Math.abs(m.timing.parts.reduce((s, p) => s + p.share, 0) - 1) < 1e-9);
  assert.equal(m.findings.length, 0);
  assert.ok(m.drill.some((c) => c.startsWith("curl -sS -o /dev/null -w")));
  assert.ok(m.drill.some((c) => c.startsWith("openssl s_client")));
  assert.ok(!m.drill.some((c) => c.startsWith("traceroute")), "not-assessed checks are not in the drill");
  assert.match(m.meta, /^sample · local · /);
});

test("model: the sample ALB 503 breaks the edge into the ALB, the finding is on top", async () => {
  const m = ndModel(await sampleRun("web.sample.test"));
  assert.equal(m.verdict, "FAIL");
  const labels = m.chain.map((n) => n.label);
  assert.deepEqual(labels, ["CLIENT", "DNS", "TCP", "TLS", "HTTP", "ALB"]);
  const alb = m.chain.at(-1);
  assert.equal(alb.status, "FAIL");
  assert.equal(alb.edgeIn, "broken");
  assert.equal(m.chain.find((n) => n.label === "DNS").fact, "2 IPs · CNAME");
  assert.equal(m.checks[0].status, "FAIL", "failures first");
  assert.equal(m.checks[0].id, "L-HTTP-01");
  assert.equal(m.findings[0].walkthrough, "alb-503");
  assert.equal(m.counts.FAIL, 1);
  const tls = ndModel(await sampleRun("web.sample.test"), { filter: "tls" });
  assert.ok(tls.checks.length === 3 && tls.checks.every((c) => c.layer === "tls"));
  const fails = ndModel(await sampleRun("web.sample.test"), { filter: "FAIL" });
  assert.deepEqual(fails.checks.map((c) => c.id), ["L-HTTP-01"]);
});

test("model: empty, running and error states", () => {
  assert.equal(ndModel(null).state, "empty");
  const running = ndModel({ id: "x", state: "running", target: { input: "https://a.example/" }, steps: [{ text: "resolve", state: "running" }] });
  assert.equal(running.state, "running");
  assert.equal(running.steps[0].text, "resolve");
  const refused = ndModel({ error: "169.254.169.254 is an instance metadata address: never probed" });
  assert.equal(refused.state, "error");
  assert.match(refused.text, /metadata/);
  assert.equal(timingOf([]), null);
});

test("the chain order: client side first, AWS and cluster layers after HTTP", () => {
  const order = CHAIN.map((c) => c.layer);
  assert.deepEqual(order.slice(0, 5), ["client", "dns", "transport", "tls", "http"]);
  assert.ok(order.indexOf("lb") > order.indexOf("http") && order.indexOf("cluster") > order.indexOf("lb"));
});

test("CSS: role tokens only (no colour literals), both themes styled", () => {
  const css = ND_CSS + JSON.stringify(ND_TOKENS);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\brgba?\(|\bhsla?\(/i);
  for (const name of ["white", "black", "red", "green", "blue", "orange", "yellow", "gray", "grey"]) assert.doesNotMatch(css, new RegExp(`:\\s*${name}\\b`), name);
  assert.match(ND_CSS, /:root:not\(\[data-theme="pro"\]\) #netdebug/);
  assert.match(ND_CSS, /:root\[data-theme="pro"\] #netdebug/);
  for (const role of ["--surface", "--text", "--ok", "--err", "--warn", "--accent"]) assert.ok(Object.values(ND_TOKENS).includes(`var(${role})`), role);
});

test("page wiring: the panel, its CSS and module are served; PATH shows and hides it", () => {
  const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  const browser = readFileSync(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.ok(FILES.has("netdebug/view.js"));
  assert.match(server, /<section id="netdebug" aria-label="network debugging" hidden><\/section>/);
  assert.match(server, /\$\{ND_CSS\}/);
  assert.match(server, /netdebugRoute\(req, res, url, app\.netdebug/);
  assert.match(browser, /import \{ createNetdebugView, debugBarShown \} from "\.\/netdebug\/view\.js";/);
  assert.match(browser, /clickGround\(ui\);\n {2}netdebugView\.show\(\);/);
  assert.match(browser, /hostInput\.hidden = true;\n {2}netdebugView\.hide\(\);/);
  assert.match(browser, /who !== "alb"/, "only an ALB answer moves the PATH diagram");
  const view = readFileSync(new URL("../src/netdebug/view.js", import.meta.url), "utf8");
  assert.doesNotMatch(view, /innerHTML/);
  assert.match(view, /sample: sample\(\) === true/);
});

test("the DEBUG bar belongs to the SNIFF (path) tab only", () => {
  assert.equal(debugBarShown("path"), true);
  for (const mode of ["map", "cluster", "vaults", "", undefined]) assert.equal(debugBarShown(mode), false, String(mode));
  // Every tab change goes through renderChromeParts, which syncs the bar to
  // the mode: leaving PATH for CLUSTER (and then MAP) used to keep it up.
  const browser = readFileSync(new URL("../src/browser.js", import.meta.url), "utf8");
  const parts = browser.slice(browser.indexOf("function renderChromeParts()"));
  assert.match(parts.slice(0, parts.indexOf("\n}\n")), /debugBarShown\(mode\)/);
});
