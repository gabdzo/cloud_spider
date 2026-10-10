# Plan: Stacks expansion, Learning, cloud-platform

Written 2026-10-10 for the 00:37 brief. Three threads, three PRs, none merged
by the agent. Each PR is based on the one before it (B on A, C on B) so they
can be reviewed in order. If one is merged, the next is rebased onto main.

| PR | Branch | Thread | What |
|---|---|---|---|
| A | `spider/stacks-expansion` | 1 | This plan; five new Pulumi stacks with vault templates and costs; the Terraform PoC with a read-only reader; cost on every card |
| B | `spider/learn` | 2 | The LEARN view (holotape picker), EX280 labs (OC) plus Kubernetes/EKS variants, progress, and the OpenShift-on-EC2 stack |
| C | `spider/cloud-platform` | 3 | cloud-platform folded in: labctl and its scenarios under `labs/cloud-platform`, the bug fixes, read-only Learn integration |

House rules that shape every choice below: no AWS writes by the agent
(Gabriel runs every `up`/`apply`), eu-north-1 only, colours from `theme.js`
only, every stack tagged `project=<vault>` so the vault claims it, the
cheapest settings that still teach the thing.

---

## Thread 1: Stacks

### New Pulumi stacks

Every stack is its own project and stack in the shared state bucket, tagged
by `inheritTags(pulumi, stackTags("<vault>"))`, with a vault template in
`vaults/templates/` (moved up to `vaults/` with `npm run vaults:new` once it
is up, like barrel and signal).

