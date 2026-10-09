import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const project = readFileSync(new URL("../Pulumi.yaml", import.meta.url), "utf8");
const stack = readFileSync(new URL("../Pulumi.test.yaml", import.meta.url), "utf8");

test("the state backend is pinned to the eu-north-1 bucket", () => {
  assert.match(
    project,
    /s3:\/\/cloudspider-state-550536272523\?region=eu-north-1&awssdk=v2&profile=default/,
  );
});

test("the stack refuses every account except this one", () => {
  assert.match(stack, /aws:region: eu-north-1/);
  assert.match(stack, /aws:profile: default/);
  assert.match(stack, /550536272523/);
  assert.match(stack, /project: cloudspider/);
  assert.match(stack, /managed-by: pulumi/);
});
