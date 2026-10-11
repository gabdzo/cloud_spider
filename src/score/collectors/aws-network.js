// Security groups in every scanned region (ec2:DescribeSecurityGroups).
import { DescribeSecurityGroupsCommand } from "@aws-sdk/client-ec2";
import { securityGroupFrom } from "../../aws-path.js";
import { evidence, pageAll, worst } from "../evidence.js";

export const awsNetwork = {
  key: "aws-network",
  target: "aws",
  reads: ["ec2:DescribeSecurityGroups"],
  async collect({ regions, clients }) {
    const groups = [];
    const statuses = [];
    let error = null;
    for (const region of regions) {
      const client = clients.ec2(region);
      const got = await pageAll(async (NextToken) => {
        const out = await client.send(new DescribeSecurityGroupsCommand({ NextToken }));
        return { items: out.SecurityGroups || [], next: out.NextToken };
      });
      statuses.push(got.status);
      error ||= got.error || null;
      for (const raw of got.items) groups.push({ ...securityGroupFrom(raw), region });
    }
    return evidence({ key: "aws-network", collector: "aws-network", read: "ec2:DescribeSecurityGroups", target: "aws", status: worst(statuses), fields: { groups }, error });
  },
};
