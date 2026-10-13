// EKS versions (src/eks-versions.js): support windows and their price, the
// one-minor-at-a-time rule, auto keeping the live version, the card's field
// and LIVE line, and SCORE's AWS-FIN-002.
import assert from "node:assert/strict";
import test from "node:test";
import { ADDON_K8S, addonsBlocking, EKS_CALENDAR, EKS_NEW_VERSION, EKS_VERSIONS, eksSupport, nextVersion, resolveEksVersion, supportText, supportWarning, versionStepProblem } from "../src/eks-versions.js";
import { versionLine } from "../src/run-pane.js";
import { UPGRADES, checkParams } from "../src/upgrade.js";
import { awsEvaluators } from "../src/score/evaluators/aws.js";
import { loadCatalog } from "../src/score/catalog.js";

const OCT_13 = Date.parse("2026-10-13T12:00:00Z");

test("support: 1.32 and 1.33 extended ($0.60/h) on 2026-10-13, 1.34 standard until 2026-12-02", () => {
  assert.deepEqual(EKS_VERSIONS, ["1.32", "1.33", "1.34", "1.35"]);
  assert.equal(EKS_NEW_VERSION, "1.35");
  assert.equal(eksSupport("1.35", OCT_13).status, "standard");
  assert.equal(eksSupport("1.35", OCT_13).standardEnd, "2027-03-27");
  assert.equal(eksSupport("1.35", OCT_13).extendedEnd, "2028-03-27");
  assert.equal(eksSupport("1.35", Date.parse("2027-03-27T00:00:00Z")).status, "extended");
  assert.equal(eksSupport("1.32", OCT_13).status, "extended");
  assert.equal(eksSupport("1.32", OCT_13).usdPerHour, 0.6);
  assert.equal(eksSupport("1.33", OCT_13).status, "extended");
  assert.equal(eksSupport("1.34", OCT_13).status, "standard");
  assert.equal(eksSupport("1.34", OCT_13).usdPerHour, 0.1);
  assert.equal(eksSupport("1.34", Date.parse("2026-12-02T00:00:00Z")).status, "extended");
  assert.equal(eksSupport("1.32", Date.parse("2026-03-22T23:59:00Z")).status, "standard");
  assert.equal(eksSupport("1.31", OCT_13).status, "extended");
  assert.equal(eksSupport("1.31", Date.parse("2026-11-27T00:00:00Z")).status, "ended");
  assert.equal(eksSupport("v1.32.9-eks-1", OCT_13).version, "1.32");
  assert.equal(eksSupport("1.99", OCT_13).status, "unknown");
  assert.match(supportText("1.32", OCT_13), /1\.32 · EXTENDED SUPPORT \(since 2026-03-23\) · \$0\.60\/h, \+\$0\.50\/h fee/);
  assert.match(supportText("1.34", OCT_13), /standard support until 2026-12-02 · \$0\.10\/h/);
  assert.match(supportWarning("1.32", { live: true, now: OCT_13 }), /EXTENDED SUPPORT: the live cluster runs 1\.32, billed \$0\.60\/h instead of \$0\.10\/h \(~\$365\/mo extra\); next step: UPGRADE TO 1\.33/);
  assert.equal(supportWarning("1.34", { now: OCT_13 }), "");
});

test("one minor at a time, never down; auto keeps the live version", () => {
  assert.equal(nextVersion("1.32"), "1.33");
  assert.equal(versionStepProblem("1.33", "1.32"), "");
  assert.equal(versionStepProblem("1.34", ""), "", "a new cluster takes any offered version");
  assert.match(versionStepProblem("1.34", "1.32"), /skips a minor.*UPGRADE TO 1\.33 first/);
  assert.match(versionStepProblem("1.32", "1.33"), /downgrade/);
  assert.equal(resolveEksVersion("auto", "1.32"), "1.32");
  assert.equal(resolveEksVersion("", "1.33"), "1.33");
  assert.equal(resolveEksVersion("auto", ""), "1.35");
  assert.equal(versionStepProblem("1.35", "1.34"), "");
  assert.match(versionStepProblem("1.35", "1.33"), /skips a minor.*UPGRADE TO 1\.34 first/);
  assert.equal(resolveEksVersion("1.33", "1.32"), "1.33");
});

