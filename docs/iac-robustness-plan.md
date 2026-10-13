# IaC robustness plan: upgrades/ to Terraform-module grade

Audit date: 2026-10-13. Scope: every Pulumi program under `upgrades/` (eks, addons,
observe, observability, shopapi, demo, pgcluster, rds, openshift, camp, site, signal,
barrel, worker) plus the shared files (`eks-addons.js`, `eks-kube.js`, `netpol.js`,
`tags.js`) and the app side that creates/runs stacks (`src/upgrade.js`).

Trigger: 2026-10-13 a new small cluster with SPOT + maxPods `auto` failed. The card
(`src/upgrade.js` checkParams) accepted it, created the stack, and only then
`upgrades/eks/index.js` threw in preview. #331 patched that one rule by hand in two
places. The general fix: **one schema per stack, shared by the card and the program**,
so the card refuses exactly what the program refuses, before any stack exists.

## What the audit found

| Area | State today | Terraform-module equivalent |
|---|---|---|
| Input validation | Ad hoc `config.get` + scattered `throw`s. eks validates instanceType/nodeCount/maxPods/capacity; clusterName unchecked in the program (card caps it at 28 chars, a hand-run `pulumi up` does not); unknown/typo'd keys silently ignored in every stack; shopapi/observe/pgcluster/observability read keys with no type check | `variable {type, validation}` on every input, unknown vars are errors |
| Card vs program rules | Two copies (`checkParams` + `spec.check` vs program throws); drift caused the 10-13 failure | one module, one source of truth |
| Fail-fast | eks mostly validates first, but `ownAddon` reads AWS before the node group and some checks happen after resources are declared in addons/pgcluster | `terraform validate`/`plan` fails before apply |
| Region/AZ | `eu-north-1a/b` hardcoded in eks, karpenter, rds, openshift; no check that the zones or instance types exist in the region | `data.aws_availability_zones`, `aws_ec2_instance_type_offerings` |
| CIDR | eks VPC `10.43.0.0/16` hardcoded, subnets hand-written; no overlap check vs other stacks (demo/openshift/rds VPCs) | `cidrsubnet()`, validation blocks |
| Versions | `@pulumi/pulumi` pinned 3.268.0, but `@pulumi/aws` is `^6.66` in 12 stacks and `^7.50` in addons/openshift (two majors in one repo); `@pulumi/kubernetes ^4.18`; no `plugins:`/`requiredPulumiVersion` in Pulumi.yaml; Helm charts are pinned (addons/catalog.js `chartVersion`, pgcluster CNPG) — good; EKS 1.32 hardcoded | `required_providers` + `.terraform.lock.hcl` |
| Lockfiles | package-lock.json per stack (good) but `npm install` is not enforced (`npm ci` only in docs) | lockfile committed and enforced |
| Modules | No ComponentResources; each stack is one flat program; eks VPC/IAM/nodegroup logic not reusable; inputs documented only in comments | reusable modules with `variables.tf`/`outputs.tf`/README |
| Data safety | **No `protect` anywhere.** rds says "Take it down deletes it, data included"; pgcluster PVCs/S3 backups, observability log groups, EKS cluster itself unprotected. `retainOnDelete` only for legacy EKS add-ons | `prevent_destroy`, `deletion_protection` |
| Ordering | eks has explicit `dependsOn` for cluster/nodegroup/addons; addons/observe rely on implicit ordering for CRDs → CRs (Kyverno policies, Karpenter NodePool) | `depends_on` |
| Timeouts | eks cluster/nodegroup 40m. None on Helm releases (default 5m, Karpenter/Kyverno often slower on a cold node), RDS (default fine), ALB | `timeouts {}` |
| Idempotency / partial failure | `pulumi up` is resumable, but the app has no "pending operations" handling: an interrupted run leaves `pending_operations` and the next run fails until `pulumi cancel`/`refresh`; the observe ConfigMap "already exists" (#324) was one such class | state is idempotent; `terraform apply` re-plans |
| Policy-as-code | None. Kyverno policies exist for the cluster, nothing for the IaC itself (no cost cap, no "no public RDS", no required tags) | Sentinel/OPA/checkov/tfsec |
| Tests | Good start: `scripts/pulumi-mock.mjs` runs a program under mocks; ~30 tests use it (eks spot, scanner RBAC, observe). But they skip silently when a stack's `node_modules` is missing (fc.sh only installs root + addons), so eks/observe mock tests may never run in the gate | `terraform test`, terratest |
| Preview in CI | No `.github/workflows` at all; previews only by hand | plan per env in CI |
| Docs/versioning | Per-stack notes live in `src/upgrade.js` card text and comments; no per-module README, version, or CHANGELOG | module README, semver tags, CHANGELOG |
| Audit trail | The app writes `audit.jsonl` for netdebug pods and EKS scale, but **not for stack PREVIEW/RUN/destroy** (who, which stack, config, result, duration) | TFC run history |

## Ranked plan (impact first)

1. **Shared typed config schema per stack, used by card AND program** (high impact,
   prevents the 10-13 class). `upgrades/schema/` (dependency-free, so the app and
   every stack import it by relative path like `eks-addons.js` already is; zod was
   considered but would add a dependency to 14 lockfiles and the app for what is
   ~100 lines). Each schema: typed keys (enum / int range / name pattern / bool
   on-off), defaults, **cross-field rules** (instanceType × maxPods × prefix
   delegation × capacityType; clusterName length vs IAM role names), **unknown key =
   error with a did-you-mean**. `checkParams` runs it before a stack is created;
   the program runs it as its first statement, before any resource. Test case #1:
   SPOT + maxPods auto (+ prefixDelegation off). A property test walks the full
   choice cross-product and asserts card and program agree. **Start: eks; then
   shopapi, observe, pgcluster, addons, observability, the rest.**
2. **Mocks harness that actually runs in the gate** (high). Keep
   `scripts/pulumi-mock.mjs`; add a helper that reports when a stack's
   node_modules are missing and make fc.sh/CI install every stack that has mock
   tests, so a skipped test is visible, not a silent pass. Per stack: one
   "default config registers N resources, nothing before validation" test and one
   "bad config throws before any resource" test.
3. **Data protection** (high, low effort). `protect: true` (config-overridable for
   lab teardown via an explicit `allowDestroy` key) on: rds instance, pgcluster
   PVC/backup bucket, observability log groups with retention, the EKS cluster
   itself. `retainOnDelete` on S3 backup buckets. `deletionProtection` on RDS when
   not expendable. The app's take-it-down flow then has to unprotect explicitly
   (audited).
4. **Pinned versions + lockfile discipline** (high). Exact versions for
   `@pulumi/aws` (one major across the repo; addons/openshift on 7, the rest on 6
   today: pin each exactly first, unify later), `@pulumi/kubernetes`;
   `requiredPulumiVersion` and provider `plugins` pins in Pulumi.yaml; every Helm
   chart `version` pinned in one table; EKS version a validated config key, not a
   literal. A test asserts no `^`/`~` in any stack's dependencies.
5. **Stack-run audit** (high for an SRE tool). Every PREVIEW/RUN/destroy/cancel
   appends to `audit.jsonl`: stack, project, action, validated config (secrets
   redacted), git sha, start/end, result, resource change counts.
6. **Fail-fast live preflight** (medium-high). Before `up`, a read-only preflight:
   AZs exist and are `available` in the region, instance types offered in those AZs
   (`ec2:DescribeInstanceTypeOfferings`), spot pool types offered, quotas (VPCs,
   EIPs) not exhausted, CIDR does not overlap another cloudspider VPC. Runs in the
   card and the program (`pulumi.runtime.isDryRun()` safe, all reads).
7. **Partial-failure recovery** (medium). App detects `pending_operations` /
   locked stack after an interrupted run and offers `pulumi cancel` +
   `refresh --yes` (preview first); Helm releases with `atomic`/`cleanupOnFail`;
   `customTimeouts` on every Helm release (15m) and ALB/RDS.
8. **ComponentResources** (medium, larger effort). Extract `CloudspiderVpc`,
   `EksCluster` (cluster + IAM + access entries), `ManagedNodeGroup` (launch
   template + maxPods), `HelmAddon` (catalog entry + pod identity), `PgCluster`.
   Each with a typed args object (the schema from 1), documented outputs, a README
   (inputs/outputs table generated from the schema, like terraform-docs) and
   aliases so existing stacks do not replace resources when moved under a
   component (`aliases: [{ parent: pulumi.rootStackResource }]`). Must be preview-
   verified as 0 replaces on the live `upgrade` stack before merge.
9. **Policy-as-code with CrossGuard** (medium). `policies/` pack (JS): required
   tags (`project`, `cloudspider`), no public RDS/0.0.0.0/0 on SG ingress except
   ALB 80/443, instance types in an allowed list, monthly cost estimate under a
   cap (reuse `src/stack-costs.js`), no `protect:false` on data. Runs as
   `pulumi preview --policy-pack` in the app and CI; advisory first, mandatory
   after a week.
10. **Preview-in-CI matrix** (medium). GitHub Actions: unit + mock tests on every
    PR; a matrix over every stack × its sample configs (`Pulumi.*.yaml` plus
    schema-generated edge configs) running the mock program (no cloud creds); an
    optional real `pulumi preview` job with a read-only OIDC role.
11. **Per-module docs, version, CHANGELOG** (low-medium). `upgrades/<stack>/README.md`
    generated from the schema, `version` in package.json bumped per change,
    `CHANGELOG.md`, card shows "stack v1.4.0, latest v1.5.0" (ties into the VAULTS
    LATEST/OUTDATED chip).
12. **Region/CIDR parameterisation** (low-medium). Region and VPC CIDR as schema
    keys with `cidrsubnet`-style derivation and overlap validation; zones from
    `getAvailabilityZones`.

## Done in this round

- #332 this plan.
- #333 item 1 for **eks**: `upgrades/schema/core.js` (typed schema, unknown key = error
  with did-you-mean, `docTable` for READMEs) + `upgrades/schema/eks.js`; the card
  (`checkParams`) and the program run it, the program before any resource. Mocks
  test: all 32 instanceType x maxPods x capacityType x prefixDelegation combos, card
  and program agree. Case #1 (SPOT + maxPods auto) covered.
