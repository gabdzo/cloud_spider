import { cidrContains } from "./cidr.js";
import { isInstanceId } from "./ids.js";

const DEPTH = { internet: -1, lb: 0, listener: 1, rule: 2, tg: 3, answer: 3, target: 4, node: 5, cluster: 6 };
const CONTROLLER_STACK = ["service.k8s.aws/stack", "ingress.k8s.aws/resource", "ingress.k8s.aws/stack"];

export function diagnose(graph, lbArn, { ruleArn = null } = {}) {
  const lb = graph.loadBalancers.find((item) => item.arn === lbArn);
  if (!lb) return { nodes: [], edges: [], findings: [] };
  const nodes = [];
  const edges = [];
  const seen = new Set();
  const add = (node) => {
    if (seen.has(node.id)) return false;
    seen.add(node.id);
    nodes.push(node);
    return true;
  };
  const link = (from, to, status = "ok", sentence = "") => edges.push({ from, to, status, sentence });

  // Internet-facing: the path starts at the internet (anyone), through the
  // IGW to the load balancer; a subnet without that route breaks the first wire.
  if (lb.scheme === "internet-facing") {
    add({ id: `internet:${lb.arn}`, kind: "internet", label: "INTERNET", caption: "anyone · 0.0.0.0/0 · via IGW", facts: {}, status: "ok", sentence: `${lb.name} is internet-facing: anyone can reach http://${lb.dns}/`, symptom: false });
  }
  const head = lbNode(graph, lb);
  add(head);
  if (lb.scheme === "internet-facing") link(`internet:${lb.arn}`, lb.arn, head.status === "broken" && lb.state === "active" ? "broken" : "ok");
  const focus = ruleArn
    ? graph.listeners.flatMap((listener) => rulesFor(graph, listener)).find((rule) => rule.arn === ruleArn) || null
    : null;
  const listeners = graph.listeners
    .filter((listener) => listener.lbArn === lb.arn)
    .filter((listener) => !focus || listener.arn === focus.listenerArn)
    .sort((a, b) => a.port - b.port);
  if (!listeners.length && (head.status === "ok" || head.symptom)) {
    Object.assign(head, {
      status: "broken",
      symptom: false,
      sentence: `${lb.name} has no listener. Nothing answers on this load balancer.`,
    });
  }

  for (const listener of listeners) {
    const rules = rulesFor(graph, listener).filter((rule) => !focus || rule.arn === focus.arn);
    add(listenerNode(listener, rules));
    link(lb.arn, listener.arn);
    for (const rule of rules) {
      add(ruleNode(rule, listener));
      link(listener.arn, rule.arn);
      for (const action of rule.actions) {
        const answer = answerNode(rule, action, listener);
        if (answer) {
          add(answer);
          link(rule.arn, answer.id, answer.status === "ok" ? "ok" : answer.status);
          continue;
        }
        if (action.type !== "forward") continue;
        const total = (action.weights || []).reduce((n, w) => n + (w.weight || 0), 0);
        const share = (arn) => {
          if ((action.weights || []).length < 2 || !total) return null;
          const w = action.weights.find((item) => item.arn === arn);
          return w ? Math.round((w.weight / total) * 100) : null;
        };
        for (const tgArn of action.targetGroupArns) {
          const tg = graph.targetGroups.find((item) => item.arn === tgArn);
          if (!tg) {
            add({
              id: tgArn,
              kind: "tg",
              label: tgArn.split("/").at(-2) || tgArn,
              caption: "missing",
              status: "broken",
              sentence: `${ruleName(rule)} forwards to a target group that does not exist.`,
            });
            link(rule.arn, tgArn, "broken");
            continue;
          }
          const pct = share(tg.arn);
          if (pct == null) link(rule.arn, tg.arn);
          else edges.push({ from: rule.arn, to: tg.arn, status: "ok", sentence: `${pct}% of the requests ${ruleName(rule)} matches go to ${tg.name}.`, weight: pct });
          if (add(targetGroupNode(graph, tg))) addTargets(graph, lb, tg, add, link);
          if (pct != null) {
            const tgNode = nodes.find((node) => node.id === tg.arn);
            if (tgNode) tgNode.facts = { ...tgNode.facts, share: pct };
          }
        }
      }
    }
  }
  return { nodes, edges, findings: findingsOf(nodes, edges) };
}

