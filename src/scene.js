// Path and Cluster share one picture: nodes, edges and a kind icon. The
// Pip-Boy painter lives in path-draw.js and sprites go through the shared
// draw-kit cache, so this module only names them for callers that think in
// "scenes". Colours come from theme.js.
export { paintDiagram } from "./path-draw.js";
export { drawSprite } from "./draw-kit.js";
export { PALETTE, STATUS as STATUS_COLOR } from "./theme.js";
