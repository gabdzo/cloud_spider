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
