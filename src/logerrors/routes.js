// GET /api/logs/errors: the morning report's LOG ERRORS. ?sample=1 answers
// from the SAMPLE scenarios (&scenario=bare|bundle); ?fresh=1 skips the
// 5-minute cache. Read-only.
import { logErrorsLine } from "./core.js";
import { sampleLogErrors } from "./sample.js";

export async function logErrorsRoute(req, res, url, logErrors, { send }) {
  if (url.pathname !== "/api/logs/errors" || req.method !== "GET") return false;
  if (url.searchParams.get("sample") === "1") {
    const summary = sampleLogErrors(url.searchParams.get("scenario") === "bare" ? "bare" : "bundle");
    send(res, 200, { ...summary, line: logErrorsLine(summary) });
    return true;
  }
  if (!logErrors) {
    send(res, 200, { unset: true, error: "LOG ERRORS is not set up.", line: { status: "unknown", text: "not set up." } });
    return true;
  }
  const summary = await logErrors.read({ fresh: url.searchParams.get("fresh") === "1" });
  send(res, 200, { ...summary, line: logErrorsLine(summary) });
  return true;
}
