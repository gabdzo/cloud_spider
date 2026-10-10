# Map overview

Target: the open map on `cost-and-cluster`. You, the account owner, already know the AWS console. The page is already running. Under two minutes you should be able to say what is up, what is stopped, what sits outside the VPCs, and what is wrong.

Prior learning applied: layout-drops-empty-vpc-fixtures (9/10, 2026-10-10). An empty VPC still needs its own layout branch. Dropping it is how account-level resources vanished before.
Prior learning applied: sample-poll-overwrites-place (9/10, 2026-10-09). Sample must keep pausing the two-second pull.
Prior learning applied: stack-export-not-refresh (9/10, 2026-10-10). Coarse and fine filter the cached export. The map does not run `pulumi refresh`.
Prior learning applied: cost-corner-box (10/10, 2026-10-10). The bill stays the top-right box. The tally does not replace it.
Prior learning applied: header-sprite-is-home (10/10, 2026-10-10). The tally is on the map, not a new header button.
Prior learning applied: typed-name-before-destroy (10/10, 2026-10-10). Take it down is unchanged.

## Developer persona

Who: you, one AWS account, already fluent in the console.
Context: you open the local page to see the region without a tour of the console.
Tolerance: one glance. If the sentence is not on the open map, you leave.
Expects: real names, the link from a load balancer to its machines, and the newest failure in the words the page already has.

## Developer empathy narrative

Confirmed D3 A, 2026-10-10, against the live eu-north-1 map.

I open the page. The header is a sprite, Sample, Path, Cluster, and Stacks. Two walled groups. cloudspider-test holds three stopped machines and the load balancer cloudspider-api. A load balancer is the front door that spreads requests across machines. The other wall has no name, only 172.31.0.0/16, three empty subnets, and a gate id. I scroll and find camp. Four icons say page, table, secret, and function, with green lines down to the function. The payload has the real names. The drawing replaces them. I click a machine and get a plate. I click page, the function, or the load balancer, and nothing opens. The radio has the function failure and the later success. Path and Cluster replace this picture. The bill is a separate corner box. I leave knowing the shapes and not the account.

## Competitive benchmark

Clock: the page is already open. Result: the account sentence, without another mode. Install time is not this clock. Peer minutes are a different job (connect an account, then scan). Compare what the first picture contains.

| Tool | Start to result | Time and evidence | What the first picture decides | Source |
| --- | --- | --- | --- | --- |
| Cloud Spider today | Open page to the account sentence | Picture is immediate. The sentence does not arrive. Observed. | Walls, kind words on camp, real name on the load balancer and two machines. Click opens a plate for machines only. | Live `/api/view` and `src/layout.js` `campLabel` |
| Cloud Spider after this plan | Same clock | Target under 2 minutes. Not measured until it is built. | Pinned tally, real camp names, one line from the balancer to each target, empty VPC as a strip, newest fail, plate on drawn resources. | Decisions D4 A through D10 A |
| AWS VPC resource map | Console, one VPC, Resource map tab | Steps documented. Minutes not measured here. | Subnets, route tables, gateways. No Lambda, S3, DynamoDB, or secret. One VPC at a time. | AWS VPC user guide |
| Cloudcraft | Account connected, scan, auto layout | Scan duration not stated. | Supported resources in the region after Scan complete. | Datadog Cloudcraft getting-started |
| Hava | Connect, it draws | 30–60 minute learning curve reported, not a timed first diagram. | One diagram per VPC by default. | InfraSketch 2026 comparison |
| Lucidscale | Import, then tweak | One firm reported under 15 minutes versus 4–7 hours by hand. Anecdote. | Imported metadata plus views. | Lucid consulting tutorial |

Aside was not available. These peer notes are from public docs.

## Magical moment

D5 A. The map itself is the readout. You do not go to Path, the radio, or Stacks to learn what you have.

What the open map gains:

