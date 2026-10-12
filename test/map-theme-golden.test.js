// The survey map's Pip-Boy rendering must stay pixel-identical while the
// pro theme gets its own diagram (map-pro.js). Every canvas call of a Pip
// paint is recorded (test/helpers/record-canvas.js) and hashed; the hashes
// below were taken from the renderer before the pro map existed. A Pip
// change shows here first: if it is intended, regenerate them and say so.
import { test } from "node:test";
import assert from "node:assert/strict";
import { installOffscreen, recorder } from "./helpers/record-canvas.js";
import { sampleScene } from "./helpers/map-scene.js";

installOffscreen();
globalThis.Path2D ??= class { constructor(d) { this.d = d; } toJSON() { return `Path2D(${this.d})`; } };
const { paint, focusLists } = await import("../src/draw.js");
const { PALETTE } = await import("../src/theme.js");
const { PRO_GLYPHS, glyphKey } = await import("../src/map-pro-icons.js");

const PIP_GOLDEN = {
  w1440: ["926804b2fa76a60e", { width: 1440 }],
  w760: ["5b314d43ea0564a1", { width: 760, animTime: 1234 }],
  w1920flow: ["5812d8c4ab58e938", { width: 1920, flow: true, animTime: 5000 }],
  tag: ["050f2c5ce9d5efd2", { width: 1440, view: "tag" }],
  selBuilding: ["62f8a10c31f10b55", { width: 1440, select: "building" }],
  selFixture: ["4f4a7de6c8b45908", { width: 1440, select: "fixture" }],
};

function render(opts, theme) {
  globalThis.document = theme === "pro" ? { documentElement: { dataset: { theme: "pro" } } } : undefined;
  if (theme !== "pro") delete globalThis.document;
  try {
    const scene = sampleScene(opts);
    if (opts.select) {
      const { buildings, fixtures } = focusLists(scene.placed);
      const hit = opts.select === "building" ? buildings[0] : fixtures[0];
      scene.ui.selection = { id: hit.id, name: hit.name || hit.label || hit.id, type: hit.type || hit.kind, state: hit.state || hit.status };
      scene.ui.facts = [{ label: "CHANGED", text: "2h ago by deploy", tone: "warn" }];
      scene.ui.logs = [{ time: 1700000000000, text: "GET /items 200" }];
    }
    const r = recorder(opts.width, opts.height || 1100);
    paint(r.ctx, scene);
    return r;
  } finally {
    delete globalThis.document;
  }
}

for (const [name, [hash, opts]] of Object.entries(PIP_GOLDEN)) {
  test(`Pip-Boy map is pixel-identical: ${name}`, () => {
    const r = render(opts, "pip");
    assert.ok(r.log.length > 900, "the recorder saw the whole paint");
    assert.equal(r.hash(), hash, "the Pip-Boy map's canvas calls changed");
  });
}

// Everything a pro paint draws, the static layer included.
function proLog(opts) {
  const r = render(opts, "pro");
  return { r, text: r.log.join("\n") };
}

test("pro map: no pixel art (no sprite bitmaps, no Pip palette, no Pip font)", () => {
  for (const opts of [{ width: 1440 }, { width: 760 }, { width: 1920, flow: true }, { width: 1440, select: "fixture" }]) {
    const { text } = proLog(opts);
    // Only the static layer is blitted; sprites would be more drawImage calls.
    assert.equal((text.match(/drawImage\(/g) || []).length, 1, "one drawImage: the pro static layer");
    for (const colour of [PALETTE[1], PALETTE[16], PALETTE[21], PALETTE[22], PALETTE[13]]) assert.ok(!text.includes(colour), `Pip colour ${colour} in the pro map`);
    assert.ok(!/Share Tech Mono|VT323/.test(text), "Pip font in the pro map");
    assert.match(text, /Inter/);
  }
});

test("pro map: draws every resource as an icon tile, the containers, peering and the TGW", () => {
  const { text } = proLog({ width: 1440, height: 3200 }); // tall: the regional camp is far down
  const scene = sampleScene({ width: 1440, height: 3200 });
  const { buildings, fixtures } = focusLists(scene.placed);
  for (const f of fixtures) assert.ok(text.includes((f.label || f.name || f.id).slice(0, 12)), `fixture ${f.id} labelled`); // prefix: long names ellipsize
  // Icon glyphs are Path2D strokes: one per tile at least.
  assert.ok((text.match(/stroke\("Path2D/g) || []).length >= buildings.length + fixtures.length);
  for (const word of ["Transit GW", "shared-to-prod", "Half · routes one side only", "Public · Internet", "igw"]) assert.ok(text.includes(word), word);
});

test("pro map: the selected resource gets a panel with its status and logs", () => {
  const { text } = proLog({ width: 1440, select: "fixture" });
  assert.ok(text.includes("Logs") && text.includes("GET /items 200") && text.includes("CHANGED"));
});

test("pro icons: every map kind resolves to a glyph of our own; instance types read as EC2", () => {
  const scene = sampleScene({ width: 1440 });
  const { fixtures } = focusLists(scene.placed);
  for (const f of fixtures) assert.notEqual(glyphKey(f.kind), "generic", f.kind);
  assert.equal(glyphKey("t3.medium"), "ec2");
  assert.equal(glyphKey("m7g.2xlarge"), "ec2");
  assert.ok(PRO_GLYPHS.includes("tgw") && PRO_GLYPHS.includes("pcx") && PRO_GLYPHS.includes("cluster"));
});
