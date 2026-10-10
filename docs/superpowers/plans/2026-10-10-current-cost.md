# Current cost

A header control for the AWS bill. Month to date, by service, in USD. Not bottle caps.

## What you see

The header gains a button labeled with the account total, for example `Cost $0.00`. It is not the status line and not the radio. Clicking it opens a short panel under the header:

```
account, not this region. October, estimated, about a day behind.
Amazon Elastic Compute Cloud          $1.20
Amazon Elastic Load Balancing         $0.40
total                                 $1.60
```

Services under one cent are hidden. A month with nothing above that says `no charge above $0.01 yet`. Sample mode does not call AWS. The button reads `Cost sample` and the panel says `sample, not the account.`

## Read

```
browser                process                         AWS
Cost click             cache hit? ----yes----> panel
   |                   no
   |                   GetCostAndUsage  ------------> Cost Explorer
   |                   us-east-1 only                  (account bill)
   |                   group by SERVICE
   |<---------------- panel
```

One call: `GetCostAndUsage` on the Cost Explorer client in `us-east-1`. The map, the radio, and the logs stay on the region in the menu. The profile's default region is `eu-central-1`, which the SCP denies, so this client names `us-east-1` itself. Probed on 2026-10-10: the call succeeds. October so far returns three services, all under a cent, `Estimated: true`. EC2 and the test load balancer are not in that bill yet. Cost Explorer lags about a day, so a machine started today can still show $0. The panel says so.

Window: first day of the current month UTC, inclusive, through tomorrow UTC, exclusive. The end date is exclusive. On the 1st, start and end must not be the same day.

Metric: `UnblendedCost`. Sort by amount, highest first. Drop a service when the absolute amount is under `0.01`. Sum the kept rows for the total. Follow `NextPageToken` until it is empty.

Cache the shaped result for 6 hours in the process. Each request costs $0.01, so the 2-second map poll must not call this. Opening the panel uses the cache. The first open in a session fetches. A failed fetch is not cached.

A failed bill uses `publicError` for the SDK text, then `Set AWS_PROFILE=default and AWS_REGION=us-east-1.` The call name is `GetCostAndUsage`. `accountRead` is not used, because that hint says `eu-north-1`. The button and stdout show the same sentence. No credentials and no request body. A denied call is not shown as `$0.00`.

The amount is prefixed with `$` when the unit is USD. Any other unit is printed as the number and the unit code.

## Files

Smaller arrangement, chosen in review D3. Eight files, 0 new classes. `src/aws.js` is not modified. `src/cost.js` owns the `us-east-1` client and the shaping.

| File | Change |
|---|---|
| `package.json` | Add `@aws-sdk/client-cost-explorer` at the same major as the other AWS clients. |
| `package-lock.json` | Lockfile for that dependency. |
| `src/cost.js` | New. Client, month window, shaping, dust filter, sample bill. |
| `src/app.js` | `costView()` plus the 6-hour cache. |
| `src/server.js` | `GET /api/cost`. Header button `#cost` and panel `#bill`. |
| `src/browser.js` | Click loads the panel. `pull()` does not touch it. |
| `src/main.js` | Construct the cost reader and pass it into `createApp`. |
| `test/cost.test.js` | Window, dust, sort, sample, cache, and a failed call. |

## NOT in scope

- The $10 budget alert in `TODOS.md`. That creates a budget. This only reads.
- Hourly price on the instance plate, forecasts, resource-level cost, other months, charts, and bottle caps.
- Enabling hourly granularity in Cost Explorer. That is a paid account setting.

## What already exists

Nothing reads a bill. The header, the error sentence, and Sample already exist (`src/server.js`, `src/app.js`, `src/browser.js`). `pull()` redraws the map every 2 seconds and will wipe a cost line if it is stored on the status line. The panel is its own element.

## Failure modes

