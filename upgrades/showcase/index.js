import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import { eksProvider } from "../eks-kube.js";
import { ship } from "../netpol.js";
import { inheritTags, stackTags } from "../tags.js";
import { assertStackConfig } from "../schema/stacks.js";
import { BOUTIQUE, IMAGES, NLB_SERVICE, PRODUCTS, canaryService, directIngressFor, ingressFor, routesIngress } from "./plan.js";

// The demo "prod" cluster's four products (plan.js). Stack showcase-<cluster>.
// Needs, on the cluster: the lbc, cert-manager and kyverno add-on stacks and
// the CloudNativePG operator (pgcluster stack). Wiki.js's database is a CNPG
// Cluster; Uptime Kuma and Mealie keep SQLite on a gp3 PVC.
const cfg = assertStackConfig(pulumi, "cloudspider-showcase", { strict: true });
const { clusterName, domain } = cfg;
if (pulumi.getStack() !== `showcase-${clusterName}`) throw new Error(`stack ${pulumi.getStack()} must be showcase-${clusterName}`);
inheritTags(pulumi, stackTags("showcase", { cluster: clusterName }));

const provider = eksProvider({ pulumi, aws, k8s, clusterName });
const k = { provider };
const res = (cpu, memory) => ({ requests: { cpu, memory }, limits: { memory } });
const hardened = { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] }, seccompProfile: { type: "RuntimeDefault" } };
const spread = (app) => [{ maxSkew: 1, topologyKey: "topology.kubernetes.io/zone", whenUnsatisfiable: "ScheduleAnyway", labelSelector: { matchLabels: { app } } }];

const namespaces = {};
for (const ns of [...new Set(PRODUCTS.map((p) => p.ns))]) {
  namespaces[ns] = new k8s.core.v1.Namespace(ns, { metadata: { name: ns, labels: { "app.kubernetes.io/part-of": "cloudspider-showcase", "pod-security.kubernetes.io/warn": "restricted" } } }, k);
}
// Kyverno closes every new namespace (default deny); each ships its flows.
const vpcCidr = aws.ec2.getVpcOutput({ id: aws.eks.getClusterOutput({ name: clusterName }).vpcConfig.vpcId }).cidrBlock;
for (const ns of Object.keys(namespaces)) ship({ k8s, pulumi, opts: { ...k, dependsOn: [namespaces[ns]] }, namespace: ns, vpcCidr });
const inNs = (ns, extra = []) => ({ ...k, dependsOn: [namespaces[ns], ...extra] });

// runAs: each image's own non-root user, so no entrypoint needs chown or
// setuid (all capabilities are dropped; seen live 2026-10-14: redis, Mealie
// and Uptime Kuma crashed with "Operation not permitted" as root).
function app(ns, name, { image, port, targetPort, env = {}, cpu, memory, volumes = [], mounts = [], replicas = 1, strategy, runAs, command }) {
  const labels = { app: name };
  const dep = new k8s.apps.v1.Deployment(`${ns}-${name}`, {
    metadata: { name, namespace: ns, labels },
    spec: {
      replicas, selector: { matchLabels: labels }, ...(strategy ? { strategy } : {}),
      template: {
        metadata: { labels },
        spec: {
          topologySpreadConstraints: spread(name),
          ...(runAs ? { securityContext: { runAsNonRoot: true, runAsUser: runAs, runAsGroup: runAs, fsGroup: runAs, fsGroupChangePolicy: "OnRootMismatch" } } : {}),
          containers: [{ name, image, ...(command ? { command } : {}), ports: [{ containerPort: targetPort || port }], env: Object.entries(env).map(([n, value]) => (typeof value === "string" ? { name: n, value } : { name: n, valueFrom: value })), resources: res(cpu, memory), securityContext: hardened, volumeMounts: mounts }],
          volumes,
        },
      },
    },
  }, inNs(ns));
  const svc = new k8s.core.v1.Service(`${ns}-${name}`, { metadata: { name, namespace: ns, labels }, spec: { selector: labels, ports: [{ name: "tcp", port, targetPort: targetPort || port }] } }, inNs(ns));
  return { dep, svc };
}
// gp3, encrypted, volumes tagged project=showcase (the vault claims them).
const gp3 = new k8s.storage.v1.StorageClass("showcase-gp3", { metadata: { name: "showcase-gp3" }, provisioner: "ebs.csi.aws.com", volumeBindingMode: "WaitForFirstConsumer", reclaimPolicy: "Delete", allowVolumeExpansion: true, parameters: { type: "gp3", encrypted: "true", tagSpecification_1: "project=showcase", tagSpecification_2: `cluster=${clusterName}` } }, k);
const pvc = (ns, name, storage) => new k8s.core.v1.PersistentVolumeClaim(`${ns}-${name}`, { metadata: { name, namespace: ns }, spec: { accessModes: ["ReadWriteOnce"], storageClassName: cfg.storageClass, resources: { requests: { storage } } } }, inNs(ns, [gp3]));
const single = { type: "Recreate" }; // RWO volume: never two pods at once

