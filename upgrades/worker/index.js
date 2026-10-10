import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { fileURLToPath } from "node:url";
import { inheritTags, stackTags } from "../tags.js";

// An SQS worker: a queue, a dead-letter queue (a message that fails 3 times
// lands there), and a small Node Lambda that reads the queue in batches and
// logs each job. Its logs are kept 1 day. Stack: worker.
// Idle cost is $0: SQS (1M requests a month free) and Lambda are billed per
// use. Note that the event source mapping polls the queue: those empty
// receives count as SQS requests (well inside the free tier for one queue).
// Vault: vaults/templates/worker.yaml selects project=worker.
inheritTags(pulumi, stackTags("worker"));

const config = new pulumi.Config();
const name = config.get("name") || "cloudspider-worker";
if (!/^[a-z][a-z0-9-]{1,27}$/.test(name)) throw new Error("name must be a short lowercase name");

const tags = { Name: name, cloudspider: "expendable" };

const dead = new aws.sqs.Queue("dlq", { name: `${name}-dlq`, messageRetentionSeconds: 4 * 24 * 3600, tags });
const queue = new aws.sqs.Queue("jobs", {
  name: `${name}-jobs`,
  visibilityTimeoutSeconds: 60,
  messageRetentionSeconds: 24 * 3600,
  redrivePolicy: dead.arn.apply((arn) => JSON.stringify({ deadLetterTargetArn: arn, maxReceiveCount: 3 })),
  tags,
});

const logs = new aws.cloudwatch.LogGroup("worker", { name: `/aws/lambda/${name}`, retentionInDays: 1, tags });

const role = new aws.iam.Role("worker", {
  name: `${name}-role`,
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "lambda.amazonaws.com" }, Action: "sts:AssumeRole" }],
  }),
  tags,
});
new aws.iam.RolePolicyAttachment("worker-sqs", {
  role: role.name,
  policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaSQSQueueExecutionRole",
});


const fn = new aws.lambda.Function(
  "worker",
  {
    name,
    role: role.arn,
    runtime: "nodejs22.x",
    architectures: ["arm64"],
    handler: "index.handler",
    memorySize: 128,
    timeout: 30,
    code: new pulumi.asset.AssetArchive({ "index.mjs": new pulumi.asset.FileAsset(fileURLToPath(new URL("./handler.mjs", import.meta.url))) }),
    loggingConfig: { logFormat: "Text", logGroup: logs.name },
    tags,
  },
  { dependsOn: [logs] },
);

new aws.lambda.EventSourceMapping("worker", {
  eventSourceArn: queue.arn,
  functionName: fn.arn,
  batchSize: 10,
  functionResponseTypes: ["ReportBatchItemFailures"],
  tags,
});

export const queueUrl = queue.url;
export const deadLetterUrl = dead.url;
export const functionName = fn.name;
