// Four baseline policies, all in Audit: they report, they never block.
// Kyverno autogen copies each Pod rule to Deployments, DaemonSets, Jobs…
// kube-system and the add-ons' own namespaces are left out.
export const SKIP_NAMESPACES = ["kube-system", "kyverno", "karpenter", "keda", "cert-manager"];

const containers = (inner) => ({
  "=(ephemeralContainers)": [inner],
  "=(initContainers)": [inner],
  containers: [inner],
});

function policy(name, title, severity, description, validate) {
  return {
    name,
    title,
    severity,
    description,
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
