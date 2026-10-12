// Which module a STACKS card or a Settings config key belongs to. Plain and
// browser-safe: settings-view.js and the server both read it.
// A STACKS card's module: the observe bundle is its own module, every other
// stack belongs to stacks.
export function stackModule(id) {
  return id === "observe" ? "observe" : "stacks";
}

// Settings › Effective config: a key of a module that is off is not listed.
const CONFIG_MODULE = [["aws.", "aws"], ["cost.", "cost"], ["stacks.", "stacks"], ["scorecard.", "score"], ["learn.", "learn"], ["network.", "network"], ["kube.", "kubernetes"], ["paths.vaults", "vaults"], ["features.ask", "ask"], ["features.learn", "learn"], ["features.scorecard", "score"], ["features.stacksRun", "stacks"], ["ui.refresh.mapSeconds", "map"], ["ui.refresh.radioSeconds", "radio"], ["ui.refresh.kubeSeconds", "kubernetes"], ["ui.refresh.sloSeconds", "vaults"]];
export function configModule(key) {
  return CONFIG_MODULE.find(([prefix]) => key === prefix || key.startsWith(prefix))?.[1] || "";
}
