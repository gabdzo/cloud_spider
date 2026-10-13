// Diagnose through the real kube.js client (fixed GET paths, token, 403/404
// handling) against a fake API server; no cluster needed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createKube } from "../src/kube.js";
import { collectLive } from "../src/diagnose/collect.js";
import { investigation } from "../src/diagnose/investigate.js";
import { kubeconfigFor } from "./fixtures/fake-kube-api.js";

const CTX = { name: "brother", cluster: "brother-kind", server: "https://brother.example" };
const read = async () => kubeconfigFor([CTX]);
const json = (body) => ({ status: 200, body: JSON.stringify(body) });

function api({ rbacWebhooks = true, certManager = true } = {}) {
  const calls = [];
  const get = async (url, opts) => {
    const u = new URL(url);
    calls.push({ path: u.pathname + u.search, token: opts.token });
    const p = u.pathname;
    if (p === "/api/v1/namespaces/orders-system/services/orders-webhook") return json({ spec: { selector: { "control-plane": "controller-manager" }, ports: [{ port: 443, targetPort: 9443 }] } });
    if (p === "/apis/discovery.k8s.io/v1/namespaces/orders-system/endpointslices") return json({ items: [{ endpoints: [] }] });
    if (p === "/apis/discovery.k8s.io/v1/namespaces/cert-manager/endpointslices") return json({ items: [{ endpoints: [{ conditions: { ready: true } }] }] });
    if (p === "/api/v1/namespaces/orders-system/pods") return json({ items: [{ metadata: { name: "orders-controller-0", labels: { "control-plane": "controller-manager" } }, status: { phase: "Pending" } }] });
    if (p.endsWith("validatingwebhookconfigurations")) return rbacWebhooks ? json({ items: [{ metadata: { name: "orders-validating" }, webhooks: [{ name: "vorder.kb.io", failurePolicy: "Fail", clientConfig: { service: { namespace: "orders-system", name: "orders-webhook" } } }] }, { metadata: { name: "cert-manager-webhook" }, webhooks: [{ name: "webhook.cert-manager.io", clientConfig: { service: { namespace: "cert-manager", name: "cert-manager-webhook" } } }] }] }) : { status: 403, body: "{}" };
    if (p.endsWith("mutatingwebhookconfigurations")) return rbacWebhooks ? json({ items: [] }) : { status: 403, body: "{}" };
    if (p.includes("/cert-manager.io/v1/")) return certManager ? json({ items: [{ metadata: { namespace: "orders-system", name: "serving-cert" }, status: { conditions: [{ type: "Ready", status: "False", reason: "DoesNotExist", message: "Issuing certificate as Secret does not exist" }] } }] }) : { status: 404, body: "{}" };
    return { status: 404, body: "{}" };
  };
  return { get, calls };
}

test("operator incident through kube.js: OPS-001 + CERT-001 + NET-001, GET-only, own token, no Secrets", async () => {
  const fake = api();
  const kube = createKube({ env: {}, read, get: fake.get, context: "brother" });
  const t = Date.now();
  const rec = investigation(await collectLive(kube, { namespace: "orders-system", service: "orders-webhook", context: "brother" }));
  assert.ok(Date.now() - t < 30_000, "first summary well under 30 s");
  assert.deepEqual(rec.findings.map((f) => f.code).sort(), ["CERT-001", "NET-001", "OPS-001"]);
  assert.equal(rec.findings.filter((f) => f.code === "OPS-001").length, 1, "the healthy cert-manager webhook is a negative control");
  assert.ok(fake.calls.every((c) => c.token === "token-brother"));
  assert.ok(!fake.calls.some((c) => /\/secrets|\/exec|\/attach|\/portforward/.test(c.path)), "no Secrets, no exec");
  assert.ok(fake.calls.length <= 20, `bounded reads: ${fake.calls.length}`);
});

test("restricted RBAC: webhooks forbidden, cert-manager absent → partial coverage, no OPS/CERT claims", async () => {
  const fake = api({ rbacWebhooks: false, certManager: false });
  const kube = createKube({ env: {}, read, get: fake.get, context: "brother" });
  const rec = investigation(await collectLive(kube, { namespace: "orders-system", service: "orders-webhook", context: "brother" }));
  assert.deepEqual(rec.findings.map((f) => f.code), ["NET-001"]);
  assert.ok(rec.coverage.forbidden.includes("admission-webhooks"));
  assert.ok(rec.coverage.missing.includes("cert-manager"));
  assert.ok(rec.coverage.rules_not_evaluated.includes("OPS-001"));
});
