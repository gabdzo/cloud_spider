import assert from "node:assert/strict";
import test from "node:test";
import { originAllowed } from "../src/origin.js";

const page = "http://127.0.0.1:8787";

test("allows the page origin", () => {
  assert.equal(originAllowed(page, page), true);
});

test("localhost on the same port is this page", () => {
  assert.equal(originAllowed("http://localhost:8787", page), true);
});

test("refuses a missing or foreign origin", () => {
  assert.equal(originAllowed(undefined, page), false);
  assert.equal(originAllowed("http://evil.example", page), false);
  assert.equal(originAllowed("http://127.0.0.1:9999", page), false);
});
