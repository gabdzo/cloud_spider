// Shared by the page and the server: the map snapshot the TERMINAL sends
// with a question, its size cap, and reading the agent's answer into text
// and fenced blocks (with the actions Cloud Spider itself can confirm).

const tagValue = (tags, key) => {
  if (Array.isArray(tags)) {
    const hit = tags.find((tag) => (tag?.key ?? tag?.Key) === key);
    return hit ? hit.value ?? hit.Value : undefined;
  }
  return tags && typeof tags === "object" ? tags[key] : undefined;
};

function clip(text, max = 200) {
  const value = text === undefined || text === null ? "" : String(text);
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

// A compact picture of what is on screen. Every list is bounded here; the
// byte cap (capContext) is the second fence.
export function snapshot({ place, vaults = [], radio = [], region = "", sample = false, view = "map", selection = null, path = null } = {}) {
  const vpcs = (place?.vpcs || []).slice(0, 20).map((vpc) => ({ id: vpc.id, name: clip(vpc.name, 60), cidr: vpc.cidr }));
  const instances = (place?.instances || []).slice(0, 60).map((item) => ({
    id: item.id,
    name: clip(item.name, 60),
    state: item.state,
    type: item.type,
    vpc: item.vpcId,
    expendable: tagValue(item.tags, "cloudspider") === "expendable",
    project: tagValue(item.tags, "project"),
  }));
  const fixture = (item) => ({ id: clip(item.id, 140), kind: item.kind, name: clip(item.name || item.label, 60), status: item.status, vpc: item.vpcId });
  const fixtures = (place?.fixtures || []).filter((item) => item.vpcId).slice(0, 60).map(fixture);
  const camp = (place?.fixtures || []).filter((item) => !item.vpcId).slice(0, 60).map(fixture);
  return {
    region,
    mode: sample ? "sample" : "live",
    view,
    vpcs,
    instances,
    fixtures,
    camp,
    vaults: (vaults || []).slice(0, 40).map((vault) => ({
      name: vault.name,
      number: vault.number,
      title: clip(vault.title, 80),
      light: vault.status,
      damaged: Boolean(vault.damaged),
      errors: (vault.errors || []).slice(0, 5).map((text) => clip(text, 160)),
      checks: (vault.checks || []).slice(0, 8).map((check) => ({
        name: clip(check.name || check.url, 80),
        status: check.status,
        code: check.code,
        ms: check.ms,
        error: clip(check.error, 160),
      })),
      owns: (vault.owned || []).length,
    })),
    radio: (radio || []).slice(0, 15).map((row) => ({ time: row.time ? new Date(row.time).toISOString() : "", status: row.status, text: clip(row.text, 200) })),
    selection: selection ? { id: selection.id, name: clip(selection.name, 60), type: selection.type, state: selection.state } : null,
    path: path
      ? {
          headline: clip(path.headline, 300),
          host: clip(path.host, 120),
          findings: (path.findings || []).slice(0, 12).map((item) => ({ status: item.status, text: clip(item.text || item.sentence || item.label, 200) })),
        }
      : null,
  };
}

// JSON no longer than max characters: the longest list is halved until it
// fits, then strings are cut. Returns { json, trimmed }.
export function capContext(value, max = 16_000) {
  let data = JSON.parse(JSON.stringify(value ?? {}));
  let json = JSON.stringify(data);
  if (json.length <= max) return { json, trimmed: false };
  const lists = (node, out = []) => {
    if (Array.isArray(node)) {
      out.push(node);
      node.forEach((item) => lists(item, out));
    } else if (node && typeof node === "object") Object.values(node).forEach((item) => lists(item, out));
    return out;
  };
  for (let round = 0; round < 200 && json.length > max; round += 1) {
    const longest = lists(data).sort((a, b) => b.length - a.length)[0];
    if (!longest || longest.length <= 1) break;
    longest.length = Math.floor(longest.length / 2);
    json = JSON.stringify(data);
  }
  for (let limit = 120; json.length > max && limit >= 8; limit = Math.floor(limit / 2)) {
    const cut = (node) => {
      if (typeof node === "string") return node.length > limit ? `${node.slice(0, limit)}…` : node;
      if (Array.isArray(node)) return node.map(cut);
      if (node && typeof node === "object") return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, cut(v)]));
      return node;
    };
    data = cut(data);
    json = JSON.stringify(data);
  }
  if (json.length > max) json = JSON.stringify({ note: "snapshot too large" });
  return { json, trimmed: true };
}

// The actions Cloud Spider can confirm itself. Anything else is copy-only.
export function parseAction(line) {
  const words = String(line || "").trim().split(/\s+/);
  const [verb, target] = words;
  if (words.length !== 2) return null;
  if ((verb === "stop" || verb === "start") && /^[A-Za-z0-9-]{1,64}$/.test(target)) return { verb, id: target };
  if (verb === "up" && /^[a-z][a-z0-9-]{0,30}$/.test(target)) return { verb, module: target };
  return null;
}

// Answer text into [{ kind: "text", text } | { kind: "code", lang, text, actions, open }].
// A block still streaming (no closing fence yet) is marked open.
export function parseAnswer(text) {
  const parts = [];
  const lines = String(text || "").split("\n");
  let block = null;
  let prose = [];
  const flush = () => {
    if (prose.length) parts.push({ kind: "text", text: prose.join("\n") });
    prose = [];
  };
  for (const line of lines) {
    const fence = line.match(/^\s*```\s*([\w-]*)\s*$/);
    if (fence && !block) {
      flush();
      block = { kind: "code", lang: fence[1] || "", lines: [] };
      continue;
    }
    if (fence && block) {
      parts.push(closeBlock(block, false));
      block = null;
      continue;
    }
    if (block) block.lines.push(line);
    else prose.push(line);
  }
  if (block) parts.push(closeBlock(block, true));
  else flush();
  return parts.filter((part) => part.kind === "code" || part.text.trim());
}

function closeBlock(block, open) {
  const text = block.lines.join("\n");
  const actions = block.lang === "cloudspider" && !open ? block.lines.map(parseAction).filter(Boolean) : [];
  return { kind: "code", lang: block.lang, text, actions, open };
}
