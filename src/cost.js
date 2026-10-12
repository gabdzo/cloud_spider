import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostAndUsageWithResourcesCommand,
  GetCostForecastCommand,
} from "@aws-sdk/client-cost-explorer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { publicError } from "./aws.js";

const REGION = "us-east-1";
const DUST = 0.01;
// Credits and refunds are their own record types in Cost Explorer. With a
// promotional credit every service's UnblendedCost nets to about zero, so
// the headline counts the charges and shows the credits beside them.
const CREDIT_TYPES = new Set(["Credit", "Refund"]);
const NOT_CREDITS = { Not: { Dimensions: { Key: "RECORD_TYPE", Values: [...CREDIT_TYPES] } } };
// Every Cost Explorer request is billed ($0.01), so a bill is kept on disk
// too: a server restart (RUN-ME's after-pull routine) does not read it again.
export const COST_TTL = 6 * 60 * 60 * 1000;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function monthWindow(now = new Date()) {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const start = new Date(Date.UTC(year, month, 1));
  const end = new Date(Date.UTC(year, month, now.getUTCDate() + 1));
  return { start: stamp(start), end: stamp(end) };
}

// A credit reads "−$0.24" (a real minus sign before the dollar), never "$-0.24".
export function formatAmount(value, unit) {
  const cents = Math.round((Math.abs(value) + Number.EPSILON) * 100) / 100;
  const sign = value < 0 && cents > 0 ? "\u2212" : "";
  const number = cents.toFixed(2);
  if (unit === "USD") return `${sign}$${number}`;
  if (!unit) return `${sign}${number}`;
  return `${sign}${number} ${unit}`;
}

export const SERVICE_ICON = {
  "Amazon Elastic Load Balancing": "lb",
  "Amazon Elastic Kubernetes Service": "cluster",
  "Amazon Elastic Container Service for Kubernetes": "cluster",
  "Amazon Elastic Compute Cloud - Compute": "ec2",
  "Amazon Elastic Compute Cloud": "ec2",
  "EC2 - Other": "ec2",
  "Amazon Virtual Private Cloud": "vpc",
  "Amazon Simple Storage Service": "bucket",
  "AWS Lambda": "function",
  "Amazon DynamoDB": "table",
  "AWS Secrets Manager": "secret",
  "Amazon Relational Database Service": "database",
  "Amazon CloudFront": "cdn",
  "Amazon Simple Queue Service": "queue",
  "AmazonCloudWatch": "logs",
  "Amazon CloudWatch": "logs",
  "AWS X-Ray": "logs",
};

// A short service name for the panel: "Amazon Elastic Load Balancing" → "ELB".
export function shortService(service) {
  if (SERVICE_SHORT[service]) return SERVICE_SHORT[service];
  return String(service || "unknown").replace(/^(Amazon|AWS)\s+/, "").replace(/^Elastic Compute Cloud/, "EC2");
}

// Cost Explorer's own service names: EKS bills as "Amazon Elastic Container
// Service for Kubernetes", not "Amazon Elastic Kubernetes Service".
export const RESOURCE_SERVICES = [
  "Amazon Elastic Load Balancing",
  "Amazon Elastic Container Service for Kubernetes",
  "Amazon Elastic Compute Cloud - Compute",
];

const SERVICE_SHORT = {
  "Amazon Elastic Load Balancing": "ELB",
  "Amazon Elastic Kubernetes Service": "EKS",
  "Amazon Elastic Container Service for Kubernetes": "EKS",
  "Amazon Elastic Compute Cloud - Compute": "EC2",
  "Amazon Elastic Compute Cloud": "EC2",
  "EC2 - Other": "EC2 other",
  "Amazon Virtual Private Cloud": "VPC",
  "Amazon Simple Storage Service": "S3",
  "Amazon Relational Database Service": "RDS",
  "Amazon Simple Queue Service": "SQS",
};