export function headline(result) {
  return result.findings[0]?.sentence || "every edge on this path looks healthy";
}

export function hostOf(text) {
  const raw = String(text || "").trim();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `http://${raw}`).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function requestOf(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const hasScheme = raw.includes("://");
  try {
    const url = new URL(hasScheme ? raw : `http://${raw}`);
    if (!url.hostname) return null;
    const port = url.port ? Number(url.port) : hasScheme ? (url.protocol === "https:" ? 443 : 80) : null;
    return { host: url.hostname.toLowerCase(), path: url.pathname || "/", port };
  } catch {
    return null;
  }
}

export function matchHost(graph, text) {
  const request = requestOf(text);
  if (!request) return [];
  const bare = request.host.replace(/^dualstack\./, "");
  const out = [];
  for (const lb of graph.loadBalancers) {
    const listeners = graph.listeners.filter((item) => item.lbArn === lb.arn);
    const named = graph.rules.some(
      (rule) =>
        listeners.some((listener) => listener.arn === rule.listenerArn) &&
        rule.hosts.some((pattern) => wildcard(pattern, request.host, true)),
    );
    if (lb.dns !== bare && !named) continue;
    out.push(...routeOn(graph, lb.arn, request));
  }
  return out;
}

export function routeOn(graph, lbArn, request) {
  const listeners = graph.listeners.filter((item) => item.lbArn === lbArn);
  const open = listeners
    .filter((listener) => request.port === null || listener.port === request.port)
    .sort((a, b) => Number(b.protocol === "HTTPS") - Number(a.protocol === "HTTPS") || a.port - b.port);
  const out = [];
  for (const listener of open) {
    const route = follow(graph, listeners, listener, request, 0);
    if (route && !out.some((item) => item.ruleArn === route.ruleArn)) out.push(route);
  }
  return out;
}

function follow(graph, listeners, listener, request, hops) {
  const skipped = [];
  const rule = rulesFor(graph, listener).find((item) => {
    if (!ruleServes(item, request)) return false;
    if (item.others) skipped.push(item.arn);
    return !item.others;
  });
  if (!rule) return null;
  const action = rule.actions[0];
  const sameHost = !action?.redirectHost || action.redirectHost === "#{host}";
  if (action?.type === "redirect" && sameHost && hops < 3) {
    const port = redirectPort(action, listener);
    const next = listeners.find((item) => item.port === port && item.arn !== listener.arn);
    const after = next && follow(graph, listeners, next, request, hops + 1);
    if (after) return { ...after, via: [rule.arn, ...after.via], skipped: [...skipped, ...after.skipped] };
  }
  return { lbArn: listener.lbArn, ruleArn: rule.arn, via: [], skipped };
}

function redirectPort(action, listener) {
  if (/^\d+$/.test(action.redirectPort || "")) return Number(action.redirectPort);
  const protocol = /^HTTPS?$/.test(action.redirectProtocol || "") ? action.redirectProtocol : listener.protocol;
  if (protocol !== listener.protocol) return protocol === "HTTPS" ? 443 : 80;
  return listener.port;
}

function ruleServes(rule, request) {
  const hostOk = !rule.hosts.length || rule.hosts.some((pattern) => wildcard(pattern, request.host, true));
  const pathOk = !rule.paths.length || rule.paths.some((pattern) => wildcard(pattern, request.path, false));
  return hostOk && pathOk;
}

function wildcard(pattern, value, ignoreCase) {
  const source = String(pattern)
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*")
    .replace(/\?/g, ".");
  return new RegExp(`^${source}$`, ignoreCase ? "i" : "").test(value);
}

export function interfaceFor(interfaces, ip) {
  return (
    interfaces.find((entry) => entry.ip === ip) ||
    interfaces.find((entry) => entry.prefix && cidrContains(entry.prefix, ip)) ||
    null
  );
}

