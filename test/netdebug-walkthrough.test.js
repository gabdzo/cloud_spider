// N7: the ALB 503 walkthrough over a run's evidence (pure), VERIFY, and
// the load balancer metrics check it starts from.
import assert from "node:assert/strict";
import test from "node:test";
import { albWalkthrough, verifyState } from "../src/netdebug/walkthrough.js";
import { albMetricsCheck } from "../src/netdebug/aws-edge.js";
import { createAwsCollector } from "../src/netdebug/aws.js";
import { createKubeCollector } from "../src/netdebug/kube-collect.js";
import { createNetdebug } from "../src/netdebug/api.js";
import { ND_CSS } from "../src/netdebug/style.js";
import { samplePathGraph } from "../src/path-sample.js";

const ORIGIN = "http://127.0.0.1:9241";
async function sample(target, collectors = [createAwsCollector({}), createKubeCollector({})]) {
  const nd = createNetdebug({ pageOrigin: ORIGIN, collectors });
  const s = await nd.start(ORIGIN, { target, sample: true });
  await nd.settle(s.id);
  return (await nd.get(s.id)).report;
}
const path = (w) => w.steps.map((s) => s.n);

test("A-ELB-04: the load balancer's own 5xx vs the targets', load-balancer wide (offPath)", () => {
  const graph = samplePathGraph();
  const lb = graph.loadBalancers[0];
  const c = albMetricsCheck({ graph }, lb);
  assert.equal(c.status, "FAIL");
  assert.equal(c.offPath, true);
  assert.equal(c.text, "of 940 requests, 19 got a 5xx from the load balancer itself (503: 7, 504: 12); the targets answered no 5xx");
  graph.metrics[lb.arn] = { elb502: 0, elb503: 0, elb504: 0, target5xx: 0, requests: 10 };
  assert.equal(albMetricsCheck({ graph }, lb).status, "PASS");
  assert.equal(albMetricsCheck({ graph: { metrics: {} } }, lb).status, "NOT_ASSESSED");
});

test("web.sample.test: 1 → 2 (none registered) → 3 (selector) and a FIX that patches the selector", async () => {
  const w = albWalkthrough(await sample("web.sample.test"));
  assert.deepEqual(path(w), [1, 2, 3]);
  assert.equal(w.lb, "k8s-demo-api");
  assert.match(w.steps[0].answer, /^k8s-demo-api itself \(server: awselb, no app headers\)/);
  assert.match(w.steps[1].answer, /^none registered/);
  assert.equal(w.verdict.text, "The Service selects app=web, but its pods are labelled app=shop-web: nothing matches, no endpoints, an empty target group, and the load balancer answers 503.");
  assert.match(w.verdict.fix[1], /^kubectl -n shop patch service web -p '\{"spec":\{"selector":\{"app":"shop-web"\}\}\}'/);
  assert.deepEqual(w.verdict.because, ["K-SVC-01", "K-SVC-02", "A-ELB-02"]);
});

test("web.sample.test without the cluster: step 3 is unknown and says how to look", async () => {
  const w = albWalkthrough(await sample("web.sample.test", [createAwsCollector({})]));
  assert.deepEqual(path(w), [1, 2, 3]);
  assert.equal(w.steps[2].state, "unknown");
  assert.match(w.verdict.text, /^The target group is empty/);
});

test("api.sample.test: 1 → 2 (1 of 2) → 4 (Timeout) → 5 (SG, with the flow log REJECTs)", async () => {
  const w = albWalkthrough(await sample("api.sample.test"));
  assert.deepEqual(path(w), [1, 2, 4, 5]);
  assert.match(w.steps[2].answer, /^Target\.Timeout: 10\.43\.12\.31:8080 does not answer HTTP \/healthz in time/);
  assert.match(w.verdict.text, /sample-sg-node-b does not allow tcp 8080 from sample-sg-alb\. The load balancer cannot reach this target; flow logs: 3 REJECTs/);
  assert.deepEqual(w.verdict.because, ["A-VPC-01", "A-VPC-05", "A-ELB-02"]);
});

test("cdn.sample.test through CloudFront: the listener sends it to the default 404 (step 7)", async () => {
  const w = albWalkthrough(await sample("cdn.sample.test"));
  assert.deepEqual(path(w), [1, 2, 7]);
  assert.match(w.verdict.text, /no rule serves cdn\.sample\.test.*: the request never reaches a target group\.$/);
});

test("google.com: the 503 is not happening; VERIFY ticks only below 500 with a healthy target", async () => {
  const g = await sample("google.com");
  const w = albWalkthrough(g);
  assert.deepEqual(path(w), [1]);
  assert.match(w.verdict.text, /^The 503 is not happening now/);
  assert.equal(verifyState(g).ok, true);
  const web = await sample("web.sample.test");
  assert.deepEqual(verifyState(web), { ok: false, status: 503, healthy: false, text: "still 503; k8s-shop-web has no registered targets" });
});

test("walkthrough CSS: both themes, role tokens only", () => {
  for (const sel of [".nd-why ", ".nd-wstep", ".nd-wverdict", ".nd-wverify", ".nd-whybtn", ':root[data-theme="pro"] #netdebug .nd-why', ':root:not([data-theme="pro"]) #netdebug .nd-why']) assert.ok(ND_CSS.includes(sel), sel);
  assert.ok(!/#[0-9a-f]{3,8}\b|rgba?\(/i.test(ND_CSS));
});
