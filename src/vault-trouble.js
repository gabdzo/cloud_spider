// Per-vault trouble: what went wrong for this vault's resources, so a red
// light comes with a reason. Two read-only sources:
//   - CloudTrail failures the radio already read (LookupEvents), matched to
//     the vault by the resource names a failed call touched or asked for;
//   - the last error lines of the vault's log groups (logs:FilterLogEvents),
//     read when a vault opens, cached a minute.
export const LOG_TTL = 60_000;
export const LOG_WINDOW_MS = 60 * 60 * 1000;
export const ERROR_PATTERN = '?ERROR ?Error ?error ?Exception ?"Task timed out" ?panic ?FATAL';
const MAX_GROUPS = 4;
const MAX_LINES = 12;
const MAX_TROUBLE = 5;

// Every name the vault's resources go by: listed ids, the stack's handles,
// owned ids and the names of owned pieces on the map.
export function vaultHandles(entry, ownedIds = [], resources = new Map()) {
  const out = new Set();
  for (const id of entry?.resources?.ids || []) out.add(id);
  for (const handle of entry?.resources?.handles || []) out.add(handle);
  for (const id of ownedIds) {
    out.add(id);
    const item = resources.get(id);
    if (item?.name) out.add(item.name);
    if (item?.arn) out.add(item.arn);
  }
  return out;
}

function short(handle) {
  const text = String(handle || "");
  const cut = Math.max(text.lastIndexOf("/"), text.lastIndexOf(":"));
  return cut >= 0 && cut < text.length - 1 ? text.slice(cut + 1) : text;
}

// failures: raw radio events with error set. Newest first, 5 at most.
export function vaultTrouble(handles, failures = []) {
  if (!handles?.size) return [];
  const shorts = new Set([...handles].map(short));
  const out = [];
  for (const event of failures) {
    const touched = [...(event.resources || []), ...(event.names || [])];
    const hit = touched.find((name) => handles.has(name) || shorts.has(short(name)));
    if (!hit) continue;
    out.push({ time: event.time || 0, call: event.name || "", issue: event.error || "", resource: short(hit) });
    if (out.length >= MAX_TROUBLE) break;
  }
  return out;
}

// Log groups for a vault: the stack's, plus /aws/lambda/<name> for owned functions.
export function vaultLogGroups(stackGroups = [], ownedFunctions = []) {
  const out = new Set(stackGroups);
  for (const name of ownedFunctions) if (name) out.add(`/aws/lambda/${name}`);
  return [...out].slice(0, MAX_GROUPS);
}

export async function readErrorLines({ logs, region, groups, now }) {
  if (!groups.length) return { lines: [], note: "no log groups for this vault" };
  if (typeof logs?.search !== "function") return { lines: [], note: "logs are not set up" };
  const results = await Promise.all(
    groups.map(async (group) => ({ group, result: await logs.search({ region, group, pattern: ERROR_PATTERN, start: now - LOG_WINDOW_MS, limit: 20 }).catch((error) => ({ error: error?.message || "error" })) })),
  );
  const lines = [];
  const notes = [];
  for (const { group, result } of results) {
    if (result?.missing) continue;
    if (result?.error) {
      notes.push(`${group}: ${result.error}`);
      continue;
    }
    for (const event of result?.events || []) {
      lines.push({ time: Number(event.time) || 0, group, text: String(event.message || "").replace(/\s+/g, " ").trim().slice(0, 300) });
    }
  }
  lines.sort((a, b) => a.time - b.time);
  const kept = lines.slice(-MAX_LINES);
  const note = notes.length ? `cannot read ${notes.join("; ")}` : kept.length ? "" : `no error lines in the last hour (${groups.join(", ")})`;
  return { lines: kept, note, groups };
}

export function createLogCache({ clock = Date.now, ttl = LOG_TTL } = {}) {
  const cache = new Map();
  return {
    async get(key, read) {
      const now = clock();
      const hit = cache.get(key);
      if (hit && now - hit.at < ttl) return hit.value;
      const value = await read();
      cache.set(key, { at: now, value });
      return value;
    },
  };
}
