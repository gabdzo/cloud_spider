import assert from "node:assert/strict";
import test from "node:test";
import { awsNetwork } from "../src/score/collectors/aws-network.js";
import { denied, fakeAws } from "./fixtures/fake-aws.js";

const sg = (id, port, cidr) => ({ GroupId: id, GroupName: id, VpcId: "vpc-1", IpPermissions: [{ IpProtocol: "tcp", FromPort: port, ToPort: port, IpRanges: [{ CidrIp: cidr }] }] });

test("collects security groups from every region, following NextToken", async () => {
  const { clients, calls } = fakeAws({
    DescribeSecurityGroupsCommand: (input, region) =>
      region === "eu-north-1" && !input.NextToken ? { SecurityGroups: [sg("sg-1", 22, "0.0.0.0/0")], NextToken: "p2" } : { SecurityGroups: [sg(`sg-${region}`, 443, "10.0.0.0/8")] },
  });
  const rec = await awsNetwork.collect({ regions: ["eu-north-1", "eu-west-1"], clients });
  assert.equal(rec.status, "ok");
  assert.deepEqual(rec.fields.groups.map((g) => [g.id, g.region]), [["sg-1", "eu-north-1"], ["sg-eu-north-1", "eu-north-1"], ["sg-eu-west-1", "eu-west-1"]]);
  assert.deepEqual(rec.fields.groups[0].ingress[0], { protocol: "tcp", from: 22, to: 22, cidrs: ["0.0.0.0/0"], groupIds: [], prefixListIds: [], ipv6: [] });
  assert.ok(calls.every((c) => c.name === "DescribeSecurityGroupsCommand"), "read calls only");
});

test("a denied region makes the whole record denied", async () => {
  const { clients } = fakeAws({ DescribeSecurityGroupsCommand: (input, region) => (region === "eu-west-1" ? denied() : { SecurityGroups: [] }) });
  const rec = await awsNetwork.collect({ regions: ["eu-north-1", "eu-west-1"], clients });
  assert.equal(rec.status, "denied");
  assert.equal(rec.read, "ec2:DescribeSecurityGroups");
});
