# Changelog: showcase

Semantic versions per module: major = an input removed/renamed or a change that replaces a resource; minor = a new input or resource; patch = no infrastructure change. Bump package.json `version` with an entry here.

## 1.0.0 (2026-10-13)

- First release: the demo prod cluster's products (Online Boutique, Uptime Kuma, Wiki.js on CNPG, Mealie), a shared ALB (IngressGroup `showcase`, one host rule per app), a dedicated Boutique ALB and an NLB; typed config schema, pinned images, NetworkPolicies per namespace.
