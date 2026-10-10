import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { listen, listenExit } from "../src/server.js";
import { isInstanceId } from "../src/ids.js";

const id = "i-0abc1234";

function app() {
  const calls = [];
  const ec2 = {
    async describeRegions() {
      return { regions: ["us-east-1"] };
    },
    async defaultRegion() {
      return "us-east-1";
    },
    async describeVpcs() {
      return { items: [] };
    },
    async describeSubnets() {
      return { items: [] };
    },
    async describeInstances() {
      return { items: [] };
    },
    async describeInstance(...args) {
      calls.push(["one", ...args]);
      return null;
    },
    async stopInstances(...args) {
      calls.push(["stop", ...args]);
      return {};
    },
    async startInstances() {
      return {};
    },
  };
  return {
    calls,
    app: createApp({
      ec2,
      trail: { async lookupEvents() { return { event: null }; } },
      logs: { async filter() { return { events: [] }; } },
      logGroup: "",
      pageOrigin: "http://127.0.0.1:8787",
      clock: () => 0,
    }),
  };
}

test("a taken port says the page is already open and any other listen error exits 1", () => {
  const taken = listenExit({ code: "EADDRINUSE", message: "listen EADDRINUSE" }, 9241);
  assert.equal(taken.code, 0);
  assert.equal(taken.line, "Cloud Spider is already open at http://127.0.0.1:9241");
  const other = listenExit({ code: "EACCES", message: "bad" }, 9241);
  assert.equal(other.code, 1);
  assert.match(other.line, /^listen: bad/);
});

test("sample is three local shacks and does not describe the account", async () => {
  let reads = 0;
  const box = app();
  const original = box.app.boot.bind(box.app);
  box.app.boot = async () => {
    reads += 1;
    return original();
  };
  const server = await listen(box.app, 0);
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/sample`);
    const body = await response.json();
    const ids = body.place.instances.map((item) => item.id);
    assert.deepEqual(ids, ["sample-running", "sample-stopped", "sample-untagged"]);
    assert.equal(ids.every((item) => isInstanceId(item)), false);
    assert.match(body.trail[0].text, /^put a machine down  sample-stopped/);
    assert.ok(body.trail.some((row) => row.status === "fail"), "the sample shows what a failure looks like");
    assert.equal(reads, 0);
  } finally {
    server.close();
  }
});

test("the process binds loopback and a foreign stop does not describe", async () => {
  const box = app();
  const server = await listen(box.app, 0);
  try {
    const address = server.address();
    assert.equal(address.address, "127.0.0.1");
    const page = await fetch(`http://127.0.0.1:${address.port}/`);
    const html = await page.text();
    assert.match(html, /CLOUD SPIDER/);
    assert.match(html, /<canvas/);
    // A named icon, so the browser never logs a 404 for /favicon.ico.
    assert.match(html, /<link rel="icon"/);
    assert.match(html, /#place \{ display: block; \}/, "an inline canvas overflows the map and shows scrollbars");
    const hidden = await fetch(`http://127.0.0.1:${address.port}/aws.js`);
    assert.equal(hidden.status, 404);
    const stopped = await fetch(`http://127.0.0.1:${address.port}/api/stop`, {
      method: "POST",
      headers: {
        origin: "http://evil.example",
        "content-type": "application/json",
      },
      body: JSON.stringify({ id }),
    });
    const body = await stopped.json();
    assert.match(body.status, /the stop did not happen/);
    assert.equal(box.calls.some((call) => call[0] === "one"), false);
  } finally {
    server.close();
  }
});

