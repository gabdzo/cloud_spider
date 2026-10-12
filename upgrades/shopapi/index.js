import { readFileSync } from "node:fs";
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import { eksProvider } from "../eks-kube.js";
import { inheritTags, stackTags } from "../tags.js";

// A sample backend on EKS wired to the database from upgrades/pgcluster.
// Stack: shopapi. Needs eks and pgcluster up (the card checks both first).
//   - a migration Job (postgres:16-alpine, psql) that applies sql/*.sql to
//     the database, re-run whenever the SQL changes (the Job name carries
//     its hash)
//   - PostgREST v16 serving schema api read-only as role web_anon:
//       GET /items  → the seeded rows as JSON
//   - a ClusterIP Service, no load balancer: reach it with
//       kubectl -n shop port-forward svc/shopapi 3000:80
// Both read the connection string from the Secret shopdb-app (key uri) that
// CloudNativePG writes. RDS instead: put the RDS URI into a Secret with the
// same name and key (docs/RUN-ME.md §11); the RDS stack's VPC is separate,
// so that needs peering, which this PoC does not make (open question).
// With expose=none it adds no AWS resources; the vault binds it by its stack.
// With expose=alb the controller makes an ALB tagged project=shopapi. Vault: vaults/templates/shopapi.yaml.
const config = new pulumi.Config();
const clusterName = config.get("clusterName") || "cloudspider-up";
const secretName = config.get("dbSecret") || "shopdb-app";
// none: a ClusterIP Service only (port-forward). alb: an internet-facing ALB
// through the AWS Load Balancer Controller (the lbc add-on, which the card
// checks for first).
const expose = config.get("expose") || "none";
if (!["none", "alb"].includes(expose)) throw new Error("expose must be none or alb");
// replicas: 2 by default, spread over zones (NET-K8S-002: an ALB's targets
// in 2+ zones) with a PodDisruptionBudget of 1; 1 is the cheap, single-zone
// choice.
const replicas = Number(config.get("replicas") || "2");
if (!Number.isInteger(replicas) || replicas < 1 || replicas > 6) throw new Error("replicas must be 1-6");
if (!/^[a-z][a-z0-9-]{1,62}$/.test(secretName)) throw new Error("dbSecret must be a Kubernetes name");

inheritTags(pulumi, stackTags("shopapi", { cluster: clusterName }));

const ns = "shop";
const labels = { app: "shopapi", "app.kubernetes.io/name": "shopapi", "app.kubernetes.io/part-of": "cloudspider-shop", "cloudspider/project": "shopapi" };
const provider = eksProvider({ pulumi, aws, k8s, clusterName });
// Fail early without the Postgres cluster: namespace shop is pgcluster's (one
// stack per namespace), so this stack reads it and never makes it. Missing,
// preview and up stop here with "needs-pgcluster-namespace-shop" instead of
// half-creating the Service and ConfigMap ("namespaces \"shop\" not found").
const shopNamespace = k8s.core.v1.Namespace.get("needs-pgcluster-namespace-shop", ns, { provider });
const k = { provider, dependsOn: [shopNamespace] };

const sqlDir = new URL("./sql/", import.meta.url);
const migrations = { "001-shop.sql": readFileSync(new URL("001-shop.sql", sqlDir), "utf8") };
const hash = (await import("node:crypto")).createHash("sha256").update(JSON.stringify(migrations)).digest("hex").slice(0, 8);
const dbUri = { name: "DATABASE_URL", valueFrom: { secretKeyRef: { name: secretName, key: "uri" } } };

const sql = new k8s.core.v1.ConfigMap("migrations", { metadata: { name: `shopapi-sql-${hash}`, namespace: ns, labels }, data: migrations }, k);

const migrate = new k8s.batch.v1.Job(
  "migrate",
  {
    metadata: { name: `shopapi-migrate-${hash}`, namespace: ns, labels },
    spec: {
      backoffLimit: 4,
      ttlSecondsAfterFinished: 3600,
      template: {
        metadata: { labels: { ...labels, app: "shopapi-migrate", "app.kubernetes.io/name": "shopapi-migrate" } },
        spec: {
          restartPolicy: "OnFailure",
          containers: [
            {
              name: "psql",
              image: "postgres:16-alpine",
              command: ["sh", "-c", 'for f in /sql/*.sql; do echo "applying $f"; psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$f" || exit 1; done'],
              env: [dbUri],
              // Kyverno require-readiness-probe asks every container for one.
              readinessProbe: { exec: { command: ["/bin/true"] }, periodSeconds: 30 },
              volumeMounts: [{ name: "sql", mountPath: "/sql", readOnly: true }],
              resources: { requests: { cpu: "50m", memory: "64Mi" }, limits: { memory: "128Mi" } },
              securityContext: { allowPrivilegeEscalation: false, runAsNonRoot: true, runAsUser: 70 },
            },
          ],
          volumes: [{ name: "sql", configMap: { name: sql.metadata.name } }],
        },
      },
    },
  },
  { ...k, dependsOn: [shopNamespace, sql] },
);

