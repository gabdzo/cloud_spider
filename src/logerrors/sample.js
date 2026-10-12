// SAMPLE: last night's logs for the two SERVICES scenarios (graph-sample.js).
// Made up, like the scenarios: sandbox-bare (cert-manager's webhook breaks
// the demo app's rollout) and sandbox-nimbus (a ledgerdb operator upgrade
// cascades into billing, workflow and the router). Each emits the raw lines
// a Loki would hold, one entry per line, so the real folding and
// fingerprinting run on them.
import { summarize } from "./core.js";

const DAY = 86_400_000;

// A clock time on the sample night: h ≥ 12 is the evening before.
function clock(base, h, m, s = 0) {
  const d = new Date(base);
  d.setHours(h, m, s, 0);
  return d.getTime() - (h >= 12 ? DAY : 0);
}

function emitter(out, base) {
  return (h, m, s, where, lines) => {
    const t = clock(base, h, m, s);
    lines.forEach((line, i) => out.push({ time: t + i, line, ...where }));
  };
}

const nodeTrace = (msg, frames) => [msg, ...frames.map((f) => `    at ${f}`)];

function bareNight(base, { yesterday = false } = {}) {
  const out = [];
  const at = emitter(out, base);
  const api = (i) => ({ namespace: "demo", service: "api", container: "api", pod: `api-7d9f8c6b4-${["x2b4k", "m7khp", "q9zt2"][i % 3]}` });
  const web = { namespace: "demo", service: "web", container: "web", pod: "web-5c8d7f9b6-k2j8p" };
  const hook = { namespace: "cert-manager", service: "cert-manager-webhook", container: "cert-manager-webhook", pod: "cert-manager-webhook-6b7c9d8f5-r4w2n" };
  const ctl = { namespace: "cert-manager", service: "cert-manager", container: "cert-manager-controller", pod: "cert-manager-7f9c6d5b8-h3l6z" };
  // A steady one: seen both nights (not NEW).
  for (let i = 0; i < 3; i += 1) {
    at(23 + i, 12 + i * 7, 4, api(i), nodeTrace(`TypeError: Cannot read properties of undefined (reading 'sku') at order ${41230 + i * 17}`, ["mapLine (/app/src/orders/map.js:44:31)", "Array.map (<anonymous>)", "toOrder (/app/src/orders/map.js:12:22)", "async GET /orders/:id (/app/src/routes/orders.js:58:17)"]));
  }
  // Redis resets: 2 a night usually, a burst during the retry storm (SPIKE).
  const resets = yesterday ? [[3, 10], [5, 2]] : [[3, 10], [5, 2], ...Array.from({ length: 22 }, (_, i) => [9, 44 + Math.floor(i / 10), i * 2])];
  for (const [h, m, s = 0] of resets) {
    at(h, m, s, api(m), nodeTrace(`Error: read ECONNRESET redis://redis.demo.svc:6379 (attempt ${2 + (m % 4)})`, ["TCP.onStreamRead (node:internal/stream_base_commons:217:20)", "RedisClient.retry (/app/node_modules/redis/dist/lib/client/socket.js:194:17)", "Cache.get (/app/src/cache.js:21:9)"]));
  }
  if (!yesterday) {
    // cert-manager 1.15 → 1.16: the webhook serves no certificate for 9 min.
    for (let i = 0; i < 12; i += 1) {
      at(9, 43 + Math.floor(i / 2), (i * 17) % 60, hook, [`E1012 09:${43 + Math.floor(i / 2)}:${String((i * 17) % 60).padStart(2, "0")}.${100 + i} 1 dynamic_source.go:155] "msg"="failed to generate serving certificate" "error"="no CA bundle for cert-manager/cert-manager-webhook-ca (${i + 1} retries)" "logger"="cert-manager.webhook"`]);
    }
    for (let i = 0; i < 6; i += 1) {
      at(9, 44 + i, 5, ctl, [`E1012 09:${44 + i}:05.${300 + i} 1 controller.go:167] "msg"="re-queuing item due to error processing" "error"="Internal error occurred: failed calling webhook \\"webhook.cert-manager.io\\": context deadline exceeded" "key"="demo/demo-tls"`]);
    }
    // web: 502s from the api while it restarted, and one Go panic.
    for (let i = 0; i < 37; i += 1) {
      at(9, 46 + Math.floor(i / 6), (i * 9) % 60, web, [JSON.stringify({ level: "error", ts: `2026-10-12T09:${46 + Math.floor(i / 6)}:${String((i * 9) % 60).padStart(2, "0")}Z`, msg: "upstream request failed", error: `GET http://api.demo.svc:8080/orders/${5100 + i}: 502 Bad Gateway`, trace_id: `4bf92f3577b34da6a3ce929d0e0e${4736 + i}` })]);
    }
    at(9, 47, 31, web, [
      "panic: runtime error: invalid memory address or nil pointer dereference",
      "[signal SIGSEGV: segmentation violation code=0x1 addr=0x18 pc=0x6b3a2f]",
      "",
      "goroutine 214 [running]:",
      "main.(*Proxy).renderCart(0xc0001a2000, 0x0)",
      "\t/src/web/proxy.go:88 +0x2f",
      "main.(*Proxy).ServeHTTP(0xc0001a2000, {0x7f1c40, 0xc0003b8000}, 0xc000412100)",
      "\t/src/web/proxy.go:41 +0x1d5",
      "net/http.serverHandler.ServeHTTP({0xc00011e0f0}, {0x7f1c40, 0xc0003b8000}, 0xc000412100)",
      "\t/usr/local/go/src/net/http/server.go:3137 +0x8e",
    ]);
  }
  return out;
}