test("path sample is local and names the first break", async () => {
  let reads = 0;
  const box = app();
  const original = box.app.boot.bind(box.app);
  box.app.boot = async () => {
    reads += 1;
    return original();
  };
  const server = await listen(box.app, 0);
  try {
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/path-sample?host=api.sample.test`);
    const body = await response.json();
    assert.equal(
      body.findings[0].sentence,
      "sample-sg-node-b does not allow tcp 8080 from sample-sg-alb. The load balancer cannot reach this target.",
    );
    assert.equal(reads, 0);
    const page = await (await fetch(`http://127.0.0.1:${address.port}/`)).text();
    assert.match(page, /id="path"/);
    assert.match(page, /--pip-bright: #/);
    assert.match(page, /id="tab-map"/);
    assert.match(page, /id="radio-panel"/);
    assert.match(page, /id="lb"/);
    assert.match(page, /id="host"/);
    const layout = await fetch(`http://127.0.0.1:${address.port}/path-layout.js`);
    assert.equal(layout.status, 200);
    const drawer = await fetch(`http://127.0.0.1:${address.port}/path-draw.js`);
    assert.equal(drawer.status, 200);
  } finally {
    server.close();
  }
});

test("every module the page imports is served", async () => {
  const { readFile } = await import("node:fs/promises");
  const { posix } = await import("node:path");
  const box = app();
  const server = await listen(box.app, 0);
  try {
    const { port } = server.address();
    const seen = new Set();
    const queue = ["browser.js"];
    while (queue.length) {
      const name = queue.pop();
      if (seen.has(name)) continue;
      seen.add(name);
      const response = await fetch(`http://127.0.0.1:${port}/${name}`);
      assert.equal(response.status, 200, `${name} is not served`);
      const source = await readFile(new URL(`../src/${name}`, import.meta.url), "utf8");
      const dir = posix.dirname(name);
      for (const match of source.matchAll(/from "(\.{1,2}\/[\w./-]+\.js)"/g)) queue.push(posix.join(dir, match[1]));
    }
  } finally {
    server.close();
  }
});

test("vaults: /api/vaults answers without booting AWS and TEST checks the origin", async () => {
  const { createVaultStore } = await import("../src/vaults.js");
  const { createCheckRunner } = await import("../src/vault-checks.js");
  const { createVaultView } = await import("../src/vault-view.js");
  const { sampleFetch, samplePlace } = await import("../src/sample.js");
  let boots = 0;
  const sampleView = createVaultView({
    store: createVaultStore({ dir: new URL("../samples/vaults/", import.meta.url).pathname }),
    checker: createCheckRunner({ fetch: sampleFetch }),
  });
  const vaultApp = createApp({
    ec2: { async describeRegions() { boots += 1; return { regions: [] }; }, async defaultRegion() { boots += 1; return ""; } },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    vaults: { live: null, sample: sampleView, samplePlace },
    logGroup: "",
    pageOrigin: "http://127.0.0.1:8787",
    clock: () => 0,
  });
  const server = await listen(vaultApp, 0);
  try {
    const { port } = server.address();
    const live = await (await fetch(`http://127.0.0.1:${port}/api/vaults`)).json();
    assert.deepEqual(live.vaults, []);
    assert.equal(live.note, "vaults are not set up");
    const sample = await (await fetch(`http://127.0.0.1:${port}/api/vaults?sample=1`)).json();
    assert.deepEqual(sample.vaults.map((v) => [v.key, v.damaged]), [["landing", false], ["orders-api", false], ["reactor.yaml#0", true]]);
    const post = (origin) => fetch(`http://127.0.0.1:${port}/api/vaults/test`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ key: "orders-api", sample: true }),
    }).then((r) => r.json());
    assert.deepEqual(await post("http://evil.example"), { error: "the test did not run" });
    const tested = await post("http://127.0.0.1:8787");
    assert.equal(tested.vault.status, "fail");
    assert.equal(tested.vault.checks[0].error, "expected 200, got 503");
    assert.equal(boots, 0, "vaults never boot the AWS side");
  } finally {
    server.close();
  }
});

test("every served browser module is valid JavaScript", async () => {
  const { spawnSync } = await import("node:child_process");
  const { FILES } = await import("../src/server.js");
  for (const name of ["vault-draw.js", "vault-layout.js", "vault-state.js", "vault-match.js", "vault-schema.js", "sprites/vault.js"]) {
    assert.ok(FILES.has(name), `${name} is served`);
  }
  for (const name of [...FILES].filter((n) => n.endsWith(".js"))) {
    const result = spawnSync(process.execPath, ["--check", new URL(`../src/${name}`, import.meta.url).pathname], { encoding: "utf8" });
    assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  }
});
