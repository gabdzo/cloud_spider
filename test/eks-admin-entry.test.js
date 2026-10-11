import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Live test 2026-10-11: a cluster raised from the Stacks panel answered
// Unauthorized to its own deployer (the provider does not bootstrap the
// creator as admin), so every add-on, pgcluster and shopapi stack failed.
test("the EKS stack grants the deploying user cluster admin through an access entry", () => {
  const source = readFileSync(new URL("../upgrades/eks/index.js", import.meta.url), "utf8");
  assert.match(source, /new aws\.eks\.AccessEntry\("admin"/);
  assert.match(source, /AmazonEKSClusterAdminPolicy/);
  assert.match(source, /principalArn: me\.arn/);
  assert.doesNotMatch(source, /bootstrapClusterCreatorAdminPermissions:/);
});
