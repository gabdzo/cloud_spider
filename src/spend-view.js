// The CAPS bill panel under the header LCD: month-to-date total, pace,
// services ranked with share bars, and the last 14 days by resource with a
// small daily bar chart each. Credits read "−$0.24 credit" in their own tone.
// Pure DOM; colours come from theme.js through the CSS vars in server.js.

const MAX_RESOURCES = 12;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shortDay(day) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(day.slice(5, 7)) - 1] || ""} ${Number(day.slice(8, 10))}`;
}

function money(value) {
  const cents = Math.round(Math.abs(value) * 100) / 100;
  return `${value < 0 && cents > 0 ? "\u2212" : ""}$${cents.toFixed(2)}`;
}

// What the panel says, separate from the DOM so it can be tested.
export function spendModel(bill) {
  if (!bill) return { kind: "loading" };
  if (bill.error) return { kind: "error", text: bill.error };
  const legacy = !("totalValue" in bill) && !bill.resources;
  if (legacy) return { kind: "lines", lines: (bill.lines || []).filter((line) => line !== bill.label) };
  const usd = bill.unit === "USD" || bill.unit === undefined;
  const pace = bill.pace || {};
  const month = bill.month || "";
  // Freshness: Cost Explorer's estimate lags; say the newest day it has.
  const through = bill.dataThrough ? `data through ${shortDay(bill.dataThrough)} UTC` : "about 1 day behind";
  const head = {
    kicker: `${month ? month.toUpperCase() + " · " : ""}MONTH TO DATE`,
    total: bill.total || "$0.00",
    caption: bill.sample ? "made up · nothing read from AWS" : `${bill.estimated === false ? "" : "estimated · "}${through}`,
    scope: bill.sample ? "SAMPLE" : "ACCOUNT · ALL REGIONS",
    // Charges are the headline; credits (a promotional credit nets every
    // service to about zero) and what is left to pay sit under it.
    credits: bill.credit ? `credits ${bill.credit.amount} · you pay ${bill.net || "$0.00"}` : "",
  };
  let pace1 = "";
  if (usd && bill.forecast?.value > 0) {
    pace1 = `AWS forecast ${money(bill.forecast.value)} by ${month.slice(0, 3)} ${pace.monthDays || ""}`.trim() + " · charges before credits";
  } else if (usd && pace.perDay > 0 && pace.days) {
    pace1 = `≈ ${money(pace.perDay)}/day over ${pace.days} day${pace.days === 1 ? "" : "s"} · on pace for ${money(pace.forecast)} by ${month.slice(0, 3)} ${pace.monthDays}`;
    if (bill.forecast?.note) pace1 += ` (straight line: ${bill.forecast.note})`;
  }
  const services = (bill.rows || []).map((row) => ({ name: row.short || row.service, full: row.creditAmount ? `${row.service}: ${row.amount} charges, ${row.creditAmount} credit` : row.service, icon: row.icon || "caps", value: Number(row.value) || 0, amount: row.amount, credit: (Number(row.value) || 0) < 0 }));
  const top = Math.max(0, ...services.map((row) => Math.abs(row.value)));
  for (const row of services) row.share = top ? Math.abs(row.value) / top : 0;

  // Same short name twice (two ALBs called cloudspider-api): add the id tail.
  const all = [...(bill.resources || [])].sort((a, b) => (a.value < 0) - (b.value < 0) || Math.abs(b.value) - Math.abs(a.value));
  const seen = new Map();
  for (const row of all) seen.set(`${row.service}|${row.resource}`, (seen.get(`${row.service}|${row.resource}`) || 0) + 1);
  const resources = all.map((row) => {
    const value = Number(row.value) || 0;
    const credit = value < 0;
    const unattributed = row.id === "NoResourceId" || row.resource === "no resource id";
    let name = unattributed ? (credit ? "credits, not tied to a resource" : "not tied to a resource") : row.resource;
    if (!unattributed && seen.get(`${row.service}|${row.resource}`) > 1) name = `${row.resource} ·${String(row.id).split("/").pop().slice(0, 4)}`;
    return { name, id: row.id, service: row.short || row.service, icon: row.icon || "caps", value, amount: credit ? `${money(value)} credit` : money(value), credit, series: row.series || [] };
  });
  const gross = resources.filter((row) => !row.credit).reduce((sum, row) => sum + row.value, 0);
  const credits = resources.filter((row) => row.credit).reduce((sum, row) => sum + row.value, 0);
  const errors = Object.entries(bill.resourceErrors || {}).map(([service, text]) => ({ service, text }));
  return {
    kind: "bill",
    head,
    pace: pace1,
    services,
    resources: resources.slice(0, MAX_RESOURCES),
    more: Math.max(0, resources.length - MAX_RESOURCES),
    gross: resources.length ? money(gross) : "",
    credits: credits < 0 ? `${money(credits)} credit` : "",
    errors,
    emptyServices: !services.length,
  };
}

function spark(series, credit) {
  const box = el("span", `sp-spark${credit ? " credit" : ""}`);
  box.setAttribute("aria-hidden", "true");
  const top = Math.max(0, ...series.map((v) => Math.abs(v)));
  for (const value of series) {
    const bar = el("i");
    bar.style.height = `${top ? Math.max(8, Math.round((Math.abs(value) / top) * 100)) : 8}%`;
    if (!value) bar.className = "zero";
    box.append(bar);
  }
  return box;
}

export function renderSpend(container, bill, { iconURL } = {}) {
  const model = spendModel(bill);
  container.replaceChildren();
  container.classList.toggle("sp-legacy", model.kind === "lines");
  const icon = (name) => {
    const img = el("img", "px");
    img.alt = "";
    img.width = 16;
    img.height = 16;
    if (iconURL) img.src = iconURL(name);
    return img;
  };
  if (model.kind === "loading") {
    container.append(el("p", "sp-note", "reading the bill…"));
    return model;
  }
  if (model.kind === "error") {
    const box = el("div", "sp-error");
    box.append(el("b", "", "THE BILL DID NOT LOAD"), el("p", "", model.text));
    container.append(box);
    return model;
  }
  if (model.kind === "lines") {
    for (const line of model.lines) container.append(el("p", "sp-note", line));
    return model;
  }
  const head = el("div", "sp-head");
  const left = el("div", "sp-total");
  left.append(el("span", "sp-kicker", model.head.kicker), el("b", "sp-big", model.head.total), el("span", "sp-cap", model.head.caption));
  head.append(left, el("span", "sp-chip", model.head.scope));
  container.append(head);
  if (model.head.credits) container.append(el("p", "sp-pace sp-credits", model.head.credits));
  if (model.pace) container.append(el("p", "sp-pace", model.pace));

  const svc = el("section", "sp-sec");
  svc.append(el("h3", "", "BY SERVICE · THIS MONTH"));
  if (model.emptyServices) {
    svc.append(el("p", "sp-empty", "No charge above $0.01 this month yet."));
  } else {
    const list = el("ol", "sp-rows");
    for (const row of model.services) {
      const li = el("li", row.credit ? "credit" : "");
      const bar = el("span", "sp-share");
      bar.setAttribute("aria-hidden", "true");
      const fill = el("i");
      fill.style.width = `${Math.max(3, Math.round(row.share * 100))}%`;
      bar.append(fill);
      const name = el("span", "sp-name", row.name);
      name.title = row.full;
      li.append(icon(row.icon), name, bar, el("span", "sp-amt", row.amount));
      list.append(li);
    }
    svc.append(list);
  }
  container.append(svc);

  const res = el("section", "sp-sec");
  const h = el("h3", "", "LAST 14 DAYS · BY RESOURCE");
  res.append(h);
  if (!model.resources.length && !model.errors.length) {
    res.append(el("p", "sp-empty", "Nothing billed per resource yet. Resource-level data (14 days) needs Cost Explorer's hourly and resource-level setting."));
  }
  if (model.resources.length) {
    const table = el("table", "sp-table");
    const body = el("tbody");
    for (const row of model.resources) {
      const tr = el("tr", row.credit ? "credit" : "");
      const who = el("td", "sp-who");
      const name = el("span", "sp-name", row.name);
      name.title = row.id;
      who.append(icon(row.icon), el("span", "sp-svc", row.service), name);
      const chart = el("td", "sp-chart");
      if (row.series.length > 1) chart.append(spark(row.series, row.credit));
      tr.append(who, chart, el("td", "sp-amt", row.amount));
      body.append(tr);
    }
    table.append(body);
    res.append(table);
    if (model.more) res.append(el("p", "sp-note", `and ${model.more} more`));
    const foot = el("p", "sp-foot");
    foot.append(el("span", "", `charges ${model.gross}`));
    if (model.credits) foot.append(el("span", "credit", model.credits));
    res.append(foot);
  }
  for (const err of model.errors) res.append(el("p", "sp-warn", `${err.service}: ${err.text}`));
  container.append(res);
  return model;
}
