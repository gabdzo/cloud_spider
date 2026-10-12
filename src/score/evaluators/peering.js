// NET-VPC-004..007: peering routes on both sides, no overlapping CIDRs, no
// default route through a peering, DNS resolution across peerings in use.
import { peeringItems } from "../../peering.js";

const run = (check) => ({ data }) => {
  const out = peeringItems(data["aws-peering"] || {}, check);
  return out.items.length || out.unknown?.length ? out : { notApplicable: "no VPC peering connection" };
};

export const peeringEvaluators = {
  "peering-routes-symmetric": run("symmetric"),
  "peering-no-overlap": run("overlap"),
  "peering-no-default-route": run("default"),
  "peering-dns-resolution": run("dns"),
};
