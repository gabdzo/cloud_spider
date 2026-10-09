const INSTANCE_ID = /^i-[0-9a-f]{8,17}$/;

export function isInstanceId(value) {
  return typeof value === "string" && INSTANCE_ID.test(value);
}
