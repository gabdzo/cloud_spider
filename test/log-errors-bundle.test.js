// LOG ERRORS finds the observe bundle's Loki by itself (service proxy, no
// logs.loki.url) and reads its OTLP labels; a configured Loki with plain
// namespace labels still wins; no bundle → the "no log store" note.
import assert from "node:assert/strict";
import test from "node:test";
import { createLogReport } from "../src/log-report.js";
import { BUNDLE_SELECTOR, lokiEntries } from "../src/log-sources.js";
import { PATHS } from "../src/kube.js";

const NOW = Date.parse("2026-10-12T07:30:00Z");
const line = (msOffset, text) => [String((NOW - msOffset) * 1e6), text];
const otlp = { data: { result: [{ stream: { k8s_namespace_name: "demo", service_name: "orders", k8s_pod_name: "orders-1", k8s_container_name: "app" }, values: [line(3 * 3600e3, "ERROR payment failed id=42"), line(3 * 3600e3 - 1, "java.lang.IllegalStateException: boom")] }] } };

function kube({ installed = true, forbidden = false } = {}) {
  const queries = [];
  return {
    queries,
    async read(name, qs) {
      if (name === "pods") return { json: { items: [] } };
      if (name !== "observeLokiQuery") return { missing: true };
      queries.push(new URLSearchParams(qs).get("query"));
      if (forbidden) return { forbidden: true };
      return installed ? { json: otlp } : { missing: true };
    },
  };
}

test("bundle Loki: auto-discovered through the service proxy, OTLP labels", async () => {
  const k = kube();
  const report = createLogReport({ logs: {}, kube: k, clock: () => NOW });
  assert.equal(report.source(), "bundle");
  const out = await report.report({ fresh: true });
  assert.ok(k.queries.length >= 1 && k.queries.every((q) => q.startsWith(BUNDLE_SELECTOR)));
  assert.ok(JSON.stringify(out).includes("orders"), "errors grouped under the OTLP service_name");
  assert.match(PATHS.observeLokiQuery("query=x&limit=1"), /^\/api\/v1\/namespaces\/cloudspider-observe\/services\/loki:http\/proxy\/loki\/api\/v1\/query_range\?query=x&limit=1$/);
  const [e] = lokiEntries(otlp);
  assert.deepEqual([e.service, e.namespace, e.pod, e.container], ["orders", "demo", "orders-1", "app"]);
});

test("no bundle / forbidden: a clear note; a configured Loki URL keeps plain labels", async () => {
  const none = await createLogReport({ logs: {}, kube: kube({ installed: false }), clock: () => NOW }).report({ fresh: true });
  assert.match(none.notes.join(" "), /observe bundle .* is not installed/);
  const denied = await createLogReport({ logs: {}, kube: kube({ forbidden: true }), clock: () => NOW }).report({ fresh: true });
  assert.match(denied.notes.join(" "), /services\/proxy loki:http/);
  const urls = [];
  const fetch = async (url) => { urls.push(url); return { status: 200, json: async () => ({ data: { result: [{ stream: { namespace: "shop", app: "cart" }, values: [line(3600e3, "ERROR x")] }] } }) }; };
  const plain = createLogReport({ logs: { loki: { url: "http://loki:3100" } }, kube: kube(), fetch, clock: () => NOW });
  assert.equal(plain.source(), "loki");
  await plain.report({ fresh: true });
  assert.match(decodeURIComponent(urls[0]), /\{namespace=~"\.\+"\}/);
  assert.equal(createLogReport({ logs: { bundle: false }, kube: kube(), clock: () => NOW }).source(), "");
});
