// One config for Cloud Spider: cloudspider.yaml.
//
// Where it is read from (the first that exists):
//   1. --config <file> on the command line
//   2. $CLOUDSPIDER_CONFIG
//   3. cloudspider.yaml in the repo root
//   4. ~/.config/cloudspider/config.yaml
// No file is fine: everything has a default.
//
// Precedence, lowest to highest: defaults < config file < env vars < CLI
// flags. Every env var Cloud Spider read before this file existed still
// works and still wins over the file, so an old start line behaves as it did.
// cloudspider.example.yaml documents every key; SCHEMA below is the truth.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { LineCounter, parseDocument } from "yaml";

const REGION = /^[a-z]{2}(-gov)?-[a-z]+-\d$/;
const CONTEXT = /^[A-Za-z0-9][A-Za-z0-9@:._/+-]{0,252}$/;
const NAMESPACE = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;
const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

// A leaf: { type, default, env?, flag?, doc, ... }. type is string, integer,
// boolean, enum (values), list (items: a pattern) or contexts.
export const SCHEMA = {
  server: {
    host: { type: "string", default: "127.0.0.1", env: "CLOUDSPIDER_HOST", flag: "host", doc: "address to listen on; anything but loopback exposes stop/start and ASK to the network" },
    port: { type: "integer", min: 1, max: 65535, default: 9241, env: "PORT", flag: "port", doc: "port to listen on" },
  },
  aws: {
    profile: { type: "string", default: "", env: "AWS_PROFILE", flag: "profile", doc: "AWS profile for every AWS call (empty: the SDK default chain)" },
    region: { type: "string", pattern: REGION, default: "", env: "AWS_REGION", flag: "region", doc: "region the map opens on (empty: the profile's region)" },
    regions: { type: "list", items: REGION, default: [], doc: "only offer these regions in the region picker (empty: every enabled region)" },
    logGroup: { type: "string", default: "", env: "CLOUDSPIDER_LOG_GROUP", doc: "CloudWatch log group the LOGS panel reads" },
  },
  kube: {
    context: { type: "string", pattern: CONTEXT, default: "cloudspider-viewer", env: "CLOUDSPIDER_KUBE_CONTEXT", doc: "the one context used when no contexts are listed" },
    contexts: { type: "contexts", default: [], doc: "contexts and namespace allowlists; merged with cloudspider.contexts.yaml (these first)" },
    contextsFile: { type: "string", default: "cloudspider.contexts.yaml", env: "CLOUDSPIDER_KUBE_CONTEXTS_FILE", doc: "the contexts file CONNECT writes (still read, merged after kube.contexts)" },
    autoConnect: { type: "boolean", default: true, env: "CLOUDSPIDER_KUBE_AUTO_CONNECT", doc: "CONNECT a cluster after its EKS RUN on Stacks, DISCONNECT it after TAKE IT DOWN (the current context is never changed)" },
    writeContexts: { type: "list", items: CONTEXT, default: [], env: "CLOUDSPIDER_KUBE_WRITE_CONTEXTS", doc: "contexts where Cloud Spider may create its network debug pod (a separate identity with the netdebug Role); [] = none, ppf-* need a typed confirm" },
  },
  ui: {
    theme: { type: "enum", values: ["pip", "pro"], default: "pip", env: "CLOUDSPIDER_THEME", flag: "theme", doc: "pip (Pip-Boy) or pro (clean dark); a choice in the settings panel overrides it per browser" },
    defaultView: { type: "enum", values: ["map", "path", "cluster", "vaults"], default: "map", env: "CLOUDSPIDER_VIEW", flag: "view", doc: "view a bare URL opens on" },
    stacksLayout: { type: "enum", values: ["overview", "combined"], default: "overview", env: "CLOUDSPIDER_STACKS_LAYOUT", doc: "STACKS opens on: overview (what is deployed; run controls in a separate RUN CONSOLE) or combined (the old cards with the run controls inline); the toggle in the STACKS title overrides it per browser" },
    refresh: {
      mapSeconds: { type: "integer", min: 1, max: 600, default: 1, doc: "how often the map polls instance state" },
      radioSeconds: { type: "integer", min: 10, max: 3600, default: 30, doc: "how often the radio reads CloudTrail" },
      kubeSeconds: { type: "integer", min: 5, max: 3600, default: 15, doc: "how often the pod health watch ticks (each context keeps its own poll)" },
      sloSeconds: { type: "integer", min: 10, max: 3600, default: 30, doc: "how often SLOs are evaluated in the background" },
    },
  },
  paths: {
    vaults: { type: "string", default: "vaults", env: "CLOUDSPIDER_VAULTS_DIR", doc: "folder of vault files (SLOs live in the vault files)" },
  },
  cost: {
    enabled: { type: "boolean", default: true, env: "CLOUDSPIDER_COST", doc: "read Cost Explorer for CAPS (each read is ~5 calls at $0.01)" },
    cacheTtlMinutes: { type: "integer", min: 60, max: 10080, default: 360, env: "CLOUDSPIDER_COST_TTL_MINUTES", doc: "how long a bill is reused (at least an hour: the API is billed)" },
  },
  storage: {
    backend: { type: "enum", values: ["file", "dynamodb"], default: "file", env: "CLOUDSPIDER_STORAGE", doc: "file (JSON under storage.path); dynamodb is designed, not built (docs/storage.md)" },
    path: { type: "string", default: ".cloudspider", env: "CLOUDSPIDER_STATE_DIR", doc: "state folder for the file backend (relative to the repo root)" },
    table: { type: "string", default: "", doc: "DynamoDB table name (reserved for the dynamodb backend)" },
  },
  learn: {
    context: { type: "string", pattern: CONTEXT, default: "", env: "CLOUDSPIDER_LAB_CONTEXT", doc: "the lab cluster's kube context LEARN checks are pinned to (kind-*, k3d-*, minikube, crc, or \"lab\" in the name); empty: checks do not run" },
    deny: { type: "list", items: CONTEXT, default: [], env: "CLOUDSPIDER_LAB_DENY", doc: "more contexts that are never a lab (ppf-* always are)" },
  },
  scorecard: {
    environment: { type: "string", pattern: /^[a-z0-9-]{0,32}$/, default: "", doc: "environment label that picks the scorecard profile (production, staging, development, sandbox…); empty: production rules, and the report says so" },
    regions: { type: "list", items: REGION, default: [], doc: "regions the AWS scorecard scans (first is home, for CloudTrail); empty: aws.region" },
    packs: { type: "list", items: /^(kubernetes|aws)$/, default: ["kubernetes", "aws"], doc: "which control packs SCAN offers" },
  },
  network: {
    enabled: { type: "boolean", default: true, env: "CLOUDSPIDER_FEATURE_NETWORK", doc: "network debugging: the DEBUG bar in PATH (local probes of a URL you type)" },
    local: {
      timeoutSeconds: { type: "integer", min: 1, max: 60, default: 10, doc: "per step of a URL debug run" },
      maxRedirects: { type: "integer", min: 0, max: 10, default: 10, doc: "redirects followed (80, 443 or the URL's own port only)" },
      doh: { type: "list", items: /^https:\/\/[A-Za-z0-9.-]+(:\d+)?\/[^\s?#]*$/, default: ["https://cloudflare-dns.com/dns-query", "https://dns.google/resolve"], doc: "public DoH resolvers compared with this machine's answer; [] turns that check off" },
      ipv6: { type: "enum", values: ["auto", "off"], default: "auto", doc: "connect to IPv6 addresses too" },
      allowInternalTargets: { type: "boolean", default: false, env: "CLOUDSPIDER_NETWORK_INTERNAL", doc: "probe loopback and RFC 1918 addresses (VPN users); metadata and link-local are always refused" },
      rateLimit: {
        perHostPerMinute: { type: "integer", min: 1, max: 60, default: 6, doc: "runs a minute per host" },
        perMinute: { type: "integer", min: 1, max: 120, default: 30, doc: "runs a minute in total" },
        concurrent: { type: "integer", min: 1, max: 8, default: 2, doc: "runs at once" },
      },
    },
    aws: {
      route53: { type: "boolean", default: true, doc: "read Route 53 (zones, records, TestDNSAnswer, health checks) when debugging a URL" },
      cloudfront: { type: "boolean", default: true, doc: "read CloudFront distributions when debugging a URL" },
      vpc: { type: "boolean", default: true, doc: "read NACLs, VPC endpoints, subnet free IPs and flow log settings of the load balancer's VPC" },
      flowLogs: { type: "boolean", default: true, doc: "search the VPC flow log group for REJECTs to the targets (last 15 min, 50 events, one call per target, max 4)" },
    },
    pod: {
      enabled: { type: "boolean", default: false, env: "CLOUDSPIDER_NETDEBUG_POD", doc: "FROM INSIDE in SNIFF: a short-lived netshoot pod probes DNS, TCP, HTTP, hops and MTU (needs a context in kube.writeContexts)" },
      namespace: { type: "string", pattern: /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/, default: "cloudspider-debug", doc: "where the debug pod runs by default" },
      sourceNamespaces: { type: "list", items: /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/, default: [], doc: "more namespaces it may run in (to test NetworkPolicy from that source)" },
      image: { type: "string", pattern: /^[a-z0-9./:-]+@sha256:[a-f0-9]{64}$/, default: "docker.io/nicolaka/netshoot@sha256:a20c2531bf35436ed3766cd6cfe89d352b050ccc4d7005ce6400adf97503da1b", doc: "probe image, pinned by digest (netshoot v0.13)" },
      ttlSeconds: { type: "integer", min: 30, max: 1800, default: 300, doc: "activeDeadlineSeconds and the sweeper's expiry" },
      allowRawTrace: { type: "boolean", default: false, doc: "tcptraceroute (netpol-friendly hops): the pod runs as root with only NET_RAW, no escalation" },
      openshiftScc: { type: "boolean", default: false, doc: "OpenShift + allowRawTrace: an admin applied the cloudspider-netdebug SCC shown in the plan" },
    },
    reports: {
      keep: { type: "integer", min: 1, max: 500, default: 50, doc: "debug reports kept under storage.path/netdebug" },
    },
  },
  stacks: {
    eks: {
      maxNodes: { type: "integer", min: 1, max: 10, default: 3, doc: "most nodes the EKS card's nodeCount takes (each node is billed)" },
    },
  },
  modules: {
    profile: { type: "enum", values: ["full", "k8s-only", "aws-only"], default: "full", env: "CLOUDSPIDER_PROFILE", flag: "modules", doc: "which modules are on: full, k8s-only (no AWS client is ever created) or aws-only" },
    enable: { type: "list", items: /^[a-z0-9-]{1,32}$/, default: [], doc: "modules to add to the profile (their needs come with them), e.g. [observe]" },
    disable: { type: "list", items: /^[a-z0-9-]{1,32}$/, default: [], doc: "modules to take out (whatever needs them goes too), e.g. [cost, radio]" },
  },
  logs: {
    loki: {
      url: { type: "string", pattern: /^(https?:\/\/[^\s]+)?$/, default: "", env: "CLOUDSPIDER_LOKI_URL", doc: "Loki's HTTP API (LOG ERRORS in the morning report), e.g. http://127.0.0.1:3100 through a port-forward; the observe bundle will fill this in" },
      tenant: { type: "string", default: "", env: "CLOUDSPIDER_LOKI_TENANT", doc: "X-Scope-OrgID for a multi-tenant Loki (empty: none)" },
      selector: { type: "string", default: "", doc: "LogQL stream selector (empty: {namespace=~\".+\"})" },
    },
    window: {
      start: { type: "string", pattern: /^([01]\d|2[0-3]):[0-5]\d$/, default: "22:00", doc: "the night window LOG ERRORS reports on, local time" },
      end: { type: "string", pattern: /^([01]\d|2[0-3]):[0-5]\d$/, default: "07:00", doc: "end of the night window" },
    },
    cloudwatch: {
      logGroups: { type: "list", items: /^[\w#/.-]{1,512}$/, default: [], doc: "EKS container log groups for Logs Insights when there is no Loki (aws module; billed per GB scanned, read at most every 5 min)" },
    },
  },
  features: {
    ask: { type: "boolean", default: true, env: "CLOUDSPIDER_FEATURE_ASK", doc: "ASK: the local agent terminal" },
    stacksRun: { type: "boolean", default: true, env: "CLOUDSPIDER_FEATURE_STACKS_RUN", doc: "running Pulumi from STACKS (reading stacks stays on)" },
    learn: { type: "boolean", default: true, env: "CLOUDSPIDER_FEATURE_LEARN", doc: "LEARN: the lab shelf and its read-only checks" },
    scorecard: { type: "boolean", default: true, doc: "SCORE: the readiness scorecard (FIX also needs stacksRun)" },
  },
};

const isLeaf = (node) => node && typeof node.type === "string";

export function leaves(schema = SCHEMA, prefix = []) {
  const out = [];
  for (const [key, node] of Object.entries(schema)) {
    if (isLeaf(node)) out.push({ path: [...prefix, key], spec: node });
    else out.push(...leaves(node, [...prefix, key]));
  }
  return out;
}

export function defaults(schema = SCHEMA) {
  const out = {};
  for (const { path, spec } of leaves(schema)) setIn(out, path, structuredClone(spec.default));
  return out;
}

function setIn(obj, path, value) {
  let at = obj;
  for (const key of path.slice(0, -1)) at = at[key] ??= {};
  at[path.at(-1)] = value;
}

function getIn(obj, path) {
  return path.reduce((at, key) => (at && typeof at === "object" ? at[key] : undefined), obj);
}

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const keep = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = keep;
    }
  }
  return row[b.length];
}

function suggest(word, options) {
  const best = options.map((o) => [o, distance(word.toLowerCase(), o.toLowerCase())]).sort((x, y) => x[1] - y[1])[0];
  return best && best[1] <= Math.max(2, Math.floor(word.length / 3)) ? best[0] : "";
}

const TRUE = new Set(["1", "true", "yes", "on"]);
const FALSE = new Set(["0", "false", "no", "off", ""]);

// One value against its leaf spec. fromText: env/flag strings are coerced.
function check(spec, value, fromText) {
  let v = value;
  if (fromText && typeof v === "string") {
    if (spec.type === "integer") v = /^-?\d+$/.test(v.trim()) ? Number(v) : v;
    if (spec.type === "boolean") v = TRUE.has(v.trim().toLowerCase()) ? true : FALSE.has(v.trim().toLowerCase()) ? false : v;
    if (spec.type === "list") v = v.split(",").map((s) => s.trim()).filter(Boolean);
  }
  switch (spec.type) {
    case "string":
      if (typeof v === "number") v = String(v);
      if (typeof v !== "string") return { error: `must be a string, got ${kind(v)}` };
      v = v.trim();
      if (v && spec.pattern && !spec.pattern.test(v)) return { error: `"${v.slice(0, 60)}" is not valid here` };
      return { value: v };
    case "integer":
      if (!Number.isInteger(v)) return { error: `must be a whole number, got ${show(v)}` };
      if (v < spec.min || v > spec.max) return { error: `must be between ${spec.min} and ${spec.max}, got ${v}` };
      return { value: v };
    case "boolean":
      if (typeof v !== "boolean") return { error: `must be true or false, got ${show(v)}` };
      return { value: v };
    case "enum":
      if (!spec.values.includes(v)) {
        const hint = typeof v === "string" ? suggest(v, spec.values) : "";
        return { error: `must be one of ${spec.values.join(", ")}, got ${show(v)}${hint ? ` (did you mean ${hint}?)` : ""}` };
      }
      return { value: v };
    case "list": {
      if (!Array.isArray(v)) return { error: `must be a list, got ${kind(v)}` };
      const items = v.map((s) => String(s).trim());
      const bad = items.filter((s) => spec.items && !spec.items.test(s));
      if (bad.length) return { error: `${bad.map((s) => `"${s.slice(0, 40)}"`).join(", ")} ${bad.length === 1 ? "is" : "are"} not valid` };
      return { value: [...new Set(items)] };
    }
    case "contexts":
      return checkContexts(v);
    default:
      return { error: `unknown type ${spec.type}` };
  }
}

function checkContexts(v) {
  if (!Array.isArray(v)) return { error: `must be a list of { context, label?, namespaces?, poll? }, got ${kind(v)}` };
  const out = [];
  for (const [i, raw] of v.entries()) {
    const where = `[${i}]`;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { error: `${where} must be a mapping with a context key` };
    const extra = Object.keys(raw).filter((k) => !["context", "label", "namespaces", "poll"].includes(k));
    if (extra.length) return { error: `${where} has unknown key ${extra[0]}${suggest(extra[0], ["context", "label", "namespaces", "poll"]) ? ` (did you mean ${suggest(extra[0], ["context", "label", "namespaces", "poll"])}?)` : ""}` };
    const name = String(raw.context ?? "").trim();
    if (!CONTEXT.test(name)) return { error: `${where}.context "${name.slice(0, 40)}" is not a kube context name` };
    let ns = raw.namespaces ?? "*";
    if (Array.isArray(ns)) {
      const bad = ns.map(String).filter((n) => !NAMESPACE.test(n));
      if (bad.length) return { error: `${where}.namespaces: "${bad[0].slice(0, 63)}" is not a namespace` };
      if (!ns.length) return { error: `${where}.namespaces is empty (use "*" for every namespace)` };
    } else if (ns !== "*") return { error: `${where}.namespaces must be a list or "*"` };
    if (raw.poll != null && !(Number(raw.poll) >= 30)) return { error: `${where}.poll must be at least 30 seconds` };
    out.push({ context: name, ...(raw.label != null ? { label: String(raw.label) } : {}), namespaces: ns, ...(raw.poll != null ? { poll: Number(raw.poll) } : {}) });
  }
  return { value: out };
}

function kind(v) {
  return Array.isArray(v) ? "a list" : v === null ? "nothing" : typeof v === "object" ? "a mapping" : `${typeof v} ${show(v)}`;
}

function show(v) {
  return typeof v === "string" ? `"${v.slice(0, 40)}"` : JSON.stringify(v);
}

// Unknown keys anywhere in the file are errors (a typo silently ignored is
// the worst kind of config bug).
function unknownKeys(raw, schema, prefix, out) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
  for (const key of Object.keys(raw)) {
    const node = schema[key];
    const path = [...prefix, key];
    if (!node) {
      const hint = suggest(key, Object.keys(schema));
      out.push({ path, message: `unknown key${hint ? ` (did you mean ${[...prefix, hint].join(".")}?)` : ""}` });
    } else if (!isLeaf(node)) {
      if (raw[key] != null && (typeof raw[key] !== "object" || Array.isArray(raw[key]))) out.push({ path, message: `must be a mapping, got ${kind(raw[key])}` });
      else unknownKeys(raw[key], node, path, out);
    }
  }
}

