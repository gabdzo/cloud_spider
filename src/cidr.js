function toInt(ip) {
  const parts = String(ip).split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3];
}

function parse(cidr) {
  const [ip, bits = "32"] = String(cidr).split("/");
  const base = toInt(ip);
  const size = Number(bits);
  if (base === null || !Number.isInteger(size) || size < 0 || size > 32) return null;
  const mask = size === 0 ? 0 : (0xffffffff << (32 - size)) >>> 0;
  return { start: (base & mask) >>> 0, size, mask };
}

export function cidrContains(outer, inner) {
  const a = parse(outer);
  const b = parse(inner);
  if (!a || !b || b.size < a.size) return false;
  return ((b.start & a.mask) >>> 0) === a.start;
}
