// The page's state in the URL hash, so a reload, a shared link and the
// browser's back/forward all land on the same screen:
//   #<view>?sample=1&learn=<lab>&stacks=<card>&lb=<arn>&host=<host>
//   #path?debug=<url>&why=1  one-shot: DEBUG runs <url> (and opens the ALB
//                            503 walkthrough); not written back
// view is "" (the map), "path", "cluster", "vaults" or "vaults/<key>".
// learn and stacks are "1" when the panel is open with nothing picked.
const VIEWS = new Set(["", "path", "cluster", "vaults"]);

export function parseUrlState(hash) {
  const text = String(hash || "").replace(/^#/, "");
  const at = text.indexOf("?");
  const route = at < 0 ? text : text.slice(0, at);
  const params = new URLSearchParams(at < 0 ? "" : text.slice(at + 1));
  let view = route;
  let vault = null;
  if (route.startsWith("vaults/")) {
    view = "vaults";
    try {
      vault = decodeURIComponent(route.slice(7)) || null;
    } catch {
      vault = null;
    }
  }
  if (!VIEWS.has(view)) view = "";
  return {
    view,
    vault,
    sample: params.get("sample") === "1",
    learn: params.get("learn") || "",
    stacks: params.get("stacks") || "",
    lb: view === "path" ? params.get("lb") || "" : "",
    host: view === "path" ? params.get("host") || "" : "",
    debug: view === "path" ? (params.get("debug") || "").slice(0, 2048) : "",
    why: view === "path" && params.get("why") === "1",
  };
}

export function formatUrlState(state = {}) {
  let route = VIEWS.has(state.view) ? state.view : "";
  if (route === "vaults" && state.vault) route = `vaults/${encodeURIComponent(state.vault)}`;
  const params = new URLSearchParams();
  if (state.sample) params.set("sample", "1");
  if (state.learn) params.set("learn", state.learn);
  if (state.stacks) params.set("stacks", state.stacks);
  if (route === "path" && state.lb) params.set("lb", state.lb);
  if (route === "path" && state.host) params.set("host", state.host);
  const query = params.toString();
  if (!route && !query) return "";
  return `#${route}${query ? `?${query}` : ""}`;
}
