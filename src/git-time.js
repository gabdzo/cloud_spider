// When a stack's code last changed: the last commit touching its directory
// (`git log -1 --format=%ct -- <dir>`, read-only). A vault is OUTDATED when
// that is after the stack's last deploy. Cached 5 min; 0 when git is absent.
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export function createCodeTime({ cwd = root, run = execFile, clock = Date.now, ttl = 300_000 } = {}) {
  const cache = new Map();
  return (dir) => {
    if (!/^[\w./-]+$/.test(String(dir || "")) || String(dir).includes("..")) return Promise.resolve(0);
    const hit = cache.get(dir);
    if (hit && clock() - hit.at < ttl) return hit.value;
    const value = new Promise((resolve) => {
      run("git", ["log", "-1", "--format=%ct", "--", dir], { cwd, timeout: 5000 }, (error, stdout) => {
        const t = Number(String(stdout || "").trim());
        resolve(!error && Number.isFinite(t) && t > 0 ? t * 1000 : 0);
      });
    });
    cache.set(dir, { at: clock(), value });
    return value;
  };
}
