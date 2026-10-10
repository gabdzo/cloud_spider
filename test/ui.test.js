import assert from "node:assert/strict";
import test from "node:test";
import { isInstanceId } from "../src/ids.js";
import { samplePlace } from "../src/sample.js";
import {
  clickBuilding,
  clickGround,
  createUi,
  pressN,
  pressY,
  setLogs,
  setRadio,
  switchRegion,
} from "../src/ui.js";

const region = "us-east-1";

function building(state, extra = {}) {
  return {
    id: "i-0abc1234",
    type: "t4g.nano",
    state,
    tags: [{ key: "cloudspider", value: "expendable" }],
    ...extra,
  };
}

test("a running building opens a stop confirmation that names the type and name", () => {
  const ui = createUi();
  clickBuilding(ui, building("running", { name: "brother" }), region);
  assert.match(ui.confirmation.line, /> STOP i-0abc1234 \(t4g.nano, brother\) in us-east-1/);
  assert.match(ui.confirmation.line, /\[Y\] put it down/);
  assert.equal(ui.confirmation.allowsY, true);
});

test("a missing name is omitted from the confirmation", () => {
  const ui = createUi();
  clickBuilding(ui, building("stopped"), region);
  assert.match(ui.confirmation.line, /> START i-0abc1234 \(t4g.nano\) in us-east-1/);
  assert.equal(ui.confirmation.line.includes("undefined"), false);
});

test("an untagged building has no Y", () => {
  const ui = createUi();
  clickBuilding(ui, building("running", { tags: [] }), region);
  assert.match(ui.confirmation.line, /is not tagged cloudspider=expendable/);
  assert.match(ui.confirmation.line, /This will not stop it/);
  assert.equal(ui.confirmation.allowsY, false);
  assert.equal(pressY(ui), null);
  assert.ok(ui.confirmation);
});

test("pending selects the building and does not open a confirmation", () => {
  const ui = createUi();
  clickBuilding(ui, building("pending"), region);
  assert.equal(ui.selection.id, "i-0abc1234");
  assert.equal(ui.confirmation, null);
});

test("Y closes the confirmation and N does not call a verb", () => {
  const ui = createUi();
  clickBuilding(ui, building("running"), region);
  const action = pressY(ui);
  assert.deepEqual(action, { verb: "stop", id: "i-0abc1234" });
  assert.equal(ui.confirmation, null);
  assert.equal(pressY(ui), null);

  clickBuilding(ui, building("stopped"), region);
  assert.equal(pressN(ui), null);
  assert.equal(ui.confirmation, null);
});

test("radio and logs do not change an open confirmation", () => {
  const ui = createUi();
  clickBuilding(ui, building("running", { name: "brother" }), region);
  const line = ui.confirmation.line;
  setRadio(ui, "StopInstances i-0bbb2222");
  setLogs(ui, ["boot"], "");
  assert.equal(ui.confirmation.line, line);
  assert.equal(ui.radio, "StopInstances i-0bbb2222");
  assert.deepEqual(ui.logs, ["boot"]);
});

test("empty ground clears the selection and another building does not keep the old prompt", () => {
  const ui = createUi();
  clickBuilding(ui, building("running"), region);
  clickGround(ui);
  assert.equal(ui.selection, null);
  assert.equal(ui.confirmation, null);
  assert.deepEqual(ui.logs, []);

  clickBuilding(ui, building("running"), region);
  clickBuilding(ui, building("stopped", { id: "i-0bbb2222" }), region);
  assert.equal(ui.selection.id, "i-0bbb2222");
  assert.match(ui.confirmation.line, /START i-0bbb2222/);
});

test("sample Y changes the picture locally and does not name a dry run", () => {
  const place = samplePlace();
  for (const shack of place.instances) assert.equal(isInstanceId(shack.id), false);
  const ui = createUi();
  ui.sample = true;
  const running = place.instances[0];
  clickBuilding(ui, running, "sample");
  assert.match(ui.confirmation.line, /Y changes the picture/);
  assert.match(ui.confirmation.line, /does not call AWS/);
  assert.equal(ui.confirmation.line.includes("dry-run"), false);
  const action = pressY(ui);
  assert.deepEqual(action, { local: true, verb: "stop", id: "sample-running" });
  clickBuilding(ui, place.instances[2], "sample");
  assert.match(ui.confirmation.line, /is not tagged cloudspider=expendable/);
  assert.equal(ui.confirmation.allowsY, false);
  assert.equal(pressY(ui), null);
});

test("a region switch closes the confirmation and clears the radio", () => {
  const ui = createUi();
  clickBuilding(ui, building("running"), region);
  setRadio(ui, "StopInstances i-0abc1234");
  switchRegion(ui);
  assert.equal(ui.confirmation, null);
  assert.equal(ui.selection, null);
  assert.equal(ui.radio, "");
});
