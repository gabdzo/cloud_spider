const SECRET_KEYS = /secret|credential|authorization|password|accesskey|sessiontoken|body/i;
const KEY_TEXT = /AKIA[0-9A-Z]{16}|wJalrXU[A-Za-z0-9/+]*/;

export function report(lines, { call, id, sentence, detail }) {
  const extra = publicDetail(detail);
  const shown = extra ? `${sentence}: ${extra}` : sentence;
  const who = id ? `${call} ${id}` : call;
  lines.push(`${who}: ${shown}`);
  return shown;
}

function publicDetail(detail) {
  if (!detail || typeof detail !== "object") return "";
  const message = typeof detail.message === "string" ? detail.message : "";
  if (!message || KEY_TEXT.test(message)) return "";
  if (SECRET_KEYS.test(message)) return "";
  return message;
}