export function linesFromTargets(balancers, groups, health, interfaces) {
  const edges = [];
  const seen = new Set();
  for (const lb of balancers || []) {
    const mine = (groups || []).filter(
      (group) => (group.lbArns || []).includes(lb.id) || (group.lbArns || []).includes(lb.arn),
    );
    for (const group of mine) {
      for (const item of health?.[group.arn] || []) {
        const instanceId = isInstanceId(item.id) ? item.id : interfaceFor(interfaces, item.id)?.instanceId || "";
        if (!instanceId) continue;
        const key = `${lb.id}|${instanceId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        // The target state rides on the line, so the morning can say what
        // is hurting without another read.
        const edge = { from: lb.id, to: instanceId };
        if (item.state) edge.state = item.state;
        if (item.reason) edge.reason = item.reason;
        edges.push(edge);
      }
    }
  }
  return edges;
}

const COUNT_AS = {
  healthy: "healthy",
  initial: "starting",
  unhealthy: "unhealthy",
  unavailable: "unhealthy",
  "unhealthy.draining": "unhealthy",
  unused: "unused",
  draining: "unused",
};

// Every target behind each balancer by state, including the ones no line
// can be drawn to (an IP with no interface), so "no target" is never a
// guess from the lines alone.
export function targetCounts(balancers, groups, health) {
  const out = {};
  for (const lb of balancers || []) {
    const counts = { total: 0, healthy: 0, starting: 0, unhealthy: 0, unused: 0 };
    const mine = (groups || []).filter(
      (group) => (group.lbArns || []).includes(lb.id) || (group.lbArns || []).includes(lb.arn),
    );
    const seen = new Set();
    for (const group of mine) {
      for (const item of health?.[group.arn] || []) {
        const key = `${item.id}:${item.port ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        counts.total += 1;
        const bucket = COUNT_AS[item.state];
        if (bucket) counts[bucket] += 1;
      }
    }
    out[lb.id] = counts;
  }
  return out;
}

export function healthVerdict(health, tg) {
  const where = `${health.id}:${health.port}`;
  const check = `${tg.healthProtocol} ${tg.healthPath || ""}`.trim();
  const description = health.description || "";
  const say = (status, sentence) => ({ status, sentence: sentence.trim() });
  if (health.state === "healthy") return say("ok", `${where} is healthy`);
  switch (health.reason) {
    case "Target.Timeout":
      return say("hang", `${where} does not answer ${check} in time. Requests to it hang until the load balancer gives up.`);
    case "Target.ResponseCodeMismatch":
      return say("broken", `${where} answers ${check} with a code outside ${tg.matcher || "200"}. ${description}`);
    case "Target.FailedHealthChecks":
      return say("broken", `${where} refuses or drops ${check}. ${description}`);
    case "Target.NotInUse":
      return say(
        "broken",
        `${where} gets no traffic. ${description || "Its zone is not enabled on the load balancer, or no listener uses this target group."}`,
      );
    case "Target.NotRegistered":
      return say("broken", `${where} is not registered in ${tg.name}.`);
    case "Target.InvalidState":
      return say("broken", `${where} is not running. ${description}`);
    case "Target.IpUnusable":
      return say("broken", `${where} has an address the load balancer cannot use. ${description}`);
    case "Target.DeregistrationInProgress":
      return say("unknown", `${where} is draining and leaves ${tg.name} soon.`);
    case "Elb.InitialHealthChecking":
      return say("unknown", `${where} is still on its first health checks.`);
    case "Elb.RegistrationInProgress":
      return say("unknown", `${where} is still being registered.`);
    default:
      return say(
        health.state === "unhealthy" ? "broken" : "unknown",
        `${where} is ${health.state}. ${description || health.reason || ""}`,
      );
  }
}

export function reachable(graph, lb, groupIds, port, targetIp = "") {
  if (!lb.securityGroupIds.length) {
    return {
      status: "unknown",
      sentence: `${lb.name} has no security group. The targets must allow the callers' addresses on ${port}.`,
    };
  }
  const targetGroups = groupIds
    .map((id) => graph.securityGroups.find((group) => group.id === id))
    .filter(Boolean);
  if (!targetGroups.length) {
    return { status: "unknown", sentence: "the security groups of this target were not read." };
  }
  const lbCidrs = lb.subnetIds
    .map((id) => graph.subnets.find((subnet) => subnet.id === id)?.cidr)
    .filter(Boolean);
  const allowing = targetGroups.flatMap((group) => group.ingress).filter((rule) => covers(rule, port));
  const fromGroup = allowing.some((rule) => rule.groupIds.some((id) => lb.securityGroupIds.includes(id)));
  const fromCidrs =
    lbCidrs.length > 0 &&
    lbCidrs.every((cidr) => allowing.some((rule) => rule.cidrs.some((outer) => cidrContains(outer, cidr))));
  if (!fromGroup && !fromCidrs) {
    if (allowing.some(unreadSource)) {
      return {
        status: "unknown",
        sentence: `${groupIds.join(", ")} allows tcp ${port} through prefix lists or IPv6 ranges, which are not read here.`,
      };
    }
    return {
      status: "broken",
      sentence: `${groupIds.join(", ")} does not allow tcp ${port} from ${lb.securityGroupIds.join(", ")}. The load balancer cannot reach this target.`,
    };
  }
  const lbGroups = lb.securityGroupIds
    .map((id) => graph.securityGroups.find((group) => group.id === id))
    .filter(Boolean);
  const leaving = lbGroups.flatMap((group) => group.egress).filter((rule) => covers(rule, port));
  const outbound = leaving.some(
    (rule) =>
      rule.groupIds.some((id) => groupIds.includes(id)) ||
      rule.cidrs.some((outer) => (targetIp ? cidrContains(outer, targetIp) : outer === "0.0.0.0/0")),
  );
  if (!outbound && leaving.some(unreadSource)) {
    return {
      status: "unknown",
      sentence: `${lb.securityGroupIds.join(", ")} allows tcp ${port} out through prefix lists or IPv6 ranges, which are not read here.`,
    };
  }
  if (!outbound) {
    return {
      status: "broken",
      sentence: `${lb.securityGroupIds.join(", ")} does not allow tcp ${port} out to this target. The load balancer cannot reach it.`,
    };
  }
  return { status: "ok", sentence: "" };
}

function unreadSource(rule) {
  return (rule.prefixListIds || []).length > 0 || (rule.ipv6 || []).length > 0;
}

function covers(rule, port) {
  if (rule.protocol === "-1") return true;
  if (rule.protocol !== "tcp" && rule.protocol !== "6") return false;
  return port >= rule.from && port <= rule.to;
}

function lbNode(graph, lb) {
  const node = {
    id: lb.arn,
    kind: "lb",
    label: lb.name,
    caption: `${lb.type} ${lb.scheme}`,
    facts: { lbType: lb.type, scheme: lb.scheme, dns: lb.dns, ports: graph.listeners.filter((item) => item.lbArn === lb.arn).map((item) => `${item.protocol} :${item.port}`) },
    status: "ok",
    sentence: lb.dns,
    symptom: false,
  };
  if (lb.state !== "active") {
    return { ...node, status: "broken", sentence: `${lb.name} is ${lb.state}. ${lb.stateReason || ""}`.trim() };
  }
  if (lb.scheme === "internet-facing") {
    const closed = lb.subnetIds.filter((id) => !routesToInternet(graph, lb.vpcId, id));
    if (closed.length) {
      return {
        ...node,
        status: "broken",
        sentence: `${closed.join(", ")} ${closed.length === 1 ? "has" : "have"} no route to an internet gateway. The internet cannot reach ${lb.name} there.`,
      };
    }
  }
  const symptom = symptomOf(lb, graph.metrics?.[lb.arn]);
  return symptom ? { ...node, ...symptom, symptom: true } : node;
}

function routesToInternet(graph, vpcId, subnetId) {
  const table =
    graph.routeTables.find((item) => item.subnetIds.includes(subnetId)) ||
    graph.routeTables.find((item) => item.vpcId === vpcId && item.main);
  return Boolean(
    table?.routes.some(
      (route) => route.dest === "0.0.0.0/0" && route.target.startsWith("igw-") && route.state !== "blackhole",
    ),
  );
}

function symptomOf(lb, m) {
  if (!m) return null;
  const when = "in the last 15 minutes";
  if (m.elb504 > 0) {
    return { status: "hang", sentence: `${m.elb504} requests timed out at ${lb.name} ${when}. A target took the connection and did not answer in time.` };
  }
  if (m.elb502 > 0) {
    return { status: "broken", sentence: `${m.elb502} requests got 502 from ${lb.name} ${when}. A target closed the connection or sent a bad response.` };
  }
  if (m.elb503 > 0) {
    return { status: "broken", sentence: `${m.elb503} requests got 503 from ${lb.name} ${when}. No target could take them.` };
  }
  if (m.target5xx > 0) {
    return { status: "broken", sentence: `${m.target5xx} requests got a 5xx from the service itself ${when}.` };
  }
  return null;
}

function rulesFor(graph, listener) {
  const rules = graph.rules.filter((rule) => rule.listenerArn === listener.arn);
  if (!rules.length) {
    return [
      {
        arn: `${listener.arn}|default`,
        listenerArn: listener.arn,
        priority: "default",
        isDefault: true,
        hosts: [],
        paths: [],
        actions: listener.defaultActions,
      },
    ];
  }
  const rank = (rule) => (rule.isDefault ? Number.MAX_SAFE_INTEGER : Number(rule.priority));
  return [...rules].sort((a, b) => rank(a) - rank(b));
}

function ruleName(rule) {
  return rule.isDefault ? "the default rule" : `rule ${rule.priority}`;
}

// ALB redirect placeholders (#{protocol}, #{host}, #{port}, #{path},
// #{query}) mean "keep what the request had": resolve them to the listener's
// own values so a card never shows the raw template.
export function resolveRedirect(action, listener = {}) {
  const keep = (value, token) => !value || value === token;
  const protocol = keep(action.redirectProtocol, "#{protocol}") ? listener.protocol || "" : action.redirectProtocol;
  const port = keep(action.redirectPort, "#{port}") ? String(listener.port ?? "") : String(action.redirectPort);
  const sameHost = keep(action.redirectHost, "#{host}");
  const rawPath = action.redirectPath || "/#{path}";
  const samePath = rawPath === "/#{path}";
  const path = samePath ? "same path" : rawPath.replace(/#\{path\}/g, "…");
  const query = !action.redirectQuery || action.redirectQuery === "#{query}" ? "" : action.redirectQuery;
  const hop = protocol || port ? `${protocol} :${port}`.trim() : "";
  const where = [hop, sameHost ? "" : action.redirectHost, path].filter(Boolean).join(" ");
  return { protocol, port, host: sameHost ? "same host" : action.redirectHost, path, query, sameHost, samePath, where };
}

function actionWords(action, fallbackProtocol, fallbackPort) {
  if (!action) return "does nothing";
  if (action.type === "forward") return "forwards";
  if (action.type === "redirect") {
    return `redirects to ${resolveRedirect(action, { protocol: fallbackProtocol, port: fallbackPort }).where}`;
  }
  if (action.type === "fixed-response") return `answers ${action.statusCode} itself`;
  return action.type;
}

function listenerNode(listener, rules) {
  const actions = rules.flatMap((rule) => rule.actions);
  const label = `${listener.protocol} ${listener.port}`;
  const base = { id: listener.arn, kind: "listener", label, facts: { protocol: listener.protocol, port: listener.port, rules: rules.length }, status: "ok", sentence: "" };
  if (actions.some((action) => action.type === "forward" && action.targetGroupArns.length)) {
    return { ...base, caption: `${rules.length} ${rules.length === 1 ? "rule" : "rules"}`, sentence: `${label} forwards to target groups.` };
  }
  const redirect = actions.find((action) => action.type === "redirect");
  if (redirect) {
    const words = actionWords(redirect, listener.protocol, listener.port);
    return { ...base, caption: words, sentence: `${label} ${words}.` };
  }
  const fixed = actions.find((action) => action.type === "fixed-response");
  // A listener whose (focused) rule answers itself on purpose is fine.
  if (fixed && rules.some((rule) => !rule.isDefault)) return { ...base, caption: `answers ${fixed.statusCode} itself`, sentence: `${label} answers ${fixed.statusCode} itself on this rule.` };
  return {
    ...base,
    caption: fixed ? `answers ${fixed.statusCode} itself` : "forwards nothing",
    status: "unknown",
    sentence: `${label} forwards nothing. ${fixed ? `It answers ${fixed.statusCode} itself.` : ""}`.trim(),
  };
}

// What a rule does, in a few words, and the conditions beyond host/path.
export function actionSummary(action, listener = {}) {
  if (!action) return { kind: "none", text: "does nothing" };
  if (action.type === "redirect") {
    const code = String(action.statusCode || "").replace("HTTP_", "") || "302";
    const r = resolveRedirect(action, listener);
    // Same protocol and port: the path is the news ("301 → /dashboard").
    const same = r.sameHost && (r.protocol === (listener.protocol || "")) && r.port === String(listener.port ?? "");
    return { kind: "redirect", code, text: `${code} → ${same ? r.path : r.where}`, redirect: r };
  }
  if (action.type === "fixed-response") return { kind: "fixed", code: String(action.statusCode || ""), text: `answers ${action.statusCode || "?"}${action.contentType ? ` ${action.contentType}` : ""}` };
  if (action.type === "forward") {
    const weights = (action.weights || []).filter(() => (action.weights || []).length > 1);
    if (weights.length) {
      const total = weights.reduce((n, w) => n + (w.weight || 0), 0) || 1;
      return { kind: "weighted", text: `weighted ${weights.map((w) => `${Math.round((w.weight / total) * 100)}%`).join(" / ")}` };
    }
    return { kind: "forward", text: "forward → target group" };
  }
  return { kind: action.type || "none", text: action.type || "does nothing" };
}

export function conditionWords(rule) {
  return [
    ...(rule.headers || []).map((h) => `header ${h.name}: ${h.values.join("|")}`),
    ...(rule.queries || []).map((q) => `query ${q.key ? `${q.key}=` : ""}${q.value}`),
    ...((rule.methods || []).length ? [`method ${rule.methods.join("|")}`] : []),
    ...((rule.sources || []).length ? [`source ${rule.sources.join(",")}`] : []),
  ];
}

// Redirect and fixed-response rules end at the ALB: one card says what the
// client gets back, in the target-group column.
function answerNode(rule, action, listener) {
  const summary = actionSummary(action, listener);
  if (summary.kind === "redirect") {
    return { id: `${rule.arn}|answer`, kind: "answer", label: summary.text, caption: "redirect", facts: { answer: "redirect", code: summary.code, text: summary.text, query: summary.redirect.query, to: summary.redirect }, status: "ok", sentence: `${ruleName(rule)} answers ${summary.code}: the ALB sends the client to ${summary.text.split("→ ")[1]}. No target is reached on this request.` };
  }
  if (summary.kind === "fixed") {
    const code = Number(summary.code);
    return { id: `${rule.arn}|answer`, kind: "answer", label: `${summary.code}`, caption: "fixed response", facts: { answer: "fixed", code: summary.code, contentType: action.contentType || "", body: action.messageBody || "" }, status: code >= 500 ? "hang" : "ok", sentence: `${ruleName(rule)} answers ${summary.code} itself${action.messageBody ? `: "${action.messageBody}"` : ""}. No target is reached.${code >= 500 ? " Callers see an error here; if that is on purpose (maintenance), it is fine." : ""}` };
  }
  return null;
}

function ruleNode(rule, listener = {}) {
  const match = [...rule.hosts, ...rule.paths].join(" ") || "everything else";
  const node = {
    id: rule.arn,
    kind: "rule",
    label: rule.isDefault ? "default" : `rule ${rule.priority}`,
    caption: match,
    facts: { hosts: rule.hosts, paths: rule.paths, isDefault: Boolean(rule.isDefault), priority: rule.priority, action: rule.actions[0] ? actionWords(rule.actions[0], "", "") : "", actionKind: actionSummary(rule.actions[0], listener).kind, actionText: actionSummary(rule.actions[0], listener).text, conditions: conditionWords(rule) },
    status: "ok",
    sentence: `${ruleName(rule)} matches ${match} and ${actionWords(rule.actions[0], "", "")}.`,
  };
  if (rule.actions.some((action) => action.type === "forward" && action.weightless)) {
    return {
      ...node,
      status: "broken",
      sentence: `${ruleName(rule)} gives every target group weight 0, so the requests it matches reach no target.`,
    };
  }
  return node;
}

function k8sService(tags) {
  for (const key of CONTROLLER_STACK) {
    const found = tags.find((tag) => tag.key === key && tag.value);
    if (found) return found.value;
  }
  return "";
}

function targetGroupNode(graph, tg) {
  const health = graph.health[tg.arn] || [];
  const service = k8sService(graph.tags[tg.arn] || []);
  const node = {
    id: tg.arn,
    kind: "tg",
    label: tg.name,
    caption: service ? `k8s ${service}` : `${tg.protocol} ${tg.port} ${tg.targetType}`,
    facts: { protocol: tg.protocol, port: tg.port, targetType: tg.targetType, service, healthy: health.filter((item) => item.state === "healthy").length, total: health.length, healthPath: tg.healthPath || "" },
    status: "ok",
    sentence: `${tg.name} sends ${tg.protocol} ${tg.port} to ${health.length} ${health.length === 1 ? "target" : "targets"}.`,
  };
  if (!health.length) {
    node.status = "broken";
    node.sentence =
      `${tg.name} has no registered targets. The load balancer answers 503.` +
      (service
        ? ` The AWS Load Balancer Controller registers the pods of ${service}. Check that its selector matches running pods and that they are Ready.`
        : "");
  } else if (health.every((item) => item.state === "unhealthy")) {
    node.status = "broken";
    node.symptom = true;
    node.sentence = `every target in ${tg.name} is unhealthy. The load balancer sends requests to all of them anyway, so callers see errors or hangs.`;
  } else if (!health.some((item) => item.state === "healthy") && health.some((item) => item.state === "unhealthy")) {
    node.status = "broken";
    node.symptom = true;
    node.sentence = `no target in ${tg.name} is healthy. The load balancer sends requests to the unhealthy ones anyway, so callers see errors or hangs.`;
  } else if (!health.some((item) => item.state === "healthy")) {
    node.status = "broken";
    node.symptom = true;
    node.sentence = `no target in ${tg.name} is healthy right now. The load balancer answers 503 until one is.`;
  }
  return node;
}

function addTargets(graph, lb, tg, add, link) {
  const health = [...(graph.health[tg.arn] || [])].sort((a, b) =>
    `${a.id}:${a.port}`.localeCompare(`${b.id}:${b.port}`),
  );
  const tgTags = graph.tags[tg.arn] || [];
  for (const item of health) {
    const id = `${tg.arn}|${item.id}:${item.port}`;
    const iface = tg.targetType === "ip" ? interfaceFor(graph.interfaces, item.id) : null;
    const instanceId = tg.targetType === "instance" ? item.id : iface?.instanceId || "";
    const instance = graph.nodes.find((entry) => entry.id === instanceId) || null;
    const groupIds = iface ? iface.groupIds : instance?.groupIds || [];
    const targetIp = tg.targetType === "ip" ? item.id : instance?.privateIp || "";
    const verdict = healthVerdict(item, tg);
    add({ id, kind: "target", label: `${item.id}:${item.port}`, caption: item.state, facts: { ip: item.id, port: item.port, state: item.state, zone: item.zone || "", targetType: tg.targetType }, status: verdict.status, sentence: verdict.sentence });

    const reach = reachTarget(graph, lb, tg, groupIds, item.port, targetIp);
    if (reach.status === "broken" && verdict.status === "ok") {
      link(tg.arn, id, "unknown", `${item.id}:${item.port} passes health checks, but the security groups read here do not show the rule that allows it.`);
    } else {
      link(tg.arn, id, reach.status, reach.sentence);
    }

    if (!instance) {
      const podCluster = clusterNameFor(null, tgTags);
      if (podCluster) {
        add(clusterNode(graph, podCluster));
        link(id, `cluster:${podCluster}`);
      }
      continue;
    }
    const who = instance.name || instance.id;
    const fresh = add({
      id: instance.id,
      kind: "node",
      label: who,
      caption: instance.state,
      facts: { id: instance.id, state: instance.state, instanceType: instance.instanceType || "", zone: instance.zone || "", ip: instance.privateIp || "" },
      status: instance.state === "running" ? "ok" : "broken",
      sentence: `${who} is ${instance.state}`,
    });
    link(id, instance.id);
    const clusterName = clusterNameFor(instance, tgTags);
    if (!clusterName) continue;
    add(clusterNode(graph, clusterName));
    if (fresh) link(instance.id, `cluster:${clusterName}`);
  }
}

function reachTarget(graph, lb, tg, groupIds, trafficPort, targetIp) {
  const first = reachable(graph, lb, groupIds, trafficPort, targetIp);
  const healthPort = tg.healthPort && tg.healthPort !== "traffic-port" ? Number(tg.healthPort) : trafficPort;
  if (first.status !== "ok" || healthPort === trafficPort) return first;
  return reachable(graph, lb, groupIds, healthPort, targetIp);
}

function clusterNameFor(instance, tgTags) {
  const fromGroup = tgTags.find((tag) => tag.key === "elbv2.k8s.aws/cluster")?.value;
  if (fromGroup) return fromGroup;
  const tags = instance?.tags || [];
  const fromNode = tags.find((tag) => tag.key === "eks:cluster-name")?.value;
  if (fromNode) return fromNode;
  const legacy = tags.find((tag) => tag.key.startsWith("kubernetes.io/cluster/"));
  return legacy ? legacy.key.slice("kubernetes.io/cluster/".length) : "";
}

function clusterNode(graph, name) {
  const id = `cluster:${name}`;
  const cluster = graph.clusters.find((item) => item.name === name);
  if (!cluster) {
    const note = (graph.notes || []).find((item) => item.startsWith("EKS:")) || "";
    return { id, kind: "cluster", label: name, caption: "EKS", facts: {}, status: "unknown", sentence: `${name} was not read. ${note}`.trim() };
  }
  const base = {
    id,
    kind: "cluster",
    label: name,
    caption: `EKS ${cluster.version} ${cluster.status}`,
    facts: { version: cluster.version, status: cluster.status, nodegroups: cluster.nodegroups.length },
    status: "ok",
    sentence: `${name} is ${cluster.status}`,
  };
  if (cluster.status !== "ACTIVE") return { ...base, status: "broken" };
  const issue = [
    ...cluster.issues.map((item) => ({ owner: name, ...item })),
    ...cluster.nodegroups.flatMap((group) => group.issues.map((item) => ({ owner: group.name, ...item }))),
  ][0];
  if (issue) return { ...base, status: "broken", sentence: `${issue.owner}: ${issue.code} ${issue.message}`.trim() };
  return base;
}

function findingsOf(nodes, edges) {
  const kindOf = (id) => nodes.find((node) => node.id === id)?.kind;
  const list = [
    ...edges
      .filter((edge) => edge.status !== "ok" && edge.sentence)
      .map((edge) => ({
        status: edge.status,
        nodeId: edge.to,
        depth: DEPTH[kindOf(edge.to)] ?? 9,
        edge: true,
        symptom: false,
        sentence: edge.sentence,
      })),
    ...nodes
      // A fixed 503 the rule was written to send (maintenance) is shown amber
      // on its card, but it is not a finding.
      .filter((node) => node.status !== "ok" && !node.facts?.answer)
      .map((node) => ({
        status: node.status,
        nodeId: node.id,
        depth: DEPTH[node.kind],
        edge: false,
        symptom: Boolean(node.symptom),
        sentence: node.sentence,
      })),
  ];
  const rank = (item) => [item.symptom ? 1 : 0, item.status === "unknown" ? 1 : 0, item.depth, item.edge ? 0 : 1];
  return list.sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    for (let i = 0; i < ra.length; i += 1) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  });
}