- A tally pinned to the map viewport, top-left. The bill stays top-right (`#spend`). The tally is not drawn at canvas y=0, because `#map` scrolls and a tall picture would hide it.
- Camp icons use the resource name already on the fixture (`cloudspider-camp-page`, the table, the secret, the bucket). `campLabel` in `src/layout.js` stops replacing those four with page, function, table, and secret. Sample fixtures use the same rule.
- A click on a camp node, a load balancer, or an EKS fixture opens a plate. Fields already loaded only: name, kind, status, and the names of linked resources. Never a secret value. Instances keep the plate they have, including logs.
- One line from each load balancer to each machine it actually targets. Listener, rule, and target group stay in Path. The map does not call `readPath`. It asks for target health, and when the target is an IP address it uses `interfaceFor` (`src/path-diagnose.js`) to find the instance. That pair is cached for 30 seconds, including a failure, and a second poll does not start another read while one is in flight. `GET /api/view` returns the last lines immediately. The one-second stop/start loop never calls this read. Sample does not call AWS. If the read fails, draw no line and let the tally carry the existing error sentence.
- A VPC with no instances is one short strip: name or id, CIDR, and the word empty. A VPC with instances keeps the full wall, plots, and the balancer line. The default VPC `172.31.0.0/16` is the live case (three empty subnets, no machines).
- If the newest radio row is a fail, the tally shows that sentence. If the newest row is ok, an older fail stays in the radio and does not sit on the tally. A failed view fetch shows the existing words "the page failed". Do not invent a fix.
- Coarse / fine sits on the camp wall and on the Camp card. Both write `campGrain`. Default coarse. Filter the cached export. Do not `pulumi refresh`.

## Journey map

| Stage | Developer does | Friction | Status |
| --- | --- | --- | --- |
| Discover | Opens the repo they already run | None for this persona. README stays the short start. | ok |
| Install | `npm install`, profile, region, `npm start` | Already running. | ok |
| Hello world | Sample, or the live map | Sample will use the same names and tally. The two-second pull stays paused while Sample is on. | fixed in this plan |
| Real usage | Reads the open map | Kind words, dead clicks, no balancer line, empty VPC is a full wall. | fixed in this plan |
| Debug | Looks for the failure | The reason is only in the radio. | fixed in this plan |
| Upgrade | Stacks, typed name, Take it down | No published version to migrate. Stacks rules stand. The detail dial moves onto the camp wall. | fixed in this plan |

## First-time confusion report

Persona: account owner. Attempting: understand eu-north-1 from the open page.

- T+0:00 Header and two walls. No account sentence. Addressed by the pinned tally.
- T+0:30 Camp says page, table, secret, function. Addressed by real names.
- T+1:00 Click on camp or the balancer does nothing. Addressed by the plate.
- T+1:30 The default VPC is three empty plots. Addressed by the strip.
- T+2:00 The balancer is not tied to the machines. Addressed by one line. The full chain stays in Path.
- T+2:30 The radio has the fail. The map does not. Addressed by the newest fail on the tally.
- T+3:00 More camp detail is behind Stacks. Addressed by coarse / fine on the wall.

No confusion in that log stayed open.

## NOT in scope

- Probing whether the function URL answers. The payload does not know, and the two-minute target does not add that call.
- Drawing the listener, rule, and target group on the map. D7 B. Path keeps that chain.
- Rewriting AWS errors into advice. D9 C. The tally quotes the radio.
- Hiding empty VPCs. D8 C. The strip stays on the picture.
- Moving the bill into the tally, or adding a header button for it.
- Green moving marks on healthy edges. Shelved earlier.
- A community channel, a second cloud, the $10 budget alert, Signal, and Barrel.
- `pulumi refresh` from the map. The export stays read-only.
- IAM on the map. Secret values on a label or a plate.

## What already exists

- README start: `npm install`, `AWS_PROFILE`, `AWS_REGION`, `npm start`, `http://127.0.0.1:9241`. Sample does not call AWS.
- Map poll every 2 seconds (`src/browser.js`). Diagram cache 30 seconds (`src/aws.js`). Wait poll every 1 second does not read the diagram.
- Machine plate: name, id, type, state, logs (`src/draw.js` `drawPlate`). Click hit-testing is `buildingAt`, instances only.
- Camp wall, hub layout, green edges (`src/layout.js` `placeCamp`, `src/draw.js`).
- Radio mixes page errors, `noteSpider` lines, and CloudTrail (`src/browser.js` `logRows`). The summary already prefers a fail. The tally must not copy that preference. Newest row wins.
- Path graph and diagnose (`src/path-diagnose.js`). Reuse it for the balancer line.
- Camp grain on the card (`#camp-grain`), posted as `?grain=` and not as Pulumi config.
- Stacks: typed name, watch line, destroy does not `config set`.

## Pass 1 — Getting started

Today 4/10. The picture loads. The account sentence never arrives. A 10 is the open page saying the sentence with your names, the way Stripe prefills your keys into the first example.

After this plan 8/10. The tally, names, line, strip, and fail are on the map you already have open. Residual: a brand-new machine still needs a working AWS profile. That is outside this clock. The README stays short on purpose.

