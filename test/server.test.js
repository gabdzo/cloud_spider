import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { listen } from "../src/server.js";

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