// Online Boutique (ALB 2 + NLB).
app("boutique", "redis-cart", { image: IMAGES.redis, port: 6379, cpu: "20m", memory: "64Mi", runAs: 999, volumes: [{ name: "data", emptyDir: {} }], mounts: [{ name: "data", mountPath: "/data" }] });
for (const s of BOUTIQUE) app("boutique", s.name, { image: s.image, port: s.name === "frontend" ? 80 : s.port, targetPort: s.name === "frontend" ? 8080 : s.targetPort, env: s.env, cpu: s.cpu, memory: s.memory });
new k8s.core.v1.Service("boutique-frontend-nlb", NLB_SERVICE, inNs("boutique"));

// Uptime Kuma (SQLite on a PVC).
const kuma = PRODUCTS.find((p) => p.id === "kuma");
pvc(kuma.ns, "kuma-data", kuma.storage);
app(kuma.ns, kuma.service, { image: IMAGES.kuma, port: kuma.port, cpu: kuma.cpu, memory: kuma.memory, runAs: 1000, command: ["node", "server/server.js"], strategy: single, volumes: [{ name: "data", persistentVolumeClaim: { claimName: "kuma-data" } }], mounts: [{ name: "data", mountPath: "/app/data" }] });

// Wiki.js on a one-instance CNPG Postgres (secret wikidb-app made by CNPG).
const wiki = PRODUCTS.find((p) => p.id === "wiki");
const wikidb = new k8s.apiextensions.CustomResource("wikidb", {
  apiVersion: "postgresql.cnpg.io/v1", kind: "Cluster",
  metadata: { name: wiki.db.name, namespace: wiki.ns },
  spec: { instances: 1, imageName: "ghcr.io/cloudnative-pg/postgresql:17.5", storage: { size: wiki.db.storage, storageClass: cfg.storageClass }, resources: res(wiki.db.cpu, wiki.db.memory), bootstrap: { initdb: { database: "wiki", owner: "wiki" } } },
}, inNs(wiki.ns, [gp3]));
const secret = (key) => ({ secretKeyRef: { name: `${wiki.db.name}-app`, key } });
app(wiki.ns, wiki.service, { image: IMAGES.wiki, port: wiki.port, cpu: wiki.cpu, memory: wiki.memory, env: { DB_TYPE: "postgres", DB_HOST: `${wiki.db.name}-rw`, DB_PORT: "5432", DB_NAME: "wiki", DB_USER: secret("username"), DB_PASS: secret("password") } });

// Mealie (SQLite on a PVC).
const mealie = PRODUCTS.find((p) => p.id === "mealie");
pvc(mealie.ns, "mealie-data", mealie.storage);
app(mealie.ns, mealie.service, { image: IMAGES.mealie, port: mealie.port, cpu: mealie.cpu, memory: mealie.memory, runAs: 911, strategy: single, env: { ALLOW_SIGNUP: "false", BASE_URL: `http://mealie.${domain}` }, volumes: [{ name: "data", persistentVolumeClaim: { claimName: "mealie-data" } }, { name: "nltk", emptyDir: {} }], mounts: [{ name: "data", mountPath: "/app/data" }, { name: "nltk", mountPath: "/app/nltk_data" }] });

// ALB 1 (shared, IngressGroup "showcase": 3 host rules) and ALB 2 (Boutique).
const ingresses = PRODUCTS.map((p) => new k8s.networking.v1.Ingress(`${p.id}-ingress`, ingressFor(p, { domain, certificateArn: cfg.certificateArn || "", wafAclArn: cfg.wafAclArn || "" }), inNs(p.ns, p.id === "wiki" ? [wikidb] : [])));

// Per-app ports on the shared ALB, only without a certificate.
const direct = !cfg.certificateArn? PRODUCTS.map((p) => [p, directIngressFor(p)]).filter(([, spec]) => spec) : [];
const directIngresses = direct.map(([p, spec]) => new k8s.networking.v1.Ingress(`${p.id}-direct`, spec, inNs(p.ns, [ingresses[1]])));
export const directLinks = directIngresses.map((ing, i) => ing.status.loadBalancer.ingress[0].hostname.apply((h) => `http://${h}:${direct[i][0].directPort}/`));
// Demo rules on the shared ALB's :80: path, redirect, fixed-response, header
// canary and a weighted forward (plan.js routesIngress). Rules are free.
const canary = new k8s.core.v1.Service("uptime-kuma-canary", canaryService(), inNs(kuma.ns));
new k8s.networking.v1.Ingress("showcase-routes", routesIngress(), inNs(kuma.ns, [ingresses[1], canary]));
export const hosts = PRODUCTS.filter((p) => p.host).map((p) => `${p.host}.${domain}`);
export const sharedAlb = ingresses[1].status.loadBalancer.ingress[0].hostname;
export const boutiqueAlb = ingresses[0].status.loadBalancer.ingress[0].hostname;
export const tls = cfg.certificateArn ? "https" : "http only (no certificateArn)";
