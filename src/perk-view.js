// VAULTS → cluster vaults with their PERKS (vault-perks.js groups them).
// Pip-Boy: a vault header with the door, a perk meter and the score, then
// perk cards in the Fallout style (a medallion with a 16px pixel icon drawn
// at 3x, rank pips, the "+ effect" line and a lamp); AVAILABLE perks below,
// dimmed, each with INSTALL ▸ CARD, which opens the add-on's Stacks card
// (PREVIEW, then APPROVE: nothing here writes). Pro: the same nodes, styled
// as a quiet list with icons (server.js CSS). DOM nodes and textContent only.
import { perkSprite } from "./sprites/perks.js";
import { rasterise } from "./draw-kit.js";

const urls = new Map();
export function perkIconURL(name, scale = 3) {
  const key = `${name}@${scale}`;
  if (urls.has(key)) return urls.get(key);
  const sprite = perkSprite(name);
  const canvas = document.createElement("canvas");
  canvas.width = 16 * scale;
  canvas.height = 16 * scale;
  rasterise(canvas.getContext("2d"), sprite, 0, 0, scale);
  const url = canvas.toDataURL();
  urls.set(key, url);
  return url;
}

function el(tag, cls = "", text = "") {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text) node.textContent = text;
  return node;
}
function button(cls, text) {
  const node = el("button", cls, text);
  node.type = "button";
  return node;
}

function medal(perk, size = "") {
  const wrap = el("span", `pk-medal ${perk.lamp} ${size}`.trim());
  const img = el("img", "pk-icon");
  img.alt = "";
  img.width = size === "big" ? 64 : 48;
  img.height = img.width;
  img.src = perkIconURL(perk.icon, size === "big" ? 4 : 3);
  wrap.append(img);
  return wrap;
}

function pips(rank) {
  const row = el("span", "pk-rank");
  row.setAttribute("aria-label", `rank ${rank} of 3`);
  for (let i = 1; i <= 3; i += 1) row.append(el("i", i <= rank ? "on" : ""));
  return row;
}

function perkCardNode(perk, { selected, onSelect }) {
  const li = el("li", `pk-card ${perk.state} ${perk.lamp}${selected ? " sel" : ""}`);
  const open = button("pk-open");
  open.dataset.focus = `perk:${perk.id}`;
  open.setAttribute("aria-pressed", String(selected));
  open.setAttribute("aria-label", `${perk.title}: ${perk.stateText}. ${perk.effect}`);
  const lamp = el("span", "pk-state");
  lamp.append(el("i"), el("b", "", perk.stateText));
  open.append(medal(perk), pips(perk.rank), el("b", "pk-name", perk.title), el("small", "pk-effect", perk.effect), lamp);
  if (perk.state === "available") open.append(el("span", "pk-install", "INSTALL ▸"));
  open.addEventListener("click", () => onSelect(perk.id));
  li.append(open);
  return li;
}

function factRow(list, label, value) {
  if (value === "" || value == null || (Array.isArray(value) && !value.length)) return;
  const row = el("div", "pk-fact");
  row.append(el("dt", "", label), el("dd", "", Array.isArray(value) ? value.join(" · ") : String(value)));
  list.append(row);
}

// The open perk: what it does, where it comes from, its health and SLOs (from
// its vault when it has one), the controls it satisfies and what it costs.
function drawer(perk, cluster, { vault, cost, onOpenVault, onOpenCard, onClose }) {
  const box = el("aside", `pk-drawer ${perk.lamp}`);
  box.setAttribute("aria-label", `${perk.title} perk`);
  const head = el("div", "pk-dhead");
  const words = el("div", "pk-dwords");
  words.append(el("span", "pk-kicker", perk.builtIn ? "BUILT-IN PERK" : perk.state === "unlocked" ? "UNLOCKED PERK" : perk.state === "locked" ? "LOCKED PERK" : "AVAILABLE PERK"), el("h4", "", perk.title), el("p", "pk-deffect", perk.effect));
  const close = button("cmd pk-close", "✕");
  close.setAttribute("aria-label", "close the perk");
  close.addEventListener("click", onClose);
  head.append(medal(perk, "big"), words, pips(perk.rank), close);
  const facts = el("dl", "pk-facts");
  factRow(facts, "STATE", perk.stateText);
  factRow(facts, "CLUSTER", cluster.name);
  factRow(facts, "SOURCE", perk.source);
  factRow(facts, "STACK", perk.stack);
  factRow(facts, "VERSION", perk.version);
  factRow(facts, "NEEDS", perk.needs);
  factRow(facts, "SATISFIES", perk.controls.length ? perk.controls : perk.builtIn ? "part of every EKS cluster" : "");
  if (vault) {
    factRow(facts, "RESOURCES", `${vault.stackInfo?.resources ?? 0} in its stack · ${(vault.owned || []).length} on the map`);
    factRow(facts, "HEALTH", (vault.trouble || []).length ? `${vault.trouble.length} in trouble` : vault.status === "fail" ? "a check fails" : "no trouble seen");
    factRow(facts, "SLO", (vault.slos || []).map((s) => `${s.name} ${s.state || ""}`.trim()));
  }
  factRow(facts, "COST", cost || (perk.builtIn ? "in the cluster's price" : ""));
  const actions = el("div", "pk-actions");
  if (vault) {
    const go = button("cmd", "OPEN VAULT");
    go.addEventListener("click", () => onOpenVault(vault.key));
    actions.append(go);
  }
  if (!perk.builtIn && perk.state !== "locked") {
    const card = button(`cmd${perk.state === "available" ? " pk-primary" : ""}`, perk.state === "available" ? "INSTALL ▸ CARD" : "OPEN CARD");
    card.title = "Opens the add-on's Stacks card: PREVIEW first, then APPROVE. Nothing changes from here.";
    card.addEventListener("click", () => onOpenCard(perk.id, cluster.name));
    actions.append(card);
  }
  box.append(head, facts, actions);
  if (perk.state === "available") box.append(el("p", "pk-note", "Installs through the card's PREVIEW and APPROVE, like any stack."));
  return box;
}

