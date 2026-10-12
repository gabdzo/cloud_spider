import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:https";
import { gzipSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { httpsGet } from "../src/kube.js";

test("httpsGet asks for gzip and filters the inflated body line by line", async (t) => {
  const d = mkdtempSync(join(tmpdir(), "gz-"));
  try { execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", join(d, "k"), "-out", join(d, "c"), "-days", "1", "-subj", "/CN=localhost"], { stdio: "ignore" }); } catch { t.skip("no openssl"); return; }
  const page = Array.from({ length: 20000 }, (_, i) => (i % 2 ? `keep_me{i="${i}"} 1` : `drop_me{i="${i}"} 1`)).join("\n");
  let enc = "";
  const srv = createServer({ key: readFileSync(join(d, "k")), cert: readFileSync(join(d, "c")) }, (req, res) => {
    enc = req.headers["accept-encoding"] || "";
    res.writeHead(200, { "content-encoding": "gzip" }); res.end(gzipSync(page));
  });
  await new Promise((r) => srv.listen(0, "127.0.0.1", r));
  const got = await httpsGet(`https://127.0.0.1:${srv.address().port}/m`, { ca: readFileSync(join(d, "c"), "utf8"), servername: "localhost", token: "x", keepLine: (l) => l.startsWith("keep_me") });
  srv.close();
  assert.match(enc, /gzip/);
  assert.equal(got.status, 200);
  assert.equal(got.body.split("\n").filter(Boolean).length, 10000);
  assert.ok(!got.body.includes("drop_me"));
});
