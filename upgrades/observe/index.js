import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { NAMESPACE, netpol, plan } from "./plan.js";

// The observe bundle (plan.js): Beyla + OTel collectors + Loki (+ optional
// kube-state-metrics) on any Kubernetes or OpenShift cluster, through the
// kube context named in kubeContext (never the current context by
// accident: it is required). Stack: observe. No AWS: the state lives in a
// local file backend (Pulumi.yaml). Uninstall = pulumi destroy: Pulumi
// deletes in reverse dependency order (workloads, Services, ConfigMaps,
// NetworkPolicies, RBAC, SCCs, then the namespace).
const config = new pulumi.Config();
const kubeContext = config.require("kubeContext");
const options = {
  platform: config.get("platform") || "kubernetes",
  profile: config.get("profile") || "crc",
  allowPrivileged: config.get("allowPrivileged") || "off",
  logs: config.get("logs") || "on",
  kubeStateMetrics: config.get("kubeStateMetrics") || "off",
  nodeCidr: config.require("nodeCidr"),
  lokiSizeGi: config.get("lokiSizeGi") || "",
  retentionHours: config.get("retentionHours") || "",
  storageClass: config.get("storageClass") || "",
};
const bundle = plan({ ...options, withNetpol: false });
for (const w of bundle.warnings) pulumi.log.warn(w);

const provider = new k8s.Provider("target", { context: kubeContext, enableServerSideApply: true });
const [nsObject, ...rest] = bundle.objects;
const ns = new k8s.core.v1.Namespace(NAMESPACE, { metadata: nsObject.metadata }, { provider });
// SCCs and cluster RBAC first, so the workloads are admitted on OpenShift.
// The namespace's own least-privilege NetworkPolicies (upgrades/netpol.js
// NAMESPACE_NETPOL["cloudspider-observe"], OpenShift DNS/host-network aware).
const policies = new k8s.yaml.ConfigGroup("observe-netpol", { objs: netpol({ platform: options.platform, nodeCidr: options.nodeCidr }) }, { provider, dependsOn: [ns] });
const isRbac = (o) => ["SecurityContextConstraints", "ClusterRole", "ClusterRoleBinding", "RoleBinding", "ServiceAccount"].includes(o.kind);
const rbac = new k8s.yaml.ConfigGroup("observe-rbac", { objs: rest.filter(isRbac) }, { provider, dependsOn: [ns] });
const work = new k8s.yaml.ConfigGroup("observe", { objs: rest.filter((o) => !isRbac(o)) }, { provider, dependsOn: [ns, rbac, policies] });

export const namespace = NAMESPACE;
export const platform = bundle.platform;
export const beyla = bundle.privileged ? "on" : "off";
export const footprint = bundle.footprint;
export const objects = rest.length + 1 + netpol({ platform: options.platform, nodeCidr: options.nodeCidr }).length;
export const ready = work.ready.apply(() => "installed");
