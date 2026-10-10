// LEARN: the lab shelf. Three tracks of hands-on labs live under labs/:
//   ex280  OpenShift EX280 labs (oc), imported unchanged plus hints.yaml
//   k8s    the same labs for Kubernetes/EKS (kubectl), with a mapping table
//   cloud  (later) cloud-platform scenarios, listed with labctl commands
// Cloud Spider shows the task, the setup commands, hints one at a time and
// the check script, and keeps progress in .learn/progress.json. It never
// shows anything from a lab's answer/ folder. It runs a check script only
// when a static scan finds no cluster write, exec or install in the script
// and the helpers it calls; otherwise the card says "run it yourself".
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
export const CHECK_TIMEOUT = { ex280: 300_000, k8s: 120_000 };

export const TRACKS = [
  { id: "k8s", title: "KUBERNETES / EKS", tool: "kubectl", note: "The EX280 labs rewritten for any Kubernetes cluster (EKS, kind, k3s): oc → kubectl, Routes → Ingress, SCC → Pod Security, projects → namespaces." },
  { id: "ex280", title: "OPENSHIFT EX280", tool: "oc", note: "The original labs for OpenShift Local (CRC) 4.22. Run them on the OpenShift stack or any cluster where you are cluster-admin." },
];

// Commands that change a cluster, open a shell in a pod or install things.
const WRITES = [
  /\b(?:oc|kubectl)\s+(?:-\S+(?:[\s=][^-\s]\S*)?\s+)*(apply|create|delete|patch|edit|replace|set|scale|label|annotate|expose|run|exec|rsh|debug|port-forward|cp|attach|autoscale|new-app|new-project|new-build|start-build|process|import-image|tag|login|drain|cordon|uncordon|taint)\b/,
  /\b(?:oc|kubectl)\s+adm\s+(?!top\b)/,
  /\b(?:oc|kubectl)\s+rollout\s+(undo|restart|pause|resume)\b/,
  /\bhelm\s+(install|upgrade|uninstall|delete|rollback|repo\s+add)\b/,
  /\bcurl\b[^\n]*\s-X\s*(POST|PUT|PATCH|DELETE)\b/,
  /\b(aws|pulumi|terraform|eksctl|labctl)\b\s+\S/,
];

export function stripComments(text) {
  return String(text)
    .split("\n")
    .map((line) => (/^\s*#/.test(line) ? "" : line))
    .join("\n");
}

// name() { ... } bodies of a sourced helper library (top-level functions).
export function shellFunctions(text) {
  const out = {};
  const lines = String(text).split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const head = /^([A-Za-z_][A-Za-z0-9_]*)\(\)\s*\{/.exec(lines[i]);
    if (!head) continue;
    const body = [];
    for (i += 1; i < lines.length && lines[i] !== "}"; i += 1) body.push(lines[i]);
    out[head[1]] = body.join("\n");
  }
  return out;
}

// What a script really runs: its own text plus every helper it calls,
// transitively. Returns { safe, reasons } with the offending lines.
export function scanScript(text, helpers = {}) {
  const seen = new Set();
  const parts = [{ where: "script", text: stripComments(text) }];
  for (let i = 0; i < parts.length; i += 1) {
    for (const name of Object.keys(helpers)) {
      if (seen.has(name) || !new RegExp(`\\b${name}\\b`).test(parts[i].text)) continue;
      seen.add(name);
      parts.push({ where: name, text: stripComments(helpers[name]) });
    }
  }
  const reasons = [];
  for (const part of parts) {
    for (const line of part.text.split("\n")) {
      if (WRITES.some((pattern) => pattern.test(line))) reasons.push(`${part.where}: ${line.trim()}`);
    }
  }
  return { safe: reasons.length === 0, reasons: [...new Set(reasons)].slice(0, 6), helpers: [...seen] };
}

function section(markdown, name) {
  const match = new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, "m").exec(markdown);
  return match ? match[1].trim() : "";
}

// Requirement lines from a README section: "- x" and "1. x" items; a line
// ending in ":" heads the items under it ("Deployment `catalog`: 3 ready
// replicas"); other prose lines (except setup notes) stay as their own line.
function bullets(text) {
  const out = [];
  let head = "";
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const item = /^(?:[-*]|\d+\.)\s+(.*)$/.exec(line);
    if (item) out.push(head ? `${head} ${item[1].trim()}` : item[1].trim());
    else if (line.endsWith(":")) head = line;
    else if (!/^Optional:|setup\.sh/.test(line)) {
      head = "";
      out.push(line);
    }
  }
  return out;
}