// One cluster vault. opts: door (a canvas or null), score ({ number, tone }
// or null), selected (perk id or ""), appTitle(key), and the callbacks.
export function clusterVaultNode(cluster, opts) {
  const { door = null, score = null, selected = "", appTitle = (key) => key, cost = () => "", onSelect, onOpenVault, onOpenCard, onOpenApp } = opts;
  const section = el("section", `pk-vault${cluster.live ? "" : " gone"}`);
  section.dataset.cluster = cluster.name;
  const head = el("header", "pk-head");
  if (door) head.append(door);
  const title = el("div", "pk-title");
  title.append(el("span", "pk-kicker", `CLUSTER VAULT${cluster.live ? "" : " · NOT LIVE"}`), el("h3", "", `VAULT ${cluster.name}`));
  const meter = el("div", "pk-meter");
  meter.setAttribute("role", "img");
  meter.setAttribute("aria-label", `${cluster.unlocked} of ${cluster.perks.length} perks unlocked, ${cluster.healthy} healthy`);
  const order = { unlocked: 0, available: 1, locked: 2 };
  for (const perk of [...cluster.perks].sort((x, y) => order[x.state] - order[y.state] || (x.lamp === "ok" ? 0 : 1) - (y.lamp === "ok" ? 0 : 1))) meter.append(el("i", `${perk.state} ${perk.lamp}`));
  const tally = el("p", "pk-tally", `${cluster.unlocked}/${cluster.perks.length} PERKS · ${cluster.healthy} HEALTHY · ${cluster.available} AVAILABLE`);
  title.append(meter, tally);
  const side = el("div", "pk-side");
  const chip = el("span", `pk-score ${score?.tone || "muted"}`);
  chip.append(el("small", "", "SCORE"), el("b", "", score?.number ? score.number.replace("/100", "") : "—"));
  chip.title = score?.number ? `production readiness ${score.number} (SCORE)` : "no scan of this cluster here (SCORE → SCAN)";
  side.append(chip);
  if (cluster.vault) {
    const open = button("cmd", "OPEN VAULT");
    open.dataset.focus = `cluster:${cluster.name}`;
    open.addEventListener("click", () => onOpenVault(cluster.vault.key));
    side.append(open);
  }
  head.append(title, side);
  section.append(head);
  if (cluster.apps.length) {
    const apps = el("p", "pk-apps");
    apps.append(el("span", "pk-kicker", "HOUSES"));
    for (const key of cluster.apps) {
      const b = button("pk-app", appTitle(key));
      b.addEventListener("click", () => onOpenApp(key));
      apps.append(b);
    }
    section.append(apps);
  }
  const groups = [
    ["UNLOCKED PERKS", cluster.perks.filter((p) => p.state === "unlocked")],
    ["AVAILABLE PERKS", cluster.perks.filter((p) => p.state !== "unlocked")],
  ];
  for (const [label, list] of groups) {
    if (!list.length) continue;
    section.append(el("h4", "pk-label", `${label} · ${list.length}`));
    const grid = el("ul", `pk-grid${label.startsWith("AVAILABLE") ? " avail" : ""}`);
    for (const perk of list) grid.append(perkCardNode(perk, { selected: perk.id === selected, onSelect: (id) => onSelect(cluster.name, id === selected ? "" : id) }));
    section.append(grid);
    const open = list.find((p) => p.id === selected);
    if (open) section.append(drawer(open, cluster, { vault: opts.vaultOf?.(open.vault) || null, cost: cost(open.id), onOpenVault, onOpenCard, onClose: () => onSelect(cluster.name, "") }));
  }
  return section;
}
