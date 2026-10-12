// "Where am I": CLUSTER › SERVICES, VAULTS › SCORE, read from the buttons'
// own aria-pressed state, so it can never disagree with what is lit.
// crumbs() is pure (tested); mountWhere() keeps #where in step.

const label = (el) => (el?.querySelector?.("[data-pro-label]")?.textContent || el?.querySelector?.(".tag")?.textContent || el?.textContent || "").trim().toUpperCase();

// view: the lit top tab; panel: a lit console key that takes the screen
// (not RADIO, a side panel); screen: the lit cluster sub-tab; overlay: K9S.
export function crumbs({ view = "", panel = "", screen = "", overlay = "" } = {}) {
  const out = [];
  if (view) out.push(view);
  if (panel && panel !== view) out.push(panel);
  if (screen && view === "CLUSTER" && !panel) out.push(screen);
  if (overlay && overlay !== view) out.push(overlay);
  return out;
}

export function mountWhere(doc = document) {
  const where = doc.querySelector("#where");
  if (!where) return;
  const read = () => {
    const lit = (sel) => [...doc.querySelectorAll(sel)].find((b) => b.getAttribute("aria-pressed") === "true" && !b.hidden);
    const view = label(lit(".tabs .tab:not(#k9s-btn)"));
    const key = lit(".keys .key:not(#tab-radio)");
    const screen = doc.querySelector("#kube-tabs")?.hidden ? "" : label(lit("#kube-tabs button"));
    const overlay = lit("#k9s-btn") ? "K9S" : "";
    const parts = crumbs({ view, panel: label(key), screen, overlay });
    const text = parts.join(" › ");
    if (where.dataset.text === text) return; // own writes must not loop
    where.dataset.text = text;
    if (where.hidden !== !parts.length) where.hidden = !parts.length;
    where.replaceChildren(doc.createTextNode("YOU ARE IN "));
    parts.forEach((p, i) => {
      if (i) where.append(Object.assign(doc.createElement("i"), { textContent: "›" }));
      where.append(Object.assign(doc.createElement("b"), { textContent: p }));
    });
  };
  new MutationObserver((list) => { if (list.some((m) => m.target !== where)) read(); }).observe(doc.body, { subtree: true, attributes: true, attributeFilter: ["aria-pressed", "hidden"] });
  read();
}
