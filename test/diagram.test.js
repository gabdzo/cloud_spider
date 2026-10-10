import assert from "node:assert/strict";
import test from "node:test";
import { describeDiagram } from "../src/aws.js";

test("a failed diagram read is reused for 30 seconds", async () => {
  let built = 0;
  const boom = {
    async send() {
      throw new Error("denied");
    },
  };
  const region = `diagram-fail-${Date.now()}`;
  const factory = () => {
    built += 1;
    return { igw: boom, nat: boom, elb: boom, eks: boom };
  };
  const first = await describeDiagram(region, factory);
  const second = await describeDiagram(region, factory);
  assert.match(first.error, /denied/);
  assert.equal(second.error, first.error);
  assert.equal(built, 1);
});

test("RDS instances join the map as database pieces in their VPC, tagged for their vault", async () => {
  const { rdsFixture } = await import("../src/aws.js");
  const fixture = rdsFixture({
    DBInstanceArn: "arn:aws:rds:eu-north-1:550536272523:db:cloudspider-rds",
    DBInstanceIdentifier: "cloudspider-rds",
    DBInstanceStatus: "available",
    DBInstanceClass: "db.t4g.micro",
    Engine: "postgres",
    DBSubnetGroup: { VpcId: "vpc-0rds" },
    TagList: [{ Key: "project", Value: "rds" }, { Key: "managed-by", Value: "pulumi" }],
  });
  assert.deepEqual(fixture, {
    id: "arn:aws:rds:eu-north-1:550536272523:db:cloudspider-rds",
    vpcId: "vpc-0rds",
    kind: "rds",
    name: "cloudspider-rds",
    caption: "POSTGRES db.t4g.micro",
    status: "ok",
    state: "available",
    tags: { project: "rds", "managed-by": "pulumi" },
  });
  assert.equal(rdsFixture({ DBInstanceStatus: "creating" }).status, "unknown");
  assert.equal(rdsFixture({ DBInstanceStatus: "storage-full" }).status, "broken");
  const calls = [];
  const quiet = { async send(command) { calls.push(command.constructor.name); return {}; } };
  const pages = [{ DBInstances: [{ DBInstanceIdentifier: "a", DBInstanceStatus: "available" }], Marker: "m" }, { DBInstances: [{ DBInstanceIdentifier: "b", DBInstanceStatus: "available" }] }];
  const rds = { async send(command) { calls.push(command.constructor.name); return pages.shift(); } };
  const out = await describeDiagram(`diagram-rds-${Date.now()}`, () => ({ igw: quiet, nat: quiet, elb: quiet, eks: quiet, rds }));
  assert.deepEqual(out.fixtures.map((item) => item.name), ["a", "b"]);
  assert.equal(calls.filter((name) => name === "DescribeDBInstancesCommand").length, 2);
});