function javaTrace(head, ex, frames, cause) {
  return [head, ex, ...frames.map((f) => `\tat ${f}`), ...(cause ? [`Caused by: ${cause[0]}`, ...cause[1].map((f) => `\tat ${f}`), `\t... ${cause[2]} more`] : [])];
}

function nimbusNight(base, { yesterday = false } = {}) {
  const out = [];
  const at = emitter(out, base);
  const billing = (i) => ({ namespace: "nimbus-billing-t01", service: "billing-api", container: "api", pod: `billing-api-6f8d9c7b5-${["b7x2q", "c9k4m", "d2w8r"][i % 3]}` });
  const ledger = { namespace: "nimbus-ledgerdb-t01", service: "ledgerdb-store", container: "postgres", pod: "ledgerdb-t03-0" };
  const bus = { namespace: "nimbus-events-bus-t01", service: "events-bus-api", container: "broker", pod: "events-bus-api-0" };
  const flow = { namespace: "nimbus-workflow-t01", service: "workflow-api", container: "api", pod: "workflow-api-5b9c8d7f6-p4n7s" };
  const router = { namespace: "nimbus-router", service: "nimbus-router", container: "gateway", pod: "nimbus-router-7c6b5d4f8-t2v9k" };
  const identity = { namespace: "nimbus-identity-t01", service: "identity-api", container: "api", pod: "identity-api-8d7c6b5f4-w3x5y" };
  // Steady background (both nights): expired grants, one export NPE.
  const grants = yesterday ? 15 : 14;
  for (let i = 0; i < grants; i += 1) at(22 + Math.floor(i / 3) % 9, (i * 13) % 60, 0, identity, [`2026-10-12T0${i % 7}:00:00.000Z ERROR [oauth] invalid_grant: refresh token expired for client c-${8812 + i * 31} (user u-${100233 + i})`]);
  const npes = yesterday ? 10 : 11;
  for (let i = 0; i < npes; i += 1) {
    at(1, 5 + i * 4, 0, billing(i), javaTrace(`2026-10-12 01:${String(5 + i * 4).padStart(2, "0")}:00.412 ERROR 1 --- [sched-${i}] c.n.billing.ReportExport : nightly export failed for tenant t${10 + i}`, "java.lang.NullPointerException: Cannot invoke \"com.nimbus.billing.Invoice.getCurrency()\" because \"inv\" is null", ["com.nimbus.billing.ReportExport.row(ReportExport.java:118)", "com.nimbus.billing.ReportExport.run(ReportExport.java:64)", "org.springframework.scheduling.support.ScheduledMethodRunnable.run(ScheduledMethodRunnable.java:84)", "java.base/java.lang.Thread.run(Thread.java:1583)"]));
  }
  // Consumer lag errors: 5 a night usually, a burst after 10:08 (SPIKE).
  const lags = yesterday ? 5 : 41;
  for (let i = 0; i < lags; i += 1) {
    const [h, m] = yesterday || i < 5 ? [2 + i, 30] : [10, 8 + Math.floor((i - 5) / 3)];
    at(h, m, (i * 7) % 60, bus, [`level=error ts=2026-10-12T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z caller=consumer.go:212 msg="consumer group behind" group=billing.invoices lag=${48000 + i * 1311} partition=${i % 12}`]);
  }
  // Router 503s: 4 a night usually, 30 during the incident (SPIKE).
  const r503 = yesterday ? 4 : 30;
  for (let i = 0; i < r503; i += 1) {
    const [h, m] = yesterday || i < 4 ? [23, 10 + i * 9] : [10, 14 + Math.floor(i / 5)];
    at(h, m, (i * 11) % 60, router, [`10.42.${i % 8}.${17 + i} - - [12/Oct/2026:${h}:${m}:00 +0000] "POST /billing/v2/invoices HTTP/1.1" 503 0 "-" "nimbus-portal/4.3" upstream=billing-api error="upstream connect error or disconnect/reset before headers"`]);
  }
  if (!yesterday) {
    // ledgerdb-operator 4.2 → 4.3 at 10:05: the migration lock.
    for (let i = 0; i < 9; i += 1) {
      const mm = String(6 + Math.floor(i / 2)).padStart(2, "0");
      const ss = String((i * 13) % 60).padStart(2, "0");
      at(10, 6 + Math.floor(i / 2), (i * 13) % 60, ledger, [`2026-10-12 10:${mm}:${ss}.${200 + i} UTC [${4120 + i}] ERROR:  canceling statement due to lock timeout`, `2026-10-12 10:${mm}:${ss}.${201 + i} UTC [${4120 + i}] STATEMENT:  ALTER TABLE ledger_entries ADD COLUMN settled_at timestamptz`]);
    }
    // billing → ledgerdb timeouts (NEW).
    for (let i = 0; i < 96; i += 1) {
      at(10, 9 + Math.floor(i / 9), (i * 7) % 60, billing(i), javaTrace(
        `2026-10-12 10:${String(9 + Math.floor(i / 9)).padStart(2, "0")}:${String((i * 7) % 60).padStart(2, "0")}.${100 + i} ERROR 1 --- [http-nio-8080-exec-${(i % 12) + 1}] c.n.billing.InvoiceService : ledger call failed for invoice INV-2026-${String(88000 + i)}`,
        "org.springframework.dao.QueryTimeoutException: PreparedStatementCallback; SQL [insert into ledger_entries (invoice_id, amount, currency) values (?, ?, ?)]; ERROR: canceling statement due to statement timeout",
        ["org.springframework.jdbc.support.SQLStateSQLExceptionTranslator.doTranslate(SQLStateSQLExceptionTranslator.java:99)", "org.springframework.jdbc.core.JdbcTemplate.execute(JdbcTemplate.java:1548)", "com.nimbus.billing.LedgerClient.post(LedgerClient.java:73)", "com.nimbus.billing.InvoiceService.settle(InvoiceService.java:141)", "com.nimbus.billing.InvoiceController.create(InvoiceController.java:52)", "java.base/jdk.internal.reflect.DirectMethodHandleAccessor.invoke(DirectMethodHandleAccessor.java:103)"],
        ["org.postgresql.util.PSQLException: ERROR: canceling statement due to statement timeout", ["org.postgresql.core.v3.QueryExecutorImpl.receiveErrorResponse(QueryExecutorImpl.java:2725)", "org.postgresql.core.v3.QueryExecutorImpl.processResults(QueryExecutorImpl.java:2412)", "org.postgresql.jdbc.PgPreparedStatement.executeUpdate(PgPreparedStatement.java:152)"], 41],
      ));
    }
    // workflow-api: Python, crash-looping on connection refused (NEW).
    for (let i = 0; i < 22; i += 1) {
      at(10, 12 + Math.floor(i / 3), (i * 19) % 60, flow, [
        `ERROR:workflow.worker:step settle-invoice failed (run ${77120 + i})`,
        "Traceback (most recent call last):",
        '  File "/app/workflow/worker.py", line 211, in run_step',
        "    result = handler(step, ctx)",
        '  File "/app/workflow/steps/settle.py", line 48, in settle_invoice',
        "    with ledger.connect(dsn=ctx.ledger_dsn) as conn:",
        '  File "/usr/local/lib/python3.12/site-packages/psycopg/connection.py", line 119, in connect',
        "    raise last_ex.with_traceback(None)",
        `psycopg.OperationalError: connection failed: connection to server at "10.43.${i % 4}.12", port 5432 failed: Connection refused`,
      ]);
    }
  }
  return out;
}

