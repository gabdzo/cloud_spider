// VAULTS page, browser side: the health / version / location chips on each
// vault card and the HOW IT CONNECTS diagram on a vault's page (lanes of
// resources, lines from the specs and the Pulumi dependencies). The data is
// vault.insight from /api/vaults (vault-insight.js); this file only draws.
export const HEALTH_CLASS = { ok: "ok", issues: "warn", down: "fail", unknown: "unknown" };
export const VERSION_CLASS = { latest: "ok", owned: "ok", outdated: "warn", foreign: "warn", unmanaged: "unknown", notdeployed: "fail", unknown: "unknown" };
const HEALTH_GLYPH = { ok: "●", issues: "▲", down: "■", unknown: "?" };
const VERSION_GLYPH = { latest: "✓", owned: "◆", outdated: "◐", foreign: "◑", unmanaged: "○", notdeployed: "■", unknown: "?" };
const LANE_GLYPH = { edge: "▷", service: "◎", workload: "▣", config: "◇", data: "▤", platform: "△" };

export function healthTitle(health) {
  if (!health) return "";
  const head = `${health.word}${health.read?.length ? ` · read: ${health.read.join(", ")}` : ""}`;
  return health.issues?.length ? `${head}\n${health.issues.map((i) => `• ${i.text}`).join("\n")}` : `${head}\n${health.text}`;
}

