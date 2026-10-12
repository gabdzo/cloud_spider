// Layout-quality probe, run inside the page (page.evaluate(overlapProbe)).
// Units: every visible interactive element, and every run of text outside
// one. Findings:
//   overlap  two units paint over each other (≥ 3×3 px, neither inside the
//            other, and the topmost element at the spot is one of them)
//   clipped  text cut by its own box or a non-scrolling ancestor, without an
//            ellipsis + tooltip
//   offscreen a unit sticks out of the viewport sideways (or the page
//            scrolls sideways)
// Canvases and aria-hidden decoration are ignored; scroll containers may
// hide what is scrolled away.
export function overlapProbe(opts = {}) {
  const MIN = opts.min ?? 3;
  const W = window.innerWidth;
  const INTERACTIVE = "button, a[href], select, input:not([type=hidden]), textarea, summary, [role=button], [role=tab], [role=switch]";
  const describe = (el) => {
    const id = el.id ? `#${el.id}` : "";
    const cls = typeof el.className === "string" && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join(".")}` : "";
    const text = (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 24);
    return `${el.tagName.toLowerCase()}${id}${cls}${text ? ` "${text}"` : ""}`;
  };
  const shown = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      if (e.hidden || e.getAttribute("aria-hidden") === "true") return false;
      // content of a closed <details> keeps a box but is not painted
      if (e.parentElement?.tagName === "DETAILS" && !e.parentElement.open && e.tagName !== "SUMMARY") return false;
      const s = getComputedStyle(e);
      if (s.display === "none" || s.visibility === "hidden" || Number(s.opacity) === 0) return false;
    }
    return true;
  };
  const scrolls = (s) => /(auto|scroll)/.test(s.overflowX + s.overflowY);
  // The part of `r` left visible after every clipping ancestor; also whether
  // a non-scrolling ancestor cut it sideways.
  const clip = (el, r, self = false) => {
    let { left, top, right, bottom } = r;
    let cut = false;
    for (let e = self ? el : el.parentElement; e && e !== document.body; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.overflowX === "visible" && s.overflowY === "visible") continue;
      const c = e.getBoundingClientRect();
      if (!scrolls(s) && (left < c.left - 1 || right > c.right + 1)) cut = true;
      left = Math.max(left, c.left); right = Math.min(right, c.right);
      top = Math.max(top, c.top); bottom = Math.min(bottom, c.bottom);
      if (s.position === "fixed") break;
    }
    return { left, top, right, bottom, cut, empty: right - left < 1 || bottom - top < 1 };
  };
  const units = [];
  const seen = new Set();
  for (const el of document.querySelectorAll(INTERACTIVE)) {
    if (el.closest("canvas") || !shown(el)) continue;
    const top = el.parentElement?.closest(INTERACTIVE);
    if (top && shown(top)) continue; // the outer control is the unit
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const c = clip(el, r);
    if (c.empty) continue;
    units.push({ el, r: c, kind: "control" });
    seen.add(el);
  }
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || ["SCRIPT", "STYLE", "OPTION", "TITLE", "NOSCRIPT"].includes(el.tagName)) continue;
    if (el.closest(INTERACTIVE) || el.closest("svg") || !shown(el)) continue;
    const range = document.createRange();
    range.selectNodeContents(n);
    const r = range.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    const c = clip(el, r, true);
    if (c.empty) continue;
    units.push({ el, r: c, kind: "text", full: r });
  }
  const findings = [];
  const add = (kind, a, b, extra = "") => findings.push({ kind, a: describe(a), ...(b ? { b: describe(b) } : {}), ...(extra ? { note: extra } : {}) });
  // clipped / overflowing
  for (const u of units) {
    const el = u.el;
    const s = getComputedStyle(el);
    const ellipsis = s.textOverflow === "ellipsis";
    const own = el.scrollWidth > el.clientWidth + 2 && /(hidden|clip)/.test(s.overflowX) && !scrolls(s);
    if ((own || u.r.cut) && !(ellipsis && (el.title || el.closest("[title]")))) add("clipped", el, null, own ? "own box" : "ancestor");
    if (u.r.right > W + 1 || u.r.left < -1) add("offscreen", el, null, `${Math.round(u.r.left)}..${Math.round(u.r.right)} of ${W}`);
  }
  if (document.documentElement.scrollWidth > W + 1) findings.push({ kind: "offscreen", a: "page", note: `scrolls sideways: ${document.documentElement.scrollWidth} > ${W}` });
  // overlaps
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i], b = units[j];
      if (a.el === b.el || a.el.contains(b.el) || b.el.contains(a.el)) continue;
      const x1 = Math.max(a.r.left, b.r.left), x2 = Math.min(a.r.right, b.r.right);
      const y1 = Math.max(a.r.top, b.r.top), y2 = Math.min(a.r.bottom, b.r.bottom);
      if (x2 - x1 < MIN || y2 - y1 < MIN) continue;
      const hit = document.elementFromPoint((x1 + x2) / 2, (y1 + y2) / 2);
      if (!hit) continue;
      const mine = (u) => u.el === hit || u.el.contains(hit);
      if (!mine(a) && !mine(b)) continue; // both under something else (a modal)
      add("overlap", a.el, b.el, `${Math.round(x2 - x1)}×${Math.round(y2 - y1)} at ${Math.round(x1)},${Math.round(y1)}`);
    }
  }
  return findings;
}
