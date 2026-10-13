// A tiny typed config schema, shared by the app (the STACKS card, before any
// stack is made) and the Pulumi programs (first statement, before any
// resource). Dependency-free on purpose: the app and every stack import it by
// relative path, like eks-addons.js. docs/iac-robustness-plan.md item 1.
//
// A schema: { project, keys: { <name>: field }, rules: [(values) => "" | "problem"] }
// field: { type: "enum", choices, default }
//        { type: "int", min, max, default }
//        { type: "name", pattern, hint, default }     (string with a rule)
//        { type: "onoff", default }                   (on/off/true/false/yes/no/1/0 -> "on"|"off")
//        { type: "list", default }                    (comma list, kept as text)
// validate() never throws: it returns { values, errors } so the card can show
// every problem at once; assertValid() throws one readable error (programs).

const ON = ["on", "true", "yes", "1"];
const OFF = ["off", "false", "no", "0"];

function closest(word, options) {
  let best = "";
  let score = Infinity;
  for (const option of options) {
    const d = distance(word.toLowerCase(), option.toLowerCase());
    if (d < score) [best, score] = [option, d];
  }
  return score <= Math.max(2, Math.floor(word.length / 3)) ? best : "";
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

function one(name, field, raw) {
  const value = raw == null || raw === "" ? field.default : raw;
  if (field.type === "int") {
    const number = Number(value);
    if (!Number.isInteger(number) || number < field.min || number > field.max) return { error: `${name} must be a whole number from ${field.min} to ${field.max} (got ${JSON.stringify(raw)})` };
    return { value: number };
  }
  const text = String(value);
  if (field.type === "enum") {
    const hit = field.choices.find((choice) => choice.toLowerCase() === text.toLowerCase());
    if (!hit) return { error: `${name} must be ${field.choices.join(" or ")} (got ${JSON.stringify(text)})` };
    return { value: hit };
  }
  if (field.type === "onoff") {
    if (ON.includes(text.toLowerCase())) return { value: "on" };
    if (OFF.includes(text.toLowerCase())) return { value: "off" };
    return { error: `${name} must be on or off (got ${JSON.stringify(text)})` };
  }
  if (field.type === "name") {
    if (!field.pattern.test(text)) return { error: `${name} ${field.hint} (got ${JSON.stringify(text)})` };
    return { value: text };
  }
  return { value: text };
}

// input: { key: value } without the project prefix (the card's values), or a
// Pulumi config map ("<project>:<key>") when { prefixed: true }.
export function validate(schema, input = {}, { prefixed = false, strict = true } = {}) {
  const errors = [];
  const raw = {};
  for (const [full, value] of Object.entries(input || {})) {
    let key = full;
    if (prefixed) {
      if (!full.startsWith(`${schema.project}:`)) continue; // aws:region etc.: not ours
      key = full.slice(schema.project.length + 1);
    }
    if (!(key in schema.keys)) {
      if (strict) {
        const near = closest(key, Object.keys(schema.keys));
        errors.push(`unknown config key ${key}${near ? ` (did you mean ${near}?)` : ""}`);
      }
      continue;
    }
    raw[key] = value;
  }
  const values = {};
  for (const [key, field] of Object.entries(schema.keys)) {
    const got = one(key, field, raw[key]);
    if (got.error) errors.push(got.error);
    else values[key] = got.value;
  }
  // Cross-field rules only on a clean set: a bad enum would make them noisy.
  if (!errors.length) for (const rule of schema.rules || []) {
    const problem = rule(values);
    if (problem) errors.push(problem);
  }
  return { values, errors };
}

export function assertValid(schema, input, options) {
  const { values, errors } = validate(schema, input, options);
  if (errors.length) throw new Error(`${schema.project} config is not valid, nothing was created:\n  - ${errors.join("\n  - ")}`);
  return values;
}

// The inputs table for a module README (terraform-docs style).
export function docTable(schema) {
  const kind = (f) => (f.type === "enum" ? f.choices.join(" \\| ") : f.type === "int" ? `${f.min}..${f.max}` : f.type === "onoff" ? "on \\| off" : f.type === "name" ? f.hint : "text");
  return ["| key | allowed | default | description |", "|---|---|---|---|", ...Object.entries(schema.keys).map(([k, f]) => `| ${k} | ${kind(f)} | ${f.default ?? ""} | ${f.doc || ""} |`)].join("\n");
}