// Month-to-date pace: the days the window covers, and a straight-line
// forecast to the month's end (only for a positive total in one unit).
export function monthPace(window, totalValue) {
  const start = new Date(`${window.start}T00:00:00Z`);
  const end = new Date(`${window.end}T00:00:00Z`);
  const days = Math.max(1, Math.round((end - start) / 86400000));
  const monthDays = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
  if (!(totalValue > 0)) return { days, monthDays, perDay: 0, forecast: 0 };
  const perDay = totalValue / days;
  return { days, monthDays, perDay, forecast: perDay * monthDays };
}

export function costFailure(error, call = "GetCostAndUsage") {
  const text = typeof error === "string" ? error : publicError(error).error;
  if (text.includes(call) && text.includes("us-east-1") && !text.includes("eu-north-1")) {
    return { error: text, label: text, lines: [text] };
  }
  const sentence = `${text.replace(/\.?\s*$/, ".")} The bill is read from Cost Explorer (${call}, us-east-1) with the AWS_PROFILE you started with; it needs ce:${call}. AWS_REGION can stay as it is.`;
  return { error: sentence, label: sentence, lines: [sentence] };
}

export function resourceWindow(now = new Date()) {
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 14);
  return { start: stamp(start), end: stamp(end) };
}

// GetCostAndUsage grouped by SERVICE and RECORD_TYPE. Charges (Usage, Tax,
// Support, fees) make the headline; Credit and Refund rows are summed apart.
// A page grouped by SERVICE alone counts as charges.
export function shapeCost(pages, window, { dataThrough = "" } = {}) {
  const totals = new Map();
  let creditValue = 0;
  let estimated = false;
  for (const page of pages) {
    for (const period of page.ResultsByTime || []) {
      if (period.Estimated) estimated = true;
      for (const group of period.Groups || []) {
        const metric = group.Metrics?.UnblendedCost;
        if (!metric) continue;
        const value = Number(metric.Amount);
        if (!Number.isFinite(value)) continue;
        const service = group.Keys?.[0] || "unknown";
        const prev = totals.get(service) || { service, value: 0, credit: 0, unit: metric.Unit || "" };
        if (CREDIT_TYPES.has(group.Keys?.[1])) {
          prev.credit += value;
          creditValue += value;
        } else prev.value += value;
        if (!prev.unit && metric.Unit) prev.unit = metric.Unit;
        totals.set(service, prev);
      }
    }
  }
  const kept = [...totals.values()].filter((row) => Math.abs(row.value) >= DUST);
  kept.sort((a, b) => b.value - a.value || a.service.localeCompare(b.service));
  const month = MONTHS[Number(window.start.slice(5, 7)) - 1] || "";
  const through = dataThrough ? `data through ${MONTHS[Number(dataThrough.slice(5, 7)) - 1]?.slice(0, 3)} ${Number(dataThrough.slice(8, 10))} (UTC)` : "about a day behind";
  const note = `account, not this region. ${month}, ${estimated ? "estimated, " : ""}${through}.`;
  const base = { month, scope: "account", start: window.start, end: window.end, estimated, dataThrough };
  const credit = Math.abs(creditValue) >= DUST ? { value: Math.round(creditValue * 100) / 100, amount: formatAmount(creditValue, "USD") } : null;
  if (!kept.length) {
    return {
      ...base,
      label: "Cost $0.00",
      total: "$0.00",
      totalValue: 0,
      unit: "USD",
      credit,
      net: "$0.00",
      netValue: 0,
      pace: monthPace(window, 0),
      rows: [],
      lines: [note, "no charge above $0.01 yet"],
    };
  }
  const sameUnit = kept.every((row) => row.unit === kept[0].unit);
  const unit = sameUnit ? kept[0].unit : "";
  const sum = kept.reduce((acc, row) => acc + row.value, 0);
  const total = formatAmount(sum, unit);
  const totalValue = Math.round(sum * 100) / 100;
  const netValue = Math.round((sum + (credit ? creditValue : 0)) * 100) / 100;
  const rows = kept.map((row) => ({
    service: row.service,
    short: shortService(row.service),
    icon: SERVICE_ICON[row.service] || "caps",
    value: Math.round(row.value * 100) / 100,
    unit: row.unit,
    amount: formatAmount(row.value, row.unit),
    ...(Math.abs(row.credit) >= DUST ? { credit: Math.round(row.credit * 100) / 100, creditAmount: formatAmount(row.credit, row.unit) } : {}),
  }));
  const tail = credit ? [align("credits", credit.amount), align("you pay", formatAmount(netValue, unit))] : [];
  return {
    ...base,
    totalValue,
    unit,
    credit,
    net: formatAmount(netValue, unit),
    netValue,
    pace: sameUnit && unit === "USD" ? monthPace(window, totalValue) : monthPace(window, 0),
    label: `Cost ${total}`,
    total,
    rows,
    lines: [note, ...rows.map((row) => align(row.service, row.amount)), align("charges", total), ...tail],
  };
}

