import assert from "node:assert/strict";
import test from "node:test";
import { report } from "../src/report.js";

test("stdout matches the page sentence and names the call and id", () => {
  const lines = [];
  const sentence = report(lines, {
    call: "StopInstances",
    id: "i-0abc1234",
    sentence: "the stop did not happen",
  });
  assert.equal(sentence, "the stop did not happen");
  assert.equal(lines[0], "StopInstances i-0abc1234: the stop did not happen");
});

test("stdout omits credentials and request bodies", () => {
  const lines = [];
  report(lines, {
    call: "DescribeInstances",
    id: "i-0abc1234",
    sentence: "the stop did not happen",
    detail: {
      message: "blocked",
      secretAccessKey: "wJalrXUtnFEMI",
      body: "AKIAIOSFODNN7EXAMPLE",
    },
  });
  const text = lines.join("\n");
  assert.match(text, /blocked/);
  assert.equal(text.includes("wJalrXUtnFEMI"), false);
  assert.equal(text.includes("AKIAIOSFODNN7EXAMPLE"), false);
});
