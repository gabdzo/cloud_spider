import { REGION, helmRelease, podIdentityRole, setup, small, viewerAccess } from "./common.js";

// KEDA (Helm) and a worked example: a jobs-worker Deployment (aws-cli,
// receive + delete) that KEDA scales from 0 to 3 on the depth of its own SQS
// queue, <cluster>-keda-jobs. The operator reads the queue depth with its
// own Pod Identity role; the worker has another that may receive and delete.
// Send work: aws sqs send-message --queue-url <queueUrl> --message-body hi
export default function keda({ pulumi, aws, k8s, addon }) {
  const { clusterName, k, tags } = setup({ pulumi, aws, k8s, addon });
  const queue = new aws.sqs.Queue("jobs", { name: `${clusterName}-keda-jobs`, messageRetentionSeconds: 3600, visibilityTimeoutSeconds: 60, sqsManagedSseEnabled: true, tags });
  const read = queue.arn.apply((arn) => ({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["sqs:GetQueueAttributes", "sqs:GetQueueUrl"], Resource: arn }] }));
  const work = queue.arn.apply((arn) => ({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Action: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:GetQueueUrl"], Resource: arn }] }));
  const operator = podIdentityRole({ pulumi, aws, name: "keda-operator", clusterName, namespace: addon.namespace, serviceAccount: "keda-operator", inline: read, tags });
  const release = helmRelease(k8s, k, addon, {
    operator: { replicaCount: 1 },
    metricsServer: { replicaCount: 1 },
    webhooks: { replicaCount: 1 },
    resources: {
      operator: small("50m", "96Mi", "384Mi"),
      metricServer: small("50m", "96Mi", "384Mi"),
      webhooks: small("20m", "48Mi", "192Mi"),
    },
  }, { dependsOn: [operator.association] });

  const ns = new k8s.core.v1.Namespace("keda-demo", { metadata: { name: "keda-demo" } }, k);
  const inNs = { ...k, dependsOn: [ns] };
  const account = new k8s.core.v1.ServiceAccount("jobs-worker", { metadata: { name: "jobs-worker", namespace: "keda-demo" } }, inNs);
  const worker = podIdentityRole({ pulumi, aws, name: "keda-jobs-worker", clusterName, namespace: "keda-demo", serviceAccount: "jobs-worker", inline: work, tags });
  const labels = { app: "jobs-worker" };
  const script = [
    "while true; do",
    "  handle=$(aws sqs receive-message --queue-url \"$QUEUE_URL\" --wait-time-seconds 20 --max-number-of-messages 1 --query 'Messages[0].ReceiptHandle' --output text)",
    "  if [ -n \"$handle\" ] && [ \"$handle\" != None ]; then echo \"job done\"; sleep 5; aws sqs delete-message --queue-url \"$QUEUE_URL\" --receipt-handle \"$handle\"; fi",
    "done",
  ].join("\n");
  const deployment = new k8s.apps.v1.Deployment("jobs-worker", {
    metadata: { name: "jobs-worker", namespace: "keda-demo" },
    spec: {
      replicas: 0,
      selector: { matchLabels: labels },
      template: {
        metadata: { labels },
        spec: {
          serviceAccountName: account.metadata.name,
          securityContext: { runAsNonRoot: true, runAsUser: 1000, seccompProfile: { type: "RuntimeDefault" } },
          containers: [{
            name: "worker",
            image: "amazon/aws-cli:2.37.12",
            command: ["/bin/sh", "-c", script],
            env: [{ name: "QUEUE_URL", value: queue.url }, { name: "AWS_REGION", value: REGION }, { name: "HOME", value: "/tmp" }],
            resources: small("20m", "64Mi", "128Mi"),
            securityContext: { allowPrivilegeEscalation: false, capabilities: { drop: ["ALL"] } },
          }],
        },
      },
    },
  }, { ...inNs, dependsOn: [ns, worker.association], ignoreChanges: ["spec.replicas"] });
  const auth = new k8s.apiextensions.CustomResource("keda-aws", {
    apiVersion: "keda.sh/v1alpha1",
    kind: "TriggerAuthentication",
    metadata: { name: "keda-aws", namespace: "keda-demo" },
    spec: { podIdentity: { provider: "aws" } },
  }, { ...k, dependsOn: [release, ns] });
  new k8s.apiextensions.CustomResource("jobs-worker", {
    apiVersion: "keda.sh/v1alpha1",
    kind: "ScaledObject",
    metadata: { name: "jobs-worker", namespace: "keda-demo" },
    spec: {
      scaleTargetRef: { name: deployment.metadata.name },
      minReplicaCount: 0,
      maxReplicaCount: 3,
      pollingInterval: 15,
      cooldownPeriod: 60,
      triggers: [{ type: "aws-sqs-queue", authenticationRef: { name: "keda-aws" }, metadata: { queueURL: queue.url, queueLength: "5", awsRegion: REGION } }],
    },
  }, { ...k, dependsOn: [auth, deployment] });
  viewerAccess(k8s, k, addon.id, [{ apiGroups: ["keda.sh"], resources: ["scaledobjects", "scaledjobs", "triggerauthentications"] }], { dependsOn: [release] });
  return { version: addon.appVersion, details: { queueUrl: queue.url } };
}
