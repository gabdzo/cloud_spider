// The SLO ledger on disk: .cloudspider/slo-ledger.json, so a restart keeps
// the budgets' history (drill 2026-10-11, finding 8). Small: 5-minute
// buckets per SLO for at most 30 days, plus the last 4 h of CloudWatch
// minutes. Written whole to a temporary file and renamed, only when the
// ledger changed. Holds counts only: no URLs' answers, no names of people,
// nothing secret.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export function createSloStore({ file, ledger, fs = { mkdir, readFile, rename, writeFile } }) {
  let saved = -1;
  let flight = null;
  return {
    file,
    // { keys } or { keys: 0, note } when there was nothing (or nothing usable).
    async load() {
      let text;
      try {
        text = await fs.readFile(file, "utf8");
      } catch (error) {
        return { keys: 0, note: error?.code === "ENOENT" ? "no saved SLO history yet" : `the SLO history did not open: ${error?.code || error?.message}` };
      }
      try {
        const keys = ledger.load(JSON.parse(text));
        saved = ledger.version();
        return { keys };
      } catch {
        return { keys: 0, note: "the SLO history file is not JSON; starting over (it is replaced on the next save)" };
      }
    },
    async save({ force = false } = {}) {
      if (flight) return flight;
      const version = ledger.version();
      if (!force && version === saved) return { saved: false };
      flight = (async () => {
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.mkdir(dirname(file), { recursive: true });
        await fs.writeFile(tmp, JSON.stringify(ledger.dump()));
        await fs.rename(tmp, file);
        saved = version;
        return { saved: true };
      })();
      try {
        return await flight;
      } catch (error) {
        return { saved: false, error: error?.code || error?.message || "the SLO history was not saved" };
      } finally {
        flight = null;
      }
    },
  };
}
