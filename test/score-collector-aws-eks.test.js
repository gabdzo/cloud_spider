import assert from "node:assert/strict";
import test from "node:test";
import { awsEks } from "../src/score/collectors/aws-eks.js";
import { denied, fakeAws } from "./fixtures/fake-aws.js";

test("EKS: clusters with endpoint access, logging and node groups", async () => {
  const { clients, calls } = fakeAws({
    ListClustersCommand: () => ({ clusters: ["fresh"] }),
    DescribeClusterCommand: () => ({ cluster: { status: "ACTIVE", version: "1.33", resourcesVpcConfig: { endpointPublicAccess: true, publicAccessCidrs: ["0.0.0.0/0"] }, logging: { clusterLogging: [{ enabled: true, types: ["audit"] }, { enabled: false, types: ["api"] }] } } }),
    ListNodegroupsCommand: () => ({ nodegroups: ["ng"] }),
    DescribeNodegroupCommand: () => ({ nodegroup: { status: "ACTIVE", subnets: ["a", "b"], scalingConfig: { desiredSize: 2 }, capacityType: "ON_DEMAND" } }),
  });
  const rec = await awsEks.collect({ regions: ["eu-north-1"], clients });
  assert.equal(rec.status, "ok");
  assert.deepEqual(rec.fields.clusters[0], { name: "fresh", region: "eu-north-1", status: "ACTIVE", version: "1.33", endpointPublic: true, endpointPrivate: false, publicCidrs: ["0.0.0.0/0"], logging: ["audit"], nodegroups: [{ name: "ng", status: "ACTIVE", subnets: ["a", "b"], desired: 2, capacityType: "ON_DEMAND" }] });
  assert.ok(calls.every((c) => /^(List|Describe)/.test(c.name)));
});

test("EKS: a denied DescribeCluster makes the record denied and names that read", async () => {
  const { clients } = fakeAws({ ListClustersCommand: () => ({ clusters: ["fresh"] }), DescribeClusterCommand: denied });
  const rec = await awsEks.collect({ regions: ["eu-north-1"], clients });
  assert.deepEqual([rec.status, rec.read], ["denied", "eks:DescribeCluster"]);
});