// The newest day a DAILY read has any amount for (Cost Explorer runs about
// a day behind; today is usually empty).
export function lastDataDay(pages) {
  let last = "";
  for (const page of pages) {
    for (const period of page.ResultsByTime || []) {
      const day = period.TimePeriod?.Start || "";
      const any = (period.Groups || []).some((group) => Number(group.Metrics?.UnblendedCost?.Amount) !== 0);
      if (any && day > last) last = day;
    }
  }
  return last;
}

// The month's end, from GetCostForecast for what is left of the month plus
// the month so far. A young account has no forecast (DataUnavailable): the
// panel keeps its straight line and says why.
export function forecastWindow(now = new Date()) {
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: stamp(start), end: stamp(end) };
}

export function shapeResources(service, pages) {
  const totals = new Map();
  const days = [...new Set(pages.flatMap((page) => (page.ResultsByTime || []).map((period) => period.TimePeriod?.Start || "")))].filter(Boolean).sort();
  const dayIndex = new Map(days.map((day, index) => [day, index]));
  for (const page of pages) {
    for (const period of page.ResultsByTime || []) {
      const slot = dayIndex.get(period.TimePeriod?.Start || "");
      for (const group of period.Groups || []) {
        const metric = group.Metrics?.UnblendedCost;
        if (!metric) continue;
        const value = Number(metric.Amount);
        if (!Number.isFinite(value)) continue;
        const id = group.Keys?.[0] || "unknown";
        const prev = totals.get(id) || { id, value: 0, unit: metric.Unit || "", series: days.map(() => 0) };
        prev.value += value;
        if (slot !== undefined) prev.series[slot] += value;
        if (!prev.unit && metric.Unit) prev.unit = metric.Unit;
        totals.set(id, prev);
      }
    }
  }
  const kept = [...totals.values()].filter((row) => Math.abs(row.value) >= DUST);
  kept.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  return kept.map((row) => ({
    service,
    short: shortService(service),
    icon: SERVICE_ICON[service] || "caps",
    id: row.id,
    resource: shortResource(row.id),
    value: Math.round(row.value * 100) / 100,
    amount: formatAmount(row.value, row.unit),
    credit: row.value < 0,
    series: days.length > 1 ? row.series.map((value) => Math.round(value * 1000) / 1000) : [],
  }));
}

export function resourceLines(blocks) {
  const lines = ["last 14 days, by resource."];
  let any = false;
  for (const block of blocks) {
    const name = SERVICE_SHORT[block.service] || block.service;
    if (block.error) {
      lines.push(`${name}: ${block.error}`);
      any = true;
      continue;
    }
    for (const row of block.rows || []) {
      lines.push(align(`${name} ${row.resource}`, row.amount));
      any = true;
    }
  }
  if (!any) lines.push("no charge above $0.01 yet");
  return lines;
}

