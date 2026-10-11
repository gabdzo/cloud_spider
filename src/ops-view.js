// The cluster OPS screen (DOM): what the add-ons report, from
// /api/cluster/ops (kube-ops.js). Three panels: POLICY (Kyverno reports),
// SCALING (HPA replica racks, Karpenter nodes, KEDA) and EVENTS (the same
// feed the radio hears). Colours come from theme CSS variables only.
import { iconURL } from "./chrome.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function icon(name) {
  const img = el("img", "px");
  img.alt = "";
  img.width = 16;
  img.height = 16;
  img.src = iconURL(name);
  return img;
}

function panel(kind, iconName, title, chip) {
  const box = el("section", `ko-panel ${kind}`);
  box.setAttribute("aria-label", title.toLowerCase());
  const head = el("header", "ko-head");
  head.append(icon(iconName), el("b", "", title));
  if (chip) head.append(el("span", `ko-chip ${chip.kind || ""}`, chip.text));
  box.append(head);
  return box;
}

function empty(text, hint) {
  const box = el("div", "ko-empty");
  box.append(el("p", "", text));
  if (hint) box.append(el("p", "ko-hint", hint));
  return box;
}

const clock = (time) => {
  if (!time) return "--:--:--";
  const d = new Date(time);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
};

// A segmented pass/fail strip: `cells` blocks split in proportion.
export function strip(pass, fail, warn, cells = 24) {
  const total = pass + fail + warn;
  const out = [];
  if (!total) return Array(cells).fill("off");
  let bad = Math.round((fail / total) * cells);
  let amber = Math.round((warn / total) * cells);
  if (fail && !bad) bad = 1;
  if (warn && !amber) amber = 1;
  for (let i = 0; i < cells; i += 1) out.push(i < bad ? "fail" : i < bad + amber ? "warn" : "pass");
  return out;
}

// A replica rack: one slot per possible replica (max), lit for ready,
// half-lit for running but not ready, dashed for wanted but not there.
export function rack({ max, current, desired, ready }) {
  const slots = [];
  const up = ready == null ? current : Math.min(ready, current);
  for (let i = 0; i < Math.max(max, desired, current); i += 1) {
    if (i < up) slots.push("ready");
    else if (i < current) slots.push("starting");
    else if (i < desired) slots.push("wanted");
    else slots.push("free");
  }
  return slots;
}

// A namespace-scoped context cannot see cluster-wide parts: say so instead
// of "not on this cluster".
const SCOPED_HINT = "Pick a context with ALL NAMESPACES in the switcher to see it.";
function policyPanel(policy, scoped = false) {
  if (scoped) {
    const box = panel("policy", "policy", "POLICY · KYVERNO", { text: "CLUSTER-WIDE ONLY", kind: "off" });
    box.append(empty("Kyverno's policy reports and cluster policies are cluster-wide: this context reads only its namespaces.", SCOPED_HINT));
    return box;
  }
  const box = panel("policy", "policy", "POLICY · KYVERNO", policy?.installed ? { text: (policy.policies || []).some((p) => p.mode === "Enforce") ? "ENFORCE" : "AUDIT", kind: "audit" } : { text: "NOT INSTALLED", kind: "off" });
  if (!policy?.installed) {
    box.append(empty("Kyverno is not on this cluster.", "STACKS → CLUSTER ADD-ONS → Kyverno: four baseline policies in Audit mode."));
    return box;
  }
  const meter = el("div", "ko-strip");
  meter.setAttribute("role", "img");
  meter.setAttribute("aria-label", `${policy.pass} pass, ${policy.fail} fail, ${policy.warn} warn`);
  for (const cell of strip(policy.pass, policy.fail, policy.warn)) meter.append(el("i", cell));
  const tally = el("div", "ko-tally");
  tally.append(el("span", "pass", `${policy.pass} PASS`), el("span", "fail", `${policy.fail} FAIL`), el("span", "warn", `${policy.warn} WARN`));
  box.append(meter, tally);
  const list = el("ul", "ko-policies");
  for (const item of policy.policies || []) {
    const row = el("li", item.fail ? "bad" : "ok");
    row.append(el("i", "ko-lamp"), el("span", "ko-pname", item.title || item.name), el("em", `ko-sev ${item.severity}`, (item.severity || "").toUpperCase()), el("b", "", item.fail ? `${item.fail} FAIL` : "CLEAN"));
    list.append(row);
  }
  box.append(list);
  if (policy.violations?.length) {
    box.append(el("h4", "", `VIOLATIONS${policy.total > policy.violations.length ? ` (FIRST ${policy.violations.length} OF ${policy.total})` : ""} · REPORTED, NOT BLOCKED`));
    const table = el("ul", "ko-viol");
    for (const v of policy.violations.slice(0, 8)) {
      const row = el("li", v.result);
      const what = el("div", "ko-what");
      what.append(el("b", "", `${v.kind ? `${v.kind.toLowerCase()} ` : ""}${v.namespace ? `${v.namespace}/` : ""}${v.name}`), el("small", "", v.policy));
      row.append(what, el("span", "ko-msg", v.message.replace(/^validation error:\s*/i, "")));
      table.append(row);
    }
    box.append(table);
  } else {
    box.append(el("p", "ko-hint", "No violations. Every pod that was checked passed all four policies."));
  }
  return box;
}

