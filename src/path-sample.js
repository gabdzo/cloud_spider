const LB = "sample-lb-api";
const VPC = "sample-eks-vpc";
const ALL_OUT = [{ protocol: "-1", from: -1, to: -1, cidrs: ["0.0.0.0/0"], groupIds: [] }];
const NODE_TAGS = [
  { key: "eks:cluster-name", value: "cloudspider-up" },
  { key: "eks:nodegroup-name", value: "general" },
];

export function samplePathGraph() {
  return {
    region: "sample",
    loadBalancers: [
      {
        arn: LB,
        name: "k8s-demo-api",
        dns: "k8s-demo-api-7b31d2.eu-north-1.elb.amazonaws.com",
        scheme: "internet-facing",
        type: "application",
        state: "active",
        stateReason: "",
        vpcId: VPC,
        subnetIds: ["sample-public-a", "sample-public-b"],
        zones: ["eu-north-1a", "eu-north-1b"],
        securityGroupIds: ["sample-sg-alb"],
      },
    ],
    listeners: [
      { arn: "sample-listener-80", lbArn: LB, port: 80, protocol: "HTTP", defaultActions: [] },
      { arn: "sample-listener-443", lbArn: LB, port: 443, protocol: "HTTPS", defaultActions: [] },
    ],
    rules: [
      {
        arn: "sample-rule-80-default",
        listenerArn: "sample-listener-80",
        priority: "default",
        isDefault: true,
        hosts: [],
        paths: [],
        actions: [
          { type: "redirect", targetGroupArns: [], redirectPort: "443", redirectProtocol: "HTTPS", statusCode: "HTTP_301" },
        ],
      },
      {
        arn: "sample-rule-443-api",
        listenerArn: "sample-listener-443",
        priority: "1",
        isDefault: false,
        hosts: ["api.sample.test"],
        paths: [],
        actions: [{ type: "forward", targetGroupArns: ["sample-tg-api"], redirectPort: "", redirectProtocol: "", statusCode: "" }],
      },
      {
        arn: "sample-rule-443-web",
        listenerArn: "sample-listener-443",
        priority: "2",
        isDefault: false,
        hosts: ["web.sample.test"],
        paths: [],
        actions: [{ type: "forward", targetGroupArns: ["sample-tg-web"], redirectPort: "", redirectProtocol: "", statusCode: "" }],
      },
      {
        arn: "sample-rule-443-default",
        listenerArn: "sample-listener-443",
        priority: "default",
        isDefault: true,
        hosts: [],
        paths: [],
        actions: [{ type: "fixed-response", targetGroupArns: [], redirectPort: "", redirectProtocol: "", statusCode: "404" }],
      },
    ],
    targetGroups: [
      {
        arn: "sample-tg-api",
        name: "k8s-shop-api",
        protocol: "HTTP",
        port: 8080,
        targetType: "ip",
        vpcId: VPC,
        healthPath: "/healthz",
        healthPort: "traffic-port",
        healthProtocol: "HTTP",
        matcher: "200",
        lbArns: [LB],
      },
      {
        arn: "sample-tg-web",
        name: "k8s-shop-web",
        protocol: "HTTP",
        port: 3000,
        targetType: "ip",
        vpcId: VPC,
        healthPath: "/",
        healthPort: "traffic-port",
        healthProtocol: "HTTP",
        matcher: "200",
        lbArns: [LB],
      },
    ],
    health: {
      "sample-tg-api": [
        { id: "10.43.11.20", port: 8080, zone: "eu-north-1a", state: "healthy", reason: "", description: "" },
        {
          id: "10.43.12.31",
          port: 8080,
          zone: "eu-north-1b",
          state: "unhealthy",
          reason: "Target.Timeout",
          description: "Request timed out",
        },
      ],
      "sample-tg-web": [],
    },
    tags: {
      "sample-tg-api": [
        { key: "elbv2.k8s.aws/cluster", value: "cloudspider-up" },
        { key: "service.k8s.aws/stack", value: "shop/api" },
      ],
      "sample-tg-web": [
        { key: "elbv2.k8s.aws/cluster", value: "cloudspider-up" },
        { key: "service.k8s.aws/stack", value: "shop/web" },
      ],
    },
    subnets: [
      { id: "sample-public-a", vpcId: VPC, cidr: "10.43.1.0/24", zone: "eu-north-1a" },
      { id: "sample-public-b", vpcId: VPC, cidr: "10.43.2.0/24", zone: "eu-north-1b" },
      { id: "sample-private-a", vpcId: VPC, cidr: "10.43.11.0/24", zone: "eu-north-1a" },
      { id: "sample-private-b", vpcId: VPC, cidr: "10.43.12.0/24", zone: "eu-north-1b" },
    ],
    securityGroups: [
      {
        id: "sample-sg-alb",
        name: "alb",
        vpcId: VPC,
        ingress: [
          { protocol: "tcp", from: 80, to: 80, cidrs: ["0.0.0.0/0"], groupIds: [] },
          { protocol: "tcp", from: 443, to: 443, cidrs: ["0.0.0.0/0"], groupIds: [] },
        ],
        egress: ALL_OUT,
      },
      {
        id: "sample-sg-node-a",
        name: "nodes-a",
        vpcId: VPC,
        ingress: [{ protocol: "tcp", from: 8080, to: 8080, cidrs: [], groupIds: ["sample-sg-alb"] }],
        egress: ALL_OUT,
      },
      {
        id: "sample-sg-node-b",
        name: "nodes-b",
        vpcId: VPC,
        ingress: [{ protocol: "tcp", from: 22, to: 22, cidrs: ["10.43.0.0/16"], groupIds: [] }],
        egress: ALL_OUT,
      },
    ],
    routeTables: [
      {
        id: "sample-rtb-public",
        vpcId: VPC,
        main: false,
        subnetIds: ["sample-public-a", "sample-public-b"],
        routes: [
          { dest: "10.43.0.0/16", target: "local", state: "active" },
          { dest: "0.0.0.0/0", target: "igw-sample", state: "active" },
        ],
      },
      {
        id: "sample-rtb-private",
        vpcId: VPC,
        main: true,
        subnetIds: [],
        routes: [{ dest: "10.43.0.0/16", target: "local", state: "active" }],
      },
    ],
    interfaces: [
      {
        id: "sample-eni-a",
        ip: "10.43.11.20",
        subnetId: "sample-private-a",
        groupIds: ["sample-sg-node-a"],
        instanceId: "sample-node-a",
        description: "aws-K8S-sample-node-a",
      },
      {
        id: "sample-eni-b",
        ip: "10.43.12.31",
        subnetId: "sample-private-b",
        groupIds: ["sample-sg-node-b"],
        instanceId: "sample-node-b",
        description: "aws-K8S-sample-node-b",
      },
    ],
    nodes: [
      {
        id: "sample-node-a",
        state: "running",
        vpcId: VPC,
        subnetId: "sample-private-a",
        privateIp: "10.43.11.10",
        groupIds: ["sample-sg-node-a"],
        name: "cloudspider-up-node-a",
        tags: NODE_TAGS,
      },
      {
        id: "sample-node-b",
        state: "running",
        vpcId: VPC,
        subnetId: "sample-private-b",
        privateIp: "10.43.12.10",
        groupIds: ["sample-sg-node-b"],
        name: "cloudspider-up-node-b",
        tags: NODE_TAGS,
      },
    ],
    clusters: [
      {
        name: "cloudspider-up",
        status: "ACTIVE",
        version: "1.33",
        vpcId: VPC,
        issues: [],
        nodegroups: [{ name: "general", status: "ACTIVE", issues: [], desired: 2 }],
      },
    ],
    metrics: { [LB]: { elb502: 0, elb503: 7, elb504: 12, target5xx: 0, requests: 940 } },
    notes: [],
  };
}