| Failure | What the button does |
|---|---|
| Access denied or Cost Explorer disabled | The error sentence. Not `$0.00`. |
| Throttle or network | The error sentence. The last good panel stays until the next successful fetch. |
| Today is the 1st and the window is empty | `no charge above $0.01 yet`. |
| Bill is a day behind | The panel says estimated, about a day behind. |
| Two clicks at once | One in-flight call. The second waits for it. |

## Tests

`test/cost.test.js` uses a fake client. No live call in `npm test`.

- Month window is the first of this month UTC through tomorrow UTC, and the two dates differ on the 1st.
- Rows sort by amount, highest first. A row under one cent is dropped, including a negative dust amount. A credit of at least one cent stays. USD is prefixed with `$`. Any other unit is the number plus the unit code. No kept rows produces `no charge above $0.01 yet`.
- `NextPageToken` is followed until it is empty.
- Sample shaping does not call the client.
- The second `costView` inside 6 hours does not call the client. A call after 6 hours does. A thrown read is not cached, and the sentence names `GetCostAndUsage` and `us-east-1`.
- Two overlapping `costView` calls share one read.
- Regression, D5: `boot`, `view`, `pathView`, and `logsFor` are called with a cost client that throws if read. They must not throw.

One manual check: open the page, click Cost, and confirm the panel matches `aws ce get-cost-and-usage` for the same window. The map poll is not given a browser guard.

## Scope Challenge

feature answers: no cuts proposed
structure: B (D3, smaller arrangement)
accepted scope: header Cost button; month-to-date UnblendedCost grouped by SERVICE; 6-hour process cache; the 2-second map poll does not call Cost Explorer; src/cost.js owns the us-east-1 client and the shaping; aws.js is not modified. Files: package.json, package-lock.json, src/cost.js, src/app.js, src/server.js, src/browser.js, src/main.js, test/cost.test.js.
pending remedies: R1
Result: scope accepted as-is

## Decision ledger

### R1: which region a failed bill names
Finding: [P1] (confidence: 9/10) src/app.js:13 — reviewer: plan-eng-review. accountRead prefixes read errors with AWS_REGION=eu-north-1. Cost Explorer is called in us-east-1.
Plan baseline: the plan says the button and stdout show the same sentence, with the call name GetCostAndUsage. It does not say which region that sentence names.
Runtime evidence: src/app.js:13 is `const ACCOUNT_HINT = "Set AWS_PROFILE=default and AWS_REGION=eu-north-1."` and src/app.js:15 wraps every read error with it. src/aws.js:193 publicError returns the SDK message only. A live GetCostAndUsage on 2026-10-10 succeeded only when the region was us-east-1.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R1 error hint | unspecified, pending | us-east-1 and GetCostAndUsage, message from publicError | accountRead, which says eu-north-1 |
Question D4:
D4 — Which region does a failed bill name?
Project/branch/task: cloud_spider. The Cost button reads the account bill from Cost Explorer in us-east-1.
ELI10: When a read fails, the page tells you which profile and region to set. That hint is hardcoded to eu-north-1 because that is the only region the map is allowed to use. The bill is the exception. Cost Explorer rejected other regions and answered in us-east-1. If a failed bill uses the map hint, you would "fix" it by pointing the bill at the region that cannot serve it.
Stakes if we pick wrong: a denied or broken bill looks like a map outage, and the repair hint points at the wrong region.
Recommendation: A because the bill client is the one call that must not use eu-north-1.
Completeness: A=9/10, B=4/10. A names the region this call actually uses. B reuses a hint that is true for the map and false for the bill.
Pros / cons:
A) Name us-east-1 (recommended)
  ✅ The button and stdout say GetCostAndUsage and tell you to set us-east-1 for this call only. The map hint stays on map errors.
  ✅ The SDK text still comes from publicError, so credentials and request bodies stay off the page.
  ❌ One read error in the app no longer shares the map's sentence, so there are two hint strings to keep honest.