function hpaRow(hpa) {
  const row = el("div", "ko-hpa");
  const name = el("div", "ko-what");
  name.append(el("b", "", `${hpa.namespace}/${hpa.name}`), el("small", "", `${hpa.target} · ${hpa.min}–${hpa.max}`));
  const slots = el("div", "ko-rack");
  slots.setAttribute("role", "img");
  slots.setAttribute("aria-label", `${hpa.current} running, ${hpa.desired} wanted, at most ${hpa.max}`);
  for (const slot of rack(hpa)) slots.append(el("i", slot));
  const count = el("span", `ko-count${hpa.desired !== hpa.current ? " moving" : ""}`, hpa.desired !== hpa.current ? `${hpa.current}→${hpa.desired}` : `${hpa.current}`);
  const cpu = el("div", "ko-cpu");
  if (hpa.cpu != null) {
    const bar = el("div", "ko-bar");
    const fill = el("i", hpa.cpuTarget != null && hpa.cpu > hpa.cpuTarget ? "hot" : "");
    fill.style.width = `${Math.min(100, (hpa.cpu / Math.max(100, hpa.cpu)) * 100)}%`;
    bar.append(fill);
    if (hpa.cpuTarget != null) {
      const tick = el("b", "ko-tick");
      tick.style.left = `${Math.min(100, (hpa.cpuTarget / Math.max(100, hpa.cpu)) * 100)}%`;
      bar.append(tick);
    }
    cpu.append(bar, el("small", "", `CPU ${hpa.cpu}%${hpa.cpuTarget != null ? ` / ${hpa.cpuTarget}%` : ""}`));
  } else cpu.append(el("small", "", hpa.note || "no CPU reading (metrics-server?)"));
  row.append(name, slots, count, cpu);
  if (hpa.limited) row.append(el("em", "ko-flag", "AT MAX"));
  return row;
}

