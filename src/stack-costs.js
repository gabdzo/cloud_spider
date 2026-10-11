// What a stack costs while it is up, in eu-north-1 (Stockholm), on-demand.
// Prices come from the AWS Price List bulk files for eu-north-1
//   https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<service>/current/eu-north-1/index.csv
// read on 2026-10-10 (docs/plan-expansion.md lists them with the rows used).
// Pure: no network. A stack lists its lines; estimate() turns them into
// per hour, per day and per month (730 h) figures. Usage-billed services
// (requests, data out) are $0 while idle and listed as `usage` so the card
// can say "plus what you use" instead of pretending they are free.
export const PRICES_AS_OF = "2026-10-10";
export const HOURS_PER_MONTH = 730;

export const PRICES = {
  "eks-cluster": { usd: 0.1, per: "hour", text: "EKS control plane" },
  "ec2:t4g.micro": { usd: 0.0086, per: "hour", text: "t4g.micro" },
  "ec2:t4g.small": { usd: 0.0172, per: "hour", text: "t4g.small" },
  "ec2:t4g.medium": { usd: 0.0344, per: "hour", text: "t4g.medium" },
  "ec2:m7i-flex.xlarge": { usd: 0.2035, per: "hour", text: "m7i-flex.xlarge" },
  "ec2:m7i-flex.2xlarge": { usd: 0.407, per: "hour", text: "m7i-flex.2xlarge" },
  "ec2:m7i.2xlarge": { usd: 0.4284, per: "hour", text: "m7i.2xlarge" },
  "ec2:c5.metal": { usd: 4.368, per: "hour", text: "c5.metal" },
  "public-ipv4": { usd: 0.005, per: "hour", text: "public IPv4 address" },
  "ebs-gp3-gb": { usd: 0.0836, per: "month", text: "EBS gp3 GB" },
  "rds:db.t4g.micro:postgres": { usd: 0.016, per: "hour", text: "RDS db.t4g.micro PostgreSQL single-AZ" },
  "rds-gp3-gb": { usd: 0.12, per: "month", text: "RDS gp3 GB" },
  "secret": { usd: 0.4, per: "month", text: "Secrets Manager secret" },
  "s3-gb": { usd: 0.023, per: "month", text: "S3 Standard GB" },
};

// Billed per request or per GB moved: $0 when nobody uses it.
export const USAGE = {
  sqs: "SQS requests (first 1M a month free)",
  lambda: "Lambda requests and GB-seconds (free tier)",
  cloudfront: "CloudFront requests and data out (free tier 1 TB)",
  logs: "CloudWatch Logs ingested and stored",
  "s3-requests": "S3 requests",
};

const round = (value, places) => Math.round(value * 10 ** places) / 10 ** places;

// lines: [{ price: "<key>", qty }] or [{ usage: "<key>" }]
export function estimate(lines = []) {
  let hourly = 0;
  const items = [];
  const usage = [];
  for (const line of lines) {
    if (line.usage) {
      if (!USAGE[line.usage]) throw new Error(`unknown usage ${line.usage}`);
      usage.push(USAGE[line.usage]);
      continue;
    }
    const price = PRICES[line.price];
    if (!price) throw new Error(`unknown price ${line.price}`);
    const qty = line.qty ?? 1;
    const perHour = price.per === "hour" ? price.usd * qty : (price.usd * qty) / HOURS_PER_MONTH;
    hourly += perHour;
    items.push({ text: qty === 1 ? price.text : `${qty} × ${price.text}`, month: round(perHour * HOURS_PER_MONTH, 2) });
  }
  return {
    hour: round(hourly, 4),
    day: round(hourly * 24, 2),
    month: round(hourly * HOURS_PER_MONTH, 2),
    items,
    usage,
    region: "eu-north-1",
    asOf: PRICES_AS_OF,
  };
}

// A card's lines for the parameters picked in it: a line with `param`
// takes its price from that parameter ("ec2:" + instanceType) and a line
// with `perNode` is counted once per node (nodeCount).
export function costFor(lines = [], params = {}) {
  const nodes = Math.max(1, Number(params.nodeCount) || 1);
  return lines.map((line) => {
    if (line.usage) return line;
    let price = line.price;
    if (line.param && params[line.param] && PRICES[`${line.prefix || ""}${params[line.param]}`]) price = `${line.prefix || ""}${params[line.param]}`;
    const qty = (line.qty ?? 1) * (line.perNode ? nodes : 1);
    return { price, qty };
  });
}

function money(value) {
  if (value === 0) return "$0";
  if (value < 0.01) return "<$0.01";
  if (value >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4).replace(/0{1,2}$/, "")}`;
}

// "$0.12/h · $2.99/day · $90.92/mo" (+ "+ usage" when usage-billed parts exist)
export function costLine(cost) {
  if (!cost) return "";
  const parts = [`${money(cost.hour)}/h`, `${money(cost.day)}/day`, `${money(cost.month)}/mo`].join(" · ");
  return cost.usage?.length ? `${parts} + usage` : parts;
}
