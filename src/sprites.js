import { buildingShack, LIGHT } from "./pixel-art.js";

export const LIT = LIGHT;

export function buildingFrame(state, phase) {
  return buildingShack(state, phase);
}