export const FLAGS = {
  config: { type: "string" },
  set: { type: "string", multiple: true },
  help: { type: "boolean" },
  ...Object.fromEntries(leaves().filter((l) => l.spec.flag).map((l) => [l.spec.flag, { type: "string" }])),
};

export function parseFlags(argv) {
  try {
    const { values } = parseArgs({ args: argv, options: FLAGS, strict: true, allowPositionals: false });
    return { values };
  } catch (error) {
    return { values: {}, error: error.message };
  }
}

// Which file: { file, tried }. Missing files are fine; a named one that is
// missing is an error.
export function findConfigFile({ flag = "", env = {}, root, home = homedir(), exists = existsSync } = {}) {
  if (flag) return { file: resolve(flag), named: "--config" };
  if (env.CLOUDSPIDER_CONFIG) return { file: resolve(env.CLOUDSPIDER_CONFIG), named: "CLOUDSPIDER_CONFIG" };
  const tried = [join(root, "cloudspider.yaml"), join(home, ".config", "cloudspider", "config.yaml")];
  return { file: tried.find((f) => exists(f)) || "", tried };
}

// Everything in one pass: { config, sources, errors, warnings, file }.
// errors are strings "where: key: message" fit to print one per line.
export function loadConfig({ argv = [], env = {}, root = process.cwd(), home = homedir(), read = (f) => readFileSync(f, "utf8"), exists = existsSync } = {}) {
  const errors = [];
  const warnings = [];
  const config = defaults();
  const sources = {};
  for (const { path } of leaves()) sources[path.join(".")] = "default";

  const flags = parseFlags(argv);
  if (flags.error) errors.push(`command line: ${flags.error}`);
  const found = findConfigFile({ flag: flags.values.config, env, root, home, exists });
  let file = found.file;
  if (file && !exists(file)) {
    errors.push(`${found.named} names ${file}, which does not exist`);
    file = "";
  }

  if (file) {
    let text = "";
    try {
      text = read(file);
    } catch (error) {
      errors.push(`${file}: cannot read (${error.message})`);
    }
    const lineCounter = new LineCounter();
    const doc = parseDocument(text, { lineCounter, prettyErrors: false });
    // file:line:col of a key (the key itself, so an unknown key points at
    // the typo and a bad value at the line that holds it).
    const at = (path) => {
      const parent = path.length > 1 ? doc.getIn(path.slice(0, -1), true) : doc.contents;
      const pair = parent?.items?.find?.((item) => item.key?.value === path.at(-1));
      const range = pair?.key?.range;
      if (!range) return file;
      const { line, col } = lineCounter.linePos(range[0]);
      return `${file}:${line}:${col}`;
    };
    if (doc.errors.length) {
      for (const e of doc.errors) {
        const { line, col } = lineCounter.linePos(e.pos[0]);
        errors.push(`${file}:${line}:${col}: YAML: ${e.message.split("\n")[0]}`);
      }
    } else {
      const raw = doc.toJS() ?? {};
      if (typeof raw !== "object" || Array.isArray(raw)) errors.push(`${file}: the top level must be a mapping (server:, aws:, kube:, ...)`);
      else {
        const unknown = [];
        unknownKeys(raw, SCHEMA, [], unknown);
        for (const u of unknown) errors.push(`${at(u.path)}: ${u.path.join(".")}: ${u.message}`);
        for (const { path, spec } of leaves()) {
          const value = getIn(raw, path);
          if (value === undefined || value === null) continue;
          const got = check(spec, value, false);
          if (got.error) errors.push(`${at(path)}: ${path.join(".")} ${got.error}`);
          else {
            setIn(config, path, got.value);
            sources[path.join(".")] = `file`;
          }
        }
      }
    }
  }

  for (const { path, spec } of leaves()) {
    if (!spec.env || env[spec.env] === undefined) continue;
    // An empty env var (PORT=) means "not set", as it always has.
    if (env[spec.env] === "" && spec.type !== "boolean") continue;
    const got = check(spec, env[spec.env], true);
    if (got.error) errors.push(`env ${spec.env} (${path.join(".")}) ${got.error}`);
    else {
      setIn(config, path, got.value);
      sources[path.join(".")] = `env ${spec.env}`;
    }
  }

  const byPath = new Map(leaves().map((l) => [l.path.join("."), l]));
  const applyFlag = (path, text, label) => {
    const leaf = byPath.get(path);
    if (!leaf) {
      const hint = suggest(path, [...byPath.keys()]);
      errors.push(`${label}: no setting ${path}${hint ? ` (did you mean ${hint}?)` : ""}`);
      return;
    }
    const got = check(leaf.spec, text, true);
    if (got.error) errors.push(`${label} (${path}) ${got.error}`);
    else {
      setIn(config, leaf.path, got.value);
      sources[path] = label;
    }
  };
  for (const { path, spec } of leaves()) {
    if (spec.flag && flags.values[spec.flag] !== undefined) applyFlag(path.join("."), flags.values[spec.flag], `--${spec.flag}`);
  }
  for (const pair of flags.values.set || []) {
    const eq = pair.indexOf("=");
    if (eq < 1) errors.push(`--set ${pair}: use --set key.path=value`);
    else applyFlag(pair.slice(0, eq).trim(), pair.slice(eq + 1), `--set ${pair.slice(0, eq).trim()}`);
  }

  if (config.storage.backend === "dynamodb") errors.push(`storage.backend: dynamodb is designed but not built yet; use file (docs/storage.md)`);
  if (!LOOPBACK.has(config.server.host)) warnings.push(`server.host is ${config.server.host}: Cloud Spider has no login, so anyone who can reach it can stop instances and run ASK`);

  return { config, sources, errors, warnings, file, help: Boolean(flags.values.help) };
}

