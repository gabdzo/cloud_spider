import { isExpendable } from "./verbs.js";

export function createUi() {
  return {
    selection: null,
    confirmation: null,
    status: "",
    radio: "",
    logs: [],
    logNote: "",
  };
}

export function clickBuilding(ui, building, region) {
  ui.selection = building;
  ui.logs = [];
  ui.logNote = "";
  ui.confirmation = confirmationFor(building, region, ui.sample);
}

export function clickGround(ui) {
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
  ui.logs = [];
  ui.logNote = "";
}

function confirmationFor(building, region, sample) {
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
      line: `> ${building.id} (${building.type}${name})? Y changes the picture. This does not call AWS. [Y] ${button}  [N] leave it`,
    };
  }
  const word = verb === "stop" ? "STOP" : "START";
  const does = verb === "stop" ? "stops" : "starts";
  return {
    verb,
    id: building.id,
    allowsY: true,
    line: `> ${word} ${building.id} (${building.type}${name}) in ${region}? Y dry-runs, then ${does} this instance. [Y] ${button}  [N] leave it`,
  };
}