- item 4 (part): every stack's npm deps pinned exactly to what its lockfile already
  resolved (no version changed), test `iac-pinned-versions` refuses ranges or a
  lockfile that disagrees. Still open: one `@pulumi/aws` major (addons/openshift on
  7.50.0, the rest on 6.83.4), EKS version as a config key.

- #335 item 2: `npm test`'s pretest installs every stack's deps (scripts/stack-deps.mjs); the gate went from 61 to 3 skipped.
- #336 item 1 for every stack: `upgrades/schema/stacks.js`.
- item 3: `protect` on rds's instance, barrel's bucket, pgcluster's CNPG Cluster and backup bucket (`protectData`, default on). The typed-name TAKE IT DOWN runs `pulumi state unprotect --all` (state only), then destroy. No `retainOnDelete`: the buckets have fixed names, so a kept bucket would make the next create fail with "already exists"; prefer protect + versioned backups.

- #338 item 5: stack runs in audit.jsonl (src/stack-audit.js).
- #339 item 6: read-only EKS preflight (zones, node types / spot pool offered, VPC quota note), card first step + program.
- item 7 (part): `upgrades/timeouts.js` customTimeouts on every EKS add-on and the RDS instance (resource option, no diff). Recovery that already existed: the app notices pending operations and a held lock and offers `pulumi cancel` (src/pulumi-locks.js). Left: Helm Release `timeout`/`atomic`/`cleanupOnFail` are inputs, so adding them shows an update on live releases: needs a preview go-ahead.

Known gap (fixed by #335): fc.sh installs only root + addons deps, so mock tests of eks/observe/etc.
skip in the gate (61 skipped). Item 2 fixes that.