// The sample bill: made-up numbers in the real shape, so SAMPLE shows the
// whole panel (services, resources with 14-day bars, a credit).
export function sampleCost(now = new Date()) {
  const window = monthWindow(now);
  const wave = (base, swing, phase = 0) => Array.from({ length: 14 }, (_, i) => Math.round((base + swing * Math.sin(i / 2 + phase)) * 1000) / 1000);
  const sum = (series) => Math.round(series.reduce((a, b) => a + b, 0) * 100) / 100;
  const resource = (service, id, resource, series) => ({ service, short: shortService(service), icon: SERVICE_ICON[service] || "caps", id, resource, series, value: sum(series), amount: formatAmount(sum(series), "USD"), credit: sum(series) < 0 });
  const resources = [
    resource("Amazon Elastic Kubernetes Service", "arn:aws:eks:sample:cluster/cloudspider-up", "cloudspider-up", wave(2.4, 0.01)),
    resource("Amazon Elastic Compute Cloud - Compute", "i-0sample0running", "sample-running", wave(0.41, 0.12, 1)),
    resource("Amazon Elastic Load Balancing", "arn:aws:elasticloadbalancing:sample:loadbalancer/app/sample-gate/1", "sample-gate", wave(0.55, 0.05, 2)),
    resource("Amazon Elastic Load Balancing", "arn:aws:elasticloadbalancing:sample:loadbalancer/app/sample-old-gate/2", "sample-old-gate", wave(0.13, 0.0)),
    resource("Amazon Elastic Compute Cloud - Compute", "NoResourceId", "no resource id", wave(-0.02, 0.0)),
  ];
  // The month so far is a share of the 14 days, so the two blocks agree.
  const pace0 = monthPace(window, 1);
  const byService = new Map();
  for (const row of resources) if (row.value > 0) byService.set(row.service, (byService.get(row.service) || 0) + row.value);
  byService.set("Amazon Virtual Private Cloud", 1.4);
  byService.set("AWS Secrets Manager", 0.18);
  const services = [...byService.entries()].map(([service, value]) => [service, Math.round((value * Math.min(pace0.days, 14)) / 14 * 100) / 100]).sort((a, b) => b[1] - a[1]);
  const rows = services.map(([service, value]) => ({ service, short: shortService(service), icon: SERVICE_ICON[service] || "caps", value, unit: "USD", amount: formatAmount(value, "USD") }));
  const totalValue = Math.round(services.reduce((a, [, v]) => a + v, 0) * 100) / 100;
  return {
    sample: true,
    label: "Cost sample",
    month: MONTHS[now.getUTCMonth()],
    scope: "sample",
    start: window.start,
    end: window.end,
    total: formatAmount(totalValue, "USD"),
    totalValue,
    unit: "USD",
    pace: monthPace(window, totalValue),
    rows,
    resources,
    resourceErrors: {},
    lines: ["sample, not the account."],
    hints: [
      { tone: "warn", label: "IDLE·BILLED", text: "sample-old-gate: an ALB with no healthy target, $0.13/day ($1.82 in 14 days). Take it down or give it a target." },
      { tone: "", label: "SPOT", text: "cloudspider-up's node group runs SPOT (t4g.medium pool): about $0.022/h a node instead of $0.0336, ~$16 a month saved on 2 nodes." },
      { tone: "", label: "IDLE", text: "sample-stopped: stopped, its 8 GiB gp3 volume still bills about $0.64 a month." },
    ],
  };
}

