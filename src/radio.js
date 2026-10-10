const WINDOW = 8;
const READ_ONLY = /^(Describe|List|Get(?!FederationToken$)|Lookup|Head)/;

const ACTS = [
  [/^StopInstances$/, "put a machine down"],
  [/^StartInstances$/, "brought a machine back"],
  [/^RunInstances$/, "raised a machine"],
  [/^TerminateInstances$/, "tore a machine down"],
  [/^CreateNetworkInterface(Permission)?$/, "opened a network interface"],
  [/^DeleteNetworkInterface$/, "closed a network interface"],
  [/^CreateTags$/, "tagged a thing"],
  [/^DeleteTags$/, "cleared a tag"],
  [/^CreateAutoScalingGroup$/, "raised a node group"],
  [/^DeleteAutoScalingGroup$/, "took a node group down"],
  [/^CreateNodegroup$/, "raised a node group"],
  [/^DeleteNodegroup$/, "took a node group down"],
  [/AutoScalingGroup$/, "changed a node group"],
  [/^CreateCluster$/, "raised a cluster"],
  [/^DeleteCluster$/, "took a cluster down"],
  [/^CreateLoadBalancer$/, "raised a gate"],
  [/^DeleteLoadBalancer$/, "took a gate down"],
  [/^AuthorizeSecurityGroupIngress$/, "opened a fence"],
  [/^RevokeSecurityGroupIngress$/, "closed a fence"],
  [/^CreateSecurityGroup$/, "drew a fence"],
  [/^DeleteSecurityGroup$/, "took a fence down"],
  [/^GetFederationToken$/, "asked for a token"],
];

export function radioLine(event) {
  if (!event) return "the radio is quiet";
  const act = phrase(event.name || "");
  const resources = (event.resources || []).map(shortId).filter(Boolean);
  if (resources.length === 0) return act;
  if (resources.length === 1) return `${act}  ${resources[0]}`;
  return `${act}  ${resources[0]}  +${resources.length - 1}`;
}

export function radioError(error) {
  return formatEntry({
    time: 0,
    status: "fail",
    text: `the radio cannot read CloudTrail: ${error}`,
  });
}

export function radioEntries(events) {
  const kept = [];
  for (const event of events || []) {
    if (!event || READ_ONLY.test(event.name || "")) continue;
    kept.push(event);
  }
  const ordered = kept
    .map((event, index) => ({ event, index }))
    .sort((a, b) => (b.event.time || 0) - (a.event.time || 0) || a.index - b.index)
    .slice(0, WINDOW)
    .map((item) => item.event);
  const groups = [];
  for (const event of ordered) {
    const act = phrase(event.name || "");
    const resource = (event.resources || []).map(shortId).find(Boolean) || "";
    const issue = event.error || event.issue || "";
    const status = issue ? "fail" : "ok";
    const group = groups.find((item) => item.act === act && item.status === status);
    if (!group) {
      groups.push({ act, count: 1, resource, time: event.time || 0, status, issue });
      continue;
    }
    group.count += 1;
    if (resource && group.resource !== resource) group.resource = "";
    if (!group.issue && issue) group.issue = issue;
  }
  return groups.slice(0, 4).map((item) => ({
    time: item.time,
    status: item.status,
    text: item.resource ? `${item.act}  ${item.resource}` : item.act,
    issue: item.issue,
    count: item.count,
  }));
}

export function radioWindow(events) {
  const entries = radioEntries(events);
  if (entries.length === 0) return "the radio is quiet";
  return entries.map(formatEntry).join("\n");
}

export function formatEntry(item) {
  const when = item.time ? clock(item.time) : "--:--";
  const mark = item.status === "fail" ? "fail" : "ok";
  const count = item.count > 1 ? `  ×${item.count}` : "";
  const issue = item.issue ? `  ${item.issue}` : "";
  return `${when}  ${mark.padEnd(4)}  ${item.text}${count}${issue}`;
}

function clock(time) {
  const date = new Date(time);
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function phrase(name) {
  for (const [pattern, line] of ACTS) {
    if (pattern.test(name)) return line;
  }
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return words || "did something";
}

function shortId(id) {
  const text = String(id);
  if (text.length <= 18) return text;
  return `${text.slice(0, 8)}…${text.slice(-4)}`;
}

function eventsFrom(result) {
  if (Array.isArray(result?.events)) return result.events;
  if (result?.event) return [result.event];
  return [];
}

export function createRadio({ lookup }) {
  let line = "";
  let entries = [];
  // Failed calls, kept raw (newest first, 50 at most) for vault trouble.
  let failures = [];
  let ticket = 0;

  return {
    line() {
      return line;
    },
    entries() {
      return entries;
    },
    failures() {
      return failures;
    },
    clear() {
      line = "";
      entries = [];
      failures = [];
    },
    async refresh(region) {
      const mine = ++ticket;
      const result = await lookup(region);
      if (mine !== ticket) return { dropped: true, line };
      if (result?.error) {
        entries = [{ time: 0, status: "fail", text: `the radio cannot read CloudTrail: ${result.error}`, issue: "", count: 1 }];
        line = formatEntry(entries[0]);
      } else {
        entries = radioEntries(eventsFrom(result));
        failures = eventsFrom(result)
          .filter((event) => event?.error)
          .sort((a, b) => (b.time || 0) - (a.time || 0))
          .slice(0, 50);
        line = entries.length ? entries.map(formatEntry).join("\n") : "the radio is quiet";
      }
      return { dropped: false, line };
    },
  };
}
