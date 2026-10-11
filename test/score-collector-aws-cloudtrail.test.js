import assert from "node:assert/strict";
import test from "node:test";
import { awsCloudtrail } from "../src/score/collectors/aws-cloudtrail.js";
import { denied, fakeAws } from "./fixtures/fake-aws.js";

test("CloudTrail: logging, multi-region and management events per trail; denied is denied", async () => {
  const { clients } = fakeAws({
    DescribeTrailsCommand: () => ({ trailList: [{ Name: "org", TrailARN: "arn:t", IsMultiRegionTrail: true }] }),
    GetTrailStatusCommand: () => ({ IsLogging: true }),
    GetEventSelectorsCommand: () => ({ EventSelectors: [{ IncludeManagementEvents: true, ReadWriteType: "All" }] }),
  });
  assert.deepEqual((await awsCloudtrail.collect({ regions: ["eu-north-1"], clients })).fields.trails, [{ name: "org", arn: "arn:t", multiRegion: true, logging: true, management: true }]);
  const no = fakeAws({ DescribeTrailsCommand: denied });
  assert.equal((await awsCloudtrail.collect({ regions: ["eu-north-1"], clients: no.clients })).status, "denied");
});