No new decision. The vehicle is D5 A and the clock is D4 A.

## Pass 2 — API and the page

Today 5/10. The buttons are guessable. The camp labels are not. Clicks miss everything that is not a machine.

After this plan 8/10. Coarse is the simple case. Fine is the same control with more nodes. The plate is the same shape for a machine and for camp. Residual: Path and Cluster are still other pictures. That is deliberate. A 10 would put the whole request chain on the wall, and D7 B was rejected because it fights the glance.

No new decision.

## Pass 3 — Errors

Three paths.

1. Camp function create failed, then succeeded. Today the radio shows `InvalidParameterValueException: The role defined for the function cannot be assumed by Lambda`, then later ok lines. The icon stays. After: if that fail is the newest row, the tally quotes it. If a later row is ok, the tally drops it. The plate shows the same sentence when the resource name is in the line. No new wording.

2. Camp export fails. Today `noteSpider` says "the camp shelf did not load" and the VPC picture stays. After: that sentence is the newest fail, so the tally shows it. The VPC walls stay.

3. The view fetch throws. Today the page says "the page failed". After: the tally shows those same words. No invented cause.

Today 4/10. After 7/10. A 10 is Elm: problem, cause, the exact fix, and a link. D9 C rejected writing that fix, because the next AWS error would get a guess. Residual stands.

No new decision.

## Pass 4 — Documentation

Today 6/10. The README start matches the commands. Sample is the playground. There is no second docs site.

After 6/10. The page is the doc for this persona. The README does not grow a screenshot or a restatement of the tally. A 10 is a three-column docs site. That is a different product.

No new decision.

## Pass 5 — Upgrade path

Today 7/10. There is no published version. Take it down already requires the typed name, and the card line is the delete moment.

After 7/10. This plan does not change destroy. The detail dial is a view filter, not a migration. A 10 would be semver, a changelog, and a codemod. None of those exist, and none were asked for.

No new decision.

## Pass 6 — Environment

Today 7/10. `npm test`, Sample, a two-second refresh, server restart only when server JS changes.

After 7/10. Same workflow. The new drawing is browser JS plus layout. Verify in the browser. A 10 would add an editor language server and CI. Not this page.

No new decision.

## Pass 7 — Community

Today 4/10. Private page, one person. A community channel was already refused.

After 4/10. Still refused. This is accepted debt for a private tool, not an adoption blocker for a product you hand to strangers. A 10 is a monitored channel. Out of scope.

No new decision.

## Pass 8 — Measurement

Today 3/10. Nothing records whether the glance worked.

After 4/10. The check is a person opening the page and reading the tally. No analytics, no timer in the app. A target time does not by itself add telemetry. The later check is `/devex-review` on the built page. A 10 would instrument drop-off. Not approved.

No new decision.

## DX scorecard

Prior review 2026-10-10 14:46Z scored overall 7/10 for stacks and delete. Per-dimension scores were not stored. This review grades the quiet map. Do not read the old 7 as a score for this picture.

```
Getting Started   8/10   was 4    up
API / page        8/10   was 5    up
Error messages    7/10   was 4    up
Documentation     6/10   was 6    same
Upgrade path      7/10   was 7    same
Dev environment   7/10   was 7    same
Community         4/10   was 4    same, accepted
DX measurement    4/10   was 3    up, human glance only
TTHW              not reached today, target under 2 minutes on the open page
Competitive rank  Champion for that clock, once the tally is on the page
Magical moment    designed, the map is the readout
Product type      local AWS overview platform
Mode              EXPANSION
Overall           7/10   was 4 on this clock
```

Principles: zero friction covered by the pinned tally. Learn by doing covered by Sample using the same picture. Fight uncertainty covered by quoting the fail, with the fix left unwritten on purpose. Opinionated default is coarse, escape hatch is fine. Code in context is the live account, not a toy diagram. Magical moment is the map.

Critical DX debt: community and measurement stay under 6 because this is a private page with no telemetry. They do not block the overview.

## DX implementation checklist

- [ ] Open page to the account sentence in under 2 minutes
- [ ] Tally pinned on the map, bill stays top-right
- [ ] Camp uses real names, sample included
- [ ] Plate on camp, balancer, and cluster fixtures, no secret value
- [ ] One balancer-to-target line, path chain stays in Path
- [ ] Empty VPC is a strip
- [ ] Newest fail quoted, older fail not pinned, no invented fix
- [ ] Coarse / fine on the wall and the card, no `pulumi refresh`
- [ ] Sample pull still paused
- [ ] Install stays the README lines
- [ ] Typed name and the delete card line unchanged

