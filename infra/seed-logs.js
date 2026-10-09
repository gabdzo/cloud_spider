import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CloudWatchLogsClient,
  DescribeLogStreamsCommand,
  PutLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

const dir = dirname(fileURLToPath(import.meta.url));
const outputs = JSON.parse(
  execFileSync("pulumi", ["stack", "output", "--json", "--stack", "test"], {
    cwd: dir,
    encoding: "utf8",
    env: {
      ...process.env,
      AWS_PROFILE: "default",
      AWS_REGION: "eu-north-1",
      PULUMI_CONFIG_PASSPHRASE: process.env.PULUMI_CONFIG_PASSPHRASE ?? "",
    },
  }),
);

const events = Array.from({ length: 25 }, (_, index) => {
  const n = index + 1;
  let message = `seed line ${n}`;
  if (n === 24) message = "seed line 24\nhas a break";
  if (n === 25) message = "seed line 25\talso\nwrapped";
  return { timestamp: Date.now() - (25 - index) * 1000, message };
});

const client = new CloudWatchLogsClient({ region: "eu-north-1" });

for (const id of [outputs.runningId, outputs.stoppedId]) {
  const described = await client.send(
    new DescribeLogStreamsCommand({
      logGroupName: outputs.logGroupName,
      logStreamNamePrefix: id,
    }),
  );
  const stream = (described.logStreams || []).find((item) => item.logStreamName === id);
  if (!stream) throw new Error(`log stream missing: ${id}`);
  // storedBytes stays 0 right after a write. lastEventTimestamp is what ingestion sets.
  if (stream.lastEventTimestamp) {
    console.log(`${id}: already seeded`);
    continue;
  }
  await put(client, outputs.logGroupName, id, events);
  console.log(`${id}: wrote 25 lines`);
}

async function put(logs, group, stream, logEvents) {
  try {
    await logs.send(
      new PutLogEventsCommand({
        logGroupName: group,
        logStreamName: stream,
        logEvents,
      }),
    );
  } catch (error) {
    const expected = String(error?.message || "").match(/sequenceToken is: (\S+)/)?.[1];
    if (!expected) throw error;
    await logs.send(
      new PutLogEventsCommand({
        logGroupName: group,
        logStreamName: stream,
        logEvents,
        sequenceToken: expected,
      }),
    );
  }
}
