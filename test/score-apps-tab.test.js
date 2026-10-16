import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { scoreTabs } from "../src/score/view.js";

test("SCORE has an APPS tab wherever Kubernetes is on (full and k8s-only), none without it", () => {
  assert.deepEqual(scoreTabs({ kube: true, aws: true }).map(([, l]) => l), ["CLUSTER", "AWS ACCOUNT", "APPS"]);
  assert.deepEqual(scoreTabs({ kube: true, aws: false }).map(([, l]) => l), ["CLUSTER", "APPS"]);
  assert.deepEqual(scoreTabs({ kube: false, aws: true }).map(([, l]) => l), ["AWS ACCOUNT"]);
});

test("APPS tab opens the per-app panel; Pip-Boy grade tiles click through to one app's card", async () => {
  const browser = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(browser, /openApps: \(\) => openAppScore\(""\)/);
  assert.match(browser, /openApp: \(id\) => openAppScore\(id\)/);
  assert.match(browser, /appsView\.openApp\(id\)/);
  const pip = await readFile(new URL("../src/pipboy-view.js", import.meta.url), "utf8");
  assert.match(pip, /closest\("\[data-app\]"\)[\s\S]{0,80}io\.openApp\(/);
  const apps = await readFile(new URL("../src/score/apps-view.js", import.meta.url), "utf8");
  assert.match(apps, /openApp\(id\) \{ picked = id/);
});
