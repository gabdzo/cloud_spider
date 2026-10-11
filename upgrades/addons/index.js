import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import { ADDONS, parseStack } from "./catalog.js";
import { REGION } from "./common.js";
import { readPodRoom, roomRefusal } from "./pod-room.js";
import { addonPlan, needsText, ownerText, readAddon } from "../eks-addons.js";

// Cluster add-ons for an EKS cluster from upgrades/eks. One stack per add-on
// and cluster, named <addon>-<cluster>; config clusterName must match.
//   pulumi stack select --create kyverno-cloudspider-up
//   pulumi config set clusterName cloudspider-up
//   pulumi preview / pulumi up / pulumi destroy
// What each add-on is: catalog.js. The programs: one file per add-on.
const parsed = parseStack(pulumi.getStack());
const addon = parsed && ADDONS.find((item) => item.id === parsed.addon && item.offered !== false);
if (!addon) {
  throw new Error(`stack ${pulumi.getStack()} must be <addon>-<cluster>, addon one of ${ADDONS.filter((item) => item.offered !== false).map((item) => item.id).join(", ")}`);
}
// Room for its pods first: a Pending add-on hangs Helm's atomic install
// and its rollback (pod-room.js). `pulumi config set skipRoomCheck true`
// skips it (say, when Karpenter will add the node).
if (addon.podSlots && !new pulumi.Config().getBoolean("skipRoomCheck")) {
  const clusterName = new pulumi.Config().get("clusterName") || parsed.cluster;
  const found = await aws.eks.getCluster({ name: clusterName });
  // Under mocks (tests) there is no real API server to ask.
  if (/\.eks\.amazonaws\.com/.test(found.endpoint || "")) {
    const room = await readPodRoom({ endpoint: found.endpoint, ca: found.certificateAuthorities[0].data, clusterName, region: REGION, own: addon.namespace }).catch((error) => ({ unread: error.message }));
    if (room.unread) pulumi.log.warn(`could not count free pod slots on ${clusterName} (${room.unread}); going on`);
    else {
      const why = roomRefusal(addon, room, clusterName);
      if (why) throw new Error(why);
      pulumi.log.info(`${clusterName}: ${room.free} free pod slots, ${addon.title} needs ${addon.podSlots}`);
    }
  }
}
// The Pod Identity agent and metrics-server come with the EKS stack now
// (includedWithEks; docs/design/stack-dependencies.md). Their add-on stacks
// only keep the add-on they made before (retainOnDelete, until
// scripts/migrate-eks-addons.mjs hands it over); anything else is the EKS
// card's job. The app refuses this first too (src/addons.js).
if (addon.eksAddon) {
  const clusterName = new pulumi.Config().get("clusterName") || parsed.cluster;
  const existing = await readAddon(aws.eks.getAddon, clusterName, addon.eksAddon);
  if (addon.includedWithEks && existing.project !== addon.id) {
    throw new Error(`${addon.title} is included with EKS: ${needsText(addon.eksAddon, clusterName).replace(/^needs [^:]+: /, "")}${existing.exists ? `; it is on ${clusterName} from ${ownerText(existing.project, clusterName)}` : ""}`);
  }
  if (!addon.includedWithEks && addonPlan(existing, addon.id) === "use") {
    throw new Error(`${addon.title} is already on ${clusterName} from ${ownerText(existing.project, clusterName)}; nothing to add (that stack keeps it, take it down there first to move it here)`);
  }
}
const program = await import(`./${addon.id}.js`);
const result = program.default({ pulumi, aws, k8s, addon }) || {};

export const addonId = addon.id;
export const cluster = parsed.cluster;
export const chart = addon.chart || "";
export const version = result.version || addon.appVersion || "";
export const namespace = addon.namespace;
export const details = result.details || {};
