// A strict IPv4 CIDR: octets 0-255, prefix 0-32, no host bits.
export function cidrOk(text, { hostBits = false } = {}) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(String(text));
  if (!m) return false;
  const octets = m.slice(1, 5).map(Number);
  const bits = Number(m[5]);
  if (octets.some((o) => o > 255) || bits > 32) return false;
  if (hostBits) return true;
  const ip = octets.reduce((a, o) => a * 256 + o, 0);
  return bits === 0 ? ip === 0 : ip % 2 ** (32 - bits) === 0;
}
