import { createAws } from "./aws.js";
import { createApp } from "./app.js";
import { listen } from "./server.js";

const port = Number(process.env.PORT || 9241);
const pageOrigin = `http://127.0.0.1:${port}`;
const aws = createAws();
const app = createApp({
  ec2: aws.ec2,
  trail: aws.trail,
  logs: aws.logs,
  logGroup: process.env.CLOUDSPIDER_LOG_GROUP || "",
  pageOrigin,
  clock: () => Date.now(),
  write(line) {
    process.stdout.write(line);
  },
});

let server;
try {
  server = await listen(app, port);
} catch (error) {
  process.stdout.write(`listen: ${error?.message || "the page failed"}\n`);
  process.exit(1);
}
process.stdout.write(`cloud spider ${pageOrigin}\n`);

setInterval(() => {
  app.poll().catch((error) => app.fail("DescribeInstances", error));
}, 1000);

setInterval(() => {
  app.refreshRadio(false).catch((error) => app.fail("LookupEvents", error));
}, 30_000);

server.on("error", (error) => app.fail("listen", error));
