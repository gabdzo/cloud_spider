// FIX NEXT only offers what fixes the control: REL-004 (zones) opens the
// EKS card with nodeCount 2, and an add-on that is already on the cluster is
// never offered again; the real reason shows instead.
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { suggestionsOf } from "../src/score/api.js";
import { scoreModel } from "../src/score/view.js";
import { validateControl } from "../src/score/model.js";

const rel004 = parse(readFileSync(new URL("../scorecard/controls/K8S-REL-004.yaml", import.meta.url), "utf8"));
const zoneFail = { id: "K8S-REL-004", title: "Ready nodes span at least two zones", status: "FAIL", severity: "high", card: { id: "eks", params: { nodeCount: 2 } }, addon: null, resources: [{ id: "cloudspider-up", pass: false, detail: "Ready nodes in 1 zone(s). eu-north-1b: … To fix: set NODE COUNT to 2 or more" }] };
const kyvernoFail = { id: "K8S-SEC-009", title: "policy reports clean", status: "FAIL", severity: "high", addon: "kyverno", resources: [{ id: "require-requests", pass: false, detail: "demo/web" }] };
const kedaFail = { id: "K8S-PLT-007", title: "event autoscaler", status: "FAIL", severity: "medium", addon: "keda", resources: [{ id: "cloudspider-up", pass: false, detail: "none of keda-operator runs" }] };
const tree = [{ cluster: "cloudspider-up", addons: [
  { id: "kyverno", title: "Kyverno", state: "installed", source: "stack kyverno-cloudspider-up" },
  { id: "karpenter", title: "Karpenter", state: "installed", source: "stack karpenter-cloudspider-up" },
  { id: "keda", title: "KEDA", state: "absent", source: "" },
] }];

test("K8S-REL-004 is fixed on the EKS card (nodeCount 2), not by the karpenter add-on", () => {
  assert.equal(rel004.remediation.addon, undefined);
  assert.deepEqual(rel004.remediation.card, { id: "eks", params: { nodeCount: 2 } });
  assert.equal(validateControl(rel004).ok, true, validateControl(rel004).errors?.join("; "));
});

test("suggestions: card for REL-004, FIX only for an absent add-on, the reason for one already there", () => {
  const scan = { clusterName: "cloudspider-up", results: [zoneFail, kyvernoFail, kedaFail] };
  const got = suggestionsOf(scan, tree);
  assert.deepEqual(got.find((s) => s.control === "K8S-REL-004").card, { id: "eks", params: { nodeCount: 2 } });
  assert.equal(got.find((s) => s.control === "K8S-REL-004").addon, undefined);
  assert.equal(got.find((s) => s.control === "K8S-PLT-007").already, undefined);
  assert.match(got.find((s) => s.control === "K8S-SEC-009").already, /Kyverno is already on cloudspider-up \(stack kyverno-cloudspider-up\); installing it again does not fix this\. Still failing: require-requests: demo\/web/);
  // An old scan (REL-004 still mapped to karpenter) with Karpenter installed: no FIX either.
  const old = suggestionsOf({ clusterName: "cloudspider-up", results: [{ ...zoneFail, card: null, addon: "karpenter" }] }, tree);
  assert.match(old[0].already, /Karpenter is already on cloudspider-up/);
  // No tree (add-ons unread): unchanged behaviour.
  assert.equal(suggestionsOf({ clusterName: "x", results: [kedaFail] })[0].addon, "keda");
});

test("FIX NEXT: actionable first (FIX, OPEN EKS CARD), already-installed last with no FIX", () => {
  const scan = { finishedAt: "t", card: { verdict: "AT_RISK", overall: 50, categories: [], priorities: [{ id: "K8S-SEC-009" }, { id: "K8S-REL-004" }, { id: "K8S-PLT-007" }] }, results: [zoneFail, kyvernoFail, kedaFail] };
  const m = scoreModel({ cluster: "cloudspider-up", scan, suggestions: suggestionsOf({ ...scan, clusterName: "cloudspider-up" }, tree) });
  assert.deepEqual(m.next.map((n) => n.id), ["K8S-REL-004", "K8S-PLT-007", "K8S-SEC-009"]);
  assert.deepEqual(m.next[0].card, { id: "eks", params: { nodeCount: 2 } });
  assert.equal(m.next[0].addon, "");
  assert.equal(m.next[1].addon, "keda");
  assert.equal(m.next[2].addon, "");
  assert.match(m.next[2].already, /already on cloudspider-up/);
  assert.equal(m.rows.find((r) => r.id === "K8S-SEC-009").fix, "");
});
