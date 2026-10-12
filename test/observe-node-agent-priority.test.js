import { test } from "node:test";
import assert from "node:assert/strict";
import { renderBundle, NODE_AGENT_PRIORITY, PROFILES } from "../upgrades/observe/render.js";

test("Beyla and the agent run at the bundle's node-agent priority; others don't", () => {
  const b = renderBundle({ profile: "standard", allowPrivileged: true });
  const pc = b.items.find((i) => i.obj.kind === "PriorityClass").obj;
  assert.equal(pc.metadata.name, NODE_AGENT_PRIORITY);
  assert.ok(pc.value > 0 && pc.value < 1e9);
  assert.equal(pc.globalDefault, false);
  assert.equal(pc.metadata.namespace, undefined);
  const prio = Object.fromEntries(b.items.filter((i) => i.obj.spec?.template).map((i) => [i.obj.metadata.name, i.obj.spec.template.spec.priorityClassName]));
  assert.equal(prio.beyla, NODE_AGENT_PRIORITY);
  assert.equal(prio["otel-agent"], NODE_AGENT_PRIORITY);
  assert.equal(prio["otel-collector"], undefined);
});

test("standard Beyla requests 25m CPU", () => {
  assert.equal(PROFILES.standard.beyla.requests.cpu, "25m");
});
