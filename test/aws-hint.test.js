import { test } from "node:test";
import assert from "node:assert/strict";
import { accountHint } from "../src/app.js";

const bad = "AWS was not able to validate the provided access credentials";
test("the AWS banner names exactly what to set", () => {
  assert.match(accountHint(bad, { AWS_PROFILE: "work", AWS_REGION: "eu-north-1" }), /AWS_PROFILE=work did not give working credentials.*AWS_PROFILE=default/);
  assert.match(accountHint(bad, { AWS_REGION: "eu-north-1" }), /No AWS_PROFILE is set.*AWS_PROFILE=default/);
  const keys = accountHint(bad, { AWS_ACCESS_KEY_ID: "AKIASECRETVALUE", AWS_PROFILE: "default", AWS_REGION: "eu-north-1" });
  assert.match(keys, /AWS_ACCESS_KEY_ID is set .*AWS_PROFILE=default is ignored/);
  assert.doesNotMatch(keys, /AKIASECRETVALUE/, "never prints a value");
  assert.match(accountHint("Region is missing", { AWS_PROFILE: "default" }), /AWS_REGION is not set/);
  assert.equal(accountHint("ThrottlingException", { AWS_PROFILE: "default", AWS_REGION: "eu-north-1" }), "Set AWS_PROFILE=default and AWS_REGION=eu-north-1.");
});