test("the EKS card: auto by default, every version labelled with its support, extended ones warn", () => {
  const spec = UPGRADES.find((item) => item.id === "eks");
  const field = spec.parameters.find((p) => p.name === "kubernetesVersion");
  assert.equal(field.default, "auto");
  assert.deepEqual(field.choices, ["auto", "1.32", "1.33", "1.34", "1.35"]);
  assert.match(field.labels["1.32"], /EXTENDED SUPPORT/);
  assert.match(field.labels.auto, /keep the live version \(1\.35 for a new cluster\)/);
  assert.ok(field.warn.includes("1.32") && field.warn.includes("1.33"));
  assert.equal(checkParams(spec, {}).values.kubernetesVersion, "auto");
  assert.match(checkParams(spec, { kubernetesVersion: "1.31" }).error, /kubernetesVersion must be auto or 1\.32/);
  assert.ok(spec.cost.some((line) => line.price === "eks-extended-support" && line.extended === "kubernetesVersion"));
});

test("LIVE version line: the upgrade RUN would do, a refused skip, the loud warning", () => {
  assert.match(versionLine("1.32", "auto", OCT_13), /^⚠ EXTENDED SUPPORT: the live cluster runs 1\.32.*UPGRADE TO 1\.33/);
  assert.match(versionLine("1.32", "1.33", OCT_13), /RUN upgrades the control plane 1\.32 -> 1\.33 in place \(PREVIEW shows it as an update, not a replace\) · ⚠ EXTENDED SUPPORT: 1\.33 is selected/);
  assert.match(versionLine("1.32", "1.34", OCT_13), /skips a minor/);
  assert.equal(versionLine("1.33", "1.34", OCT_13), "RUN upgrades the control plane 1.33 -> 1.34 in place (PREVIEW shows it as an update, not a replace)");
  assert.equal(versionLine("", "auto", OCT_13), "", "a new cluster on 1.35: nothing to warn");
  assert.match(versionLine("", "1.32", OCT_13), /EXTENDED SUPPORT: 1\.32 is selected/);
});

test("SCORE AWS-FIN-002: a cluster on extended support fails with its cost and the next step", async () => {
  const clusters = [
    { name: "cloudspider-up", region: "eu-north-1", version: "1.32" },
    { name: "new", region: "eu-north-1", version: "1.34" },
    { name: "odd", region: "eu-north-1", version: "1.99" },
  ];
  const out = awsEvaluators["eks-standard-support"]({ data: { "aws-eks": { clusters } }, now: OCT_13 });
  assert.deepEqual(out.items.map((i) => [i.id, i.pass]), [["eu-north-1/cloudspider-up", false], ["eu-north-1/new", true]]);
  assert.match(out.items[0].detail, /1\.32 on EXTENDED SUPPORT since 2026-03-23: \$0\.60\/h vs \$0\.10\/h \(~\$365\/mo extra\).*kubernetesVersion 1\.33, PREVIEW, RUN/);
  assert.equal(out.unknown[0].id, "eu-north-1/odd");
  const { controls, errors } = await loadCatalog();
  assert.deepEqual(errors, []);
  const control = controls.find((c) => c.id === "AWS-FIN-002");
  assert.equal(control.evaluator, "eks-standard-support");
  assert.deepEqual(control.requires, ["aws-eks"]);
});

test("1.35 for a new cluster: every pinned add-on supports it, the pins match the catalog, 1.36 is held back by Kyverno", async () => {
  assert.deepEqual(addonsBlocking(EKS_NEW_VERSION), []);
  for (const v of EKS_VERSIONS.filter((x) => Number(x.split(".")[1]) >= 34)) assert.deepEqual(addonsBlocking(v), [], v);
  assert.deepEqual(addonsBlocking("1.36"), ["kyverno"]);
  assert.ok(!EKS_VERSIONS.includes("1.36"));
  // Every offered version has a calendar row (AWS EKS release calendar, read 2026-10-13).
  for (const v of EKS_VERSIONS) assert.ok(EKS_CALENDAR[v], v);
  assert.deepEqual(EKS_CALENDAR["1.36"], { standardEnd: "2027-08-02", extendedEnd: "2028-08-02" });
  // The newest offered version is the new-cluster default.
  assert.equal(EKS_VERSIONS.at(-1), EKS_NEW_VERSION);
  const { addonById } = await import("../upgrades/addons/catalog.js");
  for (const id of ["kyverno", "karpenter", "lbc", "cert-manager", "keda"]) assert.equal(addonById(id).appVersion, ADDON_K8S[id].pin, id);
  const { readFileSync } = await import("node:fs");
  assert.match(readFileSync(new URL("../upgrades/pgcluster/index.js", import.meta.url), "utf8"), /const CHART_VERSION = "0\.29\.1"/);
});
