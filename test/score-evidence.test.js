import assert from "node:assert/strict";
import test from "node:test";
import { awsFailure, evidence, pageAll, worst } from "../src/score/evidence.js";

test("AccessDenied and 403 are denied; throttling and 500 are errors", () => {
  assert.equal(awsFailure({ name: "AccessDeniedException", message: "no" }).status, "denied");
  assert.equal(awsFailure({ name: "UnauthorizedOperation" }).status, "denied");
  assert.equal(awsFailure({ name: "Weird", $metadata: { httpStatusCode: 403 } }).status, "denied");
  assert.equal(awsFailure({ name: "ThrottlingException" }).status, "error");
  assert.deepEqual(awsFailure({ name: "InternalError", message: "boom" }).error, { code: "InternalError", message: "boom" });
});

test("pageAll follows tokens, stops at the page cap as truncated, and turns a throw into a status", async () => {
  const pages = [{ items: [1, 2], next: "a" }, { items: [3], next: undefined }];
  assert.deepEqual(await pageAll(async (t) => pages[t ? 1 : 0]), { status: "ok", items: [1, 2, 3] });
  const endless = await pageAll(async () => ({ items: [1], next: "again" }), { maxPages: 3 });
  assert.deepEqual(endless, { status: "truncated", items: [1, 1, 1] });
  const denied = await pageAll(async () => {
    throw Object.assign(new Error("nope"), { name: "AccessDenied" });
  });
  assert.equal(denied.status, "denied");
});

test("an evidence record refuses an unknown status, and worst() ranks denied above error above truncated", () => {
  assert.throws(() => evidence({ key: "k", status: "fine" }), /bad evidence status/);
  assert.equal(evidence({ key: "k", collector: "c", read: "r", target: "aws", status: "ok", at: "t" }).status, "ok");
  assert.equal(worst(["ok", "truncated", "error"]), "error");
  assert.equal(worst(["ok", "denied", "error"]), "denied");
  assert.equal(worst(["ok", "absent"]), "ok");
});