// What main.js puts into process.env so modules that read env vars directly
// (the AWS SDK, kube.js, vaults.js, learn.js, pulumi/terraform children) see
// a value set in the file or by a flag. A value that came from the env is
// already there, and a default is left unset, as before. Lists are joined
// with commas; paths are made absolute against the repo root.
const ABSOLUTE = new Set(["paths.vaults", "kube.contextsFile"]);
export function envExports({ config, sources }, root) {
  const out = {};
  for (const { path, spec } of leaves()) {
    const key = path.join(".");
    const from = sources[key] || "default";
    if (!spec.env || from === "default" || from.startsWith("env ")) continue;
    let value = getIn(config, path);
    if (Array.isArray(value)) value = value.join(",");
    if (value === "" || value === null || typeof value === "object") continue;
    out[spec.env] = String(ABSOLUTE.has(key) ? resolvePath(root, value) : value);
  }
  return out;
}

// Paths in the config are relative to the repo root.
export function resolvePath(root, path) {
  return isAbsolute(path) ? path : join(root, path);
}

const SECRET = /secret|token|passphrase|password|credential|apikey|api_key|private/i;

// Redacted copy for /api/config and the settings panel: any key that looks
// like a secret (none today; a guard for later keys) becomes "•••".
export function redact(value, key = "") {
  if (SECRET.test(key)) return value === "" || value == null ? value : "•••";
  if (Array.isArray(value)) return value.map((v) => redact(v));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, k)]));
  return value;
}

// What /api/config answers: the effective config, where each key came from,
// and the file read.
export function effectiveConfig({ config, sources, file, warnings = [] }) {
  return { file: file || "", config: redact(config), sources, warnings };
}

export function usage() {
  const lines = ["usage: npm start -- [--config file] [--set key.path=value ...] " + leaves().filter((l) => l.spec.flag).map((l) => `[--${l.spec.flag} v]`).join(" "), "", "settings (key  default  env  flag):"];
  for (const { path, spec } of leaves()) {
    lines.push(`  ${path.join(".").padEnd(26)} ${JSON.stringify(spec.default).padEnd(28)} ${(spec.env || "").padEnd(32)} ${spec.flag ? `--${spec.flag}` : ""}`);
  }
  return lines.join("\n");
}
