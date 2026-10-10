# aws-smoke-001: harness smoke test

Not a learning lab. It exists to prove the `lab` lifecycle end to end, and it costs nothing (no instance).

The security group printed as `sg_id` no longer allows TCP 8080 from `10.0.0.0/8`. Restore that rule
as the solver, without opening the group to the world. Done when `lab validate` passes.
