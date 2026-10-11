import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as k8s from "@pulumi/kubernetes";
import { inheritTags, stackTags } from "../tags.js";
import { usesEksAddon } from "../eks-addons.js";

// The demo workload for the EKS cluster from upgrades/eks. Stack: demo.
//   web (podinfo) → api (podinfo), loadgen hits web (some 500s and slow calls
//   on purpose), and an ADOT collector DaemonSet that ships
//     - every demo pod's log lines (filelog) and OTLP logs → CloudWatch Logs
//       /cloudspider/eks/<cluster>/demo (kept 1 day)
//     - OTLP traces from podinfo → X-Ray
//     - node/pod/container CPU, memory, filesystem and network (kubeletstats)
//       and node disk, filesystem and load (hostmetrics), sent over OTLP to a
//       one-replica otel-gateway that serves them as Prometheus text on the
//       otel-metrics Service. Cloud Spider reads that read-only through the
//       kube API service proxy: no CloudWatch custom metrics, no extra cost.
//   The collector gets AWS credentials from EKS Pod Identity (no keys).
// Needs the EKS stack's Pod Identity agent and metrics-server add-ons (it
// never creates them). Also: the ClusterRole that lets Cloud Spider's read-only viewer role list nodes and
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

// Add-ons: Pod Identity (collector credentials) and metrics-server come
// with the EKS stack (docs/design/stack-dependencies.md); this stack never
// creates them and stops without them. One it made before that rule it
// keeps (retainOnDelete) until scripts/migrate-eks-addons.mjs hands it over.
const uses = (name, addonName) => usesEksAddon({ pulumi, aws, clusterName, addonName, self: "demo", name, tags });
await uses("pod-identity", "eks-pod-identity-agent");
await uses("metrics-server", "metrics-server");

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
new aws.eks.PodIdentityAssociation("otel-collector", { clusterName, namespace: ns, serviceAccount: "otel-collector", roleArn: collectorRole.arn, tags });

// The collector reads the kubelet's stats API on its own node.
new k8s.rbac.v1.ClusterRole("otel-kubeletstats", {
  metadata: { name: "cloudspider-otel-kubeletstats" },
  rules: [{ apiGroups: [""], resources: ["nodes", "nodes/stats", "nodes/proxy"], verbs: ["get", "list", "watch"] }],
}, k);
new k8s.rbac.v1.ClusterRoleBinding("otel-kubeletstats", {
  metadata: { name: "cloudspider-otel-kubeletstats" },
  roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "ClusterRole", name: "cloudspider-otel-kubeletstats" },
  subjects: [{ kind: "ServiceAccount", name: "otel-collector", namespace: ns }],
}, inNs);

// Cloud Spider's viewer may GET the otel-metrics Service through the API
// server proxy, that one Service and nothing else in the namespace.
new k8s.rbac.v1.Role("viewer-otel-metrics", {
  metadata: { name: "cloudspider-viewer-otel-metrics", namespace: ns },
  rules: [{ apiGroups: [""], resources: ["services/proxy"], resourceNames: ["otel-metrics"], verbs: ["get"] }],
}, inNs);
new k8s.rbac.v1.RoleBinding("viewer-otel-metrics", {
  metadata: { name: "cloudspider-viewer-otel-metrics", namespace: ns },
  roleRef: { apiGroup: "rbac.authorization.k8s.io", kind: "Role", name: "cloudspider-viewer-otel-metrics" },
  subjects: [{ apiGroup: "rbac.authorization.k8s.io", kind: "Group", name: "cloudspider-viewers" }],
}, inNs);

// Both collectors run the upstream contrib image: ADOT (aws-otel-collector)
// ships no kubeletstats or hostmetrics receiver, so the node agent crashed on
// start. Multi-arch (t4g arm64 and amd64), tag and index digest pinned; its
// entrypoint is /otelcol-contrib. Its AWS exporters (awscloudwatchlogs,
// awsxray) take EKS Pod Identity credentials (aws-sdk-go-v2 default chain).
// test/demo-otel.test.js checks both configs against this release's
// components (test/fixtures/otelcol-contrib-components.json); component ids
// use 0.162's canonical names (file_log, kubelet_stats, host_metrics,
// otlp_grpc), the old ones are deprecated aliases there.
export const COLLECTOR_IMAGE = "otel/opentelemetry-collector-contrib:0.162.0@sha256:39923a8e431bd1f57be82411999d389fcfe40857492e4365456d97a4c1f74be6";

