import * as pulumi from "@pulumi/pulumi";
import * as k8s from "@pulumi/kubernetes";
import { ship } from "../netpol.js";
import { stackTags } from "../tags.js";
import { extraPolicies, footprint, renderBundle } from "./render.js";

// The observe bundle (opt-in) on any Kubernetes or OpenShift cluster: every
// object comes from render.js (the app's PREVIEW shows the same list). The
// target is a kubeconfig context named in config (`context`), a write
// context kept apart from the app's read-only viewer context. Stack:
// observe-<context>. Nothing here touches AWS.
// Config (cloudspider-observe:*): context, platform (kubernetes|openshift),
// allowPrivileged (off|on: off = the reduced bundle, no Beyla, no container logs),
// viewerUser (a user bound to the service-proxy read Role besides the cloudspider-viewers group),
// profile (crc|standard), kubeStateMetrics (install|skip), logs (on|off:
// Loki + the file_log agent), lokiStorage (5Gi), lokiRetention (72h),
// storageClass (cluster default), nodeCidr (the node network for the
// API server / kubelet / service-proxy rules; 0.0.0.0/0 if unset).
// Take it down: pulumi destroy deletes the namespace (pods, ConfigMaps,
// Loki's claim, NetworkPolicies) and the cluster-scoped ClusterRoles,
// bindings and SCCs, all labelled app.kubernetes.io/managed-by=cloudspider-observe.
const config = new pulumi.Config();
const context = config.get("context") || "";
if (!context || !/^[A-Za-z0-9._:/@-]{1,253}$/.test(context)) throw new Error("context: the kubeconfig context to install into (a write context, not cloudspider-viewer)");
if (context === "cloudspider-viewer") throw new Error("context cloudspider-viewer is read-only by design: name a write context for the install");
const opts = Object.fromEntries(["platform", "allowPrivileged", "profile", "kubeStateMetrics", "logs", "lokiStorage", "lokiRetention", "storageClass", "nodeCidr", "viewerUser"].map((k) => [k, config.get(k) || undefined]));
const bundle = renderBundle(opts);
for (const w of bundle.warnings) pulumi.log.warn(w);

// enableConfigMapMutable: a config change updates the ConfigMap in place
// (the provider otherwise replaces it, and a fixed-name replace fails with
// "already exists"); the config-checksum annotation then rolls the pods.
const provider = new k8s.Provider("observe", { context, enableServerSideApply: true, enableConfigMapMutable: true });
const KINDS = {
  "v1/Namespace": k8s.core.v1.Namespace,
  "v1/ServiceAccount": k8s.core.v1.ServiceAccount,
  "v1/ConfigMap": k8s.core.v1.ConfigMap,
  "v1/Service": k8s.core.v1.Service,
  "apps/v1/DaemonSet": k8s.apps.v1.DaemonSet,
  "apps/v1/Deployment": k8s.apps.v1.Deployment,
  "apps/v1/StatefulSet": k8s.apps.v1.StatefulSet,
  "rbac.authorization.k8s.io/v1/ClusterRole": k8s.rbac.v1.ClusterRole,
  "rbac.authorization.k8s.io/v1/ClusterRoleBinding": k8s.rbac.v1.ClusterRoleBinding,
  "rbac.authorization.k8s.io/v1/Role": k8s.rbac.v1.Role,
  "rbac.authorization.k8s.io/v1/RoleBinding": k8s.rbac.v1.RoleBinding,
};
const [nsItem, ...rest] = bundle.items;
const ns = new k8s.core.v1.Namespace("observe-ns", { metadata: nsItem.obj.metadata }, { provider });
const inNs = { provider, dependsOn: [ns] };
// Security first (SCCs, roles, bindings, service accounts), then the
// workloads, which wait for it: a pod created before its SCC is refused
// ("unable to validate against any security context constraint", seen on
// CRC) and the DaemonSet backs off for minutes.
const WORKLOADS = new Set(["DaemonSet", "Deployment", "StatefulSet"]);
const made = [];
const security = [];
const create = (obj, opts) => {
  const name = `${obj.kind.toLowerCase()}-${obj.metadata.name}`;
  const Kind = KINDS[`${obj.apiVersion}/${obj.kind}`];
  const { apiVersion, kind, ...args } = obj;
  return Kind ? new Kind(name, args, opts) : new k8s.apiextensions.CustomResource(name, obj, opts); // SecurityContextConstraints (OpenShift only)
};
for (const { obj } of rest.filter(({ obj }) => !WORKLOADS.has(obj.kind))) {
  // ConfigMaps keep fixed names (the pods mount them by name), so a data
  // change must delete before it creates; the pods roll on the checksum.
  const res = create(obj, obj.kind === "ConfigMap" ? { ...inNs, deleteBeforeReplace: true } : inNs);
  made.push(res);
  if (/SecurityContextConstraints|Role|ServiceAccount/.test(obj.kind)) security.push(res);
}
for (const { obj } of rest.filter(({ obj }) => WORKLOADS.has(obj.kind))) made.push(create(obj, { provider, dependsOn: [ns, ...security] }));
// The API Service's ClusterIP for allow-apiserver-egress (EKS matches it pre-DNAT).
const apiService = k8s.core.v1.Service.get("kubernetes-api-service", "default/kubernetes", { provider });
ship({ k8s, pulumi, opts: inNs, namespace: bundle.namespace, vpcCidr: bundle.options.nodeCidr, apiServiceIp: apiService.spec.clusterIP, labels: { "app.kubernetes.io/managed-by": "cloudspider-observe" } });
for (const { name, spec } of extraPolicies()) {
  new k8s.networking.v1.NetworkPolicy(`netpol-observe-${name}`, { metadata: { name, namespace: bundle.namespace, labels: { "app.kubernetes.io/part-of": "cloudspider", "app.kubernetes.io/managed-by": "cloudspider-observe" } }, spec }, inNs);
}

export const namespace = bundle.namespace;
export const privileged = bundle.privileged;
export const notes = bundle.notes;
export const resources = footprint({ profile: bundle.options.profile, logs: bundle.options.logs, kubeStateMetrics: bundle.options.kubeStateMetrics, allowPrivileged: bundle.options.allowPrivileged });
export const reduced = bundle.reduced;
// No AWS resources: the tags only name the vault this stack belongs to.
export const tags = stackTags("observe");
