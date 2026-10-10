const WINDOW = 15;
const READ_ONLY = /^(Describe|List|Get(?!FederationToken$)|Lookup|Head)/;

export function radioLine(event) {
  if (!event) return "the radio is quiet";
  const resources = event.resources || [];
  if (resources.length === 0) return event.name;
  if (resources.length === 1) return `${event.name} ${resources[0]}`;
  return `${event.name} ${resources[0]} ${resources.length}`;
}

export function radioError(error) {
  return `the radio cannot read CloudTrail: ${error}`;
}

export function radioWindow(events) {
  const kept = [];
  for (const event of events || []) {
    if (!event || READ_ONLY.test(event.name || "")) continue;
    kept.push(event);
  }
  const ordered = kept
    .map((event, index) => ({ event, index }))
    .sort((a, b) => (b.event.time || 0) - (a.event.time || 0) || a.index - b.index)
    .slice(0, WINDOW)
    .map((item) => radioLine(item.event));
  if (ordered.length === 0) return "the radio is quiet";
  return ordered.join("\n");
}

function eventsFrom(result) {
  if (Array.isArray(result?.events)) return result.events;
  if (result?.event) return [result.event];
  return [];
}

export function createRadio({ lookup }) {
  let line = "";
  let ticket = 0;

  return {
    line() {
      return line;
    },
    clear() {
      line = "";
    },
    async refresh(region) {
      const mine = ++ticket;
      const result = await lookup(region);
      if (mine !== ticket) return { dropped: true, line };
      line = result?.error ? radioError(result.error) : radioWindow(eventsFrom(result));
      return { dropped: false, line };
    },
  };
}
