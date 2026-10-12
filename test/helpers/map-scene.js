// The sample map, laid out the way the page does it (browser.js placedMap),
// for golden tests of src/draw.js.
import { layout } from "../../src/layout.js";
import { samplePlace } from "../../src/sample.js";
import { sampleMapSnapshot } from "../../src/kube-sample.js";
import { diagramFromKube } from "../../src/kube-diagram.js";
import { kubeModel } from "../../src/map-kube.js";

export function sampleScene({ width = 1440, height = 1100, animTime = 0, view = "arch", selection = null, kube = true, flow = false, vaults = [] } = {}) {
  const models = new Map([["cloudspider-up", kubeModel(diagramFromKube(sampleMapSnapshot(), {}), "cloudspider-up")]]);
  const placed = layout(samplePlace(), {
    rowLimit: Math.min(1100, width),
    flowLimit: flow ? width : 0,
    vaults,
    vaultMode: "doors",
    view,
    kube: kube ? { models, choice: () => "auto" } : null,
  });
  return { placed, ui: { selection, marks: {}, logs: [], facts: [] }, region: "eu-north-1", animTime, width, height, reducedMotion: false };
}
