// Pod deep-inspect panel (Cluster view, click a pod): OVERVIEW, CONTAINERS,
// EVENTS, LOGS (per container, previous, follow), METRICS and YAML.
// Read-only: everything comes from /api/cluster/pod/inspect and
// /api/cluster/pod, which only GET. No exec, no Secrets, env values redacted
// on the server. Colours come from theme CSS variables only.
import { spark } from "./tele-view.js";
import { cpu, mem } from "./kube-diagram.js";

export const INSPECT_TABS = ["OVERVIEW", "CONTAINERS", "EVENTS", "LOGS", "METRICS", "YAML"];
const TAB_KEY = "cloudspider.cluster.podtab";
const FOLLOW_MS = 3000;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function facts(rows) {
  const dl = el("dl", "vp-facts");
  for (const [label, value, tone] of rows) {
    if (value === "" || value == null) continue;
    dl.append(el("dt", "", label), el("dd", tone || "", value));
  }
  return dl;
}

function hhmm(time) {
  if (!time) return "--:--";
  const d = new Date(time);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function meter(label, used, req, lim, unit) {
  const li = el("li", "pi-meter");
  const top = lim || req || used || 1;
  const bar = el("div", "pi-bar");
  const fill = el("span", "used");
  fill.style.width = `${Math.min(100, ((used || 0) / top) * 100)}%`;
  bar.append(fill);
  if (req) {
    const mark = el("i", "req");
    mark.style.left = `${Math.min(100, (req / top) * 100)}%`;
    bar.append(mark);
  }
  if (used != null && ((lim && used / lim >= 0.85) || (!lim && req && used > req))) li.classList.add("hot");
  li.append(el("span", "lbl", label), bar, el("span", "val", `${used ?? "--"}${unit} / ${req ? `req ${req}${unit}` : "no req"} / ${lim ? `lim ${lim}${unit}` : "no limit"}`));
  return li;
}

export function createPodInspector(panel, { sample = () => false, onClose = () => {} } = {}) {
  let ticket = 0;
  let follow = 0;
  let data = null;
  let tab = "OVERVIEW";
  try {
    const saved = window.localStorage.getItem(TAB_KEY);
    if (INSPECT_TABS.includes(saved)) tab = saved;
  } catch {
    // default tab
  }
  const logState = { container: "", previous: false, follow: false };
  let body = null;
  let tabsNav = null;

  function stopFollow() {
    clearInterval(follow);
    follow = 0;
  }

  function close() {
    ++ticket;
    stopFollow();
    panel.hidden = true;
    panel.classList.remove("kp-wide");
    panel.replaceChildren();
  }

  function query(extra) {
    const q = new URLSearchParams({ ns: data?.ns || "", name: data?.name || "", ...extra });
    if (sample()) q.set("sample", "1");
    return q;
  }

  function renderTab() {
    stopFollow();
    for (const b of tabsNav.children) b.setAttribute("aria-selected", String(b.dataset.tab === tab));
    body.replaceChildren();
    if (!data) {
      body.append(el("p", "vp-note", "reading the pod…"));
      return;
    }
    if (data.error) {
      body.append(el("p", "vp-note err", data.error));
      return;
    }
    const o = data.overview;
    if (tab === "OVERVIEW") {
      body.append(facts([
        ["PHASE", `${o.phase}${o.word && o.word !== o.phase ? ` · ${o.word}` : ""}`, o.health === "broken" ? "bad" : o.health === "hang" ? "warn" : ""],
        ["NODE", o.node],
        ["POD IP", (o.podIPs.length ? o.podIPs : [o.podIP]).filter(Boolean).join(", ")],
        ["HOST IP", o.hostIP],
        ["QOS", o.qos],
        ["SERVICE ACCT", o.serviceAccount],
        ["AGE", o.age ? `${o.age} (since ${hhmm(o.created)})` : ""],
        ["RESTARTS", String(o.restarts), o.restarts ? "warn" : ""],
      ]));
      body.append(el("h4", "", "OWNER CHAIN"));
      const chain = el("ol", "pi-chain");
      for (const link of o.chain) chain.append(el("li", "", link));
      body.append(chain);
      if (o.terminations.length) {
        body.append(el("h4", "", "LAST TERMINATION"));
        const list = el("ul", "kp-events");
        for (const t of o.terminations) {
          const li = el("li", t.reason === "OOMKilled" || t.exitCode ? "warn" : "");
          li.append(el("span", "when", t.ago ? `${t.ago} ago` : "--"), el("span", "reason", `${t.container} · ${t.reason || "exit"}`), el("span", "msg", `exit code ${t.exitCode ?? "?"}${t.reason === "OOMKilled" ? " · ran out of its memory limit" : ""}`));
          list.append(li);
        }
        body.append(list);
      }
      body.append(el("h4", "", "CONDITIONS"));
      const conds = el("div", "pi-conds");
      for (const c of o.conditions) {
        const span = el("span", `kt-lamp ${c.status === "True" ? "on" : "alarm"}`);
        span.append(el("i"), el("b", "", c.type.toUpperCase()));
        if (c.reason) span.title = c.reason;
        conds.append(span);
      }
      body.append(conds);
    } else if (tab === "CONTAINERS") {
      for (const c of data.containers) {
        const card = el("section", "pi-container");
        const head = el("div", "pi-chead");
        head.append(el("b", "", `${c.init ? "INIT · " : ""}${c.name}`), el("span", c.ready ? "ok" : "warn", c.state || "--"), el("span", "", `↻${c.restarts}`));
        card.append(head);
        card.append(facts([
          ["IMAGE", `${c.image}${c.imageId ? ` ${c.imageId}` : ""}`],
          ["PORTS", c.ports.join(", ") || "none"],
          ["REQUESTS", [c.requests.cpu && `cpu ${c.requests.cpu}`, c.requests.memory && `mem ${c.requests.memory}`].filter(Boolean).join(" · ") || "none"],
          ["LIMITS", [c.limits.cpu && `cpu ${c.limits.cpu}`, c.limits.memory && `mem ${c.limits.memory}`].filter(Boolean).join(" · ") || "none"],
          ["USAGE", c.usage ? `cpu ${c.usage.cpu}m · mem ${c.usage.mem}Mi` : "no metrics"],
          ["LIVENESS", c.probes.liveness || "none"],
          ["READINESS", c.probes.readiness || "none"],
          ["STARTUP", c.probes.startup],
        ]));
        if (c.env.length) {
          card.append(el("h4", "", "ENV · NAMES ONLY"));
          const env = el("ul", "pi-env");
          for (const e of c.env) {
            const li = el("li");
            li.append(el("code", "", e.name), el("span", e.source === "secret" ? "warn" : "", e.source === "value" ? "set" : `from ${e.source}`));
            env.append(li);
          }
          card.append(env);
        }
        if (c.mounts.length) {
          card.append(el("h4", "", "MOUNTS"));
          const mounts = el("ul", "pi-env");
          for (const m of c.mounts) {
            const li = el("li");
            li.append(el("code", "", m.path), el("span", "", `${m.name}${m.readOnly ? " · ro" : ""}`));
            mounts.append(li);
          }
          card.append(mounts);
        }
        body.append(card);
      }
    } else if (tab === "EVENTS") {
      if (data.eventNote) body.append(el("p", "vp-note err", data.eventNote));
      if (!data.events.length) body.append(el("p", "vp-note", "no events (Kubernetes keeps them for about an hour)"));
      const list = el("ul", "kp-events");
      for (const e of data.events) {
        const li = el("li", e.type === "Warning" ? "warn" : "");
        li.append(el("span", "when", hhmm(e.time)), el("span", "reason", `${e.reason}${e.count > 1 ? ` ×${e.count}` : ""}`), el("span", "msg", e.message));
        list.append(li);
      }
      body.append(list);
    } else if (tab === "LOGS") {
      const bar = el("div", "pi-logbar");
      const select = el("select");
      select.setAttribute("aria-label", "container");
      for (const c of data.containers) {
        const opt = el("option", "", `${c.init ? "init · " : ""}${c.name}`);
        opt.value = c.name;
        select.append(opt);
      }
      if (!logState.container || !data.containers.some((c) => c.name === logState.container)) logState.container = data.containers.find((c) => !c.init)?.name || data.containers[0]?.name || "";
      select.value = logState.container;
      const prev = el("button", "cmd", "PREVIOUS");
      prev.type = "button";
      prev.setAttribute("aria-pressed", String(logState.previous));
      prev.title = "the last run before the latest restart";
      const fol = el("button", "cmd", "FOLLOW");
      fol.type = "button";
      fol.setAttribute("aria-pressed", String(logState.follow));
      fol.title = `re-read the tail every ${FOLLOW_MS / 1000} s`;
      bar.append(select, prev, fol);
      const note = el("p", "vp-note");
      const lines = el("ol", "vp-lines kp-log pi-log");
      body.append(bar, note, lines);
      let mine = ticket;
      const load = () => {
        const q = query({ container: logState.container, tail: "200" });
        if (logState.previous) q.set("previous", "1");
        const at = ticket;
        fetch(`/api/cluster/pod?${q}`).then((r) => r.json()).catch(() => ({ error: "the pod did not answer" })).then((detail) => {
          if (at !== ticket || mine !== at) return;
          const stick = lines.scrollTop + lines.clientHeight >= lines.scrollHeight - 8;
          note.textContent = detail.error || detail.logNote || `${detail.lines?.length || 0} lines · ${logState.container}${logState.previous ? " · previous run" : ""}${logState.follow ? " · following" : ""}`;
          note.className = detail.error || detail.logNote ? "vp-note err" : "vp-note";
          lines.replaceChildren(...(detail.lines || []).map((line) => el("li", /error|fail|panic|fatal|exception|out of memory|giving up/i.test(line) ? "bad" : "", line)));
          if (stick || !logState.follow) lines.scrollTop = lines.scrollHeight;
        });
      };
      const restart = () => {
        stopFollow();
        ++ticket;
        mine = ticket;
        load();
        if (logState.follow) follow = setInterval(() => (document.hidden ? null : load()), FOLLOW_MS);
      };
      select.addEventListener("change", () => {
        logState.container = select.value;
        restart();
      });
      prev.addEventListener("click", () => {
        logState.previous = !logState.previous;
        if (logState.previous) logState.follow = false;
        prev.setAttribute("aria-pressed", String(logState.previous));
        fol.setAttribute("aria-pressed", String(logState.follow));
        restart();
      });
      fol.addEventListener("click", () => {
        logState.follow = !logState.follow;
        if (logState.follow) logState.previous = false;
        prev.setAttribute("aria-pressed", String(logState.previous));
        fol.setAttribute("aria-pressed", String(logState.follow));
        restart();
      });
      restart();
    } else if (tab === "METRICS") {
      const block = el("div", "vp-metrics");
      block.append(el("h4", "", "NOW · USED vs REQUEST vs LIMIT"));
      const list = el("ul", "pi-meters");
      for (const c of data.containers.filter((x) => !x.init)) {
        list.append(meter(`${c.name} CPU`, c.usage?.cpu ?? null, cpu(c.requests.cpu) || 0, cpu(c.limits.cpu) || 0, "m"));
        list.append(meter(`${c.name} MEM`, c.usage?.mem ?? null, mem(c.requests.memory) || 0, mem(c.limits.memory) || 0, "Mi"));
      }
      block.append(list);
      const h = data.metrics;
      const head = el("h4");
      head.append(el("span", "", "POD · 1H · 30 S SAMPLES"));
      block.append(head);
      if (!h || !h.cpu?.length) block.append(el("p", "vp-note", "no history yet: Cluster → TELEMETRY samples every 30 s while it is open"));
      else {
        const ul = el("ul");
        for (const [label, values, unit] of [["CPU", h.cpu, "m"], ["MEM", h.mem, "Mi"]]) {
          const li = el("li");
          const last = [...values].reverse().find((v) => v != null);
          li.append(el("span", "lbl", label), spark(values), el("span", "val", last == null ? "--" : `${last}${unit}`));
          ul.append(li);
        }
        block.append(ul);
      }
      body.append(block);
    } else if (tab === "YAML") {
      body.append(el("p", "vp-note", "read-only · env values, last-applied and managedFields redacted"));
      body.append(el("pre", "pi-yaml", data.yaml));
    }
  }

  function open(node) {
    const mine = ++ticket;
    stopFollow();
    data = null;
    logState.container = "";
    logState.previous = false;
    logState.follow = false;
    const { ns, name } = node.pod;
    panel.classList.add("kp-wide");
    const head = el("div", "kp-title");
    head.append(el("span", "kp-name", `POD · ${ns}/${name}`));
    const x = el("button", "vp-close", "CLOSE");
    x.type = "button";
    x.addEventListener("click", () => {
      close();
      onClose();
    });
    head.append(x);
    tabsNav = el("div", "pi-tabs");
    tabsNav.setAttribute("role", "tablist");
    for (const t of INSPECT_TABS) {
      const b = el("button", "", t);
      b.type = "button";
      b.dataset.tab = t;
      b.setAttribute("role", "tab");
      b.addEventListener("click", () => {
        tab = t;
        try {
          window.localStorage.setItem(TAB_KEY, t);
        } catch {
          // not kept
        }
        renderTab();
      });
      tabsNav.append(b);
    }
    body = el("div", "kp-body pi-body");
    panel.replaceChildren(head, tabsNav, body);
    panel.hidden = false;
    renderTab();
    const q = new URLSearchParams({ ns, name });
    if (sample()) q.set("sample", "1");
    fetch(`/api/cluster/pod/inspect?${q}`).then((r) => r.json()).catch(() => ({ error: "the pod did not answer" })).then((got) => {
      if (mine !== ticket) return;
      data = got;
      renderTab();
    });
  }

  return { open, close, get tab() { return tab; } };
}
