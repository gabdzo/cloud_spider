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
// It adds no AWS resources (beyond the ones on its node); the vault binds it
// by its stack. Vault: vaults/templates/shopapi.yaml.
const config = new pulumi.Config();
const clusterName = config.get("clusterName") || "cloudspider-up";
const secretName = config.get("dbSecret") || "shopdb-app";
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
      replicas: 1,
      selector: { matchLabels: { app: "shopapi" } },
      template: {
        metadata: { labels },
        spec: {
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
              resources: { requests: { cpu: "50m", memory: "64Mi" }, limits: { memory: "128Mi" } },
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

new k8s.core.v1.Service("shopapi", {
  metadata: { name: "shopapi", namespace: ns, labels },
  spec: { selector: { app: "shopapi" }, ports: [{ name: "http", port: 80, targetPort: "http" }] },
}, k);

export const namespace = ns;
export const deployment = api.metadata.name;
export const migrationJob = migrate.metadata.name;
export const portForward = `kubectl -n ${ns} port-forward svc/shopapi 3000:80`;