const api = new k8s.apps.v1.Deployment(
  "shopapi",
  {
    metadata: { name: "shopapi", namespace: ns, labels },
    spec: {
      replicas,
      // Surge one at a time, never drop below desired: no outage while
      // the spread converges on tight nodes.
      strategy: { type: "RollingUpdate", rollingUpdate: { maxSurge: 1, maxUnavailable: 0 } },
      selector: { matchLabels: { app: "shopapi" } },
      template: {
        metadata: { labels },
        spec: {
          // PostgREST never calls the Kubernetes API: no token (K8S-SEC-007).
          automountServiceAccountToken: false,
          // Hard zone spread (NET-K8S-002): DoNotSchedule guarantees one
          // replica per zone. matchLabelKeys scopes the skew to this
          // ReplicaSet so a rollout cannot end with both pods in one zone.
          // No nodeAffinity: the scheduler (or Karpenter, whose NodePool
          // allows both zones) picks the zone that keeps skew <= 1.
          topologySpreadConstraints: [
            { maxSkew: 1, topologyKey: "topology.kubernetes.io/zone", whenUnsatisfiable: "DoNotSchedule", labelSelector: { matchLabels: { app: "shopapi" } }, matchLabelKeys: ["pod-template-hash"] },
          ],
          affinity: {
            podAntiAffinity: {
              preferredDuringSchedulingIgnoredDuringExecution: [
                { weight: 100, podAffinityTerm: { topologyKey: "kubernetes.io/hostname", labelSelector: { matchLabels: { app: "shopapi" } } } },
              ],
            },
          },
          containers: [
            {
              name: "postgrest",
              image: "postgrest/postgrest:v16.4",
              ports: [{ name: "http", containerPort: 3000 }],
              env: [
                { name: "PGRST_DB_URI", valueFrom: dbUri.valueFrom },
                { name: "PGRST_DB_SCHEMAS", value: "api" },
                { name: "PGRST_DB_ANON_ROLE", value: "web_anon" },
                { name: "PGRST_OPENAPI_SERVER_PROXY_URI", value: "http://127.0.0.1:3000" },
              ],
              readinessProbe: { httpGet: { path: "/items?limit=1", port: "http" }, periodSeconds: 10 },
              resources: { requests: { cpu: "25m", memory: "64Mi" }, limits: { memory: "128Mi" } },
              securityContext: { allowPrivilegeEscalation: false, runAsNonRoot: true, readOnlyRootFilesystem: true },
            },
          ],
        },
      },
    },
  },
  // Not ready in 5 minutes: the run fails and the run pane says why.
  { ...k, dependsOn: [shopNamespace, migrate], customTimeouts: { create: "5m", update: "5m" } },
);

const service = new k8s.core.v1.Service("shopapi", {
  metadata: { name: "shopapi", namespace: ns, labels },
  spec: { selector: { app: "shopapi" }, ports: [{ name: "http", port: 80, targetPort: "http" }] },
}, k);

// A drain keeps one replica serving (only with 2+: with 1 it would block
// every node drain).
if (replicas > 1) {
  new k8s.policy.v1.PodDisruptionBudget("shopapi", {
    metadata: { name: "shopapi", namespace: ns, labels },
    spec: { minAvailable: 1, selector: { matchLabels: { app: "shopapi" } } },
  }, k);
}

// Ingress NetworkPolicy: upgrades/pgcluster denies ingress by default in
// shop; this allows the API's own port from the VPC: the ALB (target type
// ip) reaches the pod from its ENIs in the cluster subnets, and so does the
// API server's service proxy (kubectl port-forward goes through the kubelet,
// which is allowed anyway). The migrate Job takes no ingress.
const vpcCidr = aws.ec2.getVpcOutput({ id: aws.eks.getClusterOutput({ name: clusterName }).vpcConfig.vpcId }).cidrBlock;
new k8s.networking.v1.NetworkPolicy("allow-shopapi", {
  metadata: { name: "allow-shopapi", namespace: ns, labels },
  spec: { podSelector: { matchLabels: { app: "shopapi" } }, policyTypes: ["Ingress"], ingress: [{ from: [{ ipBlock: { cidr: vpcCidr } }], ports: [{ protocol: "TCP", port: 3000 }] }] },
}, k);

// expose=alb: the drill's Ingress shape (docs/disaster-drill-2026-10-11.md).
// Targets are the pod IPs (target type ip); the health check is the API's own
// GET /items. The ALB carries project=shopapi (the lbc stack's default tags
// have no project, #93), so vaults/templates/shopapi.yaml owns it. Taking
// this stack down deletes the Ingress and the controller deletes the ALB.
const ingress = expose === "alb" ? new k8s.networking.v1.Ingress("shopapi", {
  metadata: {
    name: "shopapi",
    namespace: ns,
    labels,
    annotations: {
      "alb.ingress.kubernetes.io/scheme": "internet-facing",
      "alb.ingress.kubernetes.io/target-type": "ip",
      "alb.ingress.kubernetes.io/healthcheck-path": "/items",
      "alb.ingress.kubernetes.io/healthcheck-interval-seconds": "10",
      "alb.ingress.kubernetes.io/healthy-threshold-count": "2",
      "alb.ingress.kubernetes.io/unhealthy-threshold-count": "2",
      // cloudspider:open-path: the map's OPEN, the reach lamp and SNIFF use
      // http://<alb>/items, the API's main path.
      "alb.ingress.kubernetes.io/tags": `project=shopapi,cluster=${clusterName},cloudspider=expendable,cloudspider:open-path=/items`,
    },
  },
  spec: {
    ingressClassName: "alb",
    rules: [{ http: { paths: [{ path: "/", pathType: "Prefix", backend: { service: { name: "shopapi", port: { number: 80 } } } }] } }],
  },
}, { ...k, dependsOn: [shopNamespace, service, api], customTimeouts: { create: "10m", update: "10m" } }) : null;

export const namespace = ns;
export const deployment = api.metadata.name;
export const migrationJob = migrate.metadata.name;
export const portForward = `kubectl -n ${ns} port-forward svc/shopapi 3000:80`;
export const exposed = expose;
export const replicaCount = replicas;
export const url = ingress ? ingress.status.loadBalancer.ingress[0].hostname.apply((host) => `http://${host}/items`) : "";
