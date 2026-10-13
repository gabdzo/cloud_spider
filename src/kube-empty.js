// The Cluster view with no cluster to read (no kubeconfig, no such
// context): a clear empty state with how to connect one read-only, instead
// of "reading the cluster" forever. Cloud Spider shows these commands; it
// never runs them.

export function connectSteps(context = "cloudspider-viewer") {
  const ctx = context || "cloudspider-viewer";
  return [
    {
      title: "1 · A read-only identity",
      text: "The built-in view role reads workloads, Services and Events, never Secrets.",
      code: [
        "kubectl create serviceaccount cloudspider-viewer -n default",
        "kubectl create clusterrolebinding cloudspider-viewer --clusterrole=view --serviceaccount=default:cloudspider-viewer",
        "kubectl create token cloudspider-viewer -n default --duration=24h",
      ],
      alt: "OpenShift: the same with oc, or oc adm policy add-cluster-role-to-user view -z cloudspider-viewer -n default",
    },
    {
      title: `2 · A kube context named ${ctx}`,
      text: "Paste the token from step 1; the server URL is your cluster's API.",
      code: [
        "kubectl config set-credentials cloudspider-viewer --token=<token>",
        `kubectl config set-context ${ctx} --cluster=<your-cluster> --user=cloudspider-viewer`,
      ],
      alt: "Your current context is not changed.",
    },
    {
      title: "3 · Or use a context you already have",
      text: "Name it in cloudspider.yaml (scoped to namespaces if your role is namespaced), or set CLOUDSPIDER_KUBE_CONTEXT, then restart.",
      code: ["kube:", "  contexts:", "    - context: <my-context>", '      namespaces: "*"        # or [team-a, team-b]'],
      alt: "docs/RUN-ME.md §19 has the details.",
    },
  ];
}

// The region has no EKS cluster at all (not "no access"): one sentence and
// a link straight to the STACKS > EKS card. Pure text, pinned by the tests.
export function emptyRegionText(region = "") {
  const at = region || "this region";
  return { title: `No EKS cluster in ${at}`, text: `No EKS cluster in ${at}. Create one from STACKS > EKS, or pick another context.` };
}

export function createKubeEmpty(root, { onRetry = () => {}, onSample = () => {}, onStacks = () => {} } = {}) {
  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };
  let key = "";
  return {
    show({ context = "", reason = "" } = {}) {
      root.hidden = false;
      if (key === `${context}|${reason}`) return;
      key = `${context}|${reason}`;
      root.replaceChildren();
      const card = el("div", "ke-card");
      card.append(el("h2", "ke-title", "No cluster connected"));
      card.append(el("p", "ke-reason", reason || `kube context ${context || "cloudspider-viewer"} is not set up`));
      for (const step of connectSteps(context)) {
        const sec = el("section", "ke-step");
        sec.append(el("h3", "", step.title), el("p", "", step.text));
        const pre = el("pre", "ke-code");
        pre.textContent = step.code.join("\n");
        sec.append(pre, el("p", "ke-alt", step.alt));
        card.append(sec);
      }
      const row = el("div", "ke-actions");
      const retry = el("button", "ke-btn", "TRY AGAIN");
      retry.type = "button";
      retry.addEventListener("click", () => onRetry());
      const sample = el("button", "ke-btn ke-ghost", "SHOW SAMPLE");
      sample.type = "button";
      sample.addEventListener("click", () => onSample());
      row.append(retry, sample, el("small", "ke-note", "Cloud Spider only sends GET requests and runs none of these commands."));
      card.append(row);
      root.append(card);
    },
    // No EKS cluster in the region: a short card with the STACKS link.
    // hasContexts: the switcher (top right) offers others, so say so.
    showRegion({ region = "", hasContexts = false } = {}) {
      root.hidden = false;
      if (key === `region|${region}|${hasContexts}`) return;
      key = `region|${region}|${hasContexts}`;
      root.replaceChildren();
      const words = emptyRegionText(region);
      const card = el("div", "ke-card ke-region");
      card.append(el("h2", "ke-title", words.title));
      const p = el("p", "ke-reason");
      const link = el("a", "ke-link", "STACKS > EKS");
      link.href = "#stacks-eks";
      link.addEventListener("click", (event) => {
        event.preventDefault();
        onStacks();
      });
      p.append(`No EKS cluster in ${region || "this region"}. Create one from `, link, `, or pick another context${hasContexts ? " (top right)" : ""}.`);
      card.append(p);
      const row = el("div", "ke-actions");
      const open = el("button", "ke-btn", "OPEN STACKS > EKS");
      open.type = "button";
      open.addEventListener("click", () => onStacks());
      const sample = el("button", "ke-btn ke-ghost", "SHOW SAMPLE");
      sample.type = "button";
      sample.addEventListener("click", () => onSample());
      row.append(open, sample);
      card.append(row);
      root.append(card);
    },
    hide() {
      root.hidden = true;
    },
    isShown: () => !root.hidden,
  };
}
