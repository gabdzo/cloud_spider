import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import { ADDONS, parseStack } from "./catalog.js";

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
const program = await import(`./${addon.id}.js`);
const result = program.default({ pulumi, aws, k8s, addon }) || {};

export const addonId = addon.id;
export const cluster = parsed.cluster;
export const chart = addon.chart || "";
export const version = result.version || addon.appVersion || "";
export const namespace = addon.namespace;
export const details = result.details || {};
