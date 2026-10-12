// The settings panel (gear in the header): the theme toggle and the
// effective config from cloudspider.yaml (/api/config, redacted).
//
// Theme: ui.theme in the config is the default; a choice here is kept in
// localStorage (THEME_KEY) and wins in this browser. "Use config" forgets
// the choice. The server already writes the config theme on <html
// data-theme>, and a tiny head script applies the stored choice before the
// first paint, so there is no flash.
export const THEME_KEY = "cloudspider.theme";
export const THEMES = [
  { id: "pip", name: "Pip-Boy", note: "phosphor device, pixel art" },
  { id: "pro", name: "Pro", note: "clean dark dashboard" },
];

export function pickTheme(stored, configured) {
  const ids = THEMES.map((t) => t.id);
  if (ids.includes(stored)) return stored;
  return ids.includes(configured) ? configured : "pip";
}

// Neutral words for the pro theme: elements carrying data-pro-label show it
// there and their Pip text otherwise.
export function applyLabels(root, theme) {
  for (const el of root.querySelectorAll("[data-pro-label]")) {
    if (el.dataset.pipLabel === undefined) el.dataset.pipLabel = el.textContent;
    el.textContent = theme === "pro" ? el.dataset.proLabel : el.dataset.pipLabel;
  }
  for (const el of root.querySelectorAll("[data-pro-title]")) {
    if (el.dataset.pipTitle === undefined) el.dataset.pipTitle = el.getAttribute("title") || "";
    el.setAttribute("title", theme === "pro" ? el.dataset.proTitle : el.dataset.pipTitle);
  }
}

