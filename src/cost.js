import {
  CostExplorerClient,
  GetCostAndUsageCommand,
  GetCostAndUsageWithResourcesCommand,
} from "@aws-sdk/client-cost-explorer";
import { publicError } from "./aws.js";

const REGION = "us-east-1";
const DUST = 0.01;
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

export const RESOURCE_SERVICES = [
  "Amazon Elastic Load Balancing",
  "Amazon Elastic Kubernetes Service",
  "Amazon Elastic Compute Cloud - Compute",
];

const SERVICE_SHORT = {
  "Amazon Elastic Load Balancing": "ELB",
  "Amazon Elastic Kubernetes Service": "EKS",
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

export function shapeCost(pages, window) {
  const totals = new Map();
  for (const page of pages) {
    for (const period of page.ResultsByTime || []) {
      for (const group of period.Groups || []) {
        const metric = group.Metrics?.UnblendedCost;
        if (!metric) continue;
        const value = Number(metric.Amount);
        if (!Number.isFinite(value)) continue;
        const service = group.Keys?.[0] || "unknown";
        const prev = totals.get(service) || { service, value: 0, unit: metric.Unit || "" };
        prev.value += value;
        if (!prev.unit && metric.Unit) prev.unit = metric.Unit;
        totals.set(service, prev);
      }
    }
  }
  const kept = [...totals.values()].filter((row) => Math.abs(row.value) >= DUST);
  kept.sort((a, b) => b.value - a.value || a.service.localeCompare(b.service));
  const month = MONTHS[Number(window.start.slice(5, 7)) - 1] || "";
  const note = `account, not this region. ${month}, estimated, about a day behind.`;
  const base = { month, scope: "account", start: window.start, end: window.end };
  if (!kept.length) {
    return {
      ...base,
      label: "Cost $0.00",
      total: "$0.00",
      totalValue: 0,
      unit: "USD",
      pace: monthPace(window, 0),
      rows: [],
      lines: [note, "no charge above $0.01 yet"],
    };
  }
  const sameUnit = kept.every((row) => row.unit === kept[0].unit);
  const total = formatAmount(
    kept.reduce((sum, row) => sum + row.value, 0),
    sameUnit ? kept[0].unit : "",
  );
  const totalValue = Math.round(kept.reduce((sum, row) => sum + row.value, 0) * 100) / 100;
  const rows = kept.map((row) => ({
    service: row.service,
    short: shortService(row.service),
    icon: SERVICE_ICON[row.service] || "caps",
    value: Math.round(row.value * 100) / 100,
    unit: row.unit,
    amount: formatAmount(row.value, row.unit),
  }));
  return {
    ...base,
    totalValue,
    unit: sameUnit ? kept[0].unit : "",
    pace: sameUnit && kept[0].unit === "USD" ? monthPace(window, totalValue) : monthPace(window, 0),
    label: `Cost ${total}`,
    total,
    rows,
    lines: [note, ...rows.map((row) => align(row.service, row.amount)), align("total", total)],
  };
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
    resource("Amazon Elastic Kubernetes Service", "arn:aws:eks:sample:cluster/sample-cluster", "sample-cluster", wave(2.4, 0.01)),
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
  };
}

export function createCost({ client, now = () => new Date() } = {}) {
  const ce = client || new CostExplorerClient({ region: REGION });
  return {
    sample: sampleCost,
    async read() {
      const window = monthWindow(now());
      let pages;
      try {
        pages = await collect((token) =>
          ce.send(
            new GetCostAndUsageCommand({
              TimePeriod: { Start: window.start, End: window.end },
              Granularity: "MONTHLY",
              Metrics: ["UnblendedCost"],
              GroupBy: [{ Type: "DIMENSION", Key: "SERVICE" }],
              ...(token ? { NextPageToken: token } : {}),
            }),
          ),
        );
      } catch (error) {
        return costFailure(error);
      }
      const bill = shapeCost(pages, window);
      const span = resourceWindow(now());
      const blocks = [];
      for (const service of RESOURCE_SERVICES) {
        try {
          const resourcePages = await collect((token) =>
            ce.send(
              new GetCostAndUsageWithResourcesCommand({
                TimePeriod: { Start: span.start, End: span.end },
                Granularity: "DAILY",
                Metrics: ["UnblendedCost"],
                Filter: { Dimensions: { Key: "SERVICE", Values: [service] } },
                GroupBy: [{ Type: "DIMENSION", Key: "RESOURCE_ID" }],
                ...(token ? { NextPageToken: token } : {}),
              }),
            ),
          );
          blocks.push({ service, rows: shapeResources(service, resourcePages) });
        } catch (error) {
          blocks.push({ service, error: costFailure(error, "GetCostAndUsageWithResources").error });
        }
      }
      // Raw resource ids ride beside the short labels so the morning can
      // meet a bill row to an object on the map.
      const resources = blocks.flatMap((block) => block.rows || []);
      const resourceErrors = Object.fromEntries(blocks.filter((block) => block.error).map((block) => [block.service, block.error]));
      return { ...bill, lines: [...bill.lines, ...resourceLines(blocks)], resources, resourceErrors, resourceStart: span.start, resourceEnd: span.end };
    },
  };
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
