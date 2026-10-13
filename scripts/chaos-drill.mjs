#!/usr/bin/env node
// Chaos drill for DIAGNOSE (docs/chaos-drill.md): break one thing at a time
// in a throwaway namespace, INVESTIGATE through a running Cloud Spider (its
// viewer context, read-only), assert the expected rule fired, restore,
// VERIFY AGAIN, assert "resolved". Everything it created is removed at the
// end, also on failure or Ctrl-C.
//
//   node scripts/chaos-drill.mjs --app http://127.0.0.1:9251 --admin cloudspider-up-admin \
//     --viewer cloudspider-up-viewer [--only NET-001,K8S-001] [--shots dir --pw path/to/playwright-core/index.mjs [--chrome binary]]
//
// Writes go ONLY through --admin (kubectl --context, never current-context).
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const arg = (k, d = "") => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const APP = arg("app", "http://127.0.0.1:9251");
const ADMIN = arg("admin");
const VIEWER = arg("viewer");
const ONLY = arg("only") ? arg("only").split(",") : null;
const SHOTS = arg("shots");
const PW = arg("pw");
const OUT = arg("out", SHOTS || ".");
const NS = "chaos-drill";
const HOOK = "chaos-drill-test-webhook";
const SHOP = { ns: arg("shop-ns", "shop"), deploy: arg("shop-deploy", "shopapi"), svc: arg("shop-svc", "shopapi") };
if (!ADMIN || !VIEWER) { console.error("--admin and --viewer contexts are required"); process.exit(2); }
if (ADMIN === "ppf-helm") process.exit(2);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function k(args, input) {
  const r = spawnSync("kubectl", ["--context", ADMIN, ...args], { input, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`kubectl ${args.join(" ")}: ${(r.stderr || "").trim()}`);
  return r.stdout;
}
const kq = (args, input) => { try { return k(args, input); } catch { return ""; } };
const apply = (y) => k(["apply", "-f", "-"], y);

async function api(op, body) {
  const r = await fetch(`${APP}/api/diagnose/${op}`, { method: "POST", headers: { "content-type": "application/json", origin: new URL(APP).origin }, body: JSON.stringify(body) });
  const j = await r.json();
  if (j.error) throw new Error(`${op}: ${j.error}`);
  return j;
}

const app = (name, extra = {}) => `apiVersion: apps/v1
kind: Deployment
metadata: { name: ${name}, namespace: ${NS} }
spec:
  replicas: 1
  selector: { matchLabels: { app: ${name} } }
  template:
    metadata: { labels: { app: ${name} } }
    spec:
      containers:
      - name: web
        image: public.ecr.aws/nginx/nginx:1.27-alpine
        ports: [{ containerPort: 80 }]
        readinessProbe: { httpGet: { path: ${extra.probe || "/"}, port: 80 }, periodSeconds: 3 }
        resources: { requests: { cpu: ${extra.cpu || "10m"}, memory: 16Mi }, limits: { memory: 64Mi } }
---
apiVersion: v1
kind: Service
metadata: { name: ${name}, namespace: ${NS} }
spec: { selector: { app: ${name} }, ports: [{ port: 80, targetPort: 80 }] }
`;
const ready = (name, ns = NS) => k(["-n", ns, "rollout", "status", `deploy/${name}`, "--timeout=180s"]);
async function until(fn, s = 180, label = "") {
  for (let t = 0; t < s; t += 3) { if (await fn()) return; await wait(3000); }
  throw new Error(`timed out waiting: ${label}`);
}

// Each scenario: setup (healthy), break, expect(rec) -> bool, restore, svc.
const S = [
  { id: "NET-001", what: "Deployment scaled to 0: Service has no endpoints", svc: "net001",
    setup: async () => { apply(app("net001")); ready("net001"); },
    break: async () => { k(["-n", NS, "scale", "deploy/net001", "--replicas=0"]); await until(() => !kq(["-n", NS, "get", "pods", "-l", "app=net001", "-o", "name"]).trim(), 90, "pods gone"); },
    expect: (r) => r.findings.some((f) => f.code === "NET-001"),
    restore: async () => { k(["-n", NS, "scale", "deploy/net001", "--replicas=1"]); ready("net001"); } },
  { id: "K8S-001", what: "Readiness probe on a wrong path (unready > 120 s)", svc: "k8s001",
    setup: async () => { apply(app("k8s001")); ready("k8s001"); },
    break: async () => { apply(app("k8s001", { probe: "/no-such-path" })); await wait(150_000); },
    expect: (r) => r.findings.some((f) => f.code === "K8S-001"),
    restore: async () => { apply(app("k8s001")); ready("k8s001"); } },
  { id: "PENDING", what: "Pod requests 64 CPUs: stays Pending (an open question, not a finding)", svc: "pending", questionOnly: true,
    setup: async () => { apply(app("pending")); ready("pending"); },
    break: async () => { apply(app("pending", { cpu: "64" })); await wait(20_000); },
    expect: (r) => r.questions?.some((q) => /Pending/.test(q)) || r.findings.some((f) => /Pending/.test(f.summary)),
    restore: async () => { apply(app("pending")); ready("pending"); } },
  { id: "CERT-001", what: "Certificate whose ClusterIssuer does not exist", svc: "net001",
    setup: async () => {},
    break: async () => { apply(`apiVersion: cert-manager.io/v1\nkind: Certificate\nmetadata: { name: chaos-cert, namespace: ${NS} }\nspec:\n  secretName: chaos-cert-tls\n  dnsNames: [chaos.drill.local]\n  issuerRef: { name: no-such-issuer, kind: ClusterIssuer }\n`); await wait(15_000); },
    expect: (r) => r.findings.some((f) => f.code === "CERT-001" && /chaos-cert/.test(f.summary)),
    restore: async () => { k(["-n", NS, "delete", "certificate", "chaos-cert", "--wait"]); kq(["-n", NS, "delete", "secret", "chaos-cert-tls"]); } },
  { id: "OPS-001", what: "Test ValidatingWebhookConfiguration (failurePolicy Ignore, this namespace only) whose Service has no endpoints", svc: "net001",
    setup: async () => { apply(`apiVersion: v1\nkind: Service\nmetadata: { name: hook, namespace: ${NS} }\nspec: { selector: { app: no-such-hook }, ports: [{ port: 443, targetPort: 8443 }] }\n`); },
    break: async () => { apply(`apiVersion: admissionregistration.k8s.io/v1\nkind: ValidatingWebhookConfiguration\nmetadata: { name: ${HOOK} }\nwebhooks:\n- name: chaos.drill.cloudspider.dev\n  clientConfig: { service: { namespace: ${NS}, name: hook, path: /validate } }\n  rules: [{ apiGroups: [""], apiVersions: [v1], operations: [CREATE], resources: [configmaps] }]\n  namespaceSelector: { matchLabels: { kubernetes.io/metadata.name: ${NS} } }\n  failurePolicy: Ignore\n  sideEffects: None\n  admissionReviewVersions: [v1]\n  timeoutSeconds: 2\n`); await wait(5000); },
    expect: (r) => r.findings.some((f) => f.code === "OPS-001" && /chaos/.test(f.summary)),
    restore: async () => { k(["delete", "validatingwebhookconfiguration", HOOK]); } },
  // The ALB health check is broken, not the pods: a bad readiness probe only
  // stalls the rollout (old pods stay ready, the ALB never sees a bad target).
  { id: "NET-002", what: `ALB targets unhealthy: ${SHOP.ns}/${SHOP.svc} Ingress health check moved to a path that 404s`, ns: SHOP.ns, svc: SHOP.svc,
    setup: async () => {},
    break: async () => {
      S.shopHc = k(["-n", SHOP.ns, "get", "ingress", SHOP.svc, "-o", "jsonpath={.metadata.annotations.alb\\.ingress\\.kubernetes\\.io/healthcheck-path}"]).trim();
      if (!S.shopHc) throw new Error(`no ALB Ingress ${SHOP.ns}/${SHOP.svc} (set expose: alb first)`);
      k(["-n", SHOP.ns, "annotate", "ingress", SHOP.svc, "--overwrite", "alb.ingress.kubernetes.io/healthcheck-path=/no-such-path"]);
      S.shopTouched = true;
      await wait(90_000);
    },
    expect: (r) => r.findings.some((f) => f.code === "NET-002"),
    restore: async () => { k(["-n", SHOP.ns, "annotate", "ingress", SHOP.svc, "--overwrite", `alb.ingress.kubernetes.io/healthcheck-path=${S.shopHc}`]); S.shopTouched = false; await wait(90_000); } },
  { id: "APP-001", what: "brother-sandbox/db: existing error rate (not broken by the drill, not restored)", ns: "brother-sandbox", svc: "db", noRestore: true,
    setup: async () => {}, break: async () => {},
    expect: (r) => r.findings.some((f) => f.code === "APP-001"),
    restore: async () => { await wait(60_000); } },
];

let browser, page;
async function shot(name) {
  if (!page) return null;
  const p = join(SHOTS, `${name}.png`);
  await page.screenshot({ path: p, fullPage: false }).catch(() => {});
  return p;
}
async function uiInvestigate(ns, svc) {
  if (!page) return;
  await page.goto(`${APP}/#cluster`, { waitUntil: "load" }); await wait(2500);
  await page.evaluate(async ([c, n, s]) => { const m = await import("/diagnose-view.js"); m.openDiagnose({ context: c, namespace: n, service: s }); }, [VIEWER, ns, svc]);
  await wait(500);
  await page.click("[data-dx-go]").catch(() => {});
  await page.waitForSelector(".dx-body .dx-finding, .dx-body .dx-none, .dx-body", { timeout: 20000 }).catch(() => {});
  await wait(2500);
}
async function uiVerify() {
  if (!page) return;
  await page.click("[data-dx-verify]").catch(() => {});
  await wait(3000);
  await page.evaluate(() => document.querySelector(".dx-verify")?.scrollIntoView()).catch(() => {});
}

async function cleanup() {
  kq(["delete", "validatingwebhookconfiguration", HOOK, "--ignore-not-found"]);
  if (S.shopTouched) { kq(["-n", SHOP.ns, "annotate", "ingress", SHOP.svc, "--overwrite", `alb.ingress.kubernetes.io/healthcheck-path=${S.shopHc}`]); S.shopTouched = false; }
  kq(["delete", "namespace", NS, "--ignore-not-found", "--wait=false"]);
  await browser?.close().catch(() => {});
}
let cleaned = false;
const once = async () => { if (!cleaned) { cleaned = true; await cleanup(); } };
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, async () => { await once(); process.exit(130); });

