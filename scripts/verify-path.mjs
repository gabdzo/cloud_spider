import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const page = process.env.CLOUDSPIDER_URL || "http://127.0.0.1:9241/";
const port = 9333;
const dir = await mkdtemp(join(tmpdir(), "cloudspider-chrome-"));
const child = spawn(
  chrome,
  ["--headless=new", "--disable-gpu", "--no-first-run", "--window-size=1440,900", `--remote-debugging-port=${port}`, `--user-data-dir=${dir}`, page],
  { stdio: "ignore" },
);
const failures = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures.push(name);
};

async function socketUrl() {
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const found = list.find((item) => item.type === "page" && item.webSocketDebuggerUrl);
      if (found) return found.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error("chrome did not open a page");
}

const ws = new WebSocket(await socketUrl());
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", reject);
});
let next = 0;
const pending = new Map();
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  if (!msg.id || !pending.has(msg.id)) return;
  const { resolve, reject } = pending.get(msg.id);
  pending.delete(msg.id);
  if (msg.error) reject(new Error(JSON.stringify(msg.error)));
  else resolve(msg.result);
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++next;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
async function js(expression) {
  const out = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (out.exceptionDetails) throw new Error(out.exceptionDetails.text || "page error");
  return out.result.value;
}
async function loaded() {
  for (let i = 0; i < 80; i += 1) {
    try {
      const ready = await js(`location.href.startsWith(${JSON.stringify(page)}) && document.readyState === "complete" && Boolean(document.querySelector("#region"))`);
      if (ready) {
        await sleep(300);
        return;
      }
    } catch {}
    await sleep(250);
  }
  throw new Error("the page did not load");
}
const waitFor = (test, ms = 20000) =>
  js(`new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const value = (${test})();
      if (value || Date.now() - start > ${ms}) resolve(Boolean(value));
      else setTimeout(tick, 100);
    };
    tick();
  })`);
const status = () => js(`document.querySelector("#status").textContent`);

try {
  await send("Page.enable");
  await loaded();
  await waitFor(`() => {
    const region = document.querySelector("#region");
    const error = document.querySelector("#error");
    return (region && region.options.length) || (error && !error.hidden);
  }`);
  await js(`(() => {
    window.__calls = [];
    const real = window.fetch.bind(window);
    window.fetch = (url, opts) => {
      window.__calls.push(String(url) + " " + ((opts && opts.method) || "GET"));
      return real(url, opts);
    };
  })()`);

  await js(`document.querySelector("#path").click()`);
  const read = await waitFor(`() => {
    const text = document.querySelector("#status").textContent;
    return (text && text !== "reading the path") || !document.querySelector("#error").hidden;
  }`);
  check("Path reads the live region", read, `${await status()} ${await js(`document.querySelector("#error").textContent`)}`);
  check("Path shows the load balancer menu and host box", await js(`!document.querySelector("#lb").hidden && !document.querySelector("#host").hidden`));
  check("the Path button reads Map", (await js(`document.querySelector("#path").textContent`)) === "Map");

  await js(`document.querySelector("#sample").click()`);
  check("Sample in Path says it is a sample", await waitFor(`() => document.querySelector("#status").textContent.startsWith("sample, not the account.")`), await status());
  check("the region menu is disabled during Sample", await js(`document.querySelector("#region").disabled`));

  await js(`(() => {
    const box = document.querySelector("#host");
    box.value = "api.sample.test";
    box.dispatchEvent(new Event("change"));
  })()`);
  check(
    "the pasted host names the blocking security group",
    await waitFor(`() => document.querySelector("#status").textContent.includes("sample-sg-node-b does not allow tcp 8080")`),
    await status(),
  );

  const point = await js(`(async () => {
    const { layoutPath } = await import("/path-layout.js");
    const body = await fetch("/api/path-sample?host=api.sample.test").then((r) => r.json());
    const node = layoutPath(body.diagram).nodes.find((item) => item.kind === "target" && item.status === "hang");
    const rect = document.querySelector("#place").getBoundingClientRect();
    return { x: rect.left + node.x + 20, y: rect.top + node.y + 20 };
  })()`);
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", clickCount: 1 });
  await sleep(300);
  const shot = await send("Page.captureScreenshot", { format: "png" });
  await writeFile("/tmp/cloudspider-path.png", Buffer.from(shot.data, "base64"));
  console.log("screenshot /tmp/cloudspider-path.png");

  const writes = await js(`window.__calls.filter((line) => line.includes("/api/stop") || line.includes("/api/start") || line.endsWith("POST"))`);
  check("Path sent no POST", writes.length === 0, writes.join(", "));

  await js(`document.querySelector("#path").click()`);
  await sleep(500);
  check("leaving Path hides its controls", await js(`document.querySelector("#lb").hidden && document.querySelector("#host").hidden`));
  check("leaving Path enables the region menu", await js(`!document.querySelector("#region").disabled`));
  check("the button reads Path again", (await js(`document.querySelector("#path").textContent`)) === "Path");
} finally {
  ws.close();
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failures.length) {
  console.log(`${failures.length} checks failed`);
  process.exit(1);
}
console.log("all checks passed");
