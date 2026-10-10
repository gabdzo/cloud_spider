import { execFileSync } from "node:child_process";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createAws } from "../src/aws.js";
import { createPathAws } from "../src/aws-path.js";
import { readPath } from "../src/path-read.js";
import { pathResult } from "../src/path-view.js";

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

const region = "eu-north-1";
const aws = createAws();
const failures = [];

function check(label, ok) {
  if (!ok) failures.push(label);
}

const vpcs = await every(aws.ec2.describeVpcs);
const subnets = await every(aws.ec2.describeSubnets);
const instances = await every(aws.ec2.describeInstances);
const byId = new Map(instances.map((instance) => [instance.id, instance]));

check("test VPC 10.42.0.0/16 is present", vpcs.some((vpc) => vpc.cidr === "10.42.0.0/16"));
check("default VPC is still present", vpcs.some((vpc) => vpc.cidr === "172.31.0.0/16"));

const empty = subnets.find((subnet) => subnet.cidr === "10.42.2.0/24");
check("empty subnet 10.42.2.0/24 exists", Boolean(empty));
check(
  "subnet b has no instances",
  Boolean(empty) && instances.every((instance) => instance.subnetId !== empty.id),
);

const running = byId.get(outputs.runningId);
const stopped = byId.get(outputs.stoppedId);
const untagged = byId.get(outputs.untaggedId);

check("tagged running instance is running", running?.state === "running");
check("tagged running instance is expendable", tagged(running));
check("tagged running instance has a name", Boolean(running?.name));
check("tagged stopped instance is stopped", stopped?.state === "stopped");
check("tagged stopped instance is expendable", tagged(stopped));
check("untagged instance is stopped", untagged?.state === "stopped");
check("untagged instance has no expendable tag", untagged && !tagged(untagged));
check("untagged instance has no name", untagged && !untagged.name);

for (const id of [outputs.runningId, outputs.stoppedId]) {
  const read = await aws.logs.filter({
    region,
    group: outputs.logGroupName,
    stream: id,
    limit: 50,
  });
  check(`stream ${id} has 25 events`, !read.error && !read.missing && read.events?.length === 25);
}
const missing = await aws.logs.filter({
  region,
  group: outputs.logGroupName,
  stream: outputs.untaggedId,
  limit: 20,
});
check("untagged instance has no log stream", missing.missing === true);

if (outputs.loadBalancerName) {
  const read = await readPath(createPathAws(), region);
  check(`the path reads the region (${read.call})`, !read.error);
  if (!read.error) {
    const api = pathResult(read.graph, { region, host: "api.cloudspider.test" });
    check(`${outputs.loadBalancerName} is in the load balancer menu`, api.loadBalancers.some((lb) => lb.name === outputs.loadBalancerName));
    check(`api.cloudspider.test names the refused 8080: ${api.headline}`, /does not allow tcp 8080 from/.test(api.headline));
    const web = pathResult(read.graph, { region, host: "web.cloudspider.test" });
    check(`web.cloudspider.test names the empty group: ${web.headline}`, /cloudspider-web-ip has no registered targets/.test(web.headline));
  }
}

if (failures.length) {
  console.error(failures.map((line) => `FAIL ${line}`).join("\n"));
  process.exit(1);
}
console.log("live check passed");

function tagged(instance) {
  return (instance?.tags || []).some((tag) => tag.key === "cloudspider" && tag.value === "expendable");
}

async function every(read) {
  const items = [];
  let token;
  do {
    const page = await read(region, token);
    if (page.error) throw new Error(page.error);
    items.push(...page.items);
    token = page.nextToken;
  } while (token);
  return items;
}
