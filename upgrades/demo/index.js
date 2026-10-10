import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import { inheritTags, stackTags } from "../tags.js";

// The demo workload for the EKS cluster from upgrades/eks. Stack: demo.
//   web (podinfo) → api (podinfo), loadgen hits web (some 500s and slow calls
//   on purpose), and an ADOT collector DaemonSet that ships
//     - every demo pod's log lines (filelog) and OTLP logs → CloudWatch Logs
//       /cloudspider/eks/<cluster>/demo (kept 1 day)
//     - OTLP traces from podinfo → X-Ray
//   The collector gets AWS credentials from EKS Pod Identity (no keys).
// Also: the metrics-server add-on (pod CPU/memory for Cloud Spider) and the
// ClusterRole that lets Cloud Spider's read-only viewer role list nodes and
// metrics. No load balancer: reach web with kubectl port-forward.
const config = new pulumi.Config();
const clusterName = config.get("clusterName") || "cloudspider-up";
const region = "eu-north-1";
const ns = "demo";

// Vault: vaults/demo.yaml selects project=demo.
inheritTags(pulumi, stackTags("demo", { cluster: clusterName }));
const tags = { cloudspider: "expendable" };

const cluster = aws.eks.getClusterOutput({ name: clusterName });
const kubeconfig = pulumi.all([cluster.endpoint, cluster.certificateAuthorities]).apply(([endpoint, cas]) =>
  JSON.stringify({
    apiVersion: "v1",
    kind: "Config",
    clusters: [{ name: clusterName, cluster: { server: endpoint, "certificate-authority-data": cas[0].data } }],
    contexts: [{ name: clusterName, context: { cluster: clusterName, user: clusterName } }],
    "current-context": clusterName,
    users: [{ name: clusterName, user: { exec: { apiVersion: "client.authentication.k8s.io/v1beta1", command: "aws", args: ["--region", region, "eks", "get-token", "--cluster-name", clusterName, "--output", "json"] } } }],
  }),
);
const provider = new k8s.Provider("eks", { kubeconfig, enableServerSideApply: true });
const k = { provider };

// Add-ons: Pod Identity (collector credentials) and metrics-server.
const podIdentity = new aws.eks.Addon("pod-identity", { clusterName, addonName: "eks-pod-identity-agent", resolveConflictsOnCreate: "OVERWRITE", tags });
new aws.eks.Addon("metrics-server", { clusterName, addonName: "metrics-server", resolveConflictsOnCreate: "OVERWRITE", tags });

// Cloud Spider's viewer group (upgrades/eks maps the viewer role to it):
// nodes and metrics on top of AmazonEKSViewPolicy. Read verbs only.
new k8s.rbac.v1.ClusterRole("cloudspider-viewer", {
  metadata: { name: "cloudspider-viewer-extra" },
  rules: [
    { apiGroups: [""], resources: ["nodes"], verbs: ["get", "list", "watch"] },
    { apiGroups: ["metrics.k8s.io"], resources: ["pods", "nodes"], verbs: ["get", "list"] },
  ],
}, k);
new k8s.rbac.v1.ClusterRoleBinding("cloudspider-viewer", {
  metadata: { name: "cloudspider-viewer-extra" },
  roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "cloudspider-viewer-extra" },
  subjects: [{ apiGroup: "rbac.authorization.k8s.io", kind: "Group", name: "cloudspider-viewers" }],
}, k);

const namespace = new k8s.core.v1.Namespace("demo", { metadata: { name: ns, labels: { "app.kubernetes.io/part-of": "cloudspider-demo" } } }, k);
const inNs = { ...k, dependsOn: [namespace] };

// Logs and traces in AWS.
export const logGroupName = `/cloudspider/eks/${clusterName}/demo`;
const logGroup = new aws.cloudwatch.LogGroup("demo", { name: logGroupName, retentionInDays: 1, tags });
const collectorRole = new aws.iam.Role("collector", {
  name: `${clusterName}-demo-collector`,
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Principal: { Service: "pods.eks.amazonaws.com" }, Action: ["sts:AssumeRole", "sts:TagSession"] }],
  }),
  inlinePolicies: [
    {
      name: "logs-and-traces",
      policy: logGroup.arn.apply((arn) =>
        JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            { Effect: "Allow", Action: ["logs:CreateLogStream", "logs:PutLogEvents", "logs:DescribeLogStreams"], Resource: [arn, `${arn}:*`] },
            { Effect: "Allow", Action: ["xray:PutTraceSegments", "xray:PutTelemetryRecords", "xray:GetSamplingRules", "xray:GetSamplingTargets"], Resource: "*" },
          ],
        }),
      ),
    },
  ],
  tags,
});
const collectorAccount = new k8s.core.v1.ServiceAccount("otel-collector", { metadata: { name: "otel-collector", namespace: ns } }, inNs);
new aws.eks.PodIdentityAssociation("otel-collector", { clusterName, namespace: ns, serviceAccount: "otel-collector", roleArn: collectorRole.arn, tags }, { dependsOn: [podIdentity] });