Unchecked on purpose: changelog, community channel, docs search, codemod, credit card, TypeScript package, CI. They are not this product.

## TODOS.md

No new entries. The deferred list already holds the second cloud, the $10 alert, and the picture ideas. This review did not add a row.

## Implementation tasks

- [ ] **T1 (P1, human: ~2h / CC: ~20min)** — tally — Pin a one-line account tally to the map viewport.
  - Surfaced by: Pass 1 — the account sentence never arrives.
  - Files: `src/browser.js`, `src/server.js`, `src/draw.js`
  - Verify: open the live map. The line names stopped machines, cloudspider-api, camp, and one empty VPC, and it stays put while `#map` scrolls. The bill is still top-right.
- [ ] **T2 (P1, human: ~45min / CC: ~10min)** — names — Draw camp resource names, not kind words.
  - Surfaced by: Pass 2 — `campLabel` replaces names the payload already has.
  - Files: `src/layout.js`, `test/layout.test.js`, `src/sample.js`
  - Verify: layout test expects the fixture names. Sample camp shows those names too.
- [ ] **T3 (P1, human: ~2h / CC: ~20min)** — plate — Open a plate on camp, the load balancer, and an EKS fixture.
  - Surfaced by: empathy narrative — those clicks do nothing.
  - Files: `src/browser.js`, `src/draw.js`
  - Verify: click the function. Plate shows the name, kind, status, and the three linked names. It does not show a secret value. A machine click still shows logs.
- [ ] **T4 (P1, human: ~3h / CC: ~25min)** — link — Draw one line from each load balancer to its machines.
  - Surfaced by: Engineering D1 A and D2 A. `readPath` also fetches listeners, rules, route tables, and metrics. The live group `cloudspider-api-ip` registers `10.42.1.17` and `10.42.1.82`, which Path already maps to `cloudspider-stopped` and `cloudspider-running`.
  - Files: `src/aws-path.js`, `src/path-diagnose.js`, `src/app.js`, `src/layout.js`, `src/draw.js`, `test/layout.test.js`
  - Verify: an IP target becomes a line to the instance from `interfaceFor`. An instance-id target needs no lookup. An unknown address draws no line. A second call inside 30 seconds does not call AWS. A failed read is remembered and draws no line. Sample does not call AWS. `app.poll` does not call the read. Listener and rule are not on the map.
- [ ] **T5 (P1, human: ~1h / CC: ~15min)** — empty VPC — Draw a VPC with no instances as a short strip.
  - Surfaced by: D8 A — `172.31.0.0/16` is three empty plots.
  - Files: `src/layout.js`, `src/draw.js`, `test/layout.test.js`
  - Verify: the default VPC is a strip with its CIDR and the word empty. cloudspider-test keeps its wall. The strip is a layout branch, not a dropped fixture.
- [ ] **T6 (P2, human: ~1h / CC: ~15min)** — grain — Put coarse / fine on the camp wall, synced with the card.
  - Surfaced by: D10 A — the dial is behind Stacks.
  - Files: `src/browser.js`, `src/server.js`
  - Verify: both controls change the same picture. Default coarse. No `pulumi refresh` in the server log.
- [ ] **T7 (P1, human: ~30min / CC: ~10min)** — fail line — Quote the newest radio fail on the tally.
  - Surfaced by: Pass 3 — the map stays quiet while the radio has the reason.
  - Files: `src/browser.js`
  - Verify: a newest fail appears on the tally in the radio's words. A later ok removes it from the tally and leaves it in the radio. "the page failed" is shown as-is when the fetch throws.

## Engineering review

Scope gate: this plan. Files touched: `src/browser.js`, `src/server.js`, `src/draw.js`, `src/layout.js`, `test/layout.test.js`, `src/sample.js`, `src/aws-path.js`, `src/app.js`. No new module. Feature list unchanged. The file count is 8, so the arrangement is the open question below.

Scope record: feature answers, none cut. Structure, A, original arrangement (Engineering D3 A): `src/browser.js`, `src/server.js`, `src/draw.js`, `src/layout.js`, `test/layout.test.js`, `src/sample.js`, `src/aws-path.js`, `src/app.js`. Accepted scope, the tally, real names, plate, balancer line, empty-VPC strip, newest fail, and grain on the wall. Fetch for the line is Engineering D1 A plus D2 A. Pending remedies, none. Result: scope accepted as-is.

