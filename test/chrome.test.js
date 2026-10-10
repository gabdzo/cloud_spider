import assert from "node:assert/strict";
import test from "node:test";
import { clockText, mapStats, needleAt, pathStats, scrollToShow, stationKind, stationsFrom } from "../src/chrome.js";
import { samplePlace, sampleRadio } from "../src/sample.js";

test("radio lines become stations; quiet and errors are not stations", () => {
  assert.deepEqual(stationsFrom("the radio is quiet"), { stations: [], note: "the radio is quiet" });
  assert.equal(stationsFrom("the radio cannot read CloudTrail: denied").stations.length, 0);
  assert.deepEqual(stationsFrom(""), { stations: [], note: "" });
  const { stations } = stationsFrom("StopInstances i-1\nRunInstances i-2\n");
  assert.deepEqual(stations.map((s) => s.kind), ["stop", "start"]);
});

test("station icons follow the verb", () => {
  assert.equal(stationKind("TerminateInstances i-1"), "warn");
  assert.equal(stationKind("AuthorizeSecurityGroupIngress sg-1"), "refresh");
  assert.equal(stationKind("GetFederationToken"), "radio");
});

test("the dial needle stays on the scale", () => {
  assert.equal(needleAt(0, 0), 8);
  for (let i = 0; i < 6; i += 1) {
    const at = needleAt(i, 6);
    assert.ok(at > 4 && at < 96);
    if (i) assert.ok(at > needleAt(i - 1, 6));
  }
});

test("sample radio has stations for every kind of icon it shows", () => {
  const { stations } = stationsFrom(sampleRadio());
  assert.ok(stations.length >= 5);
  assert.ok(new Set(stations.map((s) => s.kind)).size >= 4);
});

test("status bar counts the map and the path", () => {
  const map = mapStats(samplePlace());
  assert.deepEqual(map.cells, ["VPC 1", "SUBNETS 1", "SHACKS 3"]);
  assert.equal(map.meter.label, "LIT 1/3");
  assert.equal(mapStats(null), null);
  const path = pathStats({ nodes: [{ status: "ok" }, { status: "broken" }, { status: "hang" }, { status: "ok" }] });
  assert.deepEqual(path.cells, ["NODES 4", "BROKEN 1", "HANGING 1"]);
  assert.equal(path.meter.fill, 0.5);
  assert.equal(pathStats({ nodes: [] }), null);
});

test("clock is HH:MM", () => {
  assert.equal(clockText(new Date(2026, 9, 10, 7, 5)), "07:05");
});

test("scrollToShow moves only as far as it must to show a panel", () => {
  assert.equal(scrollToShow(0, 740, 100, 300), 0, "already visible");
  assert.equal(scrollToShow(0, 740, 676, 440), 676 + 440 + 8 - 740, "past the right edge");
  assert.equal(scrollToShow(300, 740, 100, 200), 92, "past the left edge");
  assert.equal(scrollToShow(0, 300, 500, 440), 492, "wider than the view: its left edge wins");
});