export const collectorConfig = `receivers:
  otlp:
    protocols:
      grpc: { endpoint: 0.0.0.0:4317 }
      http: { endpoint: 0.0.0.0:4318 }
  file_log:
    include: [/var/log/pods/${ns}_*/*/*.log]
    exclude: [/var/log/pods/${ns}_otel-collector-*/*/*.log]
    start_at: end
    include_file_path: true
    operators:
      - type: container
  kubelet_stats:
    collection_interval: 30s
    auth_type: serviceAccount
    endpoint: "https://\${env:K8S_NODE_IP}:10250"
    insecure_skip_verify: true
    metric_groups: [node, pod, container]
  host_metrics:
    collection_interval: 30s
    root_path: /hostfs
    scrapers:
      load: {}
      memory: {}
      disk: {}
      filesystem:
        exclude_fs_types: { fs_types: [autofs, binfmt_misc, cgroup2, configfs, debugfs, devpts, devtmpfs, fusectl, hugetlbfs, mqueue, nsfs, overlay, proc, procfs, pstore, rpc_pipefs, securityfs, selinuxfs, squashfs, sysfs, tracefs, tmpfs], match_type: strict }
      network: {}
processors:
  resource/node:
    attributes:
      - { key: k8s.node.name, value: "\${env:K8S_NODE_NAME}", action: insert }
  batch: { timeout: 5s }
  memory_limiter: { check_interval: 5s, limit_mib: 150 }
exporters:
  awscloudwatchlogs:
    region: ${region}
    log_group_name: ${logGroupName}
    log_stream_name: pods
  awsxray:
    region: ${region}
  otlp_grpc/gateway:
    endpoint: otel-gateway:4317
    tls: { insecure: true }
service:
  pipelines:
    logs:
      receivers: [file_log, otlp]
      processors: [memory_limiter, batch]
      exporters: [awscloudwatchlogs]
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [awsxray]
    metrics:
      receivers: [kubelet_stats, host_metrics]
      processors: [memory_limiter, resource/node, batch]
      exporters: [otlp_grpc/gateway]
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
          image: COLLECTOR_IMAGE,
          args: ["--config=/conf/config.yaml"],
          // The image runs as uid 10001; /var/log/pods and the host's /proc are
          // root's. Root in the container, no privilege escalation.
          securityContext: { runAsUser: 0, runAsGroup: 0, allowPrivilegeEscalation: false },
          env: [
            { name: "K8S_NODE_NAME", valueFrom: { fieldRef: { fieldPath: "spec.nodeName" } } },
            { name: "K8S_NODE_IP", valueFrom: { fieldRef: { fieldPath: "status.hostIP" } } },
          ],
          ports: [{ containerPort: 4317, name: "otlp-grpc" }, { containerPort: 4318, name: "otlp-http" }],
          resources: { requests: { cpu: "20m", memory: "64Mi" }, limits: { memory: "200Mi" } },
          volumeMounts: [{ name: "conf", mountPath: "/conf" }, { name: "pods", mountPath: "/var/log/pods", readOnly: true }, { name: "hostfs", mountPath: "/hostfs", readOnly: true, mountPropagation: "HostToContainer" }],
        }],
        volumes: [{ name: "conf", configMap: { name: collectorConfigMap.metadata.name } }, { name: "pods", hostPath: { path: "/var/log/pods" } }, { name: "hostfs", hostPath: { path: "/" } }],
      },
    },
  },
}, inNs);
new k8s.core.v1.Service("otel-collector", { metadata: { name: "otel-collector", namespace: ns }, spec: { selector: collectorLabels, ports: [{ name: "otlp-grpc", port: 4317 }, { name: "otlp-http", port: 4318 }] } }, inNs);

// The metrics gateway: one replica takes every node's OTLP metrics and serves
// the latest values as Prometheus text on :8889 (the otel-metrics Service).
// Nothing leaves the cluster; Cloud Spider reads it through the API proxy.
export const gatewayConfig = `receivers:
  otlp:
    protocols:
      grpc: { endpoint: 0.0.0.0:4317 }
processors:
  batch: { timeout: 10s }
  memory_limiter: { check_interval: 5s, limit_mib: 100 }
exporters:
  prometheus:
    endpoint: 0.0.0.0:8889
    metric_expiration: 3m
    resource_to_telemetry_conversion: { enabled: true }
service:
  pipelines:
    metrics:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [prometheus]
`;
const gatewayConfigMap = new k8s.core.v1.ConfigMap("otel-gateway", { metadata: { name: "otel-gateway", namespace: ns }, data: { "config.yaml": gatewayConfig } }, inNs);
const gatewayLabels = { app: "otel-gateway" };
new k8s.apps.v1.Deployment("otel-gateway", {
  metadata: { name: "otel-gateway", namespace: ns },
  spec: {
    replicas: 1,
    selector: { matchLabels: gatewayLabels },
    template: {
      metadata: { labels: gatewayLabels },
      spec: {
        containers: [{
          name: "gateway",
          image: COLLECTOR_IMAGE,
          args: ["--config=/conf/config.yaml"],
          ports: [{ containerPort: 4317, name: "otlp-grpc" }, { containerPort: 8889, name: "prom" }],
          resources: { requests: { cpu: "10m", memory: "48Mi" }, limits: { memory: "128Mi" } },
          volumeMounts: [{ name: "conf", mountPath: "/conf" }],
        }],
        volumes: [{ name: "conf", configMap: { name: gatewayConfigMap.metadata.name } }],
      },
    },
  },
}, inNs);
new k8s.core.v1.Service("otel-gateway", { metadata: { name: "otel-gateway", namespace: ns }, spec: { selector: gatewayLabels, ports: [{ name: "otlp-grpc", port: 4317 }] } }, inNs);
// One port only, so the proxy path is plain .../services/otel-metrics/proxy/metrics.
new k8s.core.v1.Service("otel-metrics", { metadata: { name: "otel-metrics", namespace: ns }, spec: { selector: gatewayLabels, ports: [{ name: "prom", port: 8889, targetPort: 8889 }] } }, inNs);
export const otelMetricsPath = `/api/v1/namespaces/${ns}/services/otel-metrics/proxy/metrics`;

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
