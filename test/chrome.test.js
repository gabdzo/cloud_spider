import assert from "node:assert/strict";
import test from "node:test";
import { clockText, mapStats, needleAt, pathStats, rowKind, rowText, scrollToShow, stationKind, stationsFrom, timeNote } from "../src/chrome.js";
import { samplePlace, sampleTrail } from "../src/sample.js";

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
  const rows = sampleTrail();
  assert.ok(rows.length >= 5);
  assert.ok(new Set(rows.map(rowKind)).size >= 4);
  assert.ok(rows.every((row, index) => !index || row.time <= rows[index - 1].time), "newest first");
});

test("trail rows get an icon from their phrase, and failures warn", () => {
  assert.equal(rowKind({ status: "ok", text: "put a machine down  i-1" }), "stop");
  assert.equal(rowKind({ status: "ok", text: "brought a machine back  i-1" }), "start");
  assert.equal(rowKind({ status: "ok", text: "took a gate down" }), "warn");
  assert.equal(rowKind({ status: "ok", text: "opened a fence  sg-1" }), "refresh");
  assert.equal(rowKind({ status: "ok", text: "read the bill" }), "caps");
  assert.equal(rowKind({ status: "ok", text: "read eu-north-1" }), "map");
  assert.equal(rowKind({ status: "fail", text: "raised a machine" }), "warn");
  assert.equal(rowKind({ status: "ok", text: "StopInstances i-1" }), "stop");
  assert.equal(rowText({ text: "tagged a thing", count: 3, issue: "denied" }), "tagged a thing \u00d73  denied");
});

test("row times read today, yesterday, then the date", () => {
  const now = new Date(2026, 9, 10, 20, 0);
  assert.equal(timeNote(0, now), "--:--");
  assert.equal(timeNote(new Date(2026, 9, 10, 7, 5).getTime(), now), "07:05");
  assert.equal(timeNote(new Date(2026, 9, 9, 23, 59).getTime(), now), "yday 23:59");
  assert.equal(timeNote(new Date(2026, 9, 8, 14, 5).getTime(), now), "8 Oct 14:05");
});

test("status bar counts the map and the path", () => {
  const map = mapStats(samplePlace());
  assert.deepEqual(map.cells, ["VPC 2", "SUBNETS 5", "SHACKS 5"]);
  assert.equal(map.meter.label, "LIT 3/5");
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
