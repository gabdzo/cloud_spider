import { isInstanceId } from "./ids.js";

export async function readLogs({ logs, logGroup, region, id }) {
  if (!isInstanceId(id)) return { note: "it is not an instance id", lines: [] };
  if (!logGroup) return { note: "the log group is unset", lines: [] };
  const result = await logs.filter({ region, group: logGroup, stream: id, limit: 20 });
  if (result?.missing) return { note: "the log stream is missing", lines: [] };
  if (result?.error) return { note: `the logs cannot be read: ${result.error}`, lines: [] };
  const lines = (result?.events || []).slice(-20).map((event) =>
    String(event.message ?? "").replace(/\s+/g, " ").trim(),
  );
  return { note: "", lines };
}
