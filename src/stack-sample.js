// SAMPLE mode's PREVIEW: a canned `pulumi preview --diff` for the open card,
// so the Stacks pane can show creates, updates and one replace that RUN would
// stop on, without pulumi, an account or a single write. RUN stays refused.
const DIFFS = {
  eks: {
    stack: "upgrade",
    rows: [
      ["~", "update", "aws:eks:Cluster", "cloudspider-up", "[diff: ~enabledClusterLogTypes]"],
      ["+", "create", "aws:eks:Addon", "amazon-cloudwatch-observability", ""],
      ["+", "create", "aws:iam:Role", "cloudwatch-agent-pod-identity", ""],
      ["+-", "replace", "aws:eks:NodeGroup", "general", "[diff: ~capacityType ON_DEMAND => SPOT, ~maxPods 17 => 110]"],
    ],
    blocked: "BLOCKED  replace aws:eks:NodeGroup general: every pod on the old nodes restarts; RUN stops and asks you to confirm it (replaceNodeGroup)",
  },
};
const GENERIC = (id) => ({
  stack: id,
  rows: [
    ["+", "create", "kubernetes:core/v1:Namespace", id, ""],
    ["+", "create", "kubernetes:helm.sh/v3:Release", id, ""],
    ["~", "update", "aws:iam:Role", `${id}-pod-identity`, "[diff: ~tags]"],
  ],
  blocked: "",
});

export function samplePreview(id = "eks", title = id) {
  const diff = DIFFS[id] || GENERIC(id);
  const count = (op) => diff.rows.filter((row) => row[1] === op).length;
  const lines = [
    `SAMPLE · made up, nothing read or changed · pulumi preview --diff --stack ${diff.stack}`,
    `Previewing update (${diff.stack}):`,
    ...diff.rows.flatMap(([mark, op, type, name, note]) => [`  ${mark.padEnd(2)} ${op.padEnd(7)} ${type}  ${name}`, ...(note ? [`             ${note}`] : [])]),
    "",
    "Resources:",
    ...[["create", "to create"], ["update", "to update"], ["replace", "to replace"]].filter(([op]) => count(op)).map(([op, text]) => `    ${count(op)} ${text}`),
    ...(diff.blocked ? ["", diff.blocked] : []),
  ];
  return {
    state: "done",
    action: "preview",
    module: id,
    stack: diff.stack,
    sample: true,
    title,
    counts: { create: count("create"), update: count("update"), replace: count("replace") },
    blocked: diff.blocked,
    steps: [{ text: `${title} · pulumi preview --diff (sample)`, status: "done" }],
    lines,
  };
}