export const collectorConfig = `receivers:
  otlp:
    protocols:
      grpc: { endpoint: 0.0.0.0:4317 }
      http: { endpoint: 0.0.0.0:4318 }
  filelog:
    include: [/var/log/pods/${ns}_*/*/*.log]
    exclude: [/var/log/pods/${ns}_otel-collector-*/*/*.log]
    start_at: end
    include_file_path: true
    operators:
      - type: container
processors:
  batch: { timeout: 5s }
  memory_limiter: { check_interval: 5s, limit_mib: 150 }
exporters:
  awscloudwatchlogs:
    region: ${region}
    log_group_name: ${logGroupName}
    log_stream_name: pods
  awsxray:
    region: ${region}
service:
  pipelines:
    logs:
      receivers: [filelog, otlp]
      processors: [memory_limiter, batch]
      exporters: [awscloudwatchlogs]
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [awsxray]
`;
const collectorConfigMap = new k8s.core.v1.ConfigMap("otel-collector", { metadata: { name: "otel-collector", namespace: ns }, data: { "config.yaml": collectorConfig } }, inNs);
const collectorLabels = { app: "otel-collector" };
new k8s.apps.v1.DaemonSet("otel-collector", {
  metadata: { name: "otel-collector", namespace: ns },
  spec: {
    selector: { matchLabels: collectorLabels },
    template: {
      metadata: { labels: collectorLabels },
      spec: {
        serviceAccountName: collectorAccount.metadata.name,
        containers: [{
          name: "collector",
          image: "public.ecr.aws/aws-observability/aws-otel-collector:v0.50.0",
          args: ["--config=/conf/config.yaml"],
          ports: [{ containerPort: 4317, name: "otlp-grpc" }, { containerPort: 4318, name: "otlp-http" }],
          resources: { requests: { cpu: "20m", memory: "64Mi" }, limits: { memory: "200Mi" } },
          volumeMounts: [{ name: "conf", mountPath: "/conf" }, { name: "pods", mountPath: "/var/log/pods", readOnly: true }],
        }],
        volumes: [{ name: "conf", configMap: { name: collectorConfigMap.metadata.name } }, { name: "pods", hostPath: { path: "/var/log/pods" } }],
      },
    },
  },
}, inNs);
new k8s.core.v1.Service("otel-collector", { metadata: { name: "otel-collector", namespace: ns }, spec: { selector: collectorLabels, ports: [{ name: "otlp-grpc", port: 4317 }, { name: "otlp-http", port: 4318 }] } }, inNs);

// The app: podinfo twice (web calls api), and a load generator.
function podinfo(name, extraArgs = []) {
  const labels = { app: name };
  new k8s.apps.v1.Deployment(name, {
    metadata: { name, namespace: ns },
    spec: {
      replicas: 1,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          containers: [{
            name,
            image: "ghcr.io/stefanprodan/podinfo:6.7.1",
            command: ["./podinfo", "--port=9898", "--level=info", `--otel-service-name=${name}`, ...extraArgs],
            env: [{ name: "OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", value: "otel-collector:4317" }],
            ports: [{ containerPort: 9898, name: "http" }],
            readinessProbe: { httpGet: { path: "/readyz", port: 9898 }, periodSeconds: 10 },
            resources: { requests: { cpu: "10m", memory: "32Mi" }, limits: { memory: "96Mi" } },
          }],
        },
      },
    },
  }, inNs);
  new k8s.core.v1.Service(name, { metadata: { name, namespace: ns }, spec: { selector: labels, ports: [{ name: "http", port: 9898 }] } }, inNs);
}
podinfo("api");
podinfo("web", ["--backend-url=http://api:9898/echo"]);

new k8s.apps.v1.Deployment("loadgen", {
  metadata: { name: "loadgen", namespace: ns },
  spec: {
    replicas: 1,
    selector: { matchLabels: { app: "loadgen" } },
    template: {
      metadata: { labels: { app: "loadgen" } },
      spec: {
        containers: [{
          name: "loadgen",
          image: "busybox:1.36",
          command: ["sh", "-c", "while true; do for p in / /echo /status/500 /delay/1; do wget -q -T 5 -O /dev/null http://web:9898$p && echo \"loadgen: GET $p ok\" || echo \"loadgen: GET $p failed\"; done; sleep 10; done"],
          resources: { requests: { cpu: "5m", memory: "8Mi" }, limits: { memory: "32Mi" } },
        }],
      },
    },
  },
}, inNs);

export const namespaceName = ns;
export const portForward = `kubectl -n ${ns} port-forward svc/web 9898:9898   # then open http://127.0.0.1:9898`;