function prose(text) {
  return text
    .split("\n")
    .filter((line) => !/^\s*-\s/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseEx280Readme(markdown) {
  const title = (/^#\s+(.*)$/m.exec(markdown)?.[1] || "").replace(/^(Lab|Mock exam|Mock)\s*\d+\s*[—–-]\s*/i, "").trim();
  const scenario = prose(section(markdown, "Scenario"));
  const objective = prose(section(markdown, "Objective"));
  const requirementsText = section(markdown, "Requirements");
  return {
    title,
    task: [scenario, objective].filter(Boolean).join(" "),
    requirements: bullets(requirementsText),
    success: bullets(section(markdown, "Success criteria")),
    note: prose(requirementsText.split("\n").filter((line) => /^Optional:/.test(line)).join(" ")),
  };
}

function readText(path) {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function labKey(track, id) {
  return `${track}/${id}`;
}

function ex280Labs(root) {
  const base = join(root, "labs/ex280");
  if (!existsSync(base)) return [];
  const hints = YAML.parse(readText(join(base, "hints.yaml")) || "{}") || {};
  const helpers = shellFunctions(readText(join(base, "common/helpers.sh")));
  const dirs = [
    ...readdirSync(base).filter((name) => /^lab\d\d-/.test(name)).map((name) => ({ id: name, rel: `labs/ex280/${name}`, mock: false })),
    ...(existsSync(join(base, "mock-exams")) ? readdirSync(join(base, "mock-exams")).filter((name) => /^mock\d\d$/.test(name)).map((name) => ({ id: name, rel: `labs/ex280/mock-exams/${name}`, mock: true })) : []),
  ].sort((a, b) => Number(a.mock) - Number(b.mock) || a.id.localeCompare(b.id));
  return dirs.map(({ id, rel, mock }) => {
    const readme = parseEx280Readme(readText(join(root, rel, "README.md")));
    const scan = scanScript(readText(join(root, rel, "verify.sh")), helpers);
    return {
      track: "ex280",
      key: labKey("ex280", id),
      id,
      num: mock ? `M${id.slice(-2)}` : id.slice(3, 5),
      mock,
      title: readme.title || id,
      task: readme.task,
      requirements: readme.requirements,
      success: readme.success,
      note: readme.note,
      setup: [`cd ${rel} && ./setup.sh`],
      hints: hints[id] || [],
      check: { command: `cd ${rel} && ./verify.sh`, path: `${rel}/verify.sh`, runnable: scan.safe, reasons: scan.reasons },
      reset: [`cd ${rel} && ./reset.sh`],
      cleanup: ["labs/ex280/common/cleanup-all.sh"],
      needs: ["oc (cluster-admin)", "python3", "openssl", "curl"],
      twin: mock ? "" : labKey("k8s", id),
      mapping: [],
      noEquivalent: [],
      docs: [],
    };
  });
}

function k8sLabs(root) {
  const base = join(root, "labs/k8s");
  if (!existsSync(base)) return [];
  const lib = readText(join(base, "common/check-lib.sh"));
  const helpers = shellFunctions(lib);
  return readdirSync(base)
    .filter((name) => /^lab\d\d-/.test(name) && existsSync(join(base, name, "lab.yaml")))
    .sort()
    .map((id) => {
      const spec = YAML.parse(readText(join(base, id, "lab.yaml"))) || {};
      const dir = join(base, id);
      const extra = readdirSync(dir).filter((name) => name.endsWith(".py")).map((name) => readText(join(dir, name))).join("\n");
      const scan = scanScript(`${readText(join(dir, "check.sh"))}\n${extra}\n${lib}`, helpers);
      return {
        track: "k8s",
        key: labKey("k8s", id),
        id,
        num: id.slice(3, 5),
        mock: false,
        title: spec.title || id,
        task: spec.task || "",
        requirements: spec.requirements || [],
        success: [],
        note: "",
        setup: spec.setup || [],
        hints: spec.hints || [],
        check: { command: `bash ${spec.check || `labs/k8s/${id}/check.sh`}`, path: spec.check || `labs/k8s/${id}/check.sh`, runnable: scan.safe, reasons: scan.reasons },
        reset: spec.reset || [],
        cleanup: spec.cleanup || [],
        needs: spec.needs || ["kubectl"],
        twin: spec.openshift ? labKey("ex280", spec.openshift.split("/").pop()) : "",
        mapping: spec.mapping || [],
        noEquivalent: spec.noEquivalent || [],
        docs: spec.docs || [],
      };
    });
}

export function loadLabs({ root = repoRoot, extraTracks = [] } = {}) {
  const labs = [...k8sLabs(root), ...ex280Labs(root), ...extraTracks.flatMap((track) => track.labs || [])];
  const tracks = [...TRACKS, ...extraTracks.map(({ labs: _labs, ...track }) => track)]
    .map((track) => ({ ...track, count: labs.filter((lab) => lab.track === track.id).length }))
    .filter((track) => track.count > 0);
  return { tracks, labs };
}

// PASS:/FAIL: lines → a result the panel can draw.
export function parseCheckOutput(text, { code = 0, timedOut = false } = {}) {
  const lines = [];
  for (const raw of String(text).split("\n")) {
    const match = /^(PASS|FAIL):\s*(.*)$/.exec(raw.trim());
    if (match) lines.push({ ok: match[1] === "PASS", text: match[2] });
  }
  const passed = lines.filter((line) => line.ok).length;
  const failed = lines.length - passed;
  const note = timedOut ? "the check timed out" : lines.length === 0 ? (String(text).trim().split("\n").filter(Boolean).pop() || `exit ${code}`).slice(0, 240) : "";
  return { ok: !timedOut && code === 0 && failed === 0 && lines.length > 0, passed, failed, lines, note };
}

export function createProgressStore({ file = join(repoRoot, ".learn/progress.json"), clock = () => Date.now() } = {}) {
  const read = () => {
    try {
      const data = JSON.parse(readFileSync(file, "utf8"));
      return data && typeof data.labs === "object" ? data : { labs: {} };
    } catch {
      return { labs: {} };
    }
  };
  const write = (data) => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, `${JSON.stringify(data, null, 2)}\n`);
    renameSync(`${file}.tmp`, file);
  };
  return {
    all: () => read().labs,
    update(key, change) {
      const data = read();
      const now = new Date(clock()).toISOString();
      const entry = data.labs[key] || { status: "new", hints: 0, checks: [] };
      if (typeof change.hints === "number") entry.hints = Math.max(entry.hints || 0, Math.min(10, Math.floor(change.hints)));
      if (change.started && entry.status === "new") entry.status = "started";
      if (change.check) {
        const { passed, failed, ok } = change.check;
        entry.checks = [...(entry.checks || []), { at: now, passed, failed, ok }].slice(-5);
        if (ok) {
          entry.status = "passed";
          entry.passedAt = entry.passedAt || now;
        } else if (entry.status !== "passed") entry.status = "failing";
      }
      if (change.reset) Object.assign(entry, { status: "new", hints: 0, checks: [], passedAt: undefined });
      entry.updatedAt = now;
      data.labs[key] = entry;
      write(data);
      return entry;
    },
  };
}

function runScript(command, args, { cwd, timeout, env }) {
  return new Promise((resolve) => {
    let out = "";
    let timedOut = false;
    const child = spawn(command, args, { cwd, env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeout);
    const take = (chunk) => {
      if (out.length < 200_000) out += chunk;
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 127, out: `FAIL: ${error.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, out, timedOut });
    });
  });
}

// A canned run for SAMPLE mode: the first check finds the last requirement
// still broken, the next one passes.
export function sampleCheck(lab, attempt = 0) {
  const names = (lab.requirements.length ? lab.requirements : ["the lab is solved"]).map((text) => text.replace(/`/g, ""));
  const lines = names.map((text, index) => ({ ok: attempt > 0 || index < names.length - 1, text }));
  const failed = lines.filter((line) => !line.ok).length;
  return { ok: failed === 0, passed: lines.length - failed, failed, lines, note: "sample run: no cluster was touched", sample: true };
}

export function createLearn({ root = repoRoot, progress = createProgressStore(), run = runScript, env = process.env, extraTracks = () => [] } = {}) {
  let busy = false;
  const catalog = () => loadLabs({ root, extraTracks: extraTracks() });
  const find = (key) => catalog().labs.find((lab) => lab.key === key);
  return {
    list() {
      const { tracks, labs } = catalog();
      return { tracks, labs, progress: progress.all() };
    },
    lab: find,
    progress(key, change = {}) {
      if (!find(key)) return { error: "no such lab" };
      return { key, entry: progress.update(key, change) };
    },
    async check(key, { sample = false, attempt = 0 } = {}) {
      const lab = find(key);
      if (!lab) return { error: "no such lab" };
      if (sample) return { key, result: sampleCheck(lab, attempt) };
      if (!lab.check.runnable) return { key, error: "this check changes the cluster or runs inside a pod, so Cloud Spider does not run it: copy the command and run it yourself", reasons: lab.check.reasons };
      if (busy) return { key, error: "another check is running" };
      busy = true;
      try {
        const script = join(root, lab.check.path);
        const ran = await run("bash", [script], { cwd: dirname(script), timeout: CHECK_TIMEOUT[lab.track] || 120_000, env: { ...env, LANG: "C.UTF-8" } });
        const result = parseCheckOutput(ran.out, ran);
        const entry = progress.update(key, { check: result });
        return { key, result, entry, script: relative(root, script) };
      } finally {
        busy = false;
      }
    },
  };
}
