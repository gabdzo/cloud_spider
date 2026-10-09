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