B) Reuse the map hint
  ✅ Every failed read keeps one sentence, the one already tested for the map.
  ✅ No new copy to write or to drift away from the map.
  ❌ The sentence says AWS_REGION=eu-north-1. Following it points this call at the region Cost Explorer does not use.
Net: the bill keeps its own hint. The map hint does not change.
Header: Which region does a failed bill name?
Options:
A) Name us-east-1
The cost error uses publicError for the SDK text, then a sentence that names GetCostAndUsage and us-east-1. accountRead is not called for this path. The map's eu-north-1 hint stays on map errors. Button and stdout still show the same sentence.
B) Reuse the map hint
costView sends the SDK text through accountRead. The button tells you to set AWS_REGION=eu-north-1 even though the client called us-east-1.

State: approved
Actual answer: A (D4, Name us-east-1)
Accepted scope: the cost error uses publicError for the SDK text, then a sentence that names GetCostAndUsage and us-east-1. accountRead is not called for this path. The map's eu-north-1 hint stays on map errors. Button and stdout still show the same sentence.
History: none

### R2: how the map proves it never reads the bill
Finding: [P1] (confidence: 8/10) src/server.js:322 and src/browser.js pull — reviewer: plan-eng-review. The map redraws from app.view() on a 2-second poll. The new cost client sits next to that path. Nothing today fails if view() starts calling it.
Plan baseline: the plan says pull() does not touch the cost panel, and the poll must not call Cost Explorer. It does not name a test that fails if that regresses.
Runtime evidence: src/server.js:322 sends app.view() for GET /api/view. createApp callers in test/app.test.js:83, test/server.test.js:41, and test/path-app.test.js:26 do not pass a cost reader. src/cost.js does not exist yet.
Comparison grid:
| Choice | Current | A | B |
|---|---|---|---|
| R2 map must not call cost | unspecified, pending | app.view, boot, pathView, and logsFor are called with a cost client that throws if read. The test fails if any of them read it. | the same app test, plus a browser run that clicks around the map and asserts no /api/cost request |
Question D5:
D5 — How do we prove the map never reads the bill?
Project/branch/task: cloud_spider. The Cost button is new. The map poll is not supposed to call it.
ELI10: Each Cost Explorer request costs $0.01. The map asks the process for a new picture every 2 seconds. If that picture starts fetching the bill, the account pays $0.01 every 2 seconds, about $18 an hour, and the bill gets no fresher because Cost Explorer is already a day behind.
Stakes if we pick wrong: the poll calls the bill API and the only notice is the AWS invoice.
Recommendation: A because the poll is a process call, and a unit test that throws on a cost read fails in npm test. A browser run can miss a server-side call.
Completeness: A=8/10, B=10/10. A catches the poll and the other existing reads. B adds the click path, which the cost tests already cover from the route inward.
Pros / cons:
A) Guard the existing reads (recommended)
  ✅ boot, view, pathView, and logsFor run against a cost client that throws if read. npm test fails if the map starts billing the account.
  ✅ The three existing createApp test files keep passing once they pass that client through, or once cost defaults to unset and those four methods never touch it.
  ❌ A click handler that fetches /api/cost on every map refresh would pass this test if the fetch lives only in the browser.
B) Guard the reads and the browser
  ✅ The same throw-on-read test, plus one headless Chrome pass that loads the map and asserts the page never requested /api/cost.
  ✅ A browser bug that polls the bill is caught before you click Cost.
  ❌ The Chrome check is slower and already flaked once on startup, so a map-only pass becomes part of every cost change.
Net: the $0.01 loop is a server bug. Catch it in npm test. The browser check stays the manual click of the Cost button.
Header: How do we prove the map never reads the bill?
Options:
A) Guard the existing reads
A cost client that throws if read is passed into createApp. The test calls boot, view, pathView, and logsFor and expects no throw. Existing map behavior stays. The Cost button's own tests are separate.
B) Guard the reads and the browser
Option A, plus a headless Chrome run that opens the map, does not click Cost, and fails if the page requested /api/cost.

