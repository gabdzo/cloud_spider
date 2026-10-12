// SAMPLE LOG ERRORS: raw log lines for the two SERVICES scenarios
// (graph-sample.js), run through the real fold/fingerprint pipeline so the
// sample shows exactly what a live Loki would. sandbox-bare: cert-manager's
// webhook loses its CA and the demo api's rollout fails on it. sandbox-nimbus:
// a ledgerdb operator upgrade sets off a chain (ledgerdb → events-bus →
// billing → workflow → router).
import { logErrors, logWindow } from "./log-errors.js";
import { graphScenario } from "./graph-sample.js";

const day = (now) => {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const hm = (base, text, sec = 0) => {
  const [h, m] = text.split(":").map(Number);
  return base + ((h * 60 + m) * 60 + sec) * 1000;
};

function lines(base, list) {
  const out = [];
  for (const item of list) {
    const times = item.at.flatMap(([t, n = 1, every = 20]) => Array.from({ length: n }, (_, i) => hm(base, t, i * every)));
    times.forEach((time, n) => {
      const text = typeof item.text === "function" ? item.text(n, time) : item.text;
      text.split("\n").forEach((line, i) => out.push({ time: time + i, line, service: item.service, namespace: item.ns, pod: item.pod, container: item.container || item.service }));
    });
  }
  return out;
}

const iso = (time) => new Date(time).toISOString();

const JAVA_LEDGER = (n, t) => `${iso(t)} ERROR [ledger-pool-${n % 4}] c.n.ledger.store.WalWriter - WAL segment ${4100 + n} replay failed for tenant t01
com.nimbus.ledger.store.CorruptSegmentException: checksum mismatch at offset ${81920 + n * 512} (expected 0x9f3a${n}c, got 0x0000)
\tat com.nimbus.ledger.store.WalReader.verify(WalReader.java:212)
\tat com.nimbus.ledger.store.WalReader.next(WalReader.java:148)
\tat com.nimbus.ledger.store.WalWriter.replay(WalWriter.java:97)
\tat com.nimbus.ledger.Bootstrap.start(Bootstrap.java:61)
Caused by: java.io.EOFException: segment truncated after format v5 → v6 migration
\tat com.nimbus.ledger.store.SegmentFormat.read(SegmentFormat.java:44)
\t... 4 more`;

const JAVA_LEDGER_POOL = (n, t) => `${iso(t)} ERROR [http-nio-8443-exec-${n}] c.n.ledger.api.TxController - request ${crypto.randomUUID?.() || "6f1c2e7a-0b9d-4c55-9e2a-1f0b3c4d5e6f"} failed
org.postgresql.util.PSQLException: Connection to ledgerdb-store.nimbus-ledgerdb-t01.svc:5432 refused. Check that the hostname and port are correct
\tat org.postgresql.core.v3.ConnectionFactoryImpl.openConnectionImpl(ConnectionFactoryImpl.java:342)
\tat com.zaxxer.hikari.pool.HikariPool.createPoolEntry(HikariPool.java:476)
\tat com.nimbus.ledger.api.TxController.post(TxController.java:88)`;

const NODE_DEMO = (n, t) => `${iso(t)} Error: Internal error occurred: failed calling webhook "webhook.cert-manager.io": tls: failed to verify certificate: x509: certificate signed by unknown authority (request ${1200 + n})
    at RolloutClient.apply (/app/src/rollout.js:41:11)
    at async Reconciler.sync (/app/src/reconcile.js:88:5)
    at async Timeout._onTimeout (/app/src/loop.js:17:7)`;

const GO_WEBHOOK = (n, t) => `E1012 ${new Date(t).toISOString().slice(11, 23)}       1 server.go:${300 + (n % 3)}] "http: TLS handshake error from 10.0.${n % 3}.${40 + n}:5${n}612: remote error: tls: bad certificate"`;

const GO_BILLING_PANIC = `panic: runtime error: invalid memory address or nil pointer dereference
[signal SIGSEGV: segmentation violation code=0x1 addr=0x18 pc=0x9c1f2e]

goroutine 214 [running]:
github.com/nimbus/billing/internal/invoice.(*Builder).Total(0x0)
\t/src/internal/invoice/builder.go:77 +0x2e
github.com/nimbus/billing/internal/consumer.(*Handler).OnLedgerEvent(0xc0004a2000, {0xc000b18000, 0x1f4})
\t/src/internal/consumer/handler.go:132 +0x1b9
created by github.com/nimbus/billing/internal/consumer.Start in goroutine 1
\t/src/internal/consumer/start.go:40 +0x88`;

const PY_WORKFLOW = (n) => `Traceback (most recent call last):
  File "/opt/workflow/engine/runner.py", line 211, in step
    result = self.ledger.commit(txn)
  File "/opt/workflow/clients/ledger.py", line 58, in commit
    raise LedgerUnavailable(f"ledgerdb answered 503 after {3 + (n % 2)} retries")
workflow.clients.ledger.LedgerUnavailable: ledgerdb answered 503 after ${3 + (n % 2)} retries`;

const ROUTER = (n, t) => JSON.stringify({ ts: iso(t), level: "error", msg: `upstream billing-api returned 503 for /v2/invoices/${88000 + n * 7}`, upstream: "billing-api", attempt: 1 + (n % 3) });
const NOTIFIER = (n, t) => JSON.stringify({ time: iso(t), level: "error", message: `smtp relay mail.nimbus.test:587 refused: 421 too many connections (queue ${n + 3})` });

function bare(base, before) {
  const pod = { webhook: "cert-manager-webhook-6b7d9c8f4d-q8wzt", api: "api-7d9f8b6c5d-x2k9p", web: "web-5c6f7d8b9a-m4n2b" };
  const night = [
    { service: "webhook", ns: "cert-manager", pod: pod.webhook, at: [["09:43", 24, 30]], text: GO_WEBHOOK },
    { service: "api", ns: "demo", pod: pod.api, at: [["09:44", 9, 40]], text: NODE_DEMO },
    { service: "web", ns: "demo", pod: pod.web, at: [["09:47", 14, 15]], text: (n, t) => JSON.stringify({ level: "error", ts: iso(t), msg: `GET /api/items upstream api returned 502 (${180 + n} ms)` }) },
    // the same one-off every night: not NEW.
    { service: "web", ns: "demo", pod: pod.web, at: [["01:12", 1]], text: (n, t) => JSON.stringify({ level: "error", ts: iso(t), msg: "favicon.ico not found in /static" }) },
  ];
  const yesterday = [{ service: "web", ns: "demo", pod: "web-5c6f7d8b9a-h7k3p", at: [["01:15", 1]], text: (n, t) => JSON.stringify({ level: "error", ts: iso(t), msg: "favicon.ico not found in /static" }) }];
  const restarts = [{ service: "api", namespace: "demo", pod: pod.api, count: 1, reason: "OOMKilled", time: hm(base, "09:46") }];
  return { entries: lines(base, night), before: lines(before, yesterday), restarts };
}

function bundle(base, before) {
  const p = (name, hash) => `${name}-${hash}`;
  const night = [
    { service: "store", ns: "nimbus-ledgerdb-t01", pod: "ledgerdb-store-0", container: "ledger", at: [["10:07", 6, 45]], text: JAVA_LEDGER },
    { service: "api", ns: "nimbus-ledgerdb-t01", pod: p("ledgerdb-api", "6d8f7c9b5a-r2t4y"), at: [["10:07", 18, 20]], text: JAVA_LEDGER_POOL },
    { service: "api", ns: "nimbus-events-bus-t01", pod: p("events-bus-api", "79c8d6f5b4-k3j8h"), at: [["10:08", 30, 10]], text: (n, t) => `${iso(t)} level=error msg="publish to ledger.tx failed" err="context deadline exceeded" partition=${n % 6} offset=${552000 + n}` },
    { service: "api", ns: "nimbus-billing-t01", pod: p("billing-api", "58b7c6d9f4-w9q2e"), at: [["10:10", 3, 120]], text: GO_BILLING_PANIC },
    { service: "api", ns: "nimbus-workflow-t01", pod: p("workflow-api", "6f9d8c7b5e-z7x5c"), at: [["10:12", 36, 15], ["03:20", 2, 600]], text: PY_WORKFLOW },
    { service: "gateway", ns: "nimbus-router", pod: p("router-gateway", "84d5f6c7b8-t6y8u"), at: [["10:14", 40, 12]], text: ROUTER },
    { service: "notifier", ns: "nimbus-notifier-t01", pod: p("notifier", "5b6c7d8e9f-a1s2d"), at: [["23:10", 9, 300], ["02:40", 8, 300]], text: NOTIFIER },
  ];
  const yesterday = [
    { service: "api", ns: "nimbus-workflow-t01", pod: p("workflow-api", "6f9d8c7b5e-b4n6m"), at: [["03:25", 6, 600]], text: PY_WORKFLOW },
    { service: "notifier", ns: "nimbus-notifier-t01", pod: p("notifier", "5b6c7d8e9f-g5h6j"), at: [["23:00", 15, 300]], text: NOTIFIER },
    { service: "gateway", ns: "nimbus-router", pod: p("router-gateway", "84d5f6c7b8-k8l9z"), at: [["04:00", 30, 60]], text: ROUTER },
  ];
  const restarts = [
    { service: "store", namespace: "nimbus-ledgerdb-t01", pod: "ledgerdb-store-0", count: 4, reason: "Error (exit 1)", time: hm(base, "10:07") },
    { service: "api", namespace: "nimbus-billing-t01", pod: "billing-api-58b7c6d9f4-w9q2e", count: 3, reason: "Error (exit 2: panic)", time: hm(base, "10:10") },
    { service: "api", namespace: "nimbus-workflow-t01", pod: "workflow-api-6f9d8c7b5e-z7x5c", count: 5, reason: "CrashLoopBackOff", time: hm(base, "10:12") },
  ];
  // The overnight lines (before midnight) belong to last evening.
  const shift = (list) => list.map((e) => (new Date(e.time).getHours() >= 22 ? { ...e, time: e.time - 86_400_000 } : e));
  return { entries: shift(lines(base, night)), before: shift(lines(before, yesterday)), restarts };
}

export function graphNodeOf(scene) {
  return (service, namespace) => scene.nodes.find((n) => n.ns === namespace && n.id.split("/")[1] === service)?.id || "";
}

// kind "1h" / "24h": the sample night moved up to now, then cut to the window.
export function sampleLogErrors(scenario = "bare", now = Date.now(), kind = "night") {
  const night = sampleNight(scenario, now);
  if (kind !== "1h" && kind !== "24h") return night.report;
  const shift = now - night.window.end;
  const move = (list) => (list || []).map((x) => (Number.isFinite(x.time) ? { ...x, time: x.time + shift } : x));
  const window = logWindow(kind, now);
  const inside = (list) => move(list).filter((x) => !Number.isFinite(x.time) || (x.time >= window.start && x.time <= window.end));
  const report = logErrors({ ...night.data, entries: inside(night.data.entries), before: night.data.before ? move(night.data.before) : night.data.before, restarts: inside(night.data.restarts), window, source: "loki", nodeOf: night.nodeOf, scenario: night.id });
  return { ...report, scenario: night.id, title: night.report.title, sample: true };
}

function sampleNight(scenario, now) {
  const id = scenario === "bundle" ? "bundle" : "bare";
  const scene = graphScenario(id);
  const base = day(now);
  const data = id === "bundle" ? bundle(base, base - 86_400_000) : bare(base, base - 86_400_000);
  const end = hm(base, scene.window.end);
  const window = { start: hm(base, "22:00") - 86_400_000, end, running: false, kind: "night" };
  const nodeOf = graphNodeOf(scene);
  const report = logErrors({ ...data, window, source: "loki", nodeOf, scenario: id });
  return { id, data, window, nodeOf, report: { ...report, scenario: id, title: scene.title, sample: true } };
}
