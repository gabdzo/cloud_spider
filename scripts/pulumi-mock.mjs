// Runs one Pulumi program under mocks (no AWS, no backend) and prints every
// resource it would register as JSON: [{ type, name, inputs, provider }].
// Used by the tests to check tags and names without `pulumi preview`.
//   node scripts/pulumi-mock.mjs <program dir> <project> <stack> ['{"proj:key":"value"}']
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const [dirArg, project, stack, configJson = "{}"] = process.argv.slice(2);
const dir = resolve(dirArg);
const pulumiEntry = join(dir, "node_modules", "@pulumi", "pulumi", "index.js");
if (!existsSync(pulumiEntry)) {
  console.error(`no node_modules in ${dir}: run npm ci there first`);
  process.exit(3);
}
process.env.PULUMI_CONFIG = configJson;
const pulumi = await import(pathToFileURL(pulumiEntry).href);
const created = [];
await pulumi.runtime.setMocks(
  {
    newResource(args) {
      created.push({ type: args.type, name: args.name, inputs: args.inputs, provider: args.provider ? String(args.provider).replace(/::[^:]*$/, "") : "" });
      return { id: `${args.name}-id`, state: { arn: `arn:aws:mock:::${args.name}`, privateIp: `${args.name}-ip`, ...args.inputs } };
    },
    call(args) {
      const token = String(args.token);
      if (token.includes("getCallerIdentity")) return { accountId: "550536272523", arn: "arn:aws:iam::550536272523:user/mock", userId: "mock" };
      if (token.includes("getParameter")) return { value: "ami-test", name: args.inputs?.name, type: "String" };
      return args.inputs ?? {};
    },
  },
  project,
  stack,
  false,
);
// Inside a root stack, as `pulumi up` runs it, so stack transformations apply.
await pulumi.runtime.runInPulumiStack(() => import(pathToFileURL(join(dir, "index.js")).href));
for (let seen = -1, quiet = 0; quiet < 8; ) {
  quiet = seen === created.length ? quiet + 1 : 0;
  seen = created.length;
  await new Promise((done) => setTimeout(done, 40));
}
// A resource passed as an input shows up as the whole object: name it instead.
const plain = (value) => {
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    if (value.__pulumiResource) return `<${value.__pulumiType}::${value.__name}>`;
    return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, plain(inner)]));
  }
  return value;
};
for (const item of created) item.inputs = plain(item.inputs);
created.sort((a, b) => `${a.type}|${a.name}`.localeCompare(`${b.type}|${b.name}`));
process.stdout.write(JSON.stringify(created));
process.exit(0);
