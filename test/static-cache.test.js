// Page and modules: gzip when asked, an ETag, and a 304 on revalidation.
import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { gunzipSync } from "node:zlib";
import { createServer } from "../src/server.js";

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    request({ host: "127.0.0.1", port, path, headers }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on("error", reject).end();
  });
}

test("static: page and browser.js are gzipped on request, carry an ETag, and answer 304 when unchanged", async () => {
  const srv = createServer({ settings: () => ({ config: { ui: { theme: "pip" } } }) });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address();
  try {
    for (const path of ["/", "/browser.js"]) {
      const plain = await get(port, path);
      assert.equal(plain.status, 200);
      assert.equal(plain.headers["content-encoding"], undefined);
      assert.equal(plain.headers["cache-control"], "no-cache");
      const etag = plain.headers.etag;
      assert.match(etag, /^"[\w-]+"$/);
      const gz = await get(port, path, { "accept-encoding": "gzip, br" });
      assert.equal(gz.headers["content-encoding"], "gzip");
      assert.equal(gz.headers.etag, etag);
      assert.ok(gz.body.length < plain.body.length / 2, `${path}: ${gz.body.length} < ${plain.body.length}/2`);
      assert.deepEqual(gunzipSync(gz.body), plain.body);
      const again = await get(port, path, { "if-none-match": etag });
      assert.equal(again.status, 304);
      assert.equal(again.body.length, 0);
    }
  } finally {
    srv.close();
  }
});

test("static: a large JSON answer is gzipped only when the client asks", async () => {
  const srv = createServer({ settings: () => ({ config: { ui: { theme: "pip" }, pad: "x".repeat(5000) } }) });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const { port } = srv.address();
  try {
    const plain = await get(port, "/api/config");
    assert.equal(plain.headers["content-encoding"], undefined);
    const gz = await get(port, "/api/config", { "accept-encoding": "gzip" });
    assert.equal(gz.headers["content-encoding"], "gzip");
    assert.deepEqual(JSON.parse(gunzipSync(gz.body)), JSON.parse(plain.body));
  } finally {
    srv.close();
  }
});
