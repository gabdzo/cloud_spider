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
      line = "";
      const result = await lookup(region);
      if (mine !== ticket) return { dropped: true, line };
      line = result?.error ? radioError(result.error) : radioLine(result?.event ?? null);
      return { dropped: false, line };
    },
  };
}
