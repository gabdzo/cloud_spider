import assert from "node:assert/strict";
import test from "node:test";
import { awsRds } from "../src/score/collectors/aws-rds.js";
import { fakeAws } from "./fixtures/fake-aws.js";

test("RDS: minimised instances, paged", async () => {
  const pages = { undefined: { DBInstances: [{ DBInstanceIdentifier: "a", PubliclyAccessible: true, MultiAZ: false, StorageEncrypted: true, BackupRetentionPeriod: 1, Endpoint: { Port: 5432 }, VpcSecurityGroups: [{ VpcSecurityGroupId: "sg-1" }], MasterUsername: "admin" }], Marker: "m" }, m: { DBInstances: [{ DBInstanceIdentifier: "b" }] } };
  const { clients } = fakeAws({ DescribeDBInstancesCommand: (input) => pages[input.Marker] });
  const rec = await awsRds.collect({ regions: ["eu-north-1"], clients });
  assert.deepEqual(rec.fields.instances.map((i) => i.id), ["a", "b"]);
  assert.equal(JSON.stringify(rec).includes("admin"), false);
  assert.deepEqual(rec.fields.instances[0].securityGroups, ["sg-1"]);
});
