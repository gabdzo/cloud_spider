// Strict unknown-key checking only where every stack config is in the repo
// (a committed Pulumi.<stack>.yaml): eks, camp, observability. Elsewhere live
// stacks may hold keys set by hand, so an unknown key stays a warning.
import assert from "node:assert/strict";
import test from "node:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { validateStack } from "../upgrades/schema/stacks.js";

const up = join(dirname(fileURLToPath(import.meta.url)), "..", "upgrades");
const stacks = readdirSync(up).filter((d) => existsSync(join(up, d, "Pulumi.yaml")));
const committed = (d) => readdirSync(join(up, d)).filter((f) => /^Pulumi\.[^.]+\.yaml$/.test(f));
const strict = (d) => /assertStackConfig\(pulumi, "[^"]+", \{ strict: true \}\)|assertEks\(/.test(readFileSync(join(up, d, "index.js"), "utf8"));

test("strict exactly where the stack configs are committed", () => {
  for (const d of stacks) assert.equal(strict(d), committed(d).length > 0, `${d}: strict=${strict(d)}, committed configs=${committed(d).join(",") || "none"}`);
});

test("every committed stack config passes its schema strictly (no unknown key, no error)", () => {
  for (const d of stacks) {
    const project = /^name:\s*(\S+)/m.exec(readFileSync(join(up, d, "Pulumi.yaml"), "utf8"))[1];
    for (const f of committed(d)) {
      const raw = parse(readFileSync(join(up, d, f), "utf8")).config || {};
      const flat = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : String(v)]));
      const got = validateStack(project, flat, { prefixed: true });
      assert.deepEqual(got.errors, [], `${d}/${f}`);
    }
  }
});
