// EKS clusters in every scanned region: status, version, endpoint access
// and public CIDRs, logging, and node groups (eks:List*/Describe*).
import { DescribeClusterCommand, DescribeNodegroupCommand, ListClustersCommand, ListNodegroupsCommand } from "@aws-sdk/client-eks";
import { awsFailure, evidence, pageAll, worst } from "../evidence.js";

export const awsEks = {
  key: "aws-eks",
  target: "aws",
  reads: ["eks:ListClusters", "eks:DescribeCluster", "eks:ListNodegroups", "eks:DescribeNodegroup"],
  async collect({ regions, clients }) {
    const clusters = [];
    const statuses = [];
    let error = null;
    let read = "eks:ListClusters";
    const note = (status, err, which) => {
      statuses.push(status);
      if (status !== "ok" && !error) {
        error = err || null;
        read = which;
      }
    };
    const one = async (send, which) => {
      try {
        return await send();
      } catch (failure) {
        const f = awsFailure(failure);
        note(f.status, f.error, which);
        return null;
      }
    };
    for (const region of regions) {
      const eks = clients.eks(region);
      const names = await pageAll(async (nextToken) => {
        const out = await eks.send(new ListClustersCommand({ nextToken }));
        return { items: out.clusters || [], next: out.nextToken };
      });
      note(names.status, names.error, "eks:ListClusters");
      for (const name of names.items) {
        const c = (await one(() => eks.send(new DescribeClusterCommand({ name })), "eks:DescribeCluster"))?.cluster;
        if (!c) continue;
        const groups = await pageAll(async (nextToken) => {
          const out = await eks.send(new ListNodegroupsCommand({ clusterName: name, nextToken }));
          return { items: out.nodegroups || [], next: out.nextToken };
        });
        note(groups.status, groups.error, "eks:ListNodegroups");
        const nodegroups = [];
        for (const ng of groups.items) {
          const g = (await one(() => eks.send(new DescribeNodegroupCommand({ clusterName: name, nodegroupName: ng })), "eks:DescribeNodegroup"))?.nodegroup;
          if (g) nodegroups.push({ name: ng, status: g.status || "", subnets: g.subnets || [], desired: g.scalingConfig?.desiredSize ?? null, capacityType: g.capacityType || "" });
        }
        const vpc = c.resourcesVpcConfig || {};
        clusters.push({
          name, region, status: c.status || "", version: c.version || "",
          endpointPublic: vpc.endpointPublicAccess === true, endpointPrivate: vpc.endpointPrivateAccess === true, publicCidrs: vpc.publicAccessCidrs || [],
          logging: (c.logging?.clusterLogging || []).filter((l) => l.enabled).flatMap((l) => l.types || []),
          nodegroups,
        });
      }
    }
    return evidence({ key: "aws-eks", collector: "aws-eks", read, target: "aws", status: worst(statuses), fields: { clusters }, error });
  },
};
