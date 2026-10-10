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

export function formatAmount(value, unit) {
  const number = (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
  if (unit === "USD") return `$${number}`;
  if (!unit) return number;
  return `${number} ${unit}`;
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
};

export function costFailure(error, call = "GetCostAndUsage") {
  const text = typeof error === "string" ? error : publicError(error).error;
  if (text.includes(call) && text.includes("us-east-1") && !text.includes("eu-north-1")) {
    return { error: text, label: text, lines: [text] };
  }
  const sentence = `${text} Set AWS_PROFILE=default and AWS_REGION=us-east-1. ${call}.`;
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
  if (!kept.length) {
    return {
      label: "Cost $0.00",
      total: "$0.00",
      rows: [],
      lines: [note, "no charge above $0.01 yet"],
    };
  }
  const sameUnit = kept.every((row) => row.unit === kept[0].unit);
  const total = formatAmount(
    kept.reduce((sum, row) => sum + row.value, 0),
    sameUnit ? kept[0].unit : "",
  );
  const rows = kept.map((row) => ({
    service: row.service,
    amount: formatAmount(row.value, row.unit),
  }));
  return {
    label: `Cost ${total}`,
    total,
    rows,
    lines: [note, ...rows.map((row) => align(row.service, row.amount)), align("total", total)],
  };
}

export function shapeResources(service, pages) {
  const totals = new Map();
  for (const page of pages) {
    for (const period of page.ResultsByTime || []) {
      for (const group of period.Groups || []) {
        const metric = group.Metrics?.UnblendedCost;
        if (!metric) continue;
        const value = Number(metric.Amount);
        if (!Number.isFinite(value)) continue;
        const id = group.Keys?.[0] || "unknown";
        const prev = totals.get(id) || { id, value: 0, unit: metric.Unit || "" };
        prev.value += value;
        if (!prev.unit && metric.Unit) prev.unit = metric.Unit;
        totals.set(id, prev);
      }
    }
  }
  const kept = [...totals.values()].filter((row) => Math.abs(row.value) >= DUST);
  kept.sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  return kept.map((row) => ({
    service,
    resource: shortResource(row.id),
    amount: formatAmount(row.value, row.unit),
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

export function sampleCost() {
  return {
    sample: true,
    label: "Cost sample",
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
      return { ...bill, lines: [...bill.lines, ...resourceLines(blocks)] };
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
