// Which resources belong to which vault. Shared by the server (it sends the
// owned ids with each vault) and the page (layout moves owned camp pieces
// into their vault). Pure functions, no AWS.

// Tags arrive as [{key, value}] (EC2), [{Key, Value}] (ELB) or a plain
// object (EKS, Pulumi outputs). One shape out: a plain object.
export function tagMap(tags) {
  if (!tags) return {};
  if (Array.isArray(tags)) {
    const out = {};
    for (const tag of tags) {
      const key = tag?.key ?? tag?.Key;
      if (key) out[key] = String(tag?.value ?? tag?.Value ?? "");
    }
    return out;
  }
  if (typeof tags === "object") {
    const out = {};
    for (const [key, value] of Object.entries(tags)) out[key] = String(value ?? "");
    return out;
  }
  return {};
}

// Every resource on the map, in one shape.
export function placeResources(place) {
  const out = [];
  for (const item of place?.instances || []) {
    out.push({ id: item.id, arn: item.arn || "", name: item.name || "", kind: "ec2", vpcId: item.vpcId || "", tags: tagMap(item.tags), source: "instance" });
  }
  for (const item of place?.fixtures || []) {
    out.push({ id: item.id, arn: item.arn || "", name: item.name || "", kind: item.kind || "", vpcId: item.vpcId || "", tags: tagMap(item.tags), source: "fixture" });
  }
  return out;
}

export function matches(selector, resource) {
  const ids = selector?.ids || [];
  if (ids.length) {
    const handles = [resource.id, resource.arn, resource.name].filter(Boolean);
    if (ids.some((id) => handles.includes(id))) return true;
    // An ARN ending in the id (arn:...:instance/i-0abc) matches the id too.
    if (ids.some((id) => id.startsWith("arn:") && handles.some((handle) => id.endsWith(`/${handle}`) || id.endsWith(`:${handle}`)))) return true;
  }
  const tags = Object.entries(selector?.tags || {});
  if (tags.length && tags.every(([key, value]) => resource.tags[key] === value)) return true;
  return false;
}

// vault key -> owned resource ids. A resource belongs to the first vault (in
// file order) that claims it, so the map never draws it twice.
export function matchVaults(vaults, place) {
  const owned = new Map();
  const taken = new Set();
  const resources = placeResources(place);
  for (const vault of vaults || []) {
    const mine = [];
    if (!vault.damaged) {
      for (const resource of resources) {
        if (taken.has(resource.id)) continue;
        if (matches(vault.resources, resource)) {
          taken.add(resource.id);
          mine.push(resource.id);
        }
      }
    }
    owned.set(vault.key || vault.name, mine);
  }
  return owned;
}

// The page receives vaults with their resource ids already attached; this is
// the set of ids that leave the general camp.
export function ownedIds(vaults) {
  const ids = new Set();
  for (const vault of vaults || []) for (const id of vault.owned || []) ids.add(id);
  return ids;
}
