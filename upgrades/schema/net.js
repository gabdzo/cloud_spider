// Region and CIDR helpers (Terraform cidrsubnet()), shared by the EKS program,
// its schema and the preflight. docs/iac-robustness-plan.md item 12.
import { cidrOk } from "./cidr-core.js";

export { cidrOk };

const toInt = (ip) => ip.split(".").reduce((a, o) => a * 256 + Number(o), 0);
const toIp = (n) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");

// cidrsubnet("10.43.0.0/16", 8, 1) = "10.43.1.0/24"
export function cidrsubnet(cidr, newbits, index) {
  const [ip, bits] = cidr.split("/");
  const prefix = Number(bits) + newbits;
  if (prefix > 32 || index >= 2 ** newbits) throw new Error(`cidrsubnet(${cidr}, ${newbits}, ${index}) does not fit`);
  return `${toIp(toInt(ip) + index * 2 ** (32 - prefix))}/${prefix}`;
}

export function cidrsOverlap(a, b) {
  const range = (c) => { const [ip, bits] = c.split("/"); const start = toInt(ip); return [start, start + 2 ** (32 - Number(bits)) - 1]; };
  const [a0, a1] = range(a);
  const [b0, b1] = range(b);
  return a0 <= b1 && b0 <= a1;
}

const PRIVATE = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];
export function privateCidr(cidr) {
  return PRIVATE.some((p) => { const [, pb] = p.split("/"); const [, cb] = cidr.split("/"); return Number(cb) >= Number(pb) && cidrsOverlap(p, cidr); });
}

// The EKS stack's two subnets: the 2nd and 3rd blocks of 8 more bits
// (10.43.0.0/16 -> 10.43.1.0/24, 10.43.2.0/24: what the stack always had).
export const eksSubnets = (vpcCidr) => [cidrsubnet(vpcCidr, 8, 1), cidrsubnet(vpcCidr, 8, 2)];
// Its two zones in a region: <region>a and <region>b.
export const eksZones = (region = "eu-north-1") => [`${region}a`, `${region}b`];
export const REGION_PATTERN = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;