// The bill is kept in storage (key cost/bill, storage.js) when one is given,
// else in cacheFile, so a restart within ttl does not pay Cost Explorer again.
export function createCost({ client, now = () => new Date(), cacheFile = "", storage = null, ttl = COST_TTL } = {}) {
  const ce = client || new CostExplorerClient({ region: REGION });
  const cache = storage
    ? { load: async () => fresh(await storage.get(COST_KEY).catch(() => null), now(), ttl), save: (bill) => storage.put(COST_KEY, bill).catch(() => {}) }
    : cacheFile
      ? { load: () => loadCache(cacheFile, now(), ttl), save: (bill) => saveCache(cacheFile, now(), bill) }
      : null;
  return {
    sample: sampleCost,
    async read() {
      if (cache) {
        const kept = await cache.load();
        if (kept) return kept;
      }
      const window = monthWindow(now());
      let pages;
      try {
        pages = await collect((token) =>
          ce.send(
            new GetCostAndUsageCommand({
              TimePeriod: { Start: window.start, End: window.end },
              Granularity: "MONTHLY",
              Metrics: ["UnblendedCost"],
              GroupBy: [
                { Type: "DIMENSION", Key: "SERVICE" },
                { Type: "DIMENSION", Key: "RECORD_TYPE" },
              ],
              ...(token ? { NextPageToken: token } : {}),
            }),
          ),
        );
      } catch (error) {
        return costFailure(error);
      }
      const span = resourceWindow(now());
      const blocks = [];
      const dailyPages = [];
      for (const service of RESOURCE_SERVICES) {
        try {
          const resourcePages = await collect((token) =>
            ce.send(
              new GetCostAndUsageWithResourcesCommand({
                TimePeriod: { Start: span.start, End: span.end },
                Granularity: "DAILY",
                Metrics: ["UnblendedCost"],
                // Charges only: the credit would net each resource to zero.
                Filter: { And: [{ Dimensions: { Key: "SERVICE", Values: [service] } }, NOT_CREDITS] },
                GroupBy: [{ Type: "DIMENSION", Key: "RESOURCE_ID" }],
                ...(token ? { NextPageToken: token } : {}),
              }),
            ),
          );
          dailyPages.push(...resourcePages);
          blocks.push({ service, rows: shapeResources(service, resourcePages) });
        } catch (error) {
          blocks.push({ service, error: costFailure(error, "GetCostAndUsageWithResources").error });
        }
      }
      // Raw resource ids ride beside the short labels so the morning can
      // meet a bill row to an object on the map.
      const resources = blocks.flatMap((block) => block.rows || []);
      const resourceErrors = Object.fromEntries(blocks.filter((block) => block.error).map((block) => [block.service, block.error]));
      const bill = shapeCost(pages, window, { dataThrough: lastDataDay(dailyPages) });
      bill.forecast = bill.unit === "USD" ? await readForecast(ce, now(), bill.totalValue) : null;
      const result = { ...bill, lines: [...bill.lines, ...resourceLines(blocks)], resources, resourceErrors, resourceStart: span.start, resourceEnd: span.end, readAt: now().toISOString() };
      if (cache) await cache.save(result);
      return result;
    },
  };
}

async function readForecast(ce, at, monthToDate) {
  const span = forecastWindow(at);
  try {
    const out = await ce.send(
      new GetCostForecastCommand({
        TimePeriod: { Start: span.start, End: span.end },
        Granularity: "MONTHLY",
        Metric: "UNBLENDED_COST",
        Filter: NOT_CREDITS,
      }),
    );
    const rest = Number(out?.Total?.Amount);
    if (!Number.isFinite(rest)) return { value: null, note: "no forecast in the answer" };
    const value = Math.round((monthToDate + rest) * 100) / 100;
    return { value, amount: formatAmount(value, "USD"), note: "AWS forecast, charges before credits" };
  } catch (error) {
    const name = error?.name || "";
    const note = name === "DataUnavailableException" ? "AWS has too little history to forecast yet" : `no forecast (${publicError(error).error})`;
    return { value: null, note };
  }
}

export const COST_KEY = "cost/bill";

function fresh(kept, at, ttl) {
  if (!kept || typeof kept !== "object") return null;
  const age = at.getTime() - Date.parse(kept.readAt || "");
  if (!(age >= 0 && age < ttl) || kept.error) return null;
  return kept;
}

async function loadCache(file, at, ttl) {
  try {
    return fresh(JSON.parse(await readFile(file, "utf8")), at, ttl);
  } catch {
    return null;
  }
}

async function saveCache(file, at, bill) {
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(bill));
  } catch {
    // A read-only checkout still shows the bill; it is only read again.
  }
}

async function collect(send) {
  const pages = [];
  const seen = new Set();
  let token = "";
  do {
    const out = await send(token);
    pages.push(out);
    token = out.NextPageToken || "";
    if (token && seen.has(token)) break;
    if (token) seen.add(token);
  } while (token);
  return pages;
}

function shortResource(id) {
  if (!id || id === "NoResourceId") return "no resource id";
  const parts = id.split("/").filter(Boolean);
  const marker = parts.findIndex((part) => part === "app" || part === "net" || part === "cluster");
  const named = marker >= 0 && parts[marker + 1] ? parts[marker + 1] : parts.at(-1) || id;
  return named.length > 28 ? named.slice(-28) : named;
}

function align(name, amount) {
  const gap = Math.max(2, 42 - name.length);
  return `${name}${" ".repeat(gap)}${amount}`;
}

function stamp(date) {
  return date.toISOString().slice(0, 10);
}
