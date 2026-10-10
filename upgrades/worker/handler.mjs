// The worker Lambda (index.mjs in the zip). One log line per job. A job whose
// body is {"fail": true} is reported as a batch item failure, so a test
// message can be sent to the dead-letter queue on purpose (SQS retries it
// maxReceiveCount = 3 times first).
export const handler = async (event) => {
  const failures = [];
  for (const record of event?.Records || []) {
    let job;
    try {
      job = JSON.parse(record.body);
    } catch {
      job = { text: record.body };
    }
    if (job && job.fail) {
      console.log(JSON.stringify({ level: "error", id: record.messageId, job }));
      failures.push({ itemIdentifier: record.messageId });
      continue;
    }
    console.log(JSON.stringify({ level: "info", id: record.messageId, job }));
  }
  return { batchItemFailures: failures };
};
