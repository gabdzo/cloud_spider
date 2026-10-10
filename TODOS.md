# TODOS

## Deferred from CEO review (2026-10-09)

- Second cloud provider. One more provider, not every cloud. Copy the AWS region switch once the AWS place feels right. Not in the first slice. See `~/.gstack/projects/cloud_spider/ceo-plans/2026-10-09-cloud-spider.md`.

## Deferred from eng review of the Pulumi test stack (2026-10-09)

- Account budget alert at $10/month, emailed to you.
  - Why: a forgotten test stack costs about $5/month. The simplified account's spend limit goes away if advanced features are ever activated.
  - Pros: catches a forgotten `pulumi destroy` or a mistake before the bill does.
  - Cons: unprobed. AWS Budgets may be denied by SCP `p-1fsyi3oa` or by simplified mode. Probe it first.
  - Context: kept out of `infra/` because a budget covers the whole account, not the stack. Start with `aws budgets create-budget` in us-east-1 (Budgets is global).
  - Depends on: nothing. Most useful once the Pulumi test stack exists.

## Later picture ideas (2026-10-10)

- Small pixel-art fires on broken diagram nodes, broken path threads, and a broken load balancer or cluster drawn in its VPC. Built. The campfire sprite sits on top of the existing broken color.
- The map reads as an architecture diagram of this region. A settlement stays a VPC. A plot stays a subnet, labeled with its name, CIDR, and public or private. An availability zone is the column. A gate on the wall is the internet gateway, or NAT when there is no internet gateway. An instance keeps its name. A load balancer and an EKS cluster that live in that VPC are drawn inside it, and Path and Cluster still exist. The bill and the trail sit together in the top-right corner. Account-wide things with no place, such as IAM, stay off the map. A security group is still the sentence on a Path node, not a note drawn on the link.
