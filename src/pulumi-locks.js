// Pulumi stack locks on the DIY backends (S3 here, file too). up, destroy
// and refresh take one (.pulumi/locks/organization/<project>/<stack>/<uuid>.json,
// { pid, username, hostname, timestamp }) and release it when they end; a
// pulumi that is killed leaves it, and the next one refuses with "the stack
// is currently locked by N lock(s)" and one line per lock. preview takes no
// lock on these backends, so the first locking step is where it shows.
// From those lines: a lock taken on this computer by a pid that is gone (or
// is no longer pulumi) is stale and goes with `pulumi cancel --stack <s>`
// (on a DIY backend it deletes the stack's lock files; checked with pulumi
// 3.268); anything else is refused with who holds it.
import { spawnSync } from "node:child_process";

const LINE = /^\s*(\S+): created by ([^@\s]*)@(\S*) \(pid (\d+)\) at (\S+)\s*$/gm;

export function parseLocks(text = "") {
  const value = String(text || "");
  if (!/currently locked by/i.test(value)) return [];
  const out = [];
  for (const m of value.matchAll(LINE)) out.push({ url: m[1], user: m[2], host: m[3], pid: Number(m[4]), at: Date.parse(m[5]), atText: m[5] });
  return out;
}

// The process name of a pid ("" when there is none): ps on macOS and Linux.
export function processNameOf(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return "";
  const got = spawnSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8", shell: false, timeout: 3000 });
  return got.status === 0 ? String(got.stdout || "").trim() : "";
}

// { stale, why }: dead | reused (stale); live | other-host | unknown (not).
export function judgeLock(lock, { hostname, processName = processNameOf, ownPids = new Set() } = {}) {
  if (!lock?.pid || !lock.host) return { stale: false, why: "unknown" };
  if (lock.host !== hostname) return { stale: false, why: "other-host" };
  if (ownPids.has(lock.pid)) return { stale: false, why: "live" };
  const name = processName(lock.pid);
  if (!name) return { stale: true, why: "dead" };
  return /(^|\/)pulumi([^/]*)$/i.test(name) ? { stale: false, why: "live" } : { stale: true, why: "reused" };
}

function when(at) {
  if (!Number.isFinite(at)) return "an unknown time";
  const d = new Date(at);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function age(at, now) {
  if (!Number.isFinite(at)) return "at an unknown time";
  const minutes = Math.max(0, Math.round((now - at) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 120) return `${minutes} min ago`;
  return `${Math.round(minutes / 60)} h ago`;
}

export function staleNote(lock, why = "dead") {
  return `removed a stale lock left by a run that died at ${when(lock.at)} (pid ${lock.pid}${why === "reused" ? ", now another program" : ""}); running the step again`;
}

// The refusal when a lock is not provably stale.
export function lockRefusal(stack, judged, now = Date.now()) {
  const parts = judged.map((lock) => {
    const since = age(lock.at, now);
    if (lock.why === "live") return `pulumi pid ${lock.pid} on ${lock.host} is still running (it took the lock ${since})`;
    if (lock.why === "other-host") return `a run on another computer (${lock.host}, pid ${lock.pid}${lock.user ? `, user ${lock.user}` : ""}) took it ${since}`;
    return `a lock Cloud Spider cannot read the owner of (${lock.url}), taken ${since}`;
  });
  return `stack ${stack} is locked: ${parts.join("; ")}. Cloud Spider removes a lock by itself only when the run that took it died on this computer.`;
}

// Resource operations a killed run left half-done (pulumi warns about them
// on the next up and carries on; a pending create may exist in AWS while
// the state does not know it).
export function pendingOps(text = "") {
  const out = [];
  const seen = new Set();
  for (const m of String(text || "").matchAll(/\*\s+urn:pulumi:[^:]*::[^:]*::(?:[^\s,]*\$)?([^\s,]+?)::([^\s,]+), interrupted while (\w+)/g)) {
    const key = `${m[1]}|${m[2]}|${m[3]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ name: m[2], type: m[1], op: m[3] });
  }
  return out;
}
