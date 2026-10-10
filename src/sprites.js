import { LIGHT } from "./pixel-art.js";
import { shack } from "./sprites/buildings.js";

export const LIT = LIGHT;

export function buildingFrame(state, animPhase, reducedMotion) {
  return shack(state, animPhase, reducedMotion);
}
