import { buildingShack, LIGHT } from "./pixel-art.js";

export const LIT = LIGHT;

export function buildingFrame(state, animPhase, reducedMotion) {
  return buildingShack(state, animPhase, reducedMotion);
}
