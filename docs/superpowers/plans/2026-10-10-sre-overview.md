# SRE overview

Target: `main`. The page becomes a local SRE overview of the account already on the map.

## What the page says

The morning is three sentences: what is hurting, what changed last, and what is idle but still billed. When a fact was not read, the sentence says not checked.

Systems are inferred from wires already on the map. An API is a balancer and its targets. The camp is the function and what it uses. The cluster is the EKS read. There is no catalog file.

Idle shows as fire on the billed object. Blast radius is the sentence on the action: what else that object touches. Object biography is the last change on the plate.

## Decisions

D1 A. The rewind stays out of this plan. The morning sentence uses health, the bill, and the trail already on the page. A rewind that shows the map at a failed deploy waits until AWS Config is known to be recording, so it can show a real past.

D2 A. Smaller arrangement. The sentences and the system names (API, camp, cluster) go in `src/layout.js` beside `accountLine` and `newestFail`. `src/app.js` fills those fields from `src/radio.js`, `src/cost.js`, and `src/path-diagnose.js`. `src/browser.js` shows the three sentences. `src/server.js` holds the markup. `src/draw.js` paints the idle mark and the biography and blast lines on the plate. Tests stay in `test/layout.test.js`. No new modules.

## Still open

D3 is unanswered. Object biography needs a source for the last change. The review recommends keeping the ungrouped CloudTrail events that `createRadio.refresh` already holds, before `radioEntries` folds them and clears the resource name. The radio line stays the grouped string it is today. The other choice is the grouped rows only, and the plate says not checked when that fold cleared the name.

The idle-fire guard for a deploy that looks idle for one target-state read is still unspecified.

## Proof the sentences need

The hurting sentence uses the target state `DescribeTargetHealth` already returned. The link read in `src/path-diagnose.js` currently drops `state` off the edge. Until that state is on the edge, the sentence says not checked. The map does not call the full path read.

Idle-but-billed needs the raw resource id beside the short label from `shapeResources`, so a bill row can meet an object. The two-second map poll does not call Cost Explorer. The bill stays on the six-hour cache.

## Out

Rewind and any historical map. AWS Config history. A second cloud. The $10 budget alert in `TODOS.md`. Green path dots. Secret values on a plate. The cluster name in `upgrades/eks/Pulumi.upgrade.yaml`.
