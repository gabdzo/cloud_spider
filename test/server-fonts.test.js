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
  assert.equal(FONT_FILES.size, 1);
});