// [{ key, value, source }] for the table, leaves only, in schema order.
export function configRows(config, sources = {}, prefix = "") {
  const rows = [];
  for (const [key, value] of Object.entries(config || {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) rows.push(...configRows(value, sources, path));
    else rows.push({ key: path, value: Array.isArray(value) ? (value.length ? JSON.stringify(value) : "[]") : value === "" ? '""' : String(value), source: sources[path] || "default" });
  }
  return rows;
}

export const MODULES_KEY = "cloudspider.modules.hidden";

// Modules this page shows: on at the server and not hidden in this browser.
export function visibleModules(enabled = [], hidden = []) {
  return enabled.filter((id) => !hidden.includes(id));
}

// The cloudspider.yaml lines that make this browser's choice the server's.
export function modulesYaml(profile = "full", enabled = [], hidden = []) {
  const off = enabled.filter((id) => hidden.includes(id));
  return `modules:\n  profile: ${profile}${off.length ? `\n  disable: [${off.join(", ")}]` : ""}\n`;
}

export function readHidden(storage) {
  try {
    const got = JSON.parse(storage?.getItem(MODULES_KEY) || "[]");
    return Array.isArray(got) ? got.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function createSettings({ root, button, storage, onTheme = () => {}, onModules = () => {}, fetchConfig = () => fetch("/api/config").then((r) => r.json()) }) {
  let body = null;
  let configured = document.documentElement.dataset.configTheme || "pip";

  const read = () => {
    try {
      return storage?.getItem(THEME_KEY) || "";
    } catch {
      return "";
    }
  };
  const write = (value) => {
    try {
      if (value) storage?.setItem(THEME_KEY, value);
      else storage?.removeItem(THEME_KEY);
    } catch {
      // A browser without storage still switches for this page.
    }
  };

  function current() {
    return pickTheme(read(), configured);
  }

  function apply() {
    const theme = current();
    document.documentElement.dataset.theme = theme;
    applyLabels(document, theme);
    onTheme(theme);
    if (!root.hidden) render();
  }

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function render() {
    root.replaceChildren();
    const head = el("div", "st-head");
    head.append(el("h2", "", "Settings"));
    const close = el("button", "st-close", "×");
    close.type = "button";
    close.setAttribute("aria-label", "close settings");
    close.addEventListener("click", () => setOpen(false));
    head.append(close);
    root.append(head);

    const themeBox = el("section", "st-sec");
    themeBox.append(el("h3", "", "Theme"));
    const group = el("div", "st-seg");
    group.setAttribute("role", "radiogroup");
    group.setAttribute("aria-label", "theme");
    const theme = current();
    for (const t of THEMES) {
      const b = el("button", "st-opt");
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(theme === t.id));
      b.dataset.theme = t.id;
      b.append(el("b", "", t.name), el("small", "", t.note));
      b.addEventListener("click", () => {
        write(t.id);
        apply();
      });
      group.append(b);
    }
    themeBox.append(group);
    const stored = read();
    const note = el("p", "st-note", stored ? `This browser's choice (${stored}) overrides ui.theme: ${configured}. ` : `From the config (ui.theme: ${configured}). `);
    if (stored) {
      const reset = el("button", "st-link", "Use config");
      reset.type = "button";
      reset.addEventListener("click", () => {
        write("");
        apply();
      });
      note.append(reset);
    }
    themeBox.append(note);
    root.append(themeBox);

    if (body?.modules) root.append(modulesSection(body.modules));

    const cfg = el("section", "st-sec");
    cfg.append(el("h3", "", "Effective config"));
    if (!body) cfg.append(el("p", "st-note", "reading /api/config…"));
    else if (body.error) cfg.append(el("p", "st-note", body.error));
    else {
      cfg.append(el("p", "st-note", body.file ? `file: ${body.file}` : "no cloudspider.yaml: defaults and env vars (see cloudspider.example.yaml)"));
      for (const w of body.warnings || []) cfg.append(el("p", "st-note st-warn", w));
      const table = el("table", "st-table");
      const hr = el("tr");
      hr.append(el("th", "", "key"), el("th", "", "value"), el("th", "", "from"));
      table.append(hr);
      for (const row of configRows(body.config, body.sources)) {
        const tr = el("tr");
        const from = el("td", row.source === "default" ? "st-default" : "st-set", row.source);
        tr.append(el("td", "", row.key), el("td", "", row.value), from);
        table.append(tr);
      }
      cfg.append(table);
      cfg.append(el("p", "st-note", "Edit cloudspider.yaml (or env vars / flags) and restart to change these."));
    }
    root.append(cfg);
  }

  // MODULES: what the server runs (cloudspider.yaml, restart to change) and,
  // within that, what this browser shows. A module off at the server cannot be
  // turned on here; the YAML below is what to paste to make the choice stick.
  function modulesSection(m) {
    const sec = el("section", "st-sec st-modules");
    sec.append(el("h3", "", "Modules"));
    sec.append(el("p", "st-note", `profile: ${m.profile}. Unticking hides a module in this browser; the server keeps it until cloudspider.yaml says otherwise.`));
    const hidden = readHidden(storage);
    const list = el("ul", "st-mods");
    for (const mod of m.modules || []) {
      const li = el("li", mod.on ? "" : "st-off");
      const label = el("label");
      const box = el("input");
      box.type = "checkbox";
      box.dataset.module = mod.id;
      box.checked = mod.on && !hidden.includes(mod.id);
      box.disabled = !mod.on;
      box.addEventListener("change", () => {
        const now = readHidden(storage).filter((id) => id !== mod.id);
        if (!box.checked) now.push(mod.id);
        try {
          storage?.setItem(MODULES_KEY, JSON.stringify(now));
        } catch {
          // no storage: the choice lasts for this page only
        }
        onModules(visibleModules(m.enabled, now));
        render();
      });
      label.append(box, el("b", "", mod.label), el("small", "", mod.on ? mod.doc : `off: ${m.off?.[mod.id] || "off"}`));
      li.append(label);
      list.append(li);
    }
    sec.append(list);
    sec.append(el("pre", "st-yaml", modulesYaml(m.profile, m.enabled, hidden)));
    if (m.awsClients) sec.append(el("p", "st-note", m.awsClients.length ? `AWS clients built: ${m.awsClients.join(", ")}` : "No AWS client was built (aws module off)."));
    return sec;
  }

  function setOpen(open) {
    root.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      render();
      fetchConfig()
        .then((got) => {
          body = got || { error: "no config answer" };
          configured = got?.config?.ui?.theme || configured;
        })
        .catch(() => {
          body = { error: "/api/config did not answer" };
        })
        .finally(() => {
          if (!root.hidden) render();
        });
      root.querySelector(".st-close")?.focus();
    } else button.focus();
  }

  button.addEventListener("click", () => setOpen(root.hidden));
  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      setOpen(false);
    }
  });
  apply();
  return { current, apply, setOpen, isOpen: () => !root.hidden };
}
