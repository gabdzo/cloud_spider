# aws-web-unreachable-001 authoring plan (spoiler)

## Design

Healthy baseline per spec section 6: one VPC `10.20.0.0/16`, one public subnet `10.20.1.0/24`, an IGW, a route
table with `0.0.0.0/0 -> IGW` (separate `aws.ec2.Route`), a custom NACL (separate `NetworkAclRule`s: inbound TCP 80
from operator /32 and TCP 1024-65535 from anywhere, outbound rule 100 allow-all), a security group with a separate
ingress rule TCP 80 from operator /32 plus egress allow-all, and one `t4g.micro` AL2023 arm64 (SSM public parameter),
public IPv4, IMDSv2 required, no key pair, no instance profile, `cpu_credits=standard`.

User data writes a stdlib-only Python server as a systemd unit (`GET /health -> 200 "ok <nonce>"`, no package
installs; `ThreadingHTTPServer` with a 10s handler timeout so an idle client cannot wedge it). It writes an absolute
deadline (`now + self_terminate_minutes`) to disk and a `selfterm.service` oneshot that re-schedules `shutdown -h` from
that deadline on every boot, so a solver reboot does not cancel the timer. `instance_initiated_shutdown_behavior=terminate`.
Tags come only from `aws:defaultTags`. Names and tags are neutral.

Outputs: `endpoint`, `instance_id` (handover), plus `vpc_id`, `subnet_id`, `igw_id`, `route_table_id`, `nacl_id`,
`sg_id`, `solver_role_arn`. All three fault targets exist in every run, so exporting their IDs reveals nothing.

## Faults

| ID | inject | revert |
|---|---|---|
| `sg-no-http` | revoke the TCP 80 operator /32 ingress permission | re-authorize the same permission, re-applying the baseline rule's tags |
| `route-no-igw` | delete the `0.0.0.0/0` route | re-create it to the IGW recorded in `env.baseline` |
| `nacl-no-ephemeral` | replace outbound rule 100 with TCP 80 allow, add outbound rule 110 TCP 443 allow | delete rule 110, replace rule 100 with the baseline entry |

## Validation (spec section 7)

Outcome `health-200` (3 tries, 3s timeout, body `ok <nonce>`). Guards: `same-instance`, `no-new-network`
(VPC/IGW/ENI/EIP inventory vs `baseline(env)`), `no-world-ingress` over all SGs in the lab VPC (a superset of the
instance's SGs).

Deviation from spec section 7 (human decision): the guard matches the README strictly. Any SG ingress from
`0.0.0.0/0` or `::/0`, on any port including 80, fails. It replaces `no-world-all-ports` and `no-world-ssh`.

## Solver policy

Read: `ec2:Describe*`, `ec2:GetConsoleOutput`. Fix, tag-conditioned on `lab_run_id`: SG rule authorize/revoke/modify
on the SG (rule ARNs unconditioned, as in smoke, since new rules are untagged), route create/replace/delete on the
route table (plus the tagged IGW as a target), NACL entry create/replace/delete on the NACL, and
`ec2:RebootInstances` on the tagged instance (human decision; no stop/start, which would change the public IP). No create of
instances/VPCs/SGs/IGWs/ENIs/EIPs, no SSM, CloudTrail, or NetworkInsights (boundary denies the last three too).

## Cost per run

t4g.micro $0.0096/h + public IPv4 $0.005/h + 8 GiB gp3 (~$0.0001/h). A normal 30-60 min run is about $0.01-0.02;
worst case (self-terminate at 105 min) about $0.03. Selftest = 3 runs of about 10 min each, under $0.01.

## Risks and unverified live assumptions

- EC2 honours `aws:ResourceTag/lab_run_id` for CreateRoute/ReplaceRoute/DeleteRoute and the NACL entry actions.
- CreateRoute may also authorize the IGW resource; the policy allows the tagged IGW in case it does.
- Boot to healthy fits in `baseline_timeout_s` (300s); AL2023 ships `python3`.
- The NACL fault drops return traffic within `fault_timeout_s`; no stale connection keeps the check passing.
- Pulumi refresh/destroy after a revert (re-created rule/route have new IDs or same ID) leaves no orphans.
- SG revert with `TagSpecifications` for `security-group-rule` is accepted by the operator role.
- EC2 honours `aws:ResourceTag/lab_run_id` for `RebootInstances`; logind honours `shutdown -h +N` from a boot-time
  oneshot unit, and the instance clock is correct at boot.
- Deferred: split world ranges (for example `0.0.0.0/1` plus `128.0.0.0/1`) are not caught by the guard; the health
  check honours `HTTP(S)_PROXY` env vars; console edits that add tags to new SG rules need `ec2:CreateTags`, which the
  solver lacks.
