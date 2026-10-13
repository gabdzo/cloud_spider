// The STACKS card's read-only preflight for EKS (upgrades/schema/preflight.js)
// with the AWS SDK: DescribeAvailabilityZones, DescribeInstanceTypeOfferings,
// DescribeVpcs. Runs as the first step of PREVIEW / RUN, before the stack is
// selected or created. If AWS cannot be read (no credentials, denied), it says
// so and lets Pulumi decide: the program runs the same checks itself.
import { DescribeAvailabilityZonesCommand, DescribeInstanceTypeOfferingsCommand, DescribeVpcsCommand } from "@aws-sdk/client-ec2";
import { EKS_ZONES, eksPreflight } from "../upgrades/schema/preflight.js";
import { nodeInstanceTypes } from "../upgrades/eks-addons.js";

export function createEksPreflight(ec2) {
  return async (spec, values) => {
    let read;
    try {
      const [zones, offers, vpcs] = await Promise.all([
        ec2.send(new DescribeAvailabilityZonesCommand({ AllAvailabilityZones: true })),
        ec2.send(new DescribeInstanceTypeOfferingsCommand({ LocationType: "availability-zone", Filters: [{ Name: "instance-type", Values: nodeInstanceTypes(values.instanceType, values.capacityType) }, { Name: "location", Values: EKS_ZONES }] })),
        ec2.send(new DescribeVpcsCommand({})),
      ]);
      read = {
        zones: (zones.AvailabilityZones || []).map((z) => ({ name: z.ZoneName, state: z.State })),
        offerings: (offers.InstanceTypeOfferings || []).map((o) => ({ type: o.InstanceType, zone: o.Location })),
        vpcCount: (vpcs.Vpcs || []).length,
      };
    } catch (failure) {
      return { lines: [`preflight skipped: AWS could not be read (${failure?.name || failure?.message || "error"}); the Pulumi program checks again`] };
    }
    const { problems, notes } = eksPreflight(values, read);
    if (problems.length) return { lines: notes, error: `preflight: ${problems.join("; ")}` };
    return { lines: [...notes, `preflight ok: ${EKS_ZONES.join(", ")} available, ${nodeInstanceTypes(values.instanceType, values.capacityType).join(", ")} offered`] };
  };
}