State: approved
Actual answer: A (D5, Guard the existing reads)
Accepted scope: a cost client that throws if read is passed into createApp. The test calls boot, view, pathView, and logsFor and expects no throw. Existing map behavior stays. The Cost button's own tests are separate. No headless Chrome guard for the poll.
History: none

Approval readiness: PASS. Checked R1 (D4 A) and R2 (D5 A).

## Implementation Tasks
Synthesized from this review's findings. Each task derives from a specific finding above.

- [ ] **T1 (P1, human: ~2h / CC: ~20min)** — cost read — Add the Cost button and the us-east-1 bill read.
  - Surfaced by: Architecture — src/app.js:13 accountRead names eu-north-1, and the bill must not.
  - Files: package.json, package-lock.json, src/cost.js, src/app.js, src/server.js, src/browser.js, src/main.js
  - Verify: a denied or thrown read returns a sentence with GetCostAndUsage and us-east-1, and not eu-north-1.
- [ ] **T2 (P1, human: ~30min / CC: ~10min)** — map poll — Prove the existing reads never call the bill.
  - Surfaced by: Test review — src/server.js:322 app.view() is the 2-second poll.
  - Files: test/cost.test.js
  - Verify: `npm test` with a cost client that throws if read. boot, view, pathView, and logsFor must not throw.

## Completion summary
- Step 0: Scope Challenge — scope accepted as-is (structure B, D3)
- Architecture Review: 1 issue found (R1, accepted D4)
- Code Quality Review: 0 issues found
- Test Review: diagram below, 1 gap identified (R2, accepted D5)
- Performance Review: 0 issues found
- NOT in scope: written
- What already exists: written
- TODOS.md updates: 0 items proposed
- Failure modes: 0 critical gaps flagged
- Unresolved decisions: 0 in this review
- Outside voice: Codex, unavailable (AUTH_FAILED, run `codex login`)

```
CODE PATHS                         USER FLOWS
[+] src/cost.js                    [+] Click Cost
  ├── month window                   ├── [GAP] panel matches the shaped bill — test/cost.test.js
  │   └── [GAP] 1st of month         ├── [GAP] second click inside 6h does not call AWS
  ├── shape                          └── manual: click once and compare with aws ce
  │   ├── [GAP] sort, dust, USD
  │   ├── [GAP] credit kept
  │   └── [GAP] other unit
  ├── pages [GAP] NextPageToken    [+] Map poll
  └── sample [GAP] no client call    └── [GAP] [D5] boot/view/pathView/logsFor do not read cost

COVERAGE: 0/9 paths tested (0%)  |  Code paths: 0/6  |  User flows: 0/3
QUALITY: none yet  |  GAPS: 9
```

Sequential implementation, no parallelization opportunity. One module: the cost read, then its tests.

Lake Score: 0/2. D4 chose 9/10, D5 chose 8/10.

## Suppressed findings
none

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/plan-ceo-review` | Scope & strategy | 0 | not in log | gstack-review-read returned NO_REVIEWS |
| Outside Review | Codex plan review | Independent 2nd opinion | 1 | unavailable | AUTH_FAILED. Run codex login. |
| Eng Review | `/plan-eng-review` | Architecture & tests (required) | 1 | issues_open | 2 issues, 0 critical gaps |
| Design Review | `/plan-design-review` | UI/UX gaps | 0 | not in log | gstack-review-read returned NO_REVIEWS |
| DX Review | `/plan-devex-review` | Developer experience gaps | 0 | not in log | gstack-review-read returned NO_REVIEWS |

- **OUTSIDE COVERAGE:** Codex, phase plan-review, unavailable. The probe printed AUTH_FAILED. No findings. Native fallback was not run: this host has no Plan subagent.
- **VERDICT:** Eng Review is ISSUES OPEN (2 issues, both accepted into the plan). eng review required

NO UNRESOLVED DECISIONS
