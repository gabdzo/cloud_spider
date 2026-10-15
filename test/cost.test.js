import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "../src/app.js";
import { listen } from "../src/server.js";
import {
  createCost,
  formatAmount,
  monthWindow,
  resourceLines,
  resourceWindow,
  sampleCost,
  shapeCost,
  shapeResources,
  lastDataDay,
  forecastWindow,
} from "../src/cost.js";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spendModel } from "../src/spend-view.js";

const HOUR = 60 * 60 * 1000;

function group(service, amount, unit = "USD") {
  return {
    Keys: [service],
    Metrics: { UnblendedCost: { Amount: String(amount), Unit: unit } },
  };
}

function page(groups, token = "") {
  return { ResultsByTime: [{ Groups: groups, Estimated: true }], NextPageToken: token };
}

function ec2() {
  return {
    async describeRegions() {
      return { regions: ["eu-north-1"] };
    },
    async defaultRegion() {
      return "eu-north-1";
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
  };
}

function makeApp(cost, clock = () => 0) {
  return createApp({
    ec2: ec2(),
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    logGroup: "",
    pageOrigin: "http://127.0.0.1:9241",
    clock,
    cost,
  });
}

test("the month window starts on the 1st and ends tomorrow, including on the 1st", () => {
  const first = monthWindow(new Date("2026-10-01T00:30:00Z"));
  assert.equal(first.start, "2026-10-01");
  assert.equal(first.end, "2026-10-02");
  assert.notEqual(first.start, first.end);
  const mid = monthWindow(new Date("2026-10-10T12:00:00Z"));
  assert.equal(mid.start, "2026-10-01");
  assert.equal(mid.end, "2026-10-11");
});

test("rows sort by amount, drop dust, keep a credit, and name the unit", () => {
  const bill = shapeCost(
    [
      page([
        group("dust", "0.009"),
        group("negative dust", "-0.004"),
        group("credit", "-0.02"),
        group("Amazon Elastic Compute Cloud", "1.2"),
        group("pounds", "3", "GBP"),
      ]),
    ],
    { start: "2026-10-01", end: "2026-10-11" },
  );
  assert.deepEqual(
    bill.rows.map((row) => row.service),
    ["pounds", "Amazon Elastic Compute Cloud", "credit"],
  );
  assert.equal(bill.rows[1].amount, "$1.20");
  assert.equal(bill.rows[2].amount, "\u2212$0.02");
  assert.equal(formatAmount(-0.004, "USD"), "$0.00");
  assert.equal(formatAmount(-1.5, ""), "\u22121.50");
  assert.equal(formatAmount(3, "GBP"), "3.00 GBP");
  assert.equal(bill.rows[0].amount, "3.00 GBP");
  assert.match(bill.lines[0], /October, estimated, about a day behind/);
  assert.equal(bill.lines.at(-1).trimEnd().endsWith(bill.total), true);

  const empty = shapeCost([page([group("dust", "0.001")])], { start: "2026-10-01", end: "2026-10-02" });
  assert.equal(empty.label, "Cost $0.00");
  assert.equal(empty.lines.at(-1), "no charge above $0.01 yet");
});

test("GetCostAndUsage follows NextPageToken and a sample never calls the client", async () => {
  const seen = [];
  const client = {
    async send(command) {
      seen.push(command.input);
      if (!command.input.NextPageToken) {
        return page([group("Amazon Elastic Compute Cloud", "0.40")], "page-2");
      }
      return page([group("Amazon Elastic Load Balancing", "1.20")]);
    },
  };
  let called = false;
  const cost = createCost({
    client: {
      send(command) {
        called = true;
        return client.send(command);
      },
    },
    now: () => new Date("2026-10-10T00:00:00Z"),
  });
  const sample = cost.sample();
  assert.equal(called, false);
  assert.deepEqual(sample, sampleCost());
  assert.equal(sample.label, "Cost sample");
  assert.equal(sample.lines[0], "sample, not the account.");

  const bill = await cost.read();
  const serviceCalls = seen.filter((input) => input.GroupBy?.[0]?.Key === "SERVICE");
  const resourceCalls = seen.filter((input) => input.GroupBy?.[0]?.Key === "RESOURCE_ID");
  assert.equal(serviceCalls.length, 2);
  assert.equal(serviceCalls[0].TimePeriod.Start, "2026-10-01");
  assert.equal(serviceCalls[0].TimePeriod.End, "2026-10-11");
  assert.deepEqual(serviceCalls[0].Metrics, ["UnblendedCost"]);
  assert.equal(serviceCalls[1].NextPageToken, "page-2");
  assert.equal(resourceCalls.length, 6);
  assert.equal(resourceCalls[0].Granularity, "DAILY");
  assert.equal(resourceCalls[0].TimePeriod.Start, "2026-09-27");
  assert.equal(resourceCalls[0].TimePeriod.End, "2026-10-11");
  assert.equal(resourceCalls[0].Filter.And[0].Dimensions.Key, "SERVICE");
  assert.equal(resourceCalls[0].Filter.And[0].Dimensions.Values[0], "Amazon Elastic Load Balancing");
  // Credits are not resource costs: they only add negative NoResourceId rows.
  assert.deepEqual(resourceCalls[0].Filter.And[1], { Not: { Dimensions: { Key: "RECORD_TYPE", Values: ["Credit", "Refund"] } } });
  assert.deepEqual(serviceCalls[0].GroupBy, [{ Type: "DIMENSION", Key: "SERVICE" }, { Type: "DIMENSION", Key: "RECORD_TYPE" }]);
  assert.equal(bill.rows[0].amount, "$1.20");
  assert.equal(bill.rows[1].amount, "$0.40");
  assert.equal(bill.total, "$1.60");
  assert.equal(bill.label, "Cost $1.60");
});

test("a resource read keeps the month total when one service is denied", async () => {
  const bill = await createCost({
    now: () => new Date("2026-10-10T00:00:00Z"),
    client: {
      async send(command) {
        if (command.input.GroupBy?.[0]?.Key === "RESOURCE_ID") {
          if (command.input.Filter.And[0].Dimensions.Values[0] === "Amazon Elastic Load Balancing") {
            throw new Error("not enabled yet");
          }
          return page([
            {
              Keys: ["arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/cloudspider-api/abc"],
              Metrics: { UnblendedCost: { Amount: "0.50", Unit: "USD" } },
            },
          ]);
        }
        return page([group("Amazon Elastic Compute Cloud", "1.20")]);
      },
    },
  }).read();
  assert.equal(bill.label, "Cost $1.20");
  assert.equal(bill.total, "$1.20");
  assert.match(bill.lines.join("\n"), /ELB: not enabled yet/);
  // The morning meets bill rows to objects by the raw resource id.
  assert.match(bill.resourceErrors["Amazon Elastic Load Balancing"], /not enabled yet/);
  assert.ok(bill.resources.some((row) => row.id.endsWith("app/cloudspider-api/abc") && row.service === "Amazon Elastic Container Service for Kubernetes"));
  assert.match(bill.lines.join("\n"), /GetCostAndUsageWithResources/);
  assert.match(bill.lines.join("\n"), /EKS cloudspider-api/);
  assert.match(bill.lines.join("\n"), /\$0\.50/);
  const span = resourceWindow(new Date("2026-10-10T00:00:00Z"));
  assert.equal(span.start, "2026-09-27");
  assert.equal(span.end, "2026-10-11");
  const rows = shapeResources("Amazon Elastic Load Balancing", [
    page([
      {
        Keys: ["arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/cloudspider-api/abc"],
        Metrics: { UnblendedCost: { Amount: "0.20", Unit: "USD" } },
      },
      {
        Keys: ["arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/cloudspider-api/abc"],
        Metrics: { UnblendedCost: { Amount: "0.30", Unit: "USD" } },
      },
      { Keys: ["dust"], Metrics: { UnblendedCost: { Amount: "0.001", Unit: "USD" } } },
    ]),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].resource, "cloudspider-api");
  assert.equal(rows[0].id, "arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/cloudspider-api/abc");
  assert.equal(rows[0].value, 0.5);
  assert.equal(rows[0].amount, "$0.50");
  assert.match(resourceLines([{ service: "Amazon Elastic Kubernetes Service", rows: [] }]).join("\n"), /no charge above \$0\.01 yet/);
});

test("a bill is cached for 6 hours, a thrown read is not, and two clicks share one read", async () => {
  let now = 1_000;
  let reads = 0;
  let fail = true;
  const bill = { label: "Cost $1.00", lines: ["kept"], total: "$1.00", rows: [] };
  const app = makeApp(
    {
      async read() {
        reads += 1;
        if (fail) throw new Error("denied");
        return bill;
      },
    },
    () => now,
  );
  const denied = await app.costView();
  assert.match(denied.error, /GetCostAndUsage/);
  assert.match(denied.error, /us-east-1/);
  assert.doesNotMatch(denied.error, /eu-north-1/);
  assert.match(app.stdout.join("\n"), /GetCostAndUsage/);
  assert.match(app.stdout.join("\n"), /us-east-1/);
  assert.doesNotMatch(denied.label, /\$0\.00/);
  fail = false;
  const again = await app.costView();
  assert.equal(again.label, "Cost $1.00");
  assert.equal(reads, 2);
  const cached = await app.costView();
  assert.equal(cached.label, "Cost $1.00");
  assert.equal(reads, 2);
  now += 6 * HOUR;
  await app.costView();
  assert.equal(reads, 3);

  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let shared = 0;
  const second = makeApp({
    async read() {
      shared += 1;
      await gate;
      return bill;
    },
  });
  const firstCall = second.costView();
  const secondCall = second.costView();
  release();
  const both = await Promise.all([firstCall, secondCall]);
  assert.equal(shared, 1);
  assert.equal(both[0], both[1]);
});

test("boot, view, pathView, and logsFor do not read the bill", async () => {
  let reads = 0;
  const app = makeApp({
    async read() {
      reads += 1;
      throw new Error("the map must not read the bill");
    },
  });
  await app.boot();
  app.view();
  await app.pathView();
  await app.logsFor("i-0abc1234");
  assert.equal(reads, 0);
});

test("the overview has a home control and a spend box, and the map poll does not ask for the bill", async () => {
  let reads = 0;
  const app = makeApp({
    async read() {
      reads += 1;
      return { label: "Cost $0.00", lines: ["account, not this region. October, estimated, about a day behind.", "no charge above $0.01 yet"], total: "$0.00", rows: [] };
    },
  });
  const server = await listen(app, 0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const page = await fetch(`${base}/`);
    const html = await page.text();
    assert.match(html, /id="home"/);
    assert.match(html, /id="spend"/);
    // The path tab reads SNIFF in pip and Network in pro; its id stays "path".
    // The label is a span so the theme swap keeps the tab's icon.
    assert.match(html, /id="path"[^>]*><span data-pro-label="Network">Sniff<\/span><\/button>/);
    assert.match(html, />Cluster</);
    assert.doesNotMatch(html, /id="cost"/);
    assert.doesNotMatch(html, /id="bill"/);
    // The tally and the bill are header gauges, not overlays on the map.
    const header = html.slice(html.indexOf("<header>"), html.indexOf("</header>"));
    assert.match(header, /id="tally"/);
    assert.match(header, /id="spend"/);
    assert.match(header, /id="spend-lines"/);
    const mapwrap = html.slice(html.indexOf('class="mapwrap"'), html.indexOf('id="radio-panel"'));
    assert.doesNotMatch(mapwrap, /id="tally"|id="spend"/);
    const source = await fetch(`${base}/browser.js`).then((response) => response.text());
    const pullStart = source.indexOf("async function pullOnce(");
    const pullEnd = source.indexOf("\nfunction showSample");
    assert.ok(pullStart >= 0 && pullEnd > pullStart);
    const pullFn = source.slice(pullStart, pullEnd);
    assert.doesNotMatch(pullFn, /api\/cost/);
    assert.doesNotMatch(pullFn, /queueSpend|loadSpend/);
    // The first live pull, and only that one, asks for the bill once.
    assert.match(source, /pull\(\)\.then\(\(\) => \{\n  kickMapKube\(\);\n  if \(place && !sample\) queueSpend\(\);\n\}\);/);
    await fetch(`${base}/api/view`);
    assert.equal(reads, 0);
    const sample = await fetch(`${base}/api/cost-sample`);
    const sampleBody = await sample.json();
    assert.equal(sampleBody.label, "Cost sample");
    assert.equal(reads, 0);
    const cost = await fetch(`${base}/api/cost`);
    const body = await cost.json();
    assert.equal(body.label, "Cost $0.00");
    assert.equal(reads, 1);
  } finally {
    server.close();
  }
});

test("the CAPS panel model: credits, duplicate names, pace and the empty and error states", async () => {
  const { spendModel } = await import("../src/spend-view.js");
  const rows = shapeResources("Amazon Elastic Load Balancing", [
    {
      ResultsByTime: ["2026-10-01", "2026-10-02", "2026-10-03"].map((day, i) => ({
        TimePeriod: { Start: day },
        Groups: [
          { Keys: ["arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/api/aaaa1111"], Metrics: { UnblendedCost: { Amount: String(0.1 * (i + 1)), Unit: "USD" } } },
          { Keys: ["arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/api/bbbb2222"], Metrics: { UnblendedCost: { Amount: "0.02", Unit: "USD" } } },
          { Keys: ["NoResourceId"], Metrics: { UnblendedCost: { Amount: "-0.05", Unit: "USD" } } },
        ],
      })),
    },
  ]);
  assert.deepEqual(rows[0].series, [0.1, 0.2, 0.3]);
  assert.equal(rows.find((row) => row.id === "NoResourceId").amount, "\u2212$0.15");
  const bill = { ...shapeCost([page([group("Amazon Elastic Load Balancing", "6.20")])], { start: "2026-10-01", end: "2026-10-11" }), resources: rows, resourceErrors: { "Amazon Elastic Kubernetes Service": "not enabled" } };
  const model = spendModel(bill);
  assert.equal(model.kind, "bill");
  assert.equal(model.head.total, "$6.20");
  assert.match(model.head.kicker, /OCTOBER · MONTH TO DATE/);
  assert.match(model.pace, /\$0\.62\/day over 10 days · on pace for \$19\.22 by Oct 31/);
  assert.equal(model.services[0].name, "ELB");
  assert.deepEqual(model.resources.map((row) => row.name), ["api ·aaaa", "api ·bbbb", "credits, not tied to a resource"]);
  assert.equal(model.resources.at(-1).amount, "\u2212$0.15 credit");
  assert.equal(model.credits, "\u2212$0.15 credit");
  assert.equal(model.errors[0].text, "not enabled");
  const empty = spendModel(shapeCost([page([])], { start: "2026-10-01", end: "2026-10-02" }));
  assert.equal(empty.emptyServices, true);
  assert.equal(empty.pace, "");
  assert.equal(spendModel({ error: "AccessDenied", label: "AccessDenied" }).kind, "error");
  assert.equal(spendModel(null).kind, "loading");
  const sample = spendModel(sampleCost(new Date("2026-10-11T00:00:00Z")));
  assert.equal(sample.head.scope, "SAMPLE");
  assert.ok(sample.resources.some((row) => row.credit));
});

// Shaped like a real October answer for an account on a promotional credit:
// GroupBy SERVICE x RECORD_TYPE, every Usage group matched by a Credit group.
// Amounts and service names only; no account ids.
const REAL_USAGE = [
  ["Amazon Elastic Container Service for Kubernetes", "3.037951998"],
  ["AWS Cost Explorer", "0.72"],
  ["Amazon Elastic Load Balancing", "0.3591"],
  ["EC2 - Other", "0.0664777765"],
  ["Amazon Simple Storage Service", "0.0438610741"],
  ["AmazonCloudWatch", "0.02669"],
  ["Amazon Elastic Compute Cloud - Compute", "0.0258561451"],
  ["Amazon Virtual Private Cloud", "0.015861115"],
  ["AWS Secrets Manager", "0.0032009702"],
  ["Amazon DynamoDB", "0.000002279"],
  ["AWS Lambda", "0"],
];

function typed(service, type, amount) {
  return { Keys: [service, type], Metrics: { UnblendedCost: { Amount: String(amount), Unit: "USD" } } };
}

function creditedMonth() {
  const groups = [];
  for (const [service, amount] of REAL_USAGE) {
    groups.push(typed(service, "Usage", amount));
    if (Number(amount)) groups.push(typed(service, "Credit", -Number(amount)));
  }
  groups.push(typed("AWS Data Transfer", "Credit", "-0.000000477"));
  return { ResultsByTime: [{ TimePeriod: { Start: "2026-10-01", End: "2026-10-12" }, Total: {}, Groups: groups, Estimated: true }], DimensionValueAttributes: [] };
}

function dailyResources() {
  const day = (start, groups) => ({ TimePeriod: { Start: start }, Total: {}, Groups: groups, Estimated: true });
  const lb = "arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/cloudspider-api/abc";
  const row = (id, amount) => ({ Keys: [id], Metrics: { UnblendedCost: { Amount: String(amount), Unit: "USD" } } });
  return { ResultsByTime: [day("2026-10-09", [row(lb, "0.10")]), day("2026-10-10", [row(lb, "0.24")]), day("2026-10-11", [])] };
}

function realClient(log, { forecast = "unavailable" } = {}) {
  return {
    async send(command) {
      const name = command.constructor.name;
      log.push({ name, input: command.input });
      if (name === "GetCostForecastCommand") {
        if (forecast === "unavailable") {
          const error = new Error("Insufficient amount of historical data to generate forecast.");
          error.name = "DataUnavailableException";
          throw error;
        }
        return { Total: { Amount: String(forecast), Unit: "USD" } };
      }
      if (command.input.GroupBy?.[0]?.Key === "RESOURCE_ID") {
        if (command.input.Filter.And[0].Dimensions.Values[0] === "Amazon Elastic Load Balancing") return dailyResources();
        return { ResultsByTime: [] };
      }
      return creditedMonth();
    },
  };
}

test("a promotional credit no longer hides the bill: charges are the headline, credits apart", async () => {
  const log = [];
  const bill = await createCost({ client: realClient(log), now: () => new Date("2026-10-11T08:00:00Z") }).read();
  // Before the fix every service netted to $0 and the panel said "Cost $0.00".
  assert.equal(bill.label, "Cost $4.30");
  assert.equal(bill.total, "$4.30");
  assert.equal(bill.credit.amount, "−$4.30");
  assert.equal(bill.net, "$0.00");
  assert.equal(bill.rows[0].short, "EKS");
  assert.equal(bill.rows[0].amount, "$3.04");
  assert.equal(bill.rows[1].service, "AWS Cost Explorer");
  assert.equal(bill.rows[1].amount, "$0.72");
  assert.ok(!bill.rows.some((row) => row.service === "AWS Data Transfer"), "a credit-only crumb is not a charge row");
  assert.match(bill.lines.join("\n"), /credits\s+−\$4\.30/);
  assert.match(bill.lines.join("\n"), /you pay\s+\$0\.00/);
  // Freshness is the newest day with data, not "today".
  assert.equal(bill.dataThrough, "2026-10-10");
  assert.match(bill.lines[0], /October, estimated, data through Oct 10 \(UTC\)/);
  // Forecast: too little history is said plainly, not an error.
  assert.equal(bill.forecast.value, null);
  assert.match(bill.forecast.note, /too little history/);
  const forecastCall = log.find((entry) => entry.name === "GetCostForecastCommand");
  assert.equal(forecastCall.input.Metric, "UNBLENDED_COST");
  assert.equal(forecastCall.input.TimePeriod.Start, "2026-10-11");
  assert.equal(forecastCall.input.TimePeriod.End, "2026-11-01");
  // One month read, three resource reads, one forecast: five billed calls.
  assert.equal(log.length, 5);
  // Resource rows stay optional detail.
  assert.ok(bill.resources.some((row) => row.resource === "cloudspider-api" && row.amount === "$0.34"));

  const model = spendModel(bill);
  assert.equal(model.head.total, "$4.30");
  assert.equal(model.head.caption, "estimated · data through Oct 10 UTC");
  assert.equal(model.head.credits, "credits −$4.30 · you pay $0.00");
  assert.match(model.pace, /straight line: AWS has too little history/);
});

test("an AWS forecast replaces the straight line when Cost Explorer has one", async () => {
  const bill = await createCost({ client: realClient([], { forecast: "9.10" }), now: () => new Date("2026-10-11T08:00:00Z") }).read();
  assert.equal(bill.forecast.amount, "$13.40");
  const model = spendModel(bill);
  assert.match(model.pace, /^AWS forecast \$13\.40 by Oct 31 · charges before credits$/);
  assert.deepEqual(forecastWindow(new Date("2026-10-31T23:00:00Z")), { start: "2026-10-31", end: "2026-11-01" });
});

test("the bill is cached on disk so a restart does not pay Cost Explorer again", async () => {
  const dir = await mkdtemp(join(tmpdir(), "cost-cache-"));
  const cacheFile = join(dir, "nested", "cost-cache.json");
  let clock = new Date("2026-10-11T08:00:00Z");
  const log = [];
  const first = await createCost({ client: realClient(log), now: () => clock, cacheFile }).read();
  assert.equal(log.length, 5);
  assert.equal(JSON.parse(await readFile(cacheFile, "utf8")).total, "$4.30");
  // A new process (fresh createCost) within the hour reuses the file.
  clock = new Date("2026-10-11T13:00:00Z");
  const again = await createCost({ client: realClient(log), now: () => clock, cacheFile }).read();
  assert.equal(log.length, 5);
  assert.equal(again.total, first.total);
  // After the TTL it reads again.
  clock = new Date("2026-10-11T14:30:00Z");
  await createCost({ client: realClient(log), now: () => clock, cacheFile }).read();
  assert.equal(log.length, 10);
});

test("lastDataDay is the newest day with a non-zero amount", () => {
  assert.equal(lastDataDay([dailyResources()]), "2026-10-10");
  assert.equal(lastDataDay([]), "");
});
