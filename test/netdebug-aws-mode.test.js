// Seen live on cloudspider-up: policy said blocked, the debug pod connected —
// VPC CNI standard mode leaves a new pod default-allow until policies apply.
import assert from "node:assert/strict";
import test from "node:test";
import { awsPolicyMode } from "../src/netdebug/kube-checks.js";
import { podFindings } from "../src/netdebug/pod-result.js";

const awsNode = (env) => ({ metadata: { name: "aws-node" }, spec: { template: { spec: { containers: [{ name: "aws-node", env }, { name: "aws-eks-nodeagent", args: ["--enable-network-policy=true"] }] } } } });

test("awsPolicyMode reads NETWORK_POLICY_ENFORCING_MODE (default standard)", () => {
  assert.equal(awsPolicyMode([awsNode([{ name: "NETWORK_POLICY_ENFORCING_MODE", value: "standard" }])]), "standard");
  assert.equal(awsPolicyMode([awsNode([{ name: "NETWORK_POLICY_ENFORCING_MODE", value: "strict" }])]), "strict");
  assert.equal(awsPolicyMode([awsNode([])]), "standard");
  assert.equal(awsPolicyMode([{ metadata: { name: "calico-node" } }]), "");
});

test("blocked on paper + connected: the finding names standard mode", () => {
  const checks = [
    { id: "K-NP-03", status: "FAIL", observed: { egress: { allowed: false, selecting: ["brother-sandbox/default-deny"] } } },
    { id: "P-TCP-01", status: "PASS", observed: {} },
  ];
  const f = podFindings({}, checks, { cni: { enforcer: "VPC CNI network policy agent", awsMode: "standard" } }).find((x) => x.id === "F-NP-NOTENFORCED");
  assert.match(f.statement, /standard mode/);
  assert.equal(f.confidence, "high");
  const plain = podFindings({}, checks).find((x) => x.id === "F-NP-NOTENFORCED");
  assert.equal(plain.confidence, "medium");
});
