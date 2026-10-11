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
      // A read (Resource.get) or an import carries an id. CLOUDSPIDER_MOCK_K8S_MISSING
      // (["<type>:<id>"]) makes such a read fail as a missing object would.
      if (args.id && JSON.parse(process.env.CLOUDSPIDER_MOCK_K8S_MISSING || "[]").includes(`${args.type}:${args.id}`)) {
        const missing = new Error(`resource '${args.id}' does not exist`);
        missing.details = missing.message;
        throw missing;
      }
      created.push({ type: args.type, name: args.name, inputs: args.inputs, provider: args.provider ? String(args.provider).replace(/::[^:]*$/, "") : "", ...(args.id ? { id: args.id } : {}) });
      // What AWS fills in on a new EKS cluster (upgrades/eks builds its own
      // kubeconfig from these).
      const cluster = args.type === "aws:eks/cluster:Cluster" ? { endpoint: "https://mock.eks", certificateAuthority: { data: "bW9jaw==" }, version: args.inputs.version } : {};
      return { id: `${args.name}-id`, state: { arn: `arn:aws:mock:::${args.name}`, privateIp: `${args.name}-ip`, ...cluster, ...args.inputs } };
    },
    call(args) {
      const token = String(args.token);
      if (token.includes("getCallerIdentity")) return { accountId: "550536272523", arn: "arn:aws:iam::550536272523:user/mock", userId: "mock" };
      if (token.includes("getParameter")) return { value: "ami-test", name: args.inputs?.name, type: "String" };
      if (token.includes("eks/getCluster")) return { name: args.inputs?.name, endpoint: "https://mock.eks", certificateAuthorities: [{ data: "bW9jaw==" }], arn: `arn:aws:eks:eu-north-1:550536272523:cluster/${args.inputs?.name}`, vpcConfig: { vpcId: "vpc-mock", subnetIds: ["subnet-a", "subnet-b"], clusterSecurityGroupId: "sg-cluster" } };
      // A mock subnet's zone is its id's last letter: subnet-a is in eu-north-1a.
      if (token.includes("ec2/getSubnet")) return { id: args.inputs?.id, availabilityZone: `eu-north-1${String(args.inputs?.id).slice(-1)}`, vpcId: "vpc-mock" };
      // EKS add-ons on the mock cluster: CLOUDSPIDER_MOCK_EKS_ADDONS is
      // {"<addonName>": {"project": "<tag>"}}; any other add-on is absent.
      if (token.includes("eks/getAddon")) {
        // Unset: a cluster as the EKS stack makes it, its three add-ons tagged project=eks.
        const fallback = '{"eks-pod-identity-agent":{"project":"eks"},"metrics-server":{"project":"eks"},"aws-ebs-csi-driver":{"project":"eks"}}';
        const on = JSON.parse(process.env.CLOUDSPIDER_MOCK_EKS_ADDONS || fallback)[args.inputs?.addonName];
        if (!on) {
          // The mock monitor hands the program err.details, as gRPC would.
          const missing = new Error(`reading EKS Add-On (${args.inputs?.clusterName}:${args.inputs?.addonName}): couldn't find resource`);
          missing.details = missing.message;
          throw missing;
        }
        return { ...args.inputs, addonVersion: "v1-mock", tags: on.tags || (on.project ? { project: on.project } : {}), ...(on.configurationValues ? { configurationValues: on.configurationValues } : {}) };
      }
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
