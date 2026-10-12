// Stack bundles (docs/design/stack-dependencies.md): stacks that need each
// other, run as one plan with one approval, in dependency order. Each step is
// preview then up; the batch stops at the first failure. A step already on
// the cluster is skipped (its card's RUN converges it any time); the last one
// always runs. Pure: the app supplies what is there.
export const STACK_BUNDLES = [
  {
    id: "shop",
    title: "Shop API bundle",
    // CloudNativePG's operator is inside pgcluster (Helm), not a stack of its own.
    steps: [{ module: "pgcluster" }, { module: "lbc", when: { expose: "alb" } }, { module: "shopapi", pass: ["expose"] }],
    note: "Postgres (CloudNativePG operator + shopdb) → AWS Load Balancer Controller when expose=alb → Shop API",
  },
  {
    // For a live demo: the same three stacks with the public ALB fixed on.
    id: "shop-public",
    title: "Shop API bundle · with public ALB",
    steps: [{ module: "pgcluster" }, { module: "lbc" }, { module: "shopapi", params: { expose: "alb" }, pass: ["replicas"] }],
    note: "Postgres → AWS Load Balancer Controller → Shop API with expose=alb: a public URL (http://<alb>/items) in 2 AZs, ≈ $0.82/day for the ALB",
  },
  {
    id: "demo",
    title: "Demo bundle",
    // scaling-demo's HPAs scale demo/web and demo/api, which the first step makes.
    steps: [{ module: "demo" }, { module: "scaling-demo", params: { demoApp: "present", hpa: "on" } }],
    note: "EKS demo app → HPA scaling demo (HPAs on demo/web and demo/api)",
  },
];

export const bundleById = (id) => STACK_BUNDLES.find((item) => item.id === id) || null;
export const bundlesWith = (module) => STACK_BUNDLES.filter((item) => item.steps.some((step) => step.module === module));

// The steps that apply for these params, each with its own params.
export function bundleSteps(bundle, params = {}) {
  const cluster = String(params.clusterName || "cloudspider-up");
  return bundle.steps
    .filter((step) => !step.when || Object.entries(step.when).every(([key, value]) => String(params[key] ?? "") === String(value)))
    .map((step) => ({
      module: step.module,
      params: { clusterName: cluster, ...(step.params || {}), ...Object.fromEntries((step.pass || []).filter((key) => params[key] !== undefined).map((key) => [key, String(params[key])])) },
    }));
}

// have: { module: true | false | null } (on the cluster already?);
// base: the EKS cluster and EKS add-on needs with states (stack-needs.js),
// which no bundle step can meet. -> { order, skipped, refusal }
export function stackBundlePlan(bundle, params = {}, { have = {}, base = [], refusalFor = null } = {}) {
  const steps = bundleSteps(bundle, params);
  const missing = base.find((need) => need.state === "missing");
  const refusal = missing && refusalFor ? refusalFor(missing) : "";
  const order = [];
  const skipped = [];
  steps.forEach((step, index) => {
    const last = index === steps.length - 1;
    if (!last && have[step.module] === true) skipped.push({ module: step.module, why: "already on the cluster" });
    else order.push(step);
  });
  return { order, skipped, refusal };
}

// The one approval: what runs, in order, and what it adds to the bill.
export function bundleConfirm(bundle, plan, cluster, day = 0) {
  if (plan.refusal) return plan.refusal;
  const names = plan.order.map((step) => `${step.module}${step.params.expose ? ` (expose=${step.params.expose})` : ""}`);
  const skip = plan.skipped.length ? ` Skipped, already there: ${plan.skipped.map((item) => item.module).join(", ")}.` : "";
  const bill = day > 0 ? ` Adds about $${day.toFixed(2)}/day while up.` : "";
  return `${bundle.title} on ${cluster}: ${plan.order.length} stack${plan.order.length === 1 ? "" : "s"} in order, ${names.join(" → ")}. Each: preview, then up; stops at the first failure.${skip}${bill}`;
}