```
GET /api/view (every 2s)
  |
  +-- last edges, immediately
  |
  +-- if cache older than 30s and no read is running
        |
        +-- target groups for the balancers already on the diagram
        +-- target health
        +-- if the id is i-........  --> line
        +-- if the id is an IP
              |
              +-- interfaceFor(those addresses) --> instance id --> line
              +-- no interface --> no line
        +-- error --> remember it, no line, tally quotes the sentence
app.poll (every 1s) does not enter this path
readPath stays on GET /api/path
```

[Layer 1] Copy the 30-second `diagramCache` in `src/aws.js`. Reuse `targetHealth` in `src/aws-path.js` and `interfaceFor` in `src/path-diagnose.js`. Do not add a library. Do not call `readPath` from the map. Ask for network interfaces by the addresses that came back, not every interface in the VPC.

### Architecture

[P1] (confidence: 10/10) `src/path-read.js:27` — `readPath` walks listeners, rules, health, tags, subnets, security groups, route tables, interfaces, instances, clusters, and metrics. Disposition: accepted, Engineering D1 A. The map does not call it.

[P1] (confidence: 10/10) live `GET /api/path` — `cloudspider-api-ip` targets `10.42.1.17` and `10.42.1.82`, drawn as `cloudspider-stopped` and `cloudspider-running`. A health-only read would draw no line. Disposition: accepted, Engineering D2 A. The short read calls `interfaceFor`.

No other architecture change. The plate reads fixture fields already loaded. IAM and secret values stay off. The bill stays `#spend`. The header sprite stays home.

One production failure: target health or the interface lookup throws. Remember the error for 30 seconds, draw no line, show the existing sentence on the tally. The VPC walls and camp stay.

### Code quality

No new shared module. Two callers need the IP mapping: Path already calls `interfaceFor`, and the map will call the same function. Duplicating that lookup would drift. Rejected: folding the map into `readPath`.

### Tests

Framework: `node --test` via `package.json`.

```
view poll --> cached edges or last edges
  |
  +-- instance id ------------------> line          (new assertion)
  +-- IP + matching interface ------> line          (new assertion)
  +-- IP + no interface ------------> no line       (new assertion)
  +-- health error -----------------> no line, sentence kept (new assertion)
  +-- second call < 30s ------------> client not called (new assertion)
  +-- sample -----------------------> no AWS client (existing rule, extend)
layout
  |
  +-- empty VPC --------------------> strip         (new assertion)
  +-- VPC with instances -----------> full wall     (existing, keep)
  +-- camp names -------------------> fixture names (extend layout test)
```

Value: protects=an IP target becomes a line to the instance `interfaceFor` returns; fails_when=the map stores the IP as the endpoint or skips the lookup; why_new=layout tests cover camp edges only; seam=none

Value: protects=a cache hit does not call target health again; fails_when=the map read runs on every 2-second view; why_new=diagram cache is not asserted for this read; seam=injectable clock and client, same as `describeDiagram`

### Performance

The 2-second view returns in memory. The health read runs at most once per 30 seconds, one at a time. The first picture can lack the line until that read finishes and the next poll draws it. That wait is the cost of not blocking the page.

### Failure modes

- Health fails: no line, sentence on the tally, remembered 30 seconds.
- Address has no interface: no line for that address. Instance-id targets still draw.
- Two tabs: both polls share the server cache.
- Sample: local fixtures only. No health call.

## Completion

DX plan review of the quiet map, then an engineering pass on the same plan. DX decisions D1 A through D10 A. Engineering D1 A, a short cached target-health read. Engineering D2 A, that read follows an IP to the machine with `interfaceFor`. Engineering D3 A, those changes stay in the eight files that already own them. No unresolved choices inside this list.

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | — | no review row in the log |
| Outside Review | Codex plan review, automatic | Independent 2nd opinion | 6 | unavailable | auth failed, 0 findings |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 4 | clean | 1 issue folded into the fetch, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | — | not run |
| DX Review | `/plan-devex-review` | Developer experience gaps | 2 | issues_open | score: 4/10 → 7/10, TTHW: not reached → <2 min |

OUTSIDE COVERAGE: Codex, phase plan-review, unavailable. This run returned AUTH_FAILED before a review. No Plan subagent is available on this host, so there is no fallback. Repair is `codex login`. Prior learning applied: codex-auth-failed-no-plan-fallback (9/10, 2026-10-09).

VERDICT: ENG plan review complete for the map overview. Outside voice unavailable. Design review not run.

NO UNRESOLVED DECISIONS
