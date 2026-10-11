import assert from "node:assert/strict";
import test from "node:test";
import { awsObservability } from "../src/score/collectors/aws-observability.js";
import { denied, fakeAws } from "./fixtures/fake-aws.js";

test("observability: alarms and log groups as two records", async () => {
  const { clients } = fakeAws({
    DescribeAlarmsCommand: () => ({ MetricAlarms: [{ AlarmName: "5xx", MetricName: "HTTPCode_ELB_5XX_Count", Namespace: "AWS/ApplicationELB", Dimensions: [{ Name: "LoadBalancer", Value: "app/shop/abc" }], AlarmActions: ["arn:sns"] }] }),
    DescribeLogGroupsCommand: denied,
  });
  const [alarms, logs] = await awsObservability.collect({ regions: ["eu-north-1"], clients });
  assert.deepEqual(alarms.fields.alarms[0], { name: "5xx", region: "eu-north-1", metric: "HTTPCode_ELB_5XX_Count", namespace: "AWS/ApplicationELB", dimensions: { LoadBalancer: "app/shop/abc" }, actions: 1 });
  assert.equal(logs.status, "denied");
});
