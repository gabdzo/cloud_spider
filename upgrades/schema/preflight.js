// Read-only checks against the account before anything is made
// (docs/iac-robustness-plan.md item 6): are the zones there and available,
// are the node types (the whole spot pool) offered in them. Pure: the STACKS
// card (src/main.js, AWS SDK, before the stack exists) and upgrades/eks
// (provider invokes, during preview, before any resource) feed it what they
// read. Problems refuse; notes are said.
import { nodeInstanceTypes } from "../eks-addons.js";

import { eksZones } from "./net.js";

export const EKS_ZONES = eksZones("eu-north-1");
// The default per-region VPC quota; every EKS cluster stack makes one VPC.
export const VPC_QUOTA_DEFAULT = 5;

// zones: [{ name, state }]; offerings: [{ type, zone }]; vpcCount: number or null.
export function eksPreflight(values, { zones = [], offerings = [], vpcCount = null } = {}, wantZones = EKS_ZONES) {
  const problems = [];
  const notes = [];
  const state = Object.fromEntries(zones.map((z) => [z.name, z.state]));
  const down = wantZones.filter((z) => state[z] !== "available");
  if (down.length) problems.push(`zone ${down.join(", ")} is ${down.map((z) => state[z] || "not available (down, or not in this account/region)").join(", ")}: the EKS stack puts a subnet in each of ${wantZones.join(", ")}`);
  const types = nodeInstanceTypes(values.instanceType, values.capacityType);
  const offered = (type, zone) => offerings.some((o) => o.type === type && o.zone === zone);
  const [main, ...pool] = types;
  const missingMain = wantZones.filter((z) => !offered(main, z));
  if (missingMain.length) problems.push(`${main} is not offered in ${missingMain.join(", ")}: pick another instanceType`);
  for (const type of pool) {
    const missing = wantZones.filter((z) => !offered(type, z));
    if (missing.length) notes.push(`spot pool: ${type} is not offered in ${missing.join(", ")}; the pool still has ${types.filter((t) => t !== type).join(", ")}`);
  }
  if (vpcCount != null && vpcCount >= VPC_QUOTA_DEFAULT) notes.push(`${vpcCount} VPCs in this region; a new cluster makes one more and the default quota is ${VPC_QUOTA_DEFAULT} (VpcLimitExceeded unless it was raised)`);
  return { problems, notes };
}
