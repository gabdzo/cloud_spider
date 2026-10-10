# Scenario spec

A directory is the spec. Do not invent a scenario language. Add a field only when the CLI reads it. Full contract: section 11 of the [milestone 1 spec](docs/superpowers/specs/2026-10-06-sealed-outage-loop-design.md).

## Layout

```
scenarios/<id>/
  scenario.yaml   fields the CLI reads
  README.md       solver brief (safe to read)
  AUTHOR.md       causes, diagnosis path, solver feedback (spoiler)
  infra/          Pulumi project for the healthy baseline (spoiler)
  faults/*.py     one module per fault: ID, inject(env), revert(env) (spoiler)
  validate.py     checks(env) -> list[Check] (spoiler)
```

`<id>` looks like `aws-web-unreachable-001`: provider, symptom, number.

## scenario.yaml

```yaml
id: aws-web-unreachable-001
version: 1
provider: aws
region: eu-central-1
ttl_minutes: 90
faults: [...]
```

## Rules

- **The baseline is healthy.** `infra/` builds a working system. Faults are injected afterwards with boto3, and `lab up` proves the baseline passes and the faulted state fails.
- **The brief names the symptom only:** never the cause, never console clicks.
- **No spoilers in AWS-visible names, tags, or outputs.** Every fault target exists in every run.
- **Every fault has a reference `revert()`.** `lab selftest` uses it to prove that a fix passes validation.
- **Validation is cause-agnostic.** It checks the outcome (HTTP status, API state) plus hygiene guards. It never checks shell history, a specific command, or which resource was mutated.
- **The solver policy lives in `infra/`.** Mutations are scoped by the `lab_run_id` tag and capped by `lab-solver-boundary`. Whether a tool like Reachability Analyzer is allowed is decided per scenario.

## Version control

Scenarios live in git. `.lab/` (Pulumi state, run evidence, sealed faults) does not.
