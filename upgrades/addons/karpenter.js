import { REGION, fill, helmRelease, podIdentityRole, policyFile, setup, small, viewerAccess } from "./common.js";

// Karpenter (Helm, OCI) for an EKS cluster from upgrades/eks:
//   - the node role (+ an EC2_LINUX access entry) the nodes it launches use
//   - the controller role through Pod Identity, with the upstream managed
//     policies of policies/karpenter-controller.json (vendored, pinned)
//   - the interruption queue and its EventBridge rules (spot warnings, health)
//   - one EC2NodeClass (AL2023, the cluster's subnets and security group,
//     20 GB encrypted gp3, IMDSv2) and one NodePool: arm64 t4g.small/medium,
//     spot first, capped at 4 vCPU, consolidated a minute after it is empty.
// The controller runs on the cluster's own node group (the chart keeps it
// off Karpenter's nodes).
export default function karpenter({ pulumi, aws, k8s, addon }) {
  const { config, clusterName, k, cluster, tags } = setup({ pulumi, aws, k8s, addon });
  const capacity = config.get("capacity") || "spot";
  if (!["spot", "on-demand"].includes(capacity)) throw new Error("capacity must be spot or on-demand");
  const account = aws.getCallerIdentityOutput({}).accountId;

  const nodeRole = new aws.iam.Role("node", {
    name: `${clusterName}-karpenter-node`,
    assumeRolePolicy: JSON.stringify({ Version: "2012-10-17", Statement: [{ Effect: "Allow", Principal: { Service: "ec2.amazonaws.com" }, Action: "sts:AssumeRole" }] }),
    tags,
  });
  ["AmazonEKS_CNI_Policy", "AmazonEKSWorkerNodePolicy", "AmazonEC2ContainerRegistryPullOnly", "AmazonSSMManagedInstanceCore"].forEach((policy) =>
    new aws.iam.RolePolicyAttachment(`node-${policy}`, { role: nodeRole.name, policyArn: `arn:aws:iam::aws:policy/${policy}` }));
  const nodeAccess = new aws.eks.AccessEntry("node", { clusterName, principalArn: nodeRole.arn, type: "EC2_LINUX", tags });

  const queue = new aws.sqs.Queue("interruption", { name: `${clusterName}-karpenter`, messageRetentionSeconds: 300, sqsManagedSseEnabled: true, tags });
  new aws.sqs.QueuePolicy("interruption", {
    queueUrl: queue.url,
    policy: queue.arn.apply((arn) => JSON.stringify({
      Version: "2012-10-17",
      Id: "EC2InterruptionPolicy",
      Statement: [
        { Effect: "Allow", Principal: { Service: ["events.amazonaws.com", "sqs.amazonaws.com"] }, Action: "sqs:SendMessage", Resource: arn },
        { Sid: "DenyHTTP", Effect: "Deny", Principal: "*", Action: "sqs:*", Resource: arn, Condition: { Bool: { "aws:SecureTransport": "false" } } },
      ],
    })),
  });
  const RULES = {
    "scheduled-change": { source: ["aws.health"], "detail-type": ["AWS Health Event"] },
    "spot-interruption": { source: ["aws.ec2"], "detail-type": ["EC2 Spot Instance Interruption Warning"] },
    rebalance: { source: ["aws.ec2"], "detail-type": ["EC2 Instance Rebalance Recommendation"] },
    "state-change": { source: ["aws.ec2"], "detail-type": ["EC2 Instance State-change Notification"] },
    "capacity-reservation": { source: ["aws.ec2"], "detail-type": ["EC2 Capacity Reservation Instance Interruption Warning"] },
  };
  for (const [name, pattern] of Object.entries(RULES)) {
    const rule = new aws.cloudwatch.EventRule(name, { name: `${clusterName}-karpenter-${name}`.slice(0, 64), eventPattern: JSON.stringify(pattern), tags });
    new aws.cloudwatch.EventTarget(name, { rule: rule.name, arn: queue.arn, targetId: "KarpenterInterruptionQueueTarget" });
  }

  const vendored = policyFile("karpenter-controller.json").policies;
  const managed = Object.entries(vendored).map(([name, doc]) =>
    new aws.iam.Policy(`controller-${name}`, {
      name: `${clusterName}-karpenter-${name}`.slice(0, 128),
      policy: pulumi.all([account, nodeRole.arn, queue.arn]).apply(([accountId, nodeArn, queueArn]) => JSON.stringify(fill(doc, {
        ClusterName: clusterName,
        "AWS::Partition": "aws",
        "AWS::Region": REGION,
        "AWS::AccountId": accountId,
        "KarpenterNodeRole.Arn": nodeArn,
        "KarpenterInterruptionQueue.Arn": queueArn,
      }))),
      tags,
    }));
  // Spot needs the account's EC2 Spot service-linked role. An account that
  // never ran spot has none, and CreateFleet then fails with
  // AuthFailure.ServiceLinkedRoleCreationNotPermitted (live test 2026-10-11):
  // let the controller create that one role, nothing else.
  const spotRole = {
    Version: "2012-10-17",
    Statement: [{
      Sid: "AllowSpotServiceLinkedRole",
      Effect: "Allow",
      Action: "iam:CreateServiceLinkedRole",
      Resource: "*",
      Condition: { StringEquals: { "iam:AWSServiceName": "spot.amazonaws.com" } },
    }],
  };
  const controller = podIdentityRole({ pulumi, aws, name: "karpenter", clusterName, namespace: addon.namespace, serviceAccount: "karpenter", managed: managed.map((policy) => policy.arn), inline: spotRole, tags });

  const release = helmRelease(k8s, k, addon, {
    replicas: 1,
    serviceAccount: { name: "karpenter" },
    settings: { clusterName, interruptionQueue: queue.name },
    controller: { resources: small("100m", "256Mi", "512Mi") },
    logLevel: "info",
  }, { dependsOn: [controller.association, nodeAccess] });

  const nodeClass = new k8s.apiextensions.CustomResource("nodeclass", {
    apiVersion: "karpenter.k8s.aws/v1",
    kind: "EC2NodeClass",
    metadata: { name: "default" },
    spec: {
      role: nodeRole.name,
      amiSelectorTerms: [{ alias: "al2023@latest" }],
      subnetSelectorTerms: cluster.vpcConfig.subnetIds.apply((ids) => ids.map((id) => ({ id }))),
      securityGroupSelectorTerms: [{ id: cluster.vpcConfig.clusterSecurityGroupId }],
      blockDeviceMappings: [{ deviceName: "/dev/xvda", ebs: { volumeSize: "20Gi", volumeType: "gp3", encrypted: true, deleteOnTermination: true } }],
      metadataOptions: { httpEndpoint: "enabled", httpTokens: "required", httpPutResponseHopLimit: 1 },
      // The nodes and their volumes are claimed by the karpenter vault.
      tags: { project: addon.id, cluster: clusterName, "managed-by": "karpenter", cloudspider: "expendable" },
    },
  }, { ...k, dependsOn: [release] });

  new k8s.apiextensions.CustomResource("nodepool", {
    apiVersion: "karpenter.sh/v1",
    kind: "NodePool",
    metadata: { name: "default" },
    spec: {
      template: {
        metadata: { labels: { "cloudspider/karpenter": "true" } },
        spec: {
          nodeClassRef: { group: "karpenter.k8s.aws", kind: "EC2NodeClass", name: "default" },
          requirements: [
            { key: "kubernetes.io/arch", operator: "In", values: ["arm64"] },
            { key: "node.kubernetes.io/instance-type", operator: "In", values: ["t4g.small", "t4g.medium"] },
            { key: "karpenter.sh/capacity-type", operator: "In", values: capacity === "spot" ? ["spot", "on-demand"] : ["on-demand"] },
          ],
          expireAfter: "24h",
        },
      },
      limits: { cpu: "4", memory: "8Gi" },
      disruption: { consolidationPolicy: "WhenEmptyOrUnderutilized", consolidateAfter: "1m" },
    },
  }, { ...k, dependsOn: [nodeClass] });

  viewerAccess(k8s, k, addon.id, [
    { apiGroups: ["karpenter.sh"], resources: ["nodepools", "nodeclaims"] },
    { apiGroups: ["karpenter.k8s.aws"], resources: ["ec2nodeclasses"] },
  ], { dependsOn: [release] });
  return { version: addon.appVersion, details: { capacity, nodeRole: nodeRole.name, queue: queue.name, limitCpu: "4" } };
}
