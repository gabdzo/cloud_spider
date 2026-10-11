import assert from "node:assert/strict";
import test from "node:test";
import { execFile, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { parseAllDocuments } from "yaml";
import { createLearn, createProgressStore, loadLabs, parseCheckOutput, parseEx280Readme, sampleCheck, scanScript, shellFunctions } from "../src/learn.js";
import { createSampleProgress, labStatus, richText, trackTally } from "../src/learn-view.js";
import { holotapeGrid, holotapePalette, holotapeSprite, TAPE_H, TAPE_W } from "../src/sprites/holotape.js";
import { icon } from "../src/sprites/icons.js";
import { cssVars } from "../src/theme.js";
import { createApp } from "../src/app.js";
import { FILES, listen } from "../src/server.js";

const run = promisify(execFile);
const root = new URL("..", import.meta.url).pathname;
const read = (path) => readFileSync(join(root, path), "utf8");
const K8S = readdirSync(join(root, "labs/k8s")).filter((name) => /^lab\d\d-/.test(name)).sort();

test("the shelf has 15 Kubernetes labs and the 15 EX280 labs plus 3 mock exams", () => {
  const { tracks, labs: all } = loadLabs({ root });
  assert.deepEqual(tracks.map((track) => [track.id, track.count]), [["k8s", 15], ["ex280", 18], ["cloud", 2]]);
  assert.equal(K8S.length, 15);
  const labs = all.filter((lab) => lab.track !== "cloud"); // see learn-cloud.test.js
  for (const lab of labs) {
    assert.ok(lab.title && lab.task.length > 40, `${lab.key} has a task`);
    assert.ok(lab.setup.length && lab.hints.length >= 2, `${lab.key} has setup and hints`);
    assert.ok(existsSync(join(root, lab.check.path)), `${lab.key} check exists`);
    assert.ok(statSync(join(root, lab.check.path)).mode & 0o100, `${lab.key} check is executable`);
    assert.ok(lab.reset.length && lab.cleanup.length, `${lab.key} can be reset`);
    if (lab.track === "k8s") {
      assert.ok(lab.requirements.length >= 2 && lab.mapping.length >= 1 && lab.docs.length >= 1, `${lab.key} maps to OpenShift`);
      assert.ok(labs.some((other) => other.key === lab.twin), `${lab.key} twin ${lab.twin}`);
      assert.ok(lab.setup.every((line) => !/\boc\b/.test(line)), `${lab.key} setup uses kubectl`);
    }
  }
  // Every OpenShift lab with a K8s twin, and the twins point back.
  for (const lab of labs.filter((item) => item.track === "ex280" && !item.mock)) assert.ok(labs.some((other) => other.key === lab.twin));
});

test("LEARN never ships a lab's answer/ folder", () => {
  const text = JSON.stringify(loadLabs({ root }));
  assert.doesNotMatch(text, /answer\//);
  for (const lab of ["lab01-workloads", "lab06-configmaps-secrets", "lab14-troubleshooting"]) {
    for (const name of ["faults.md", "explanation.md"]) {
      const path = join(root, "labs/ex280", lab, "answer", name);
      if (!existsSync(path)) continue;
      const lines = readFileSync(path, "utf8").split("\n").filter((line) => line.trim().length > 30);
      for (const line of lines) assert.ok(!text.includes(line.trim()), `${lab}/${name} leaked`);
    }
  }
  // The import kept no secrets: no htpasswd file, no private keys, no kubeconfig.
  const all = spawnSync("git", ["ls-files", "-o", "-c", "--exclude-standard", "labs"], { cwd: root, encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  assert.ok(all.length > 100);
  for (const file of all) {
    assert.doesNotMatch(file, /htpasswd$|\.pem$|\.key$|kubeconfig|pull-secret|\.state\//, file);
    if (/\.(sh|ya?ml|md|py|json)$/.test(file)) assert.doesNotMatch(readFileSync(join(root, file), "utf8"), /BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY|aws_secret_access_key|"auths":\s*\{/, file);
  }
});

test("README parsing keeps grouped requirements and numbered lists", () => {
  const lab = parseEx280Readme("# Lab 01 — Workloads\n\n## Scenario\n\nA thing.\n\n## Objective\n\nFix it.\n\n## Requirements\n\nProject: `p`\n\nDeployment `a`:\n\n- 3 replicas\n- limits\n\n1. one\n2. two\n\n`setup.sh` prints hosts.\n\n## Success criteria\n\n- ok\n");
  assert.equal(lab.title, "Workloads");
  assert.equal(lab.task, "A thing. Fix it.");
  assert.deepEqual(lab.requirements, ["Project: `p`", "Deployment `a`: 3 replicas", "Deployment `a`: limits", "Deployment `a`: one", "Deployment `a`: two"]);
  assert.deepEqual(lab.success, ["ok"]);
});

test("the safety scan follows helpers and refuses exec, writes and installs", () => {
  const helpers = shellFunctions("a_ok() {\n  oc get pods\n}\n\nb_exec() {\n  oc exec deploy/x -- true\n}\n\nc_wrap() {\n  b_exec\n}\n");
  assert.deepEqual(Object.keys(helpers), ["a_ok", "b_exec", "c_wrap"]);
  assert.equal(scanScript("a_ok\n# oc delete everything\n", helpers).safe, true);
  const wrapped = scanScript("c_wrap\n", helpers);
  assert.equal(wrapped.safe, false);
  assert.match(wrapped.reasons[0], /^b_exec: oc exec/);
  for (const line of ["kubectl apply -f x", "kubectl -n a delete pod b", "oc adm policy add-scc-to-user x", "helm upgrade a b", "kubectl rollout restart deploy/a", "curl -X DELETE http://x", "aws ec2 terminate-instances", "kubectl port-forward svc/a 1"]) {
    assert.equal(scanScript(line).safe, false, line);
  }
  for (const line of ["kubectl get pods -o json", "kubectl auth can-i list pods --as a", "helm status a -o json", "kubectl rollout status deploy/a", "oc adm top pods"]) {
    assert.equal(scanScript(line).safe, true, line);
  }
  const { labs } = loadLabs({ root });
  const runnable = (key) => labs.find((lab) => lab.key === key).check.runnable;
  for (const id of K8S) assert.equal(runnable(`k8s/${id}`), true, id);
  assert.equal(runnable("ex280/lab01-workloads"), true);
  assert.equal(runnable("ex280/lab06-configmaps-secrets"), false, "lab06 verify rotates a secret");
  assert.equal(runnable("ex280/lab03-networkpolicy"), false, "lab03 verify execs into pods");
});

test("every Kubernetes check only reads the cluster (fake kubectl and helm log every call)", async () => {
  const bin = mkdtempSync(join(tmpdir(), "learn-bin-"));
  const log = join(bin, "calls.log");
  const fake = (name) => {
    writeFileSync(join(bin, name), `#!/usr/bin/env bash\necho "${name} $*" >> "${log}"\ncase "$1" in version) exit 0;; esac\nfor a in "$@"; do [[ "$a" == json ]] && { echo '{"items":[],"metadata":{},"spec":{"template":{"spec":{"containers":[{}]}}}}'; exit 0; }; done\nexit 1\n`);
    chmodSync(join(bin, name), 0o755);
  };
  fake("kubectl");
  fake("helm");
  for (const id of K8S) {
    const out = spawnSync("bash", [join(root, "labs/k8s", id, "check.sh")], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}` }, timeout: 30_000 });
    const result = parseCheckOutput(out.stdout, { code: out.status });
    assert.equal(out.status, 1, `${id} fails on an empty cluster`);
    assert.ok(result.failed >= 1 && result.lines.length >= 2, `${id}: ${out.stdout}`);
  }
  const calls = readFileSync(log, "utf8").trim().split("\n");
  assert.ok(calls.length > 40);
  for (const call of calls) {
    const [tool, verb, sub] = call.split(" ");
    if (tool === "helm") assert.equal(verb, "status", call);
    else assert.ok(["version", "get", "auth"].includes(verb) && (verb !== "auth" || sub === "can-i"), call);
  }
});

test("lab helper scripts judge fixtures correctly", () => {
  const py = (script, args, input) => spawnSync("python3", [join(root, "labs/k8s", script), ...args], { input: JSON.stringify(input), encoding: "utf8" }).status;
  const ns = (name) => ({ namespaceSelector: { matchLabels: { "kubernetes.io/metadata.name": name } } });
  const deny = { spec: { podSelector: {}, policyTypes: ["Ingress", "Egress"] } };
  const allowFront = { spec: { podSelector: { matchLabels: { app: "web" } }, policyTypes: ["Ingress"], ingress: [{ from: [ns("front")], ports: [{ port: 8080 }] }] } };
  const allowAll = { spec: { podSelector: {}, policyTypes: ["Ingress"], ingress: [{ from: [{ namespaceSelector: {} }] }] } };
  const dns = { spec: { podSelector: {}, policyTypes: ["Egress"], egress: [{ to: [ns("kube-system")], ports: [{ port: 53, protocol: "UDP" }, { port: 53, protocol: "TCP" }] }] } };
  const udpOnly = { spec: { podSelector: {}, policyTypes: ["Egress"], egress: [{ to: [ns("kube-system")], ports: [{ port: 53, protocol: "UDP" }] }] } };
  const policy = "lab03-networkpolicy/policy.py";
  assert.equal(py(policy, ["allows", "front", "other", "8080"], { items: [deny, allowFront] }), 0);
  assert.equal(py(policy, ["allows", "front", "other", "8080"], { items: [deny] }), 1);
  assert.equal(py(policy, ["allows", "front", "other", "8080"], { items: [deny, allowAll] }), 1, "other gets in too");
  assert.equal(py(policy, ["dns"], { items: [deny, dns] }), 0);
  assert.equal(py(policy, ["dns"], { items: [deny, udpOnly] }), 1, "TCP 53 is needed too");
  assert.equal(py(policy, ["denies", "peer"], { items: [deny, allowFront] }), 0);
  assert.equal(py(policy, ["denies", "peer"], { items: [deny, allowAll] }), 1);

  const deploy = (volumes, mounts, resources = {}) => ({ spec: { template: { spec: { volumes, containers: [{ volumeMounts: mounts, resources }] } } } });
  const mounts = "lab06-configmaps-secrets/mounts.py";
  assert.equal(py(mounts, ["config"], deploy([{ name: "c", configMap: { name: "app-config" } }], [{ name: "c", mountPath: "/etc/app" }])), 0);
  assert.equal(py(mounts, ["config"], deploy([{ name: "c", configMap: { name: "app-config", items: [{ key: "message", path: "msg" }] } }], [{ name: "c", mountPath: "/etc/app" }])), 1);
  assert.equal(py(mounts, ["secret"], deploy([{ name: "s", secret: { secretName: "app-secret" } }], [{ name: "s", mountPath: "/etc/secret" }])), 0);
  assert.equal(py(mounts, ["secret"], deploy([{ name: "s", secret: { secretName: "app-secret" } }], [{ name: "s", mountPath: "/etc/secret/password", subPath: "password" }])), 1, "subPath never updates");

  const pod = (requests, limits) => ({ status: { phase: "Running" }, spec: { containers: [{ resources: { requests, limits } }] } });
  const requests = "lab07-resourcequota-limitrange/requests.py";
  assert.equal(py(requests, [], { items: [pod({ cpu: "50m", memory: "32Mi" }, { cpu: "100m" })] }), 0);
  assert.equal(py(requests, [], { items: [pod({ cpu: "10m", memory: "32Mi" }, { cpu: "100m" })] }), 1);
  assert.equal(py(requests, [], { items: [pod({ cpu: "0.1", memory: "64Mi" }, undefined)] }), 1, "limits are required");
  assert.equal(py(requests, [], { items: [] }), 1);

  assert.equal(py("common/cpu.py", ["50"], deploy([], [], { requests: { cpu: "0.05" } })), 0);
  assert.equal(py("common/cpu.py", ["50"], deploy([], [], { requests: { cpu: "25m" } })), 1);
});

test("setup manifests parse, stay in their lab namespaces and meet Pod Security restricted", () => {
  for (const id of K8S) {
    const path = join(root, "labs/k8s", id, "setup.yaml");
    if (!existsSync(path)) {
      assert.equal(id, "lab10-helm-kustomize", `${id} has setup.yaml`);
      continue;
    }
    const docs = parseAllDocuments(readFileSync(path, "utf8")).map((doc) => doc.toJSON()).filter(Boolean);
    assert.ok(docs.length >= 1, id);
    const num = id.slice(3, 5);
    for (const doc of docs) {
      assert.ok(doc.apiVersion && doc.kind && doc.metadata?.name, `${id} ${doc.kind}`);
      const where = doc.kind === "Namespace" ? doc.metadata.name : doc.metadata.namespace;
      if (where) assert.match(where, new RegExp(`^k8s-lab${num}`), `${id} ${doc.kind}/${doc.metadata.name}`);
      // Every lab namespace states its Pod Security level (the SCC stand-in).
      const pod = doc.spec?.template?.spec || doc.spec?.jobTemplate?.spec?.template?.spec;
      const home = docs.find((item) => item.kind === "Namespace" && item.metadata.name === doc.metadata.namespace);
      // lab05 breaks Pod Security on purpose; everywhere else pods are admitted as restricted.
      if (pod && id !== "lab05-serviceaccounts-scc" && home?.metadata.labels["pod-security.kubernetes.io/enforce"] === "restricted") {
        assert.equal(pod.securityContext?.runAsNonRoot, true, `${id} ${doc.metadata.name} runAsNonRoot`);
        assert.equal(pod.securityContext?.seccompProfile?.type, "RuntimeDefault", `${id} ${doc.metadata.name} seccomp`);
        for (const c of [...pod.containers, ...(pod.initContainers || [])]) {
          assert.equal(c.securityContext?.allowPrivilegeEscalation, false, `${id} ${doc.metadata.name}/${c.name}`);
          assert.deepEqual(c.securityContext?.capabilities?.drop, ["ALL"], `${id} ${doc.metadata.name}/${c.name}`);
        }
      }
      if (doc.kind === "Namespace" && id !== "lab11-operators") assert.match(doc.metadata.labels?.["pod-security.kubernetes.io/enforce"] || "", /^(restricted|baseline|privileged)$/, `${id} ${doc.metadata.name}`);
    }
  }
  // The local chart and overlays the Helm/Kustomize lab installs.
  assert.match(read("labs/k8s/lab10-helm-kustomize/chart/Chart.yaml"), /name: catalog/);
  assert.match(read("labs/k8s/lab10-helm-kustomize/overlays/prod/kustomization.yaml"), /resources: \[\.\.\/\.\.\/base\]/);
});

test("kubeconform validates every setup manifest when it is installed", { skip: !existsSync("/tmp/k8sbin/kubeconform") && "kubeconform not installed" }, async () => {
  const files = K8S.map((id) => join(root, "labs/k8s", id, "setup.yaml")).filter(existsSync);
  const { stdout } = await run("/tmp/k8sbin/kubeconform", ["-strict", "-summary", "-ignore-missing-schemas", "-kubernetes-version", "1.33.0", ...files]);
  assert.match(stdout, /Invalid: 0, Errors: 0/);
});

test("check output parsing and the sample run", () => {
  const ok = parseCheckOutput("PASS: a\nPASS: b\n2 passed, 0 failed\n", { code: 0 });
  assert.deepEqual([ok.ok, ok.passed, ok.failed], [true, 2, 0]);
  const bad = parseCheckOutput("PASS: a\nFAIL: b\n\nResult: 1 passed, 1 failed", { code: 1 });
  assert.deepEqual([bad.ok, bad.passed, bad.failed, bad.lines[1].text], [false, 1, 1, "b"]);
  assert.equal(parseCheckOutput("", { code: 0, timedOut: true }).note, "the check timed out");
  assert.equal(parseCheckOutput("bash: kubectl: command not found\n", { code: 127 }).note, "bash: kubectl: command not found");
  const lab = { requirements: ["one `x`", "two"] };
  assert.deepEqual(sampleCheck(lab, 0).lines.map((line) => line.ok), [true, false]);
  assert.equal(sampleCheck(lab, 0).lines[0].text, "one x");
  assert.equal(sampleCheck(lab, 1).ok, true);
});

test("progress is saved per lab: started, hints, failing, passed, reset", () => {
  const dir = mkdtempSync(join(tmpdir(), "learn-progress-"));
  const file = join(dir, ".learn/progress.json");
  let now = Date.parse("2026-10-10T20:00:00Z");
  const store = createProgressStore({ file, clock: () => now });
  assert.equal(store.update("k8s/a", { started: true }).status, "started");
  assert.equal(store.update("k8s/a", { hints: 2 }).hints, 2);
  assert.equal(store.update("k8s/a", { hints: 1 }).hints, 2, "hints never go back");
  assert.equal(store.update("k8s/a", { check: { ok: false, passed: 1, failed: 1 } }).status, "failing");
  now += 1000;
  const passed = store.update("k8s/a", { check: { ok: true, passed: 2, failed: 0 } });
  assert.equal(passed.status, "passed");
  assert.equal(passed.passedAt, "2026-10-10T20:00:01.000Z");
  assert.equal(store.update("k8s/a", { check: { ok: false, passed: 0, failed: 2 } }).status, "passed", "a pass stays a pass");
  assert.equal(JSON.parse(readFileSync(file, "utf8")).labs["k8s/a"].checks.length, 3);
  assert.deepEqual(store.update("k8s/a", { reset: true }).checks, []);
  assert.equal(store.all()["k8s/a"].status, "new");
});

test("createLearn runs only safe scripts, one at a time, with bash and no shell", async () => {
  const dir = mkdtempSync(join(tmpdir(), "learn-run-"));
  const calls = [];
  let release;
  const learn = createLearn({
    root,
    env: { CLOUDSPIDER_LAB_CONTEXT: "kind-lab", PATH: "/usr/bin:/bin" },
    progress: createProgressStore({ file: join(dir, "p.json") }),
    run: (command, args, options) => {
      calls.push({ command, args, options });
      return new Promise((resolve) => {
        release = () => resolve({ code: 0, out: "PASS: one\nPASS: two\n", timedOut: false });
      });
    },
  });
  assert.equal((await learn.check("k8s/nope")).error, "no such lab");
  const refused = await learn.check("ex280/lab06-configmaps-secrets");
  assert.match(refused.error, /does not run it/);
  assert.ok(refused.reasons.length);
  const sample = await learn.check("ex280/lab06-configmaps-secrets", { sample: true });
  assert.equal(sample.result.sample, true);
  assert.equal(calls.length, 0, "refusals and samples run nothing");
  const first = learn.check("k8s/lab03-networkpolicy");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal((await learn.check("k8s/lab01-workloads")).error, "another check is running");
  release();
  const done = await first;
  assert.equal(done.result.ok, true);
  assert.equal(done.entry.status, "passed");
  assert.equal(calls[0].command, "bash");
  assert.deepEqual(calls[0].args, [join(root, "labs/k8s/lab03-networkpolicy/check.sh")]);
  assert.equal(calls[0].options.cwd, join(root, "labs/k8s/lab03-networkpolicy"));
  assert.equal(learn.list().progress["k8s/lab03-networkpolicy"].status, "passed");
  assert.equal(learn.progress("k8s/lab01-workloads", { hints: 1 }).entry.hints, 1);
});

test("LEARN routes: listing is open, checks and progress need the page's origin", async () => {
  const dir = mkdtempSync(join(tmpdir(), "learn-route-"));
  let ran = 0;
  const learn = createLearn({ root, env: { CLOUDSPIDER_LAB_CONTEXT: "kind-lab" }, progress: createProgressStore({ file: join(dir, "p.json") }), run: async () => { ran += 1; return { code: 1, out: "FAIL: x\n", timedOut: false }; } });
  const app = createApp({
    ec2: { async describeRegions() { return { regions: [] }; }, async defaultRegion() { return ""; } },
    trail: { async lookupEvents() { return { event: null }; } },
    logs: { async filter() { return { events: [] }; } },
    learn,
    logGroup: "",
    pageOrigin: "http://127.0.0.1:9241",
    clock: () => 0,
  });
  const server = await listen(app, 0);
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const list = await fetch(`${base}/api/learn`).then((response) => response.json());
    assert.equal(list.labs.length, 35);
    const sample = await fetch(`${base}/api/learn?sample=1`).then((response) => response.json());
    assert.deepEqual(sample.progress, {});
    const post = (path, body, origin) => fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(origin ? { origin } : {}) }, body: JSON.stringify(body) }).then((response) => response.json());
    assert.equal((await post("/api/learn/check", { key: "k8s/lab01-workloads" }, "http://evil.test")).error, "the check did not run");
    assert.equal((await post("/api/learn/progress", { key: "k8s/lab01-workloads", hints: 3 }, "http://evil.test")).error, "progress was not saved");
    assert.equal(ran, 0);
    const checked = await post("/api/learn/check", { key: "k8s/lab01-workloads" }, "http://127.0.0.1:9241");
    assert.equal(checked.result.failed, 1);
    assert.equal(ran, 1);
    assert.equal((await post("/api/learn/progress", { key: "k8s/lab01-workloads", hints: 2 }, "http://127.0.0.1:9241")).entry.hints, 2);
    for (const name of ["learn-view.js", "sprites/holotape.js"]) {
      assert.ok(FILES.has(name));
      assert.equal((await fetch(`${base}/${name}`)).status, 200);
    }
    assert.equal((await fetch(`${base}/learn.js`)).status, 404, "the server-side module is not served");
  } finally {
    server.close();
  }
});

test("the LEARN key, panel and holotape art use theme colours only", () => {
  const server = read("src/server.js");
  assert.match(server, /<button id="learn-key" class="key" type="button" aria-pressed="false"[^>]*><span class="cap" data-icon="learn"><\/span><span class="tag">Learn<\/span><\/button>/);
  assert.match(server, /<section id="learn" aria-label="learn" hidden><\/section>/);
  const start = server.indexOf("/* ---- learn ----");
  const end = server.indexOf("/* ---- end learn ---- */");
  assert.ok(start > 0 && end > start);
  const block = server.slice(start, end);
  assert.equal(block.match(/#[0-9a-fA-F]{3,8}\b(?![-\w])/g)?.filter((hit) => !/^#(learn)$/.test(hit)) ?? null, null, "no hex in the learn CSS");
  assert.equal(block.match(/rgba?\(/), null);
  const vars = cssVars();
  for (const name of new Set(block.match(/var\(--[a-z0-9-]+/g).map((hit) => hit.slice(4)))) assert.ok(vars.includes(`${name}:`), `${name} is a theme var`);
  assert.match(block, /prefers-reduced-motion/);
  assert.match(block, /\.lx-track:focus-visible/);
  assert.equal(icon("learn").length, 16);
  for (const frame of [0, 1]) {
    const grid = holotapeGrid(frame);
    assert.equal(grid.length, TAPE_H);
    for (const row of grid) assert.equal(row.length, TAPE_W);
  }
  assert.notDeepEqual(holotapeGrid(0), holotapeGrid(1), "the reels turn");
  assert.deepEqual(holotapeGrid(0).filter((row) => !row.includes("u")), holotapeGrid(1).filter((row) => !row.includes("u")));
  const sprite = holotapeSprite(0);
  const palette = holotapePalette("ex280", "passed");
  for (const row of sprite) for (const index of row) assert.ok(index === 0 || palette[index], `index ${index} has a colour`);
  assert.notEqual(holotapePalette("k8s").join(), holotapePalette("ex280").join());
});

test("learn-view helpers: rich text, tallies and SAMPLE progress in localStorage", () => {
  assert.deepEqual(richText("run `kubectl get` now"), [{ code: false, text: "run " }, { code: true, text: "kubectl get" }, { code: false, text: " now" }]);
  assert.deepEqual(richText("<b>x</b>"), [{ code: false, text: "<b>x</b>" }]);
  const labs = [{ track: "k8s", key: "k8s/a" }, { track: "k8s", key: "k8s/b" }, { track: "ex280", key: "ex280/a" }];
  assert.equal(trackTally(labs, { "k8s/a": { status: "passed" } }, "k8s").text, "1/2 PASSED");
  assert.equal(labStatus({}, "k8s/b"), "new");
  const map = new Map();
  const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
  const progress = createSampleProgress(storage);
  progress.update("k8s/a", { hints: 1, started: true });
  progress.update("k8s/a", { check: { ok: false, passed: 1, failed: 1 } });
  assert.equal(progress.all()["k8s/a"].status, "failing");
  progress.update("k8s/a", { check: { ok: true, passed: 2, failed: 0 } });
  assert.equal(createSampleProgress(storage).all()["k8s/a"].status, "passed");
  assert.ok(map.has("cloudspider.learn.sample"));
});
