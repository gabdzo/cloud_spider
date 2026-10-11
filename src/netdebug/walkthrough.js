// N7: "Why is my ALB 503?" (design §2.3), one question per step over the
// evidence a run already has: local HTTP (N1), the ALB (N4), the VPC (N5)
// and the cluster (N6). Pure: a report in, the steps and the verdict out.
// No new calls; VERIFY re-runs the same debug (view.js) and ticks when the
// load balancer answers < 500 with a healthy target.
const glance = (c) => (c ? { id: c.id, status: c.status, text: c.text || c.reason || "" } : null);

export function verifyState(report) {
  const get = (id) => report?.checks?.find((c) => c.id === id);
  const status = get("L-HTTP-01")?.observed?.status;
  const tg = get("A-ELB-02");
  const ok = typeof status === "number" && status < 500 && (!tg || tg.status === "PASS" || tg.status === "NOT_APPLICABLE");
  return { ok, status: status ?? null, healthy: tg ? tg.status === "PASS" : null, text: ok ? `answers ${status}${tg?.status === "PASS" ? `; ${tg.text.split(". ")[0]}` : ""}` : `still ${status ?? "no answer"}${tg?.status === "FAIL" ? `; ${tg.text.split(". ")[0]}` : ""}` };
}

export function albWalkthrough(report) {
  const checks = report?.checks || [];
  const get = (id) => checks.find((c) => c.id === id);
  const failed = (id) => get(id)?.status === "FAIL";
  const ran = (id) => get(id) && !["NOT_ASSESSED", "NOT_APPLICABLE"].includes(get(id).status);
  const lbName = get("A-ELB-01")?.observed?.lb?.name || get("A-TGT-01")?.observed?.name || "the load balancer";
  const steps = [];
  const step = (n, question, answer, evidence, next, state = "answered") => steps.push({ n, question, answer, evidence: evidence.map(glance).filter(Boolean), next, state });
  const done = (text, fix, why = []) => ({ steps, verdict: { text, fix: fix.filter(Boolean), because: why }, verify: "HTTP status < 500, the target group has >= 1 healthy target, and the load balancer makes no new 5xx", lb: lbName, host: report?.target?.host || "" });

  // 1. Who is answering the 503?
  const http = get("L-HTTP-01");
  const who = get("L-HTTP-03")?.observed?.answeredBy;
  const status = http?.observed?.status;
  const metrics = get("A-ELB-04")?.observed;
  const elbMade = (who === "alb" && status >= 500) || (metrics?.elb || 0) > 0;
  const appMade = (who !== "alb" && status >= 500) || (metrics?.target || 0) > 0;
  if (!elbMade && !appMade) {
    step(1, "Who is answering the 503?", status ? `nobody right now: ${report.target.host} answers ${status} and the load balancer made no 5xx` : "the request did not get an answer", [http, get("L-HTTP-03"), get("A-ELB-04")], null);
    return done("The 503 is not happening now. If it comes and goes, keep VERIFY running or open the SLO burn.", []);
  }
  step(1, "Who is answering the 503?", elbMade ? `${lbName} itself${who === "alb" ? " (server: awselb, no app headers)" : ""}${metrics?.elb ? `; ${get("A-ELB-04").text}` : ""}` : `the targets: ${get("A-ELB-04")?.text || `the answer came from ${who}`}`, [http, get("L-HTTP-03"), get("A-ELB-04")], elbMade ? 2 : 6);

  if (!elbMade) {
    // 6. The app returns 5xx.
    step(6, "Is the app returning the 5xx?", `yes: ${get("A-ELB-04")?.text || "the targets answered 5xx"}`, [get("A-ELB-04"), get("K-SVC-02")], null);
    const ns = get("K-SVC-01")?.observed?.matching?.[0];
    return done("The application (or a dependency behind it) answers 5xx; the load balancer only passes it on.", [ns ? `kubectl logs ${ns} --tail=80` : "", get("K-SVC-02")?.command]);
  }

  // 2. Does the TG have healthy targets?
  const tg = get("A-ELB-02");
  const rule = get("A-ELB-01");
  if (!ran("A-ELB-02")) {
    step(2, "Does the target group have healthy targets?", rule?.status === "FAIL" ? `no target group: ${rule.text}` : tg?.reason || "the target groups were not read", [rule, tg], 7);
  } else {
    const groups = tg.observed?.targetGroups || [];
    const total = groups.reduce((n, g) => n + g.total, 0);
    const healthy = groups.reduce((n, g) => n + g.healthy, 0);
    step(2, "Does the target group have healthy targets?", total === 0 ? `none registered: ${tg.text}` : healthy === 0 ? `all ${total} unhealthy: ${tg.text}` : healthy < total ? `${healthy} of ${total} healthy: the load balancer's 5xx can come from the others` : `all ${total} healthy`, [tg], total === 0 ? 3 : healthy < total ? 4 : 7);
  }
  const at = steps.at(-1).next;

  if (at === 3) {
    // 3. Does the Service have ready endpoints?
    const svc = get("K-SVC-01");
    const eps = get("K-SVC-02");
    if (!ran("K-SVC-01") && !ran("K-SVC-02")) {
      step(3, "Does the Service have ready endpoints?", svc?.reason || "the cluster was not read: CONNECT it in the Cluster view, or run the commands", [svc, eps], null, "unknown");
      return done("The target group is empty. The Service behind it most likely has no ready pods (scaled to 0, crash-looping, Pending, or a selector that matches nothing).", ["kubectl get endpointslices -A -l kubernetes.io/service-name", tg?.command]);
    }
    const cause = failed("K-SVC-01") ? svc : eps;
    step(3, "Does the Service have ready endpoints?", failed("K-SVC-01") || failed("K-SVC-02") ? `no: ${cause.text}` : `yes (${eps?.text}), but the controller has not registered them`, [svc, eps], null);
    if (failed("K-SVC-01") && svc.observed?.near?.length) {
      const [k] = Object.keys(svc.observed.selector || {});
      const v = svc.observed.near[0].labels[k];
      return done(`The Service selects ${k}=${svc.observed.selector[k]}, but its pods are labelled ${k}=${v}: nothing matches, no endpoints, an empty target group, and the load balancer answers 503.`, [svc.command, `kubectl -n ${report.context?.kube?.service?.split("/")[0] || "<ns>"} patch service ${report.context?.kube?.service?.split("/")[1] || "<svc>"} -p '{"spec":{"selector":{"${k}":"${v}"}}}'   # or fix the pod labels`], ["K-SVC-01", "K-SVC-02", "A-ELB-02"]);
    }
    return done(failed("K-SVC-01") || failed("K-SVC-02") ? `${cause.text}: the target group stays empty until the Service has ready endpoints.` : "The Service has endpoints but the target group is empty: check the AWS Load Balancer Controller's logs and the TargetGroupBinding.", [cause?.command, "kubectl -n kube-system logs deploy/aws-load-balancer-controller --tail=50"], [cause?.id, "A-ELB-02"].filter(Boolean));
  }

  if (at === 4 || at === 5) {
    // 4. Why do health checks fail?
    const sick = (tg.observed?.targetGroups || []).flatMap((g) => g.targets.filter((t) => t.state !== "healthy").map((t) => ({ ...t, hc: g.healthCheck })));
    const timeout = sick.some((t) => t.reason === "Target.Timeout" || t.reason === "Target.FailedHealthChecks");
    step(4, "Why do the health checks fail?", sick.length ? `${sick[0].reason || sick[0].state}: ${sick[0].verdict.sentence}` : "no reason reported", [tg], timeout ? 5 : null);
    if (!timeout) return done(`${sick[0]?.verdict.sentence || "The targets fail their health checks"}: fix the health check (path, port, matcher) or the app's answer to it.`, [tg.command, `aws elbv2 describe-target-groups --target-group-arns ${tg.observed?.targetGroups?.[0]?.arn || "<tg-arn>"} --query "TargetGroups[].[HealthCheckPath,HealthCheckPort,Matcher]"`], ["A-ELB-02"]);
  }

  if (steps.at(-1).next === 5) {
    // 5. Can the ALB reach the target?
    const blockers = ["A-VPC-01", "A-VPC-02", "K-NP-01", "A-VPC-03"].map(get).filter((c) => c?.status === "FAIL");
    step(5, "Can the load balancer reach the targets?", blockers.length ? `no: ${blockers[0].text}` : ["A-VPC-01", "A-VPC-02"].some(ran) ? "the security groups and NACLs allow it" : "not evaluated", [get("A-VPC-01"), get("A-VPC-02"), get("A-VPC-05"), get("K-NP-01")], null, blockers.length || ["A-VPC-01", "A-VPC-02"].some(ran) ? "answered" : "unknown");
    if (blockers.length) return done(`${blockers[0].text.replace(/\.$/, "")}${failed("A-VPC-05") ? `; ${get("A-VPC-05").text}` : ""}.`, [blockers[0].command, failed("A-VPC-05") ? get("A-VPC-05").command : ""], [blockers[0].id, failed("A-VPC-05") ? "A-VPC-05" : "", "A-ELB-02"].filter(Boolean));
    return done("The network allows the health checks, yet they time out: the app is too slow to answer the health check path, or it listens on another port.", [tg.command]);
  }

  // 7. Healthy targets, still 503: the listener rules.
  step(7, "Does the listener send the request to the right place?", rule ? rule.text : "the listener rules were not read", [rule], null);
  if (failed("A-ELB-01")) return done(`${rule.text}: the request never reaches a target group.`, [rule.command], ["A-ELB-01"]);
  return done("Healthy targets and a matching rule: look at forward weights (an empty target group with weight) and the target response codes.", [rule?.command]);
}
