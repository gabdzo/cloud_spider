import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBundle } from "../upgrades/observe/render.js";

const sums = (b) => Object.fromEntries(b.items.filter((i) => i.obj.spec?.template).map((i) => [i.obj.metadata.name, i.obj.spec.template.metadata.annotations?.["cloudspider.io/config-checksum"]]));

test("workloads that mount a ConfigMap carry its checksum; a config change changes it", () => {
  const a = sums(renderBundle({ profile: "crc", allowPrivileged: true }));
  const b = sums(renderBundle({ profile: "standard", allowPrivileged: true }));
  for (const n of ["otel-collector", "otel-agent", "beyla"]) assert.match(a[n] || "", /^[0-9a-f]{16}$/, n);
  assert.notEqual(a["otel-collector"], b["otel-collector"]);
  assert.notEqual(a["otel-agent"], b["otel-agent"]);
  assert.deepEqual(a, sums(renderBundle({ profile: "crc", allowPrivileged: true })));
});

test("index.js replaces ConfigMaps delete-first", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../upgrades/observe/index.js", import.meta.url), "utf8");
  assert.match(src, /ConfigMap" \? \{ \.\.\.inNs, deleteBeforeReplace: true \}/);
});
