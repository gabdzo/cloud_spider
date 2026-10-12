// Four baseline policies, all in Audit: they report, they never block.
// Kyverno autogen copies each Pod rule to Deployments, DaemonSets, Jobs…
// kube-system and the add-ons' own namespaces are left out.
export const SKIP_NAMESPACES = ["kube-system", "kyverno", "karpenter", "keda", "cert-manager"];

const containers = (inner) => ({
  "=(ephemeralContainers)": [inner],
  "=(initContainers)": [inner],
  containers: [inner],
});

function policy(name, title, severity, description, validate, category = "Pod Security (baseline), Cloud Spider") {
  return {
    name,
    title,
    severity,
    description,
    category,
    spec: {
      background: true,
      rules: [
        {
          name,
          match: { any: [{ resources: { kinds: ["Pod"] } }] },
          exclude: { any: [{ resources: { namespaces: SKIP_NAMESPACES } }] },
          validate: { failureAction: "Audit", ...validate },
        },
      ],
    },
  };
}

export const BASELINE = [
  policy("disallow-privileged-containers", "Disallow privileged containers", "high",
    "Privileged containers can do almost anything the node can.",
    { message: "Privileged mode is not allowed: set securityContext.privileged to false.", pattern: { spec: containers({ "=(securityContext)": { "=(privileged)": "false" } }) } }),
  policy("disallow-host-path", "Disallow hostPath volumes", "medium",
    "hostPath volumes reach into the node's filesystem.",
    { message: "hostPath volumes are not allowed.", pattern: { spec: { "=(volumes)": [{ "X(hostPath)": "null" }] } } }),
  policy("require-requests", "Require CPU and memory requests", "medium",
    "Without requests the scheduler, the HPA and Karpenter cannot plan.",
    { message: "Set resources.requests.cpu and resources.requests.memory on every container.", pattern: { spec: { containers: [{ resources: { requests: { cpu: "?*", memory: "?*" } } }] } } }),
  policy("disallow-latest-tag", "Disallow the :latest tag", "medium",
    "A floating tag makes a rollback guesswork.",
    { message: "Pin an image tag; :latest and untagged images are not allowed.", pattern: { spec: containers({ image: "*:* & !*:latest" }) } }),
];

// Two easy-to-read demo policies, also Audit only, to see how Kyverno
// reports: a missing app name label and a container without a readiness
// probe. (":latest" is already in the baseline above.)
const DEMO = "Best practices (demo), Cloud Spider";
export const DEMO_POLICIES = [
  policy("require-app-name-label", "Require the app.kubernetes.io/name label", "low",
    "Every Pod says which app it belongs to, so dashboards and policies can group it.",
    { message: "Add the label app.kubernetes.io/name to the Pod template.", pattern: { metadata: { labels: { "app.kubernetes.io/name": "?*" } } } }, DEMO),
  policy("require-readiness-probe", "Require a readiness probe", "low",
    "Without a readiness probe a Service sends traffic to a container before it can answer.",
    { message: "Add a readinessProbe to every container.", pattern: { spec: { containers: [{ readinessProbe: { periodSeconds: ">0" } }] } } }, DEMO),
];

export const ALL_POLICIES = [...BASELINE, ...DEMO_POLICIES];

// Exceptions, each scoped to one workload of ours, never a namespace:
// the demo's node collector reads /var/log/pods and the host's / through
// hostPath (its job: pod logs and node metrics), so disallow-host-path does
// not apply to DaemonSet demo/otel-collector and its pods.
export const EXCEPTIONS = [
  {
    name: "demo-otel-collector-host-path",
    why: "The demo's node collector (DaemonSet demo/otel-collector) reads pod logs and node metrics through read-only hostPath mounts.",
    spec: {
      exceptions: [{ policyName: "disallow-host-path", ruleNames: ["disallow-host-path", "autogen-disallow-host-path"] }],
      match: {
        any: [
          { resources: { kinds: ["DaemonSet"], namespaces: ["demo"], names: ["otel-collector"] } },
          { resources: { kinds: ["Pod"], namespaces: ["demo"], names: ["otel-collector-*"], selector: { matchLabels: { app: "otel-collector" } } } },
        ],
      },
    },
  },
];

// Default deny for every NEW namespace (defaultDeny on the Kyverno card):
// a generate rule makes NetworkPolicy default-deny (ingress + egress, DNS
// egress to CoreDNS allowed) when a namespace is created. synchronize: a
// deleted or edited policy comes back. Only on CREATE and never for
// existing namespaces (generateExisting false): shop, demo, cnpg-system keep
// the policies their stacks wrote. Out: the system namespaces, Kyverno's
// own, and any namespace labelled cloudspider.io/allow-open=true.
// Not "operations: [CREATE]": Kyverno re-checks the trigger when it
// resyncs a deleted policy, that check is no CREATE, and the policy never
// came back (cloudspider-up 2026-10-12). A precondition on the namespace's
// creation time keeps every namespace older than the rollout out instead,
// on create, update and resync alike.
export const DEFAULT_DENY_SINCE = "2026-10-12T07:00:00Z";
export const DEFAULT_DENY_SKIP = ["kube-system", "kube-public", "kube-node-lease", "kyverno"];
export const ALLOW_OPEN_LABEL = "cloudspider.io/allow-open";
export const DEFAULT_DENY_POLICY = {
  name: "default-deny-new-namespaces",
  title: "Default-deny NetworkPolicy in new namespaces",
  severity: "high",
  category: "Multi-tenancy, Cloud Spider",
  description: "Every new namespace starts closed: no ingress, egress only to DNS. Allow what the app needs with its own NetworkPolicies.",
  spec: {
    background: true,
    rules: [
      {
        name: "default-deny",
        match: { any: [{ resources: { kinds: ["Namespace"] } }] },
        preconditions: { all: [{ key: `{{ time_after('{{request.object.metadata.creationTimestamp}}', '${DEFAULT_DENY_SINCE}') }}`, operator: "Equals", value: true }] },
        exclude: { any: [{ resources: { names: DEFAULT_DENY_SKIP } }, { resources: { selector: { matchLabels: { [ALLOW_OPEN_LABEL]: "true" } } } }] },
        generate: {
          generateExisting: false,
          synchronize: true,
          apiVersion: "networking.k8s.io/v1",
          kind: "NetworkPolicy",
          name: "default-deny",
          namespace: "{{request.object.metadata.name}}",
          data: {
            metadata: { labels: { "app.kubernetes.io/managed-by": "kyverno", "cloudspider.io/policy": "default-deny-new-namespaces" } },
            spec: {
              podSelector: {},
              policyTypes: ["Ingress", "Egress"],
              egress: [{
                to: [{ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": "kube-system" } }, podSelector: { matchLabels: { "k8s-app": "kube-dns" } } }],
                ports: [{ protocol: "UDP", port: 53 }, { protocol: "TCP", port: 53 }],
              }],
            },
          },
        },
      },
    ],
  },
};

// What Kyverno's controllers need to write the generated NetworkPolicies
// (the chart's extraResources); Kyverno refuses the policy without it.
export const GENERATE_RBAC = [{ apiGroups: ["networking.k8s.io"], resources: ["networkpolicies"], verbs: ["create", "update", "patch", "delete", "get", "list", "watch"] }];