const SCENES = {
  bare: {
    title: "sandbox-bare",
    night: bareNight,
    // service key → SERVICES node and the timeline minute it belongs to
    links: { "demo/api": ["demo/api", "09:46"], "demo/web": ["demo/web", "09:47"], "cert-manager/cert-manager-webhook": ["cert-manager/webhook", "09:43"], "cert-manager/cert-manager": ["cert-manager/controller", "09:41"] },
    restarts: [{ namespace: "demo", service: "api", pod: "api-7d9f8c6b4-x2b4k", count: 1, reason: "OOMKilled", time: [9, 46] }],
    end: [10, 0],
  },
  bundle: {
    title: "sandbox-nimbus",
    night: nimbusNight,
    links: { "nimbus-billing-t01/billing-api": ["billing/api", "10:10"], "nimbus-ledgerdb-t01/ledgerdb-store": ["ledgerdb/store", "10:07"], "nimbus-events-bus-t01/events-bus-api": ["events-bus/api", "10:08"], "nimbus-workflow-t01/workflow-api": ["workflow/api", "10:12"], "nimbus-router/nimbus-router": ["router/gateway", "10:14"], "nimbus-identity-t01/identity-api": ["identity/api", null] },
    restarts: [
      { namespace: "nimbus-ledgerdb-t01", service: "ledgerdb-store", pod: "ledgerdb-t03-0", count: 6, reason: "Error (schema migration lock)", time: [10, 7] },
      { namespace: "nimbus-workflow-t01", service: "workflow-api", pod: "workflow-api-5b9c8d7f6-p4n7s", count: 5, reason: "CrashLoopBackOff", time: [10, 12] },
    ],
    end: [10, 30],
  },
};

export function sampleLogErrors(scenario = "bundle", now = Date.now()) {
  const id = scenario === "bare" ? "bare" : "bundle";
  const scene = SCENES[id];
  // The sample's "this morning": the scenario's day, at the end of its incident.
  const base = new Date(now);
  base.setHours(...scene.end, 0, 0);
  const end = base.getTime();
  const start = clock(end, 22, 0);
  const hh = (t) => new Date(t).toTimeString().slice(0, 5);
  const summary = summarize({
    today: scene.night(end),
    yesterday: scene.night(end - DAY, { yesterday: true }),
    restarts: scene.restarts.map((r) => ({ ...r, time: clock(end, ...r.time) })),
    window: { start, end, label: `${hh(start)}–${hh(end)}` },
    source: "sample",
    links: (svc) => {
      const hit = scene.links[svc.key];
      return hit ? { scenario: id, node: hit[0], t: hit[1] } : null;
    },
  });
  return { ...summary, sample: true, scenario: id, title: scene.title };
}
