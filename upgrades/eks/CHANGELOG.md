# Changelog: eks

Semantic versions per module: major = an input removed/renamed or a change that replaces a resource; minor = a new input or resource; patch = no infrastructure change. Bump package.json `version` with an entry here.

## 1.1.0 (2026-10-13)

- New input vpcCidr (/16 or /17, private; default 10.43.0.0/16 = no change). Zones follow aws:region (<region>a/b). Defaults leave the live stack unchanged.

## 1.0.0 (2026-10-13)

- First versioned release: typed config schema (validated before any resource), providers pinned, mocks matrix, policy pack.
- Earlier history: `git log -- upgrades/eks`.
