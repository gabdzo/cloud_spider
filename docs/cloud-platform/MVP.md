# MVP

Milestone 1 is the **sealed outage loop**: one scenario, `aws-web-unreachable-001`, in the sandbox account. A Python CLI over Pulumi. No web app. Full design: [milestone 1 spec](docs/superpowers/specs/2026-10-06-sealed-outage-loop-design.md).

The agent authors the scenarios. You solve them. Follow the spoiler-free working agreement in section 11 of the spec.

```
lab up <scenario>      build healthy baseline, prove it passes, inject a hidden fault, prove it fails
lab shell | console    solver-only access, 1h credentials
lab validate           outcome + hygiene checks, exit 0 only when all pass
lab reveal             the cause, after a pass (or --give-up)
lab down               idempotent teardown, then janitor
lab selftest           every fault: inject, fail, reference fix, pass
```

Do not implement anything until the Organization, both root MFAs, Identity Center, the SCPs, and the €20 budget action exist. See [ARCHITECTURE.md](ARCHITECTURE.md).

## Done, for milestone 1

- `lab up` fails safe: if the baseline doesn't pass, or the fault doesn't break it, the run destroys itself.
- `lab selftest` passes for every fault.
- You solve the lab three times as the solver and see at least two different causes.
- `lab down` succeeds twice in a row, and `lab janitor` shows nothing left in any region.
- The budget action has fired once on purpose.
- Each run records timestamps, validate attempts, the solver's change trail, and the next-day cost.

## Explicitly out of the MVP

- Frontend, accounts for other people, billing, SSO for others
- Interviewer dashboard, recordings, AI allow/block switches, numeric scores
- Account pools, Control Tower, GCP, Azure, Kubernetes, OpenShift
- EKS, NAT gateways, RDS, ALB
- A generic scenario engine, provider interface, or Pulumi Automation API
- A second scenario before three solves of the first

## Quality bar

Validation checks the outcome: HTTP 200 on `/health` from outside, plus hygiene guards. It never checks which resource you changed. Any correct fix passes. `lab selftest` is the proof that the checker is not coupled to the answer.
