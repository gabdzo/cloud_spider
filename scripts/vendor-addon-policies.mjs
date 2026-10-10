// Re-vendors the IAM policies the cluster add-ons need, from the upstream
// release tags pinned in upgrades/addons/catalog.js:
//   - Karpenter: the controller's managed policies from its getting-started
//     CloudFormation template, with ${...} placeholders kept for the program
//   - AWS Load Balancer Controller: docs/install/iam_policy.json
// Run by hand when a version moves: node scripts/vendor-addon-policies.mjs
// (network; nothing else touches AWS).
import { writeFileSync } from "node:fs";
import { parse } from "yaml";
import { ADDONS } from "../upgrades/addons/catalog.js";

const dir = new URL("../upgrades/addons/policies/", import.meta.url);
const karpenter = ADDONS.find((item) => item.id === "karpenter");
const lbc = ADDONS.find((item) => item.id === "lbc");
const get = async (url) => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return response.text();
};

const cfn = await get(`https://raw.githubusercontent.com/aws/karpenter-provider-aws/v${karpenter.chartVersion}/website/content/en/docs/getting-started/getting-started-with-karpenter/cloudformation.yaml`);
const tags = ["Sub", "GetAtt", "Ref"].map((tag) => ({ tag: `!${tag}`, resolve: (value) => value }));
const template = parse(cfn, { customTags: tags });
const policies = {};
for (const [name, resource] of Object.entries(template.Resources)) {
  if (resource.Type !== "AWS::IAM::ManagedPolicy") continue;
  const doc = JSON.parse(resource.Properties.PolicyDocument);
  policies[name] = doc;
}
writeFileSync(new URL("karpenter-controller.json", dir), `${JSON.stringify({ source: `karpenter-provider-aws v${karpenter.chartVersion} cloudformation.yaml`, policies }, null, 2)}\n`);

const lbcPolicy = JSON.parse(await get(`https://raw.githubusercontent.com/kubernetes-sigs/aws-load-balancer-controller/v${lbc.chartVersion}/docs/install/iam_policy.json`));
writeFileSync(new URL("lbc.json", dir), `${JSON.stringify(lbcPolicy, null, 2)}\n`);
console.log(Object.keys(policies).join(", "), "+ lbc");
