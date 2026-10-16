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

// Changed on purpose (UX pass 2, docs/ux-review-2026-10-12.md): the map
// legend is one flat KEY strip instead of a box per item.
// Changed on purpose (UX overlaps B): the PUBLIC tab moved to the card's
// left edge so the vault number badge no longer covers it.
// Changed on purpose (ALB rules showcase): the SAMPLE map gains the demo
// showcase balancers (dedicated Boutique ALB, shared demo-apps ALB, an NLB).
// Changed on purpose (map dock overlap): wrapped public ALB lines leave room
// for the dock under a line and the PUBLIC badge over the next.
// Changed on purpose (map namespace grid): the EKS compound lays its
// namespaces out as a grid of boxes over the free width, with gutter lines.
const PIP_GOLDEN = {
  w1440: ["71592595747d0735", { width: 1440 }],
  w760: ["3e85298eda4fa2fe", { width: 760, animTime: 1234 }],
  // Changed on purpose (#pro-map-2): side-by-side VPCs leave a chip row
  // above the first row so peering chips clear the ARCH / BY TAG switch.
  w1920flow: ["c29f0d6ccd85d699", { width: 1920, flow: true, animTime: 5000 }],
  tag: ["d3ac33f6eb8e83a2", { width: 1440, view: "tag" }],
  selBuilding: ["406aff821b21484c", { width: 1440, select: "building" }],
  selFixture: ["56fc2581e0d5f962", { width: 1440, select: "fixture" }],
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

const VAULT = { key: "shop", number: 101, title: "a-very-long-sample-vault-name-shop", stack: "shop", damaged: false, checks: [] };

test("pro map: a vault cell is drawn in the pro style, not as a door in a hill", () => {
  const r = render({ width: 1440, vaults: [VAULT] }, "pro");
  const text = r.log.join("\n");
  assert.ok(text.includes("Vault 101"));
  assert.ok(/a-very.*….*shop/.test(text), "middle ellipsis keeps the end of the name");
  assert.equal((text.match(/drawImage\(/g) || []).length, 1);
});

test("pro map: long names lose their middle, and the VPC name wins over the gateway pill", async () => {
  const { clip, gatePlace } = await import("../src/map-pro.js");
  const ctx = recorder(100, 100).ctx;
  ctx.font = "600 12px Inter";
  const out = clip(ctx, "cloudspider-camp-secret", 100);
  assert.match(out, /^cloud.*….*cret$/);
  assert.ok(ctx.measureText(out).width <= 100);
  const vpc = (w) => ({ x: 0, y: 0, w, label: "shared-services  10.0.0.0/16", gate: "igw" });
  const wide = gatePlace(ctx, vpc(700));
  assert.equal(wide.x, Math.round((700 - wide.w) / 2), "wide: centred");
  const mid = gatePlace(ctx, vpc(360));
  assert.ok(mid.label === "igw" && mid.x > 44 + 15 * 7.8, "mid: after the whole name");
  const narrow = gatePlace(ctx, vpc(260));
  assert.ok(!narrow || narrow.label === "", "narrow: icon only or nothing");
});

test("wide layout keeps the legend row clear of peering chips (both themes)", () => {
  const { placed } = sampleScene({ width: 1920, flow: true });
  const legendBottom = placed.region.y + 20 * 2 + 12 + 16 - 18; // header rows, before the reserved chip row
  for (const e of placed.regionEdges) assert.ok(e.chipY - 9 >= legendBottom, `${e.id} chip at ${e.chipY}`);
});

test("vault cells only reach the map in SAMPLE with doors=1; the real map keeps VAULTS as its own page", async () => {
  const { readFile } = await import("node:fs/promises");
  const browser = await readFile(new URL("../src/browser.js", import.meta.url), "utf8");
  assert.match(browser, /vaultMode: "page", \.\.\.\(sampleDoors\(\) \? \{ vaultMode: "doors" \} : \{\}\)/);
  assert.match(browser, /return sample && doorsAsked;/);
  assert.match(browser, /const doorsAsked = new URLSearchParams\(location\.hash[^\n]*get\("doors"\) === "1";/);
});
