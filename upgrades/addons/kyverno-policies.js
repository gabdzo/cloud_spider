// Four baseline policies, all in Audit: they report, they never block.
// Kyverno ValidatingPolicy (policies.kyverno.io/v1, CEL): kyverno.io/v1
// ClusterPolicy validate rules are deprecated since Kyverno 1.19 and go in
// 1.20. autogen copies each Pod check to Deployments, DaemonSets, Jobs…
// kube-system and the add-ons' own namespaces are left out (namespaceSelector
// plus a matchCondition).
export const SKIP_NAMESPACES = ["kube-system", "kyverno", "karpenter", "keda", "cert-manager"];
export const POD_CONTROLLERS = ["daemonsets", "deployments", "jobs", "statefulsets", "replicasets", "cronjobs"];
export const CEL_API = "policies.kyverno.io/v1";

// The same check on containers, initContainers and ephemeralContainers.
const everyContainer = (check) => ["object.spec.containers", "object.spec.?initContainers.orValue([])", "object.spec.?ephemeralContainers.orValue([])"].map((list) => `${list}.all(c, ${check})`).join(" && ");

function policy(name, title, severity, description, message, expression, category = "Pod Security (baseline), Cloud Spider") {
  return {
    name,
    title,
    severity,
    description,
    category,
    spec: {
      validationActions: ["Audit"],
      evaluation: { admission: { enabled: true }, background: { enabled: true } },
      // Both: Kyverno 1.19.1's background scan ignored the matchCondition
      // (cloudspider-up 2026-10-12: kube-system and cert-manager got
      // results); the namespaceSelector is what admission and background honour.
      matchConstraints: {
        namespaceSelector: { matchExpressions: [{ key: "kubernetes.io/metadata.name", operator: "NotIn", values: SKIP_NAMESPACES }] },
        resourceRules: [{ apiGroups: [""], apiVersions: ["v1"], operations: ["CREATE", "UPDATE"], resources: ["pods"] }],
      },
      matchConditions: [{ name: "skip-system-namespaces", expression: `!(object.metadata.?namespace.orValue('') in ${JSON.stringify(SKIP_NAMESPACES).replaceAll('"', "'")})` }],
      autogen: { podControllers: { controllers: POD_CONTROLLERS } },
      validations: [{ expression, message }],
    },
  };
}

export const BASELINE = [
  policy("disallow-privileged-containers", "Disallow privileged containers", "high",
    "Privileged containers can do almost anything the node can.",
    "Privileged mode is not allowed: set securityContext.privileged to false.",
    everyContainer("!c.?securityContext.?privileged.orValue(false)")),
  policy("disallow-host-path", "Disallow hostPath volumes", "medium",
    "hostPath volumes reach into the node's filesystem.",
    "hostPath volumes are not allowed.",
    "!object.spec.?volumes.orValue([]).exists(v, has(v.hostPath))"),
  policy("require-requests", "Require CPU and memory requests", "medium",
    "Without requests the scheduler, the HPA and Karpenter cannot plan.",
    "Set resources.requests.cpu and resources.requests.memory on every container.",
    "object.spec.containers.all(c, c.?resources.?requests.?cpu.orValue('') != '' && c.?resources.?requests.?memory.orValue('') != '')"),
  policy("disallow-latest-tag", "Disallow the :latest tag", "medium",
    "A floating tag makes a rollback guesswork.",
    "Pin an image tag; :latest and untagged images are not allowed.",
    everyContainer("c.image.matches('^.+[:@][^/]+$') && !c.image.endsWith(':latest')")),
];

// Two easy-to-read demo policies, also Audit only, to see how Kyverno
// reports: a missing app name label and a container without a readiness
// probe. (":latest" is already in the baseline above.)
const DEMO = "Best practices (demo), Cloud Spider";
export const DEMO_POLICIES = [
  policy("require-app-name-label", "Require the app.kubernetes.io/name label", "low",
    "Every Pod says which app it belongs to, so dashboards and policies can group it.",
    "Add the label app.kubernetes.io/name to the Pod template.",
    "object.metadata.?labels['app.kubernetes.io/name'].orValue('') != ''", DEMO),
  policy("require-readiness-probe", "Require a readiness probe", "low",
    "Without a readiness probe a Service sends traffic to a container before it can answer.",
    "Add a readinessProbe to every container.",
    "object.spec.containers.all(c, has(c.readinessProbe))", DEMO),
];

export const ALL_POLICIES = [...BASELINE, ...DEMO_POLICIES];

// Exceptions (policies.kyverno.io PolicyException), each scoped to one
// workload of ours, never a namespace: the demo's node collector reads
// /var/log/pods and the host's / through hostPath (its job: pod logs and
// node metrics), so disallow-host-path does not apply to DaemonSet
// demo/otel-collector and the pods it owns.
export const EXCEPTIONS = [
  {
    name: "demo-otel-collector-host-path",
    why: "The demo's node collector (DaemonSet demo/otel-collector) reads pod logs and node metrics through read-only hostPath mounts.",
    spec: {
      policyRefs: [{ name: "disallow-host-path", kind: "ValidatingPolicy" }],
      matchConditions: [{
        name: "demo-otel-collector",
        expression: "object.metadata.?namespace.orValue('') == 'demo' && ((object.kind == 'DaemonSet' && object.metadata.name == 'otel-collector') || (object.kind == 'Pod' && object.metadata.?labels.app.orValue('') == 'otel-collector' && object.metadata.?ownerReferences.orValue([]).exists(o, o.kind == 'DaemonSet' && o.name == 'otel-collector')))",
      }],
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
  // Renamed from default-deny-new-namespaces: Kyverno refuses any edit to a
  // generate rule (match, preconditions, even its name), so a changed rule
  // ships as a new policy.
  name: "generate-default-deny",
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
            metadata: { labels: { "app.kubernetes.io/managed-by": "kyverno", "cloudspider.io/policy": "generate-default-deny" } },
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
