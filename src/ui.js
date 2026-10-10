import { isExpendable } from "./verbs.js";

export function createUi() {
  return {
    selection: null,
    confirmation: null,
    status: "",
    radio: "",
    trail: [],
    logs: [],
    logNote: "",
    // Plate facts (last change, blast radius, idle) drawn under TYPE.
    facts: [],
  };
}

export function setFacts(ui, facts) {
  ui.facts = Array.isArray(facts) ? facts : [];
}

export function clickBuilding(ui, building, region, blast = "") {
  ui.selection = building;
  ui.logs = [];
  ui.logNote = "";
  ui.facts = [];
  ui.confirmation = confirmationFor(building, region, ui.sample, blast);
}

export function clickFixture(ui, fixture, note = "") {
  ui.selection = {
    id: fixture.id,
    name: fixture.name || fixture.label || fixture.id,
    type: fixture.kind || "",
    state: fixture.status || "",
  };
  ui.logs = [];
  ui.logNote = note;
  ui.facts = [];
  ui.confirmation = null;
}

export function clickGround(ui) {
  ui.facts = [];
  ui.selection = null;
  ui.confirmation = null;
  ui.logs = [];
  ui.logNote = "";
}

export function pressY(ui) {
  if (!ui.confirmation?.allowsY) return null;
  const action = ui.sample
    ? { local: true, verb: ui.confirmation.verb, id: ui.confirmation.id }
    : { verb: ui.confirmation.verb, id: ui.confirmation.id };
  ui.confirmation = null;
  return action;
}

export function pressN(ui) {
  if (!ui.confirmation) return null;
  ui.confirmation = null;
  return null;
}

export function setRadio(ui, line) {
  ui.radio = line;
}

export function setTrail(ui, entries) {
  ui.trail = Array.isArray(entries) ? entries : [];
}

export function setLogs(ui, lines, note = "") {
  ui.logs = lines;
  ui.logNote = note;
}

export function setStatus(ui, status) {
  ui.status = status;
}

export function switchRegion(ui) {
  ui.selection = null;
  ui.confirmation = null;
  ui.radio = "";
  ui.trail = [];
  ui.logs = [];
  ui.logNote = "";
}

function confirmationFor(building, region, sample, blast = "") {
  // The blast radius is said on the action, before Y.
  const radius = blast ? ` ${blast[0].toUpperCase()}${blast.slice(1).replace(/\.?$/, ".")}` : "";
  if (building.state !== "running" && building.state !== "stopped") return null;
  const verb = building.state === "running" ? "stop" : "start";
  if (!isExpendable(building)) {
    return {
      verb,
      id: building.id,
      allowsY: false,
      line: `${building.id} is not tagged cloudspider=expendable. This will not ${verb} it.`,
    };
  }
  const name = building.name ? `, ${building.name}` : "";
  const button = verb === "stop" ? "put it down" : "bring it back";
  if (sample) {
    return {
      verb,
      id: building.id,
      allowsY: true,
      line: `> ${building.id} (${building.type}${name})? Y changes the picture. This does not call AWS.${radius} [Y] ${button}  [N] leave it`,
    };
  }
  const word = verb === "stop" ? "STOP" : "START";
  const does = verb === "stop" ? "stops" : "starts";
  return {
    verb,
    id: building.id,
    allowsY: true,
    line: `> ${word} ${building.id} (${building.type}${name}) in ${region}? Y dry-runs, then ${does} this instance.${radius} [Y] ${button}  [N] leave it`,
  };
}
