// CONNECT never writes the kubeconfig without an explicit yes, and says
// truthfully what it writes. Fakes; cluster "shop-east".
import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { SCHEMA } from "../src/config.js";

const ORIGIN = "http://127.0.0.1:9241";
function world(state) {
  const ran = [];
  const upgrade = { runSteps: (opts) => { ran.push(opts); return { running: true, stack: opts.stack }; }, refuse: ({ error }) => ({ error, state: "refused" }) };
  const connector = { readKubeconfig: async () => ({ config: { "current-context": "home" }, path: "/home/u/.kube/config" }), kubeconfigPath: () => "/home/u/.kube/config", backupPath: () => "/home/u/.kube/config.cloudspider.bak", backupKubeconfig: async () => ({}) };
  const app = createApp({ upgrade, connector, pageOrigin: ORIGIN, clock: () => 0, write() {}, autoConnect: false });
  app.connectStatus = async () => state;
  return { app, ran };
}
const notConnected = { state: "not-connected", stack: "eks-shop-east", roleArn: "arn:aws:iam::1:role/shop-east-viewer", alias: "shop-east-viewer", kubeconfig: "/home/u/.kube/config", text: "NOT CONNECTED" };

test("CONNECT that would write ~/.kube/config asks first and runs nothing", async () => {
  const { app, ran } = world(notConnected);
  const got = await app.connectRun(ORIGIN, { cluster: "shop-east", action: "connect" });
  assert.equal(ran.length, 0);
  assert.equal(got.needsConfirm, true);
  assert.match(got.confirm, /\/home\/u\/\.kube\/config/);
  assert.match(got.confirm, /shop-east-viewer/);
});

test("CONNECT with the explicit yes runs, backup first", async () => {
  const { app, ran } = world(notConnected);
  await app.connectRun(ORIGIN, { cluster: "shop-east", action: "connect", confirmKubeconfig: true });
  assert.equal(ran.length, 1);
  assert.match(ran[0].steps[0].text, /back up/);
  assert.ok(ran[0].steps.some((s) => s.cmd === "aws"));
});

test("a context that already exists is only listed: no confirm, no backup, no kubeconfig write", async () => {
  const { app, ran } = world({ ...notConnected, state: "not-listed", context: "shop-east-viewer" });
  const got = await app.connectRun(ORIGIN, { cluster: "shop-east", action: "connect" });
  assert.ok(!got.needsConfirm);
  assert.equal(ran.length, 1);
  assert.ok(!ran[0].steps.some((s) => /back up/.test(s.text) || s.cmd === "aws" || s.cmd === "kubectl"), ran[0].steps.map((s) => s.text).join(" | "));
});

test("auto CONNECT after a RUN is off by default", () => {
  assert.equal(SCHEMA.kube.autoConnect.default, false);
});
