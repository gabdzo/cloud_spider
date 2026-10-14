// Which cluster the STACKS cards, the scale row and TAKE DOWN mean when
// nobody typed one: the selected kube context's cluster when an EKS stack
// holds it, else the EKS stack that holds resources, else none (""). Never a
// hard-coded name. eksStacks: `pulumi stack ls --json` of upgrades/eks.
const NAME = /^[a-z][a-z0-9-]{1,99}$/;

export function contextCluster(context = "") {
  const text = String(context || "");
  const arn = text.match(/:cluster\/([a-z][a-z0-9-]{1,99})$/);
  if (arn) return arn[1];
  return text.replace(/-(viewer|admin)$/, "");
}

export function pickCurrentCluster({ selectedContext = "", eksStacks = [], legacyName = "" } = {}) {
  const live = (eksStacks || []).filter((s) => Number(s.resourceCount) > 0);
  const nameOf = (s) => (s.name === "upgrade" ? legacyName : String(s.name).replace(/^eks-/, ""));
  const want = contextCluster(selectedContext);
  if (want && NAME.test(want) && (eksStacks || []).some((s) => nameOf(s) === want || s.name === `eks-${want}`)) return want;
  for (const s of live) {
    const name = nameOf(s);
    if (name && NAME.test(name)) return name;
  }
  return "";
}