| Card | Stack | What it makes | Recommended choice and why |
|---|---|---|---|
| RDS Postgres | `upgrades/rds` | Own VPC 10.44/16 with two **private** subnets (no IGW, no NAT), SG 5432 from the VPC only, DB subnet group, PostgreSQL 16 `db.t4g.micro`, 20 GB gp3, single-AZ | `manageMasterUserPassword`: RDS makes the password and keeps it in Secrets Manager, so it is never in Pulumi config or state. No backups kept, no final snapshot, no deletion protection, so Take it down always works. No NAT: a NAT gateway alone is $33.58/month here, more than the database. |
| Postgres on EKS | `upgrades/pgcluster` | On the EKS cluster: EBS CSI driver add-on (role via Pod Identity), the Pod Identity agent, a gp3 StorageClass, the CloudNativePG operator (chart 0.29.1 / operator 1.30.1), namespace `shop` with a 1-instance `Cluster` `shopdb` (5 Gi) | **CloudNativePG** over a plain StatefulSet or Bitnami chart: it is the CNCF Postgres operator, writes the app credentials to the Secret `shopdb-app` (with a `uri` key), and its `Cluster` object teaches the operator pattern. The StorageClass tags every EBS volume `project=pgcluster`, so the vault claims the disk on the map. Needs `t4g.medium` on the EKS card: a t4g.small holds 11 pods and runs out. |
| Shop API | `upgrades/shopapi` | In `shop`: a migration Job (`postgres:16-alpine`, psql, SQL from a ConfigMap, named after the SQL's hash so a change re-runs it), PostgREST serving `GET /items`, a ClusterIP Service | **PostgREST** over a hand-written Node API: no image to build or push (no ECR, no CI), the schema *is* the API, and the migration Job is the interesting part. Reached with `kubectl port-forward`, so no load balancer ($17.48/month saved). |
| Static site | `upgrades/site` | Private bucket (public access blocked, owner-enforced), `index.html`, CloudFront with **origin access control**, bucket policy for that distribution only | OAC, not a public website bucket and not the legacy OAI. `PriceClass_100` (Europe/North America edges). |
| SQS worker | `upgrades/worker` | Queue + DLQ (3 tries), Node 22 arm64 Lambda (`handler.mjs`) with partial batch failures, log group kept 1 day | The handler fails a job whose body is `{"fail": true}`, so the DLQ can be shown on purpose. |

pgcluster and shopapi run on the cluster, so the Kubernetes objects show in
the **Cluster** view (namespaces `cnpg-system` and `shop`); the AWS parts
(add-ons, CSI role, EBS volume) carry the project tag and show on the map.
shopapi makes no AWS resources, so its vault binds it by `spec.stack`.

RDS mode for shopapi: put an RDS connection URI in a Secret named `shopdb-app`
(key `uri`) in `shop`, and shopapi uses it unchanged. The RDS stack lives in
its own VPC, so the cluster cannot reach it without peering; the PoC does
not make that peering (open question 4).

### Cost on every card

`src/stack-costs.js` holds the eu-north-1 on-demand prices, read from the AWS
Price List bulk files on 2026-10-10 (sources below). Each card lists its cost
lines; the card head shows $/hour, and the open card shows a three-counter
readout (hour, day, month of 730 h), each line, the usage-billed parts
("+ SQS requests") and what must be up first.

| Card | Engine | $/hour | $/day | $/month | Lines | Needs |
|---|---|---:|---:|---:|---|---|
| EKS (`eks`) | Pulumi | 0.1245 | 2.99 | 90.88 | EKS control plane; t4g.small; 20 GB EBS gp3; public IPv4 | – |
| Signal (`signal`) | Pulumi | 0 | 0 | 0 | + CloudWatch Logs ingested and stored | – |
| Barrel (`barrel`) | Pulumi | 0 | 0 | 0 | + S3 requests | – |
| Camp (`camp`) | Pulumi | 0.0005 | 0.01 | 0.40 | Secrets Manager secret; + Lambda; + S3 requests | – |
| RDS Postgres (`rds`) | Pulumi | 0.0198 | 0.48 | 14.48 | db.t4g.micro PostgreSQL single-AZ; 20 GB RDS gp3; Secrets Manager secret | – |
| Postgres on EKS (`pgcluster`) | Pulumi | 0.0006 | 0.01 | 0.42 | 5 GB EBS gp3 (+ $0.0172/h to move the node to t4g.medium) | eks |
| Shop API (`shopapi`) | Pulumi | 0 | 0 | 0 | nothing of its own | eks, pgcluster |
| Static site (`site`) | Pulumi | 0 | 0 | 0 | + CloudFront (free tier 1 TB); + S3 requests | – |
| SQS worker (`worker`) | Pulumi | 0 | 0 | 0 | + SQS (1M requests/month free); + Lambda; + Logs | – |
| RDS (Terraform) (`tf-rds`) | Terraform | 0.0198 | 0.48 | 14.48 | same as RDS | – |

The whole "database on EKS + API" demo costs the EKS line with a t4g.medium
node: $0.1417/h, $3.40/day, $103.44/month, plus 5 GB.

### Terraform proof of concept

```
terraform/
  modules/network          VPC with private subnets only (no IGW/NAT/public IPs)
  modules/rds-postgres     the same RDS settings as upgrades/rds
  stacks/rds               root: provider default_tags {project=tf-rds, managed-by=terraform}
    tests/rds.tftest.hcl   terraform test with mock_provider "aws" (no account needed)
```

- **State**: S3 backend in the same state bucket, key `terraform/rds.tfstate`,
  S3-native locking (`use_lockfile`), no DynamoDB table.
- **Tags**: provider `default_tags` give every resource `project=tf-rds`,
  `managed-by=terraform`, `cloudspider=expendable`; the vault
  `vaults/templates/tf-rds.yaml` selects `project: tf-rds`, the same way the
  Pulumi vaults select theirs.
- **In the Stacks view**: a TERRAFORM section under the Pulumi cards. A card
  shows the cost, the state (read with `terraform show -json` and
  `terraform output -json` only when `.terraform/` exists, cached 60 s,
  sensitive outputs hidden), and the init/plan/apply/destroy commands with
  COPY keys. Cloud Spider never runs init, plan, apply or destroy: the reader
  refuses any subcommand but `show`, `output` and `version`.
- **Checked here** (no credentials): `terraform init -backend=false`,
  `terraform validate`, `terraform fmt -check`, and `terraform test`
  (4 runs: the root plan, DB settings, private network, the two-zone guard).
  The npm test runs them on a temp copy when terraform is installed.

---

## Thread 2: Learning

### The LEARN view

A fourth view key on the console (next to RADIO/STACKS/ASK) opens a
holotape shelf: one pixel-art holotape per lab, labelled like the Pip-Boy
tapes, with a progress lamp (dark: not started, amber: started, red: last
check failed, green: check passed). Picking a tape "loads" it into the
player and shows the lab: task, requirements, setup commands, hints
(revealed one by one), the check and its PASS/FAIL lines.

- **Two tracks per lab**: `OpenShift (oc)` is the imported EX280 lab
  unchanged; `Kubernetes (EKS)` is the variant. Track keys at the top switch
  shelves, and every tape has an OPENSHIFT VERSION / K8S VERSION key to its twin.
- **Lab format** `labs/<track>/<lab>/lab.yaml`: `title`, `task`, `setup`
  (commands to copy), `hints[]`, `check` (a script), `reset`, `mapping`
  (what changed from OC) and `noEquivalent` notes. Spoilers (`answer/`) stay
  on disk and are not served.
- **Checks**: the app runs only the lab's `verify.sh`/`check.sh`, and only
  when a static scan of the script and every helper it calls (transitively)
  finds no write, exec, port-forward or install. Every K8s `check.sh` passes
  (they only `kubectl get`, `auth can-i` and `helm status`, which a test
  proves with a logging fake kubectl). OpenShift lab03, lab06, lab15 and
  mock02 `verify.sh` use `oc exec` (lab06 also rotates a secret), so they are
  shown as copy-only. Setup and reset commands are
  shown for Gabriel to run. Results are stored in `.learn/progress.json`
  (gitignored) and mirrored in localStorage.
- **Imported**: `openshift-ex280-labs` lab01–lab15, mock01–03 and `common/`;
  `exams/ex280/*.yaml`, **except `users.htpasswd`** (credentials).

### OC → Kubernetes mapping

| OpenShift | Kubernetes / EKS | Notes |
|---|---|---|
| `oc` | `kubectl` | `oc new-app`, `oc expose`, `oc set` become manifests or `kubectl create`/`set` |
| Project, `oc new-project` | Namespace | no project request template |
| Route (edge/passthrough/reencrypt) | Ingress (+ cert-manager / TLS Secret) | needs an ingress controller; passthrough/reencrypt have no core equivalent |
| SCC (`anyuid`, `restricted-v2`) | Pod Security Admission labels (`restricted`, `baseline`) | per namespace, not per service account: no direct equivalent of `oc adm policy add-scc-to-user` |
| htpasswd OAuth, users, groups | IAM + EKS access entries, `kubectl` impersonation | no in-cluster users; groups come from the access entry |
| DeploymentConfig | Deployment | |
| ImageStream | none | image tags only |
| OLM Operators (lab11) | Helm charts / EKS add-ons | **no direct equivalent** |
| Project templates, self-provisioner (lab13) | none (ResourceQuota/LimitRange per namespace by hand) | **no direct equivalent** |
| `oc adm must-gather`, `oc debug node` | `kubectl debug node/…` | partial |

### OpenShift on EC2: options and cost (eu-north-1, on-demand)

Prices from the AWS Price List for eu-north-1 on 2026-10-10. Disk is gp3 at
$0.0836/GB-month; a public IPv4 is $0.005/h. "Light use" is 2 h a day,
22 days a month, stopped otherwise.

| Option | $/hour | $/day (24 h) | $/month (730 h) | stopped $/month | light use $/month | Notes |
|---|---:|---:|---:|---:|---:|---|
| **A. OpenShift Local (CRC) on m7i-flex.2xlarge, nested virtualization (recommended)** | 0.426 | 10.22 | 311 | 10.03 | 28.16 | 8 vCPU/32 GiB, 120 GB. Full OCP 4.x single node, the same as the EX280 labs (apps-crc.testing) |
| B. CRC on m7i.2xlarge, nested virt | 0.447 | 10.73 | 326 | 10.03 | 29.10 | same, non-flex (steady CPU) |
| C. CRC on r7i.xlarge, nested virt | 0.300 | 7.20 | 219 | 10.03 | 22.63 | 4 vCPU/32 GiB: at CRC's 4-core minimum, slow |
| D. CRC on c5.metal (no nested virt) | 4.387 | 105.28 | 3202 | 10.03 | 202.44 | 96 vCPU/192 GiB; the fallback if CRC refuses to start nested |
| E. Single-node OpenShift by IPI on AWS (OKD, or OCP 60-day eval) on m6i.2xlarge | 0.558 | 13.39 | 407 | ~102 | ~120 | needs a public Route53 zone; makes a NAT gateway and 3 load balancers that bill while stopped; ~45 min install |
| F. MicroShift on m7i-flex.large | 0.110 | 2.64 | 80 | 2.51 | 7.21 | 2 vCPU/8 GiB; no OAuth/users, no OLM by default, no console, no project templates: most EX280 labs can't run |
| G. ROSA with hosted control planes, smallest (2 × m5.xlarge) | 1.125 | 26.99 | 821 | n/a (delete) | n/a | $0.25/h cluster fee + $0.171/h per 4 worker vCPU + EC2 + NAT; cannot be stopped |
| H. Red Hat Developer Sandbox | 0 | 0 | 0 | 0 | 0 | free, 30 days at a time, no cluster-admin: users, quotas, SCC labs fail |

**Recommendation: A.** OpenShift Local (CRC) on an m7i-flex.2xlarge with EC2
nested virtualization. It is the only option that runs the EX280 labs
unchanged (they were written on CRC 4.22, `apps-crc.testing`), it can be
stopped (then only the 120 GB disk bills, $10/month), and it is the cheapest
full OpenShift: about $0.43/h, $28/month at 2 h a day.

- Nested virtualization came to virtual EC2 instances on 2026-02-16 (C8i,
  M8i, R8i) and on 2026-06-18 to M7i, M7i-flex, C7i, C7i-flex, R7i, I7i and
  more, in all commercial regions, at no extra cost. eu-north-1 has m7i-flex
  but **no m8i** in the price list today, so m7i-flex it is.
- Risk: the CRC docs say "CRC does not support nested virtualization"
  (a support statement; KVM still sees VT-x). If `crc start` fails, the same
  stack takes `instanceType=c5.metal` (option D) with no other change.
- Launch: CentOS Stream 9 AMI (free; RHEL would add ~$0.12/h), 120 GB gp3,
  no inbound ports, reached through SSM Session Manager (port forwarding to
  the console and API), `cpuOptions.nestedVirtualization=enabled` (needs
  `@pulumi/aws` 7.50+, so the openshift stack pins `^7.50`).
- Gabriel brings his own **pull secret** from console.redhat.com and puts it
  on the instance himself; it is never in the repo, config or state.
- **Auto-stop**: an in-guest timer powers off after `maxHours` (default 4)
  with `instanceInitiatedShutdownBehavior=stop`; an EventBridge Scheduler
  rule stops it every night at 22:00 Europe/Prague; tagged
  `cloudspider=expendable` so the map's stop key works. Teardown is the
  card's Take it down (deletes the disk too).

Sources:
[AWS: nested virtualization on virtual instances, 2026-02-16](https://aws.amazon.com/about-aws/whats-new/2026/02/amazon-ec2-nested-virtualization-on-virtual/),
[AWS: more Intel platforms, 2026-06-18](https://aws.amazon.com/about-aws/whats-new/2026/06/nested-virtualization-intel-us-gov-cloud/),
[EC2 nested virtualization docs](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/amazon-ec2-nested-virtualization.html),
[CRC system requirements](https://crc.dev/docs/installing/),
[ROSA pricing](https://aws.amazon.com/rosa/pricing/),
AWS Price List bulk files for eu-north-1 (below).

---

## Thread 3: cloud-platform

### What is broken or unfinished

Its own tests pass (`uv run pytest`: 179 passed; scenario tests: 26 passed),
but it has never run end to end:

1. **The account structure it needs was never built.** A dedicated AWS
   Organization, a `labs-sandbox` account, SCPs, IAM Identity Center with a
   `cp-lab` SSO profile, and the `lab-solver-boundary` policy. The solver
   role trusts only `AWSReservedSSO_LabOperator_*`, so `labctl` cannot run in
   Gabriel's single account with `AWS_PROFILE=default`.
2. **The plans are untouched**: 0 of 105 checkboxes ticked in the
   superpowers plan docs.
3. **Region**: eu-central-1 is hardcoded (`scenario.yaml`,
   `Settings.home_region`); spider is eu-north-1.
4. **macOS only**: `scripts/lab-env.sh` reads credentials from the macOS
   keychain (`security`); there is no Linux path.
5. **The SCP design denies EKS and RDS**, which conflicts with the spider
   EKS/RDS stacks if the labs ever share the account.
6. **aws-smoke-001 check is too loose**: `validate.py` accepts `0.0.0.0/0`
   on tcp/8080 (it only blocks "world on all ports"), though the brief says
   "without opening the group to the world".
7. **aws-web-unreachable-001 inventory is unscoped**: `_inventory` lists
   VPCs, IGWs and EIPs account-wide, so any unrelated stack in a shared
   account trips the "no new network" guard.
8. **Its health check is strict**: it needs the operator's IP and the exact
   nonce body; fine in the org design, brittle in a single account.

### Plan

Import `labctl`, the scenarios and the tests into `labs/cloud-platform/`
(docs into `docs/cloud-platform/`); keep it in Python (it is tested and
works; a Node port buys nothing), and fix 3, 4, 6, 7 with a test for each:
`LAB_REGION` override (default eu-north-1), a Linux credential fallback, the
world guard on any port, and inventory scoped to the scenario's tags.
Items 1, 2, 5 and 8 are decisions for Gabriel (questions below). The LEARN
view lists the scenarios (brief only, no spoilers), reads `.lab/` run state
read-only, and shows the `labctl up/validate/down` commands to copy.

---

## Price sources

AWS Price List bulk CSVs, read 2026-10-10:
`https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<service>/current/eu-north-1/index.csv`
for AmazonEC2, AmazonRDS, AmazonEKS, AWSSecretsManager, AmazonS3, AWSELB,
AmazonVPC.

| Item | eu-north-1 price |
|---|---|
| EKS cluster | $0.10/h |
| t4g.micro / small / medium | $0.0086 / $0.0172 / $0.0344 per h |
| m7i-flex.large / xlarge / 2xlarge | $0.10175 / $0.2035 / $0.407 per h |
| m7i.2xlarge, r7i.xlarge, m6i.2xlarge, m5.xlarge | $0.4284, $0.2814, $0.408, $0.204 per h |
| c5.metal, c7i.metal-24xl, m5.metal | $4.368, $4.5864, $4.896 per h |
| RDS db.t4g.micro / small PostgreSQL single-AZ | $0.016 / $0.033 per h |
| RDS gp3 storage | $0.12/GB-month |
| EBS gp3 | $0.0836/GB-month |
| Secrets Manager | $0.40/secret-month |
| S3 Standard | $0.023/GB-month |
| Public IPv4 | $0.005/h |
| NAT gateway | $0.046/h |
| NLB / ALB / Classic LB | $0.02394 / $0.02394 / $0.0266 per h |

---

## Open questions for Gabriel

1. **Pull secret**: OK to keep it only on the instance (you copy it there
   over SSM), or would you rather it sat in Secrets Manager ($0.40/month)?
2. **cloud-platform account model**: adapt `labctl` to your single account
   (simpler, what PR C does by default), or build the separate Organization
   and sandbox account it was designed for?
3. **cloud-platform business/research docs** (`docs/business`, unit
   economics): bring them into spider, or leave them out?
4. **shopapi on RDS**: worth adding VPC peering (or putting RDS in the EKS
   VPC) so the API can switch to RDS, or is CNPG enough?
5. **PostgREST vs a small Node API** for the sample backend: PostgREST was
   chosen (no image build); say if you want code you can step through.
