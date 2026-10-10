import { paintDiagram, STATUS_COLOR } from "./scene.js";
import { sceneIcon } from "./pixel-art.js";

export { STATUS_COLOR };

export function paintPath(ctx, scene) {
  paintDiagram(ctx, { ...scene, icon: (node) => sceneIcon(node.kind) });
}