function scalingPanel(scaling, scoped = false) {
  const box = panel("scaling", "scale", "SCALING · HPA + KARPENTER", { text: `${scaling?.nodes?.total ?? 0} NODES` });
  const hpas = scaling?.hpas || [];
  box.append(el("h4", "", "HORIZONTAL POD AUTOSCALERS"));
  if (!hpas.length && scoped) box.append(empty("No HPA in this context's namespaces.", "HPAs in other namespaces need a context that lists them."));
  else if (!hpas.length) box.append(empty("No HPA on this cluster.", "STACKS → CLUSTER ADD-ONS → HPA scaling demo puts two on the demo app."));
  for (const hpa of hpas) box.append(hpaRow(hpa));
  const kp = scaling?.karpenter || {};
  box.append(el("h4", "", `NODES · ${scaling?.nodes?.group ?? 0} NODE GROUP · ${scaling?.nodes?.karpenter ?? 0} KARPENTER`));
  if (scoped) box.append(empty("Karpenter node pools and node claims are cluster-wide: this context reads only its namespaces.", SCOPED_HINT));
  else if (!kp.installed) box.append(empty("Karpenter is not on this cluster.", "STACKS → CLUSTER ADD-ONS → Karpenter adds a t4g node when pods do not fit."));
  for (const pool of kp.pools || []) {
    const row = el("div", "ko-pool");
    const used = parseFloat(pool.usedCpu) || 0;
    const limit = parseFloat(pool.limitCpu) || 0;
    const bar = el("div", "ko-bar");
    const fill = el("i", limit && used >= limit ? "hot" : "");
    fill.style.width = `${limit ? Math.min(100, (used / limit) * 100) : 0}%`;
    bar.append(fill);
    const what = el("div", "ko-what");
    what.append(el("b", "", `nodepool/${pool.name}`), el("small", "", `${pool.nodes} node${pool.nodes === 1 ? "" : "s"} · ${pool.consolidation || "no consolidation"}`));
    row.append(what, bar, el("small", "", `${used || 0}/${limit || "∞"} vCPU`));
    box.append(row);
  }
  if (kp.claims?.length) {
    const claims = el("ul", "ko-claims");
    for (const claim of kp.claims) {
      const item = el("li", claim.deleting ? "going" : claim.ready ? "ready" : "launching");
      item.append(icon("node"), el("b", "", claim.type || "?"), el("em", claim.capacity === "spot" ? "spot" : "od", claim.capacity === "spot" ? "SPOT" : "ON-DEMAND"), el("small", "", claim.zone), el("span", "ko-state", claim.deleting ? "REMOVING" : claim.ready ? "READY" : "LAUNCHING"));
      claims.append(item);
    }
    box.append(claims);
  }
  const keda = scaling?.keda || {};
  if (keda.installed && keda.objects?.length) {
    box.append(el("h4", "", "KEDA"));
    for (const object of keda.objects) {
      const row = el("div", "ko-hpa");
      const what = el("div", "ko-what");
      what.append(el("b", "", `${object.namespace}/${object.name}`), el("small", "", `${object.trigger} · ${object.min}–${object.max}`));
      const slots = el("div", "ko-rack");
      for (const slot of rack({ max: object.max, current: object.replicas, desired: object.replicas, ready: object.replicas })) slots.append(el("i", slot));
      row.append(what, slots, el("span", "ko-count", object.active ? "ACTIVE" : "IDLE"));
      box.append(row);
    }
  }
  return box;
}

const TAG_ICON = { scale: "scale", node: "node", policy: "policy", warn: "warn", info: "radio" };

function eventsPanel(events) {
  const box = panel("events", "radio", "EVENTS", { text: "ON THE RADIO", kind: "radio" });
  if (!events?.length) {
    box.append(empty("No events in the last hour.", "Kubernetes keeps events for an hour."));
    return box;
  }
  const list = el("ol", "ko-events");
  for (const event of events.slice(0, 24)) {
    const row = el("li", `${event.tag}${event.type === "Warning" ? " warning" : ""}`);
    const text = el("div", "ko-ev");
    text.append(el("b", "", `${event.reason}${event.count > 1 ? ` ×${event.count}` : ""}`), el("span", "", `${event.kind.toLowerCase()} ${event.namespace ? `${event.namespace}/` : ""}${event.name}`), el("small", "", event.message));
    row.append(el("time", "", clock(event.time)), icon(TAG_ICON[event.tag] || "radio"), text);
    list.append(row);
  }
  box.append(list);
  return box;
}

export function renderOps(root, data) {
  root.replaceChildren();
  const head = el("div", "kt-head");
  if (!data) {
    head.append(el("span", "kt-why", "reading the add-ons…"));
    root.append(head);
    return;
  }
  if (data.error) {
    head.append(el("span", "kt-why", data.unset ? "No kube context: the OPS screen needs the read-only viewer context (docs/RUN-ME.md §7)." : `The cluster did not answer: ${data.error}`));
    root.append(head);
    return;
  }
  head.append(el("span", "kt-why", `${data.clusterName || "the cluster"}${data.context ? ` via ${data.context}` : ""} · Kyverno, HPA, Karpenter and KEDA as they report themselves · read-only`));
  if (data.notes?.length) head.append(el("span", "kt-hist", data.notes.join(" · ")));
  root.append(head);
  // A namespace-scoped context: what it cannot show, instead of no screen.
  for (const limit of data.limits || []) root.append(el("p", "kt-note kt-limit", limit));
  const grid = el("div", "ko-grid");
  const scoped = data.clusterWide === false;
  grid.append(policyPanel(data.policy, scoped), scalingPanel(data.scaling, scoped), eventsPanel(data.events));
  root.append(grid);
}
