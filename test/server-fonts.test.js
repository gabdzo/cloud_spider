import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { FONT_FILES } from "../src/server.js";

test("the bundled font is served by name, with its OFL license beside it", async () => {
  assert.equal(FONT_FILES.get("fonts/ShareTechMono-Regular.woff2"), "font/woff2");
  const woff2 = await readFile(new URL("../src/fonts/ShareTechMono-Regular.woff2", import.meta.url));
  assert.equal(woff2.subarray(0, 4).toString("latin1"), "wOF2");
  const license = await readFile(new URL("../src/fonts/OFL-ShareTechMono.txt", import.meta.url), "utf8");
  assert.match(license, /SIL Open Font License, Version 1\.1/);
  assert.equal(FONT_FILES.size, 5);
});

test("the pro theme's Inter and JetBrains Mono ship as woff2 with their OFL licenses", async () => {
  for (const name of ["inter-latin-400-normal", "inter-latin-500-normal", "inter-latin-600-normal", "jetbrains-mono-latin-400-normal"]) {
    assert.equal(FONT_FILES.get(`fonts/${name}.woff2`), "font/woff2");
    const woff2 = await readFile(new URL(`../src/fonts/${name}.woff2`, import.meta.url));
    assert.equal(woff2.subarray(0, 4).toString("latin1"), "wOF2", name);
  }
  for (const license of ["OFL-Inter.txt", "OFL-JetBrainsMono.txt"]) {
    assert.match(await readFile(new URL(`../src/fonts/${license}`, import.meta.url), "utf8"), /SIL Open Font License, Version 1\.1/);
  }
});
