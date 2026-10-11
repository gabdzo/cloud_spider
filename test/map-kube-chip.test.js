import assert from "node:assert/strict";
import test from "node:test";
import { compoundHit, compoundHover, kubeChip } from "../src/map-kube.js";

const compound = {
  cluster: "cloudspider-up", x: 0, y: 0, w: 400, h: 200,
  buildings: [], stalls: [], figures: [], ns: [],
  lod: [{ type: "lod", cluster: "cloudspider-up", value: "1", x: 300, y: 5, w: 16, h: 14 }],
};
const placed = { settlements: [{ plots: [{ compound }] }] };

test("the compound header has a KUBE chip left of the LOD switch", () => {
  const chip = kubeChip(compound);
  assert.ok(chip.x + chip.w <= 300);
  const hit = compoundHit(placed, chip.x + 2, chip.y + 2);
  assert.equal(hit.type, "kube");
  assert.equal(hit.cluster, "cloudspider-up");
  assert.match(compoundHover({ ...hit, text: "" }), /CONNECT/);
  assert.equal(compoundHit(placed, 305, 8).type, "lod");
});
