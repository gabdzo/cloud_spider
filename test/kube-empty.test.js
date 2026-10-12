import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { connectSteps } from "../src/kube-empty.js";

test("how-to-connect: read-only view role, the named context, and no Secrets access", () => {
  const steps = connectSteps("my-viewer");
  const all = steps.flatMap((s) => s.code).join("\n");
  assert.match(all, /--clusterrole=view /);
  assert.match(all, /set-context my-viewer /);
  assert.doesNotMatch(all, /cluster-admin|edit|secrets/);
  assert.match(steps[0].alt, /OpenShift/);
  assert.match(connectSteps("")[1].title, /cloudspider-viewer/);
});

test("the Cluster view shows it when the context is unset, in both themes, and serves the file", () => {
  const browser = readFileSync(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(browser, /Boolean\(clusterData\?\.unset\) && !clusterData\?\.diagram/);
  assert.match(browser, /modulesVisible && !modulesVisible\.includes\("aws"\)\) \|\| kubeEmpty\.isShown\(\)/, "no EKS strip without aws");
  const server = readFileSync(new URL("../src/server.js", import.meta.url), "utf8");
  assert.ok(server.includes('"kube-empty.js"'));
  assert.match(server, /<section id="kube-empty"/);
  assert.match(server, /:root\[data-theme="pro"\] #kube-empty \.ke-step/);
  const app = readFileSync(new URL("../src/app.js", import.meta.url), "utf8");
  assert.match(app, /unset: !!snap\.unset, reason: snap\.error/);
});