const results = [];
try {
  if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); if (PW) { const { chromium } = await import(PW); browser = await chromium.launch(arg("chrome") ? { executablePath: arg("chrome") } : {}); page = await browser.newPage({ viewport: { width: 1440, height: 900 } }); } }
  apply(`apiVersion: v1\nkind: Namespace\nmetadata: { name: ${NS}, labels: { cloudspider.dev/purpose: chaos-drill } }\n`);
  for (const s of S) {
    if (ONLY && !ONLY.includes(s.id)) continue;
    const ns = s.ns || NS;
    const row = { id: s.id, what: s.what, target: `${ns}/${s.svc}` };
    console.log(`\n== ${s.id}: ${s.what}`);
    try {
      await s.setup();
      await s.break();
      const t0 = Date.now();
      const rec = await api("investigate", { context: VIEWER, namespace: ns, service: s.svc });
      row.investigate_ms = rec.elapsed_ms ?? Date.now() - t0;
      row.findings = rec.findings.map((f) => f.code);
      row.summaries = rec.findings.map((f) => `${f.code}: ${f.summary}`);
      row.missing = rec.coverage?.missing || [];
      row.questions = rec.questions || [];
      row.fired = !!s.expect(rec);
      await uiInvestigate(ns, s.svc); row.shot_before = await shot(`${s.id}-1-investigate`);
      await s.restore();
      const v = await api("verify", { investigation_id: rec.investigation_id });
      row.verify = v.status;
      row.verify_checks = (v.checks || []).map((c) => `${c.code || c.id}: ${c.status}${c.why ? ` (${c.why})` : ""}`);
      await uiVerify(); row.shot_after = await shot(`${s.id}-2-verify`);
      // Pass on the drilled rule's own check: other findings that were
      // already there (APP-001 on a busy service) may stay inconclusive.
      const own = (v.checks || []).filter((c) => c.code === s.id);
      row.verify_own = own.map((c) => c.status).join(",") || null;
      if (s.questionOnly) {
        const again = await api("investigate", { context: VIEWER, namespace: ns, service: s.svc });
        row.verify_own = s.expect(again) ? "still_failing" : "resolved";
      }
      row.pass = row.fired && (s.noRestore ? true : row.verify_own === "resolved");
    } catch (e) { row.error = String(e.message || e); row.pass = false; await shot(`${s.id}-error`); }
    console.log(JSON.stringify(row, null, 1));
    results.push(row);
  }
} finally {
  await once();
  writeFileSync(join(OUT, "chaos-drill-results.json"), JSON.stringify({ at: new Date().toISOString(), app: APP, viewer: VIEWER, results }, null, 1));
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length ? `; failed: ${failed.map((r) => r.id).join(", ")}` : ""}`);
process.exit(failed.length ? 1 : 0);