export function createInsightView({ vel, onMap = () => {}, onJump = () => {}, onRender = () => {} }) {
  function chip(cls, glyph, text, title) {
    const c = vel("span", `vpg-chip ${cls}`);
    c.append(vel("i", "glyph", glyph), vel("span", "", text));
    if (title) c.title = title;
    return c;
  }
  function healthChip(insight) {
    const h = insight?.health;
    if (!h) return null;
    return chip(`health ${HEALTH_CLASS[h.state]}`, HEALTH_GLYPH[h.state], h.state === "issues" ? `UP · ${h.count} ISSUE${h.count === 1 ? "" : "S"}` : h.word, healthTitle(h));
  }
  function versionChip(insight) {
    const v = insight?.version;
    if (!v) return null;
    return chip(`version ${VERSION_CLASS[v.state]}`, VERSION_GLYPH[v.state], v.word, `${v.word}${v.owner ? ` · stack ${v.owner}` : ""}\n${v.text}`);
  }
  function where(insight) {
    const loc = insight?.location;
    const line = vel("p", "vpg-where");
    line.append(vel("i", "glyph", "◉"), vel("span", "", loc?.text || "no location known"));
    if (loc?.text) line.title = whereTitle(loc);
    if (!loc?.text) line.classList.add("none");
    return line;
  }
  function whereTitle(loc) {
    return [loc.cluster && `cluster ${loc.cluster}`, loc.namespaces?.length && `namespace ${loc.namespaces.join(", ")}`, loc.region && `region ${loc.region}`, loc.vpcs?.length && `VPC ${loc.vpcs.join(", ")}`, loc.subnets?.length && `subnets ${loc.subnets.join(", ")}`].filter(Boolean).join("\n");
  }

  // The card's chip row: health, version, then where it lives.
  function cardInsight(vault) {
    const box = vel("div", "vpg-insight");
    const row = vel("div", "vpg-chips");
    for (const c of [healthChip(vault.insight), versionChip(vault.insight)]) if (c) row.append(c);
    box.append(row, where(vault.insight));
    return box;
  }

  // The vault page's side boxes: WHERE (with the map jump), HEALTH, VERSION.
  function sideInsight(vault) {
    const insight = vault.insight;
    const out = vel("div", "vpg-facts");
    const loc = insight?.location || {};
    const whereBox = vel("section", "vpg-fact where");
    whereBox.append(vel("h5", "", "WHERE"));
    const dl = vel("dl");
    const row = (k, v) => {
      if (!v) return;
      dl.append(vel("dt", "", k), vel("dd", "", v));
    };
    row("CLUSTER", loc.cluster);
    row("NAMESPACE", loc.namespaces?.join(", "));
    row("REGION", loc.region);
    row("VPC", loc.vpcs?.join(", ") || (loc.regional ? "outside the VPCs (regional)" : ""));
    row("SUBNETS", loc.subnets?.length ? `${loc.subnets.length} · ${loc.subnets.slice(0, 3).join(", ")}${loc.subnets.length > 3 ? "…" : ""}` : "");
    if (!dl.childElementCount) dl.append(vel("dd", "none", "nothing says where yet"));
    whereBox.append(dl);
    const jump = vel("button", "cmd vpg-jump", "◉ SHOW ON MAP");
    jump.type = "button";
    jump.dataset.focus = `jump:${vault.key}`;
    jump.disabled = !(loc.mapIds?.length || loc.vpcs?.length);
    jump.title = jump.disabled ? "nothing of this vault is on the map" : "back to the map, at this vault's resources";
    jump.addEventListener("click", () => onJump(vault));
    whereBox.append(jump);
    out.append(whereBox);
    const h = insight?.health;
    if (h) {
      const box = vel("section", `vpg-fact health ${HEALTH_CLASS[h.state]}`);
      box.append(vel("h5", "", "HEALTH"), healthChip(insight));
      if (insight.pods) box.append(vel("p", "small", `PODS ${insight.pods.ready}/${insight.pods.total} READY`));
      if (h.issues.length) {
        const ul = vel("ul", "vpg-issues");
        for (const issue of h.issues) {
          const li = vel("li");
          li.append(vel("b", "", issue.source.toUpperCase()), vel("span", "", issue.text));
          ul.append(li);
        }
        box.append(ul);
      } else box.append(vel("p", "small", h.text));
      if (h.read?.length) box.append(vel("p", "read", `READ: ${h.read.join(" · ").toUpperCase()}`));
      out.append(box);
    }
    const v = insight?.version;
    if (v) {
      const box = vel("section", `vpg-fact version ${VERSION_CLASS[v.state]}`);
      box.append(vel("h5", "", "VERSION · OWNER"), versionChip(insight));
      if (v.owner) box.append(vel("p", "small", `STACK ${v.owner}`));
      box.append(vel("p", "small", v.text));
      out.append(box);
    }
    return out;
  }

  // HOW IT CONNECTS: lanes left to right, a line for each relation; click a
  // piece to light its neighbours and see it. LIST shows the flat table.
  function relations(vault, { mode = "diagram", setMode, list }) {
    const rel = vault.insight?.relations;
    const has = rel?.nodes?.length > 0;
    const block = vel("section", "vpg-rel");
    const head = vel("header", "vpg-rel-head");
    head.append(vel("h4", "", has ? `HOW IT CONNECTS · ${rel.nodes.length} PIECES${rel.quiet.length ? ` + ${rel.quiet.length} PLUMBING` : ""}` : "WHAT IT OWNS"));
    if (has) {
      const tabs = vel("div", "vpg-seg");
      tabs.setAttribute("role", "group");
      tabs.setAttribute("aria-label", "show as");
      for (const [id, label] of [["diagram", "DIAGRAM"], ["list", "LIST"]]) {
        const b = vel("button", `cmd${mode === id ? " on" : ""}`, label);
        b.type = "button";
        b.dataset.focus = `relmode:${id}`;
        b.setAttribute("aria-pressed", String(mode === id));
        b.addEventListener("click", () => setMode(id));
        tabs.append(b);
      }
      head.append(tabs);
    }
    block.append(head);
    if (!has || mode === "list") {
      block.append(list());
      if (has && rel.quiet.length) block.append(plumbing(rel));
      return block;
    }
    const wrap = vel("div", "vpg-rel-wrap");
    const lanes = vel("div", "vpg-lanes");
    lanes.style.setProperty("--lanes", String(rel.lanes.length));
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "vpg-rel-lines");
    svg.setAttribute("aria-hidden", "true");
    const nodeEls = new Map();
    const info = vel("div", "vpg-rel-info");
    info.setAttribute("aria-live", "polite");
    info.append(vel("span", "hint", "Click a piece to see what it connects to."));
    const select = (id) => {
      const keep = new Set([id]);
      for (const [a, b] of rel.edges) {
        if (a === id) keep.add(b);
        if (b === id) keep.add(a);
      }
      for (const [nid, el] of nodeEls) {
        el.classList.toggle("dim", !keep.has(nid));
        el.classList.toggle("on", nid === id);
        el.setAttribute("aria-pressed", String(nid === id));
      }
      for (const line of svg.querySelectorAll("path")) line.classList.toggle("lit", line.dataset.a === id || line.dataset.b === id);
      svg.classList.add("picked");
      const n = rel.nodes.find((x) => x.id === id);
      info.replaceChildren(vel("b", "", `${n.kind.toUpperCase()} · ${n.name}`));
      const bits = [n.namespace && `ns ${n.namespace}`, n.service, n.pods && `pods ${n.pods.ready}/${n.pods.total} ready`, n.note].filter(Boolean);
      info.append(vel("span", "", bits.join(" · ")));
      const names = (list) => list.map((x) => rel.nodes.find((n) => n.id === x)).filter(Boolean).map((x) => `${x.kind} ${x.name}`);
      const out = names(rel.edges.filter(([a]) => a === id).map(([, b]) => b));
      const inn = names(rel.edges.filter(([, b]) => b === id).map(([a]) => a));
      if (inn.length) info.append(vel("span", "", `← ${inn.join(", ")}`));
      if (out.length) info.append(vel("span", "", `→ ${out.join(", ")}`));
      if (n.mapId) {
        const show = vel("button", "cmd", "SHOW ON MAP");
        show.type = "button";
        show.dataset.focus = `show:${n.mapId}`;
        show.addEventListener("click", () => onMap(n.mapId));
        info.append(show);
      }
    };
    for (const lane of rel.lanes) {
      const col = vel("div", `vpg-lane ${lane.id}`);
      col.append(vel("h5", "", `${LANE_GLYPH[lane.id]} ${lane.label} · ${lane.count}`));
      for (const n of rel.nodes.filter((x) => x.lane === lane.id)) {
        const b = vel("button", `vpg-node ${n.status || ""}${n.mapId ? " mapped" : ""}`);
        b.type = "button";
        b.dataset.focus = `node:${n.id}`;
        b.setAttribute("aria-pressed", "false");
        b.title = `${n.type}${n.namespace ? `\nnamespace ${n.namespace}` : ""}${n.pods ? `\npods ${n.pods.ready}/${n.pods.total} ready` : ""}${n.note ? `\n${n.note}` : ""}`;
        b.append(vel("span", "kind", n.kind.toUpperCase()), vel("span", "name", n.name));
        if (n.pods) b.append(vel("span", `pods ${n.status || ""}`, `${n.pods.ready}/${n.pods.total}`));
        b.addEventListener("click", () => select(n.id));
        nodeEls.set(n.id, b);
        col.append(b);
      }
      lanes.append(col);
    }
    wrap.append(svg, lanes);
    block.append(wrap, info);
    if (rel.quiet.length) block.append(plumbing(rel));
    // Lines once the boxes have their size (and again when it changes).
    const drawLines = () => {
      if (!wrap.isConnected) return;
      const box = wrap.getBoundingClientRect();
      svg.setAttribute("width", String(box.width));
      svg.setAttribute("height", String(box.height));
      svg.replaceChildren();
      for (const [a, b, why] of rel.edges) {
        const ea = nodeEls.get(a)?.getBoundingClientRect();
        const eb = nodeEls.get(b)?.getBoundingClientRect();
        if (!ea || !eb) continue;
        const sameCol = Math.abs(ea.left - eb.left) < 4;
        const ax = (sameCol ? ea.left : ea.right) - box.left;
        const bx = eb.left - box.left;
        const ay = ea.top + ea.height / 2 - box.top;
        const by = eb.top + eb.height / 2 - box.top;
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        const d = sameCol ? `M${ax},${ay} C${ax - 18},${ay} ${bx - 18},${by} ${bx},${by}` : `M${ax},${ay} C${ax + (bx - ax) / 2},${ay} ${ax + (bx - ax) / 2},${by} ${bx},${by}`;
        p.setAttribute("d", d);
        p.dataset.a = a;
        p.dataset.b = b;
        p.setAttribute("class", `why-${why}`);
        svg.append(p);
      }
    };
    requestAnimationFrame(drawLines);
    if (typeof ResizeObserver === "function") new ResizeObserver(() => requestAnimationFrame(drawLines)).observe(wrap);
    onRender();
    return block;
  }

  function plumbing(rel) {
    const d = vel("details", "vpg-plumbing");
    d.append(vel("summary", "", `PLUMBING · ${rel.quiet.length} (attachments, policies, namespaces, log groups: listed, not drawn)`));
    const ul = vel("ul");
    for (const q of rel.quiet) {
      const li = vel("li");
      li.append(vel("b", "", q.kind), vel("span", "", q.name));
      ul.append(li);
    }
    d.append(ul);
    return d;
  }

  return { cardInsight, sideInsight, relations, healthChip, versionChip };
}
