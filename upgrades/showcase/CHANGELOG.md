# Changelog: showcase

Semantic versions per module: major = an input removed/renamed or a change that replaces a resource; minor = a new input or resource; patch = no infrastructure change. Bump package.json `version` with an entry here.

## 1.1.0 (2026-10-14)

- Demo listener rules on the shared ALB's HTTP :80 (Ingress `showcase-routes`, no host condition): `/dashboard*` path rule to Kuma, `/old*` 301 redirect to `/dashboard`, `/maintenance` fixed-response 503, `/canary*` with header `X-Canary: 1` to a canary target group, and `/canary*` weighted forward 90/10. New Service `uptime-kuma-canary` (same Kuma pod, one more target group). Rules and target groups are free; nothing is replaced.

## 1.0.2 (2026-10-14)

- redis-cart, Uptime Kuma and Mealie run as their images' non-root users (fsGroup on the volume); Kuma starts node directly (its entrypoint needs setgid). Memory: Kuma 256Mi (128Mi was OOMKilled), Mealie 512Mi. Mealie gets a writable /app/nltk_data (emptyDir). In place, pods restart.

## 1.0.1 (2026-10-13)

- Nodes are x86 (m6i.large pool): Online Boutique publishes amd64-only images. No infrastructure change in this stack.

## 1.0.0 (2026-10-13)

- First release: the demo prod cluster's products (Online Boutique, Uptime Kuma, Wiki.js on CNPG, Mealie), a shared ALB (IngressGroup `showcase`, one host rule per app), a dedicated Boutique ALB and an NLB; typed config schema, pinned images, NetworkPolicies per namespace.
