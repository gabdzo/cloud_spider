// NET-TLS-001: ACM certificates in use by load balancers or CloudFront
// expire in ≥14 days (WARN under 30). Not-in-use certificates are ignored;
// no certificate in use is NOT_APPLICABLE, never a coverage-eating stub.
import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalog } from "../src/score/catalog.js";
import { runControls } from "../src/score/engine.js";
import { evidence } from "../src/score/evidence.js";
import { awsAcm } from "../src/score/collectors/aws-net.js";
import { networkEvaluators as E } from "../src/score/evaluators/network.js";
import { fakeAws, denied } from "./fixtures/fake-aws.js";

const NOW = Date.parse("2026-10-11T12:00:00Z");
const day = 86_400_000;
const LB = "arn:aws:elasticloadbalancing:eu-north-1:1:loadbalancer/app/shop/abc";
const CF = "arn:aws:cloudfront::1:distribution/E1";
const certs = {
  "arn:c/lb": { DomainName: "shop.example.com", NotAfter: new Date(NOW + 10 * day), InUseBy: [LB], Type: "IMPORTED" },
  "arn:c/cf": { DomainName: "cdn.example.com", NotAfter: new Date(NOW + 20 * day), InUseBy: [CF], Type: "AMAZON_ISSUED" },
  "arn:c/ok": { DomainName: "api.example.com", NotAfter: new Date(NOW + 200 * day), InUseBy: [LB], Type: "AMAZON_ISSUED" },
  "arn:c/other": { DomainName: "vpn.example.com", NotAfter: new Date(NOW + 2 * day), InUseBy: ["arn:aws:ec2:eu-north-1:1:client-vpn-endpoint/cvpn-1"], Type: "IMPORTED" },
};
const HANDLERS = {
  ListCertificatesCommand: (input, region) => ({ CertificateSummaryList: region === "us-east-1" ? [{ CertificateArn: "arn:c/cf", InUse: true }] : [{ CertificateArn: "arn:c/lb", InUse: true }, { CertificateArn: "arn:c/ok", InUse: true }, { CertificateArn: "arn:c/other", InUse: true }, { CertificateArn: "arn:c/idle", InUse: false }] }),
  DescribeCertificateCommand: (input) => ({ Certificate: { CertificateArn: input.CertificateArn, ...certs[input.CertificateArn] } }),
};

test("collector: scan regions plus us-east-1 (CloudFront), every key type, describes only certificates in use", async () => {
  const { clients, calls } = fakeAws(HANDLERS);
  const rec = await awsAcm.collect({ regions: ["eu-north-1"], clients });
  assert.equal(rec.status, "ok");
  assert.deepEqual([...new Set(calls.filter((c) => c.name === "ListCertificatesCommand").map((c) => c.region))].sort(), ["eu-north-1", "us-east-1"]);
  assert.ok(calls.find((c) => c.name === "ListCertificatesCommand").input.Includes.keyTypes.includes("EC_prime256v1"));
  assert.equal(calls.some((c) => c.input?.CertificateArn === "arn:c/idle"), false, "not-in-use certificates are not described");
  assert.deepEqual(rec.fields.certificates.map((c) => c.domain).sort(), ["api.example.com", "cdn.example.com", "shop.example.com", "vpn.example.com"]);
  assert.ok(calls.every((c) => /^(Describe|List|Get)/.test(c.name)));
});

test("NET-TLS-001: FAIL under 14 days, WARN (a pass that says so) under 30, other users of ACM ignored", async () => {
  const { clients } = fakeAws(HANDLERS);
  const rec = await awsAcm.collect({ regions: ["eu-north-1"], clients });
  const out = E["cert-expiry"]({ data: { "aws-acm": rec.fields }, now: NOW, params: { failDays: 14, warnDays: 30 } });
  assert.deepEqual(out.items.map((i) => [i.id, i.pass]), [["eu-north-1/shop.example.com", false], ["eu-north-1/api.example.com", true], ["us-east-1/cdn.example.com", true]]);
  assert.match(out.items[0].detail, /expires in 10 days.*load balancer shop/);
  assert.match(out.items[2].detail, /^WARN: expires in 20 days.*CloudFront E1/);
  assert.equal(out.items[2].warn, true);
});

test("NET-TLS-001: no certificate in use is NOT_APPLICABLE (never NOT_ASSESSED); a denied read is UNKNOWN", async () => {
  const { controls } = await loadCatalog();
  const control = controls.find((c) => c.id === "NET-TLS-001");
  assert.equal(control.blockedBy, undefined);
  const profile = { id: "p", overrides: {}, gates: [] };
  const run = (rec) => runControls({ controls: [control], evaluators: E, evidence: new Map([["aws-acm", rec]]), profile, target: "aws" })[0];
  const empty = run(evidence({ key: "aws-acm", collector: "aws-acm", read: "acm:ListCertificates", target: "aws", status: "ok", fields: { certificates: [] } }));
  assert.equal(empty.status, "NOT_APPLICABLE");
  const { clients } = fakeAws({ ListCertificatesCommand: denied });
  const rec = await awsAcm.collect({ regions: ["eu-north-1"], clients });
  assert.equal(run(rec).status, "UNKNOWN");
});

test("a passing control with a WARN resource shows it on its row", async () => {
  const { scoreModel } = await import("../src/score/view.js");
  const result = { id: "NET-TLS-001", title: "t", status: "PASS", severity: "high", category: "networking", resources: [{ id: "eu-north-1/api.example.com", pass: true, detail: "expires in 200 days" }, { id: "us-east-1/cdn.example.com", pass: true, warn: true, detail: "WARN: expires in 20 days" }] };
  const card = { categories: [], priorities: [], gates: { failed: [], open: [] }, reasons: [], coverage: 100, unknown: 0, notAssessed: 0, verdict: "NO_KNOWN_BLOCKERS", verdictLabel: "NO KNOWN BLOCKERS", confidence: "high", profile: "aws-production" };
  const model = scoreModel({ target: "aws", cluster: "account", scan: { id: "s", target: "aws", card, results: [result] }, trend: [], suggestions: [] });
  assert.equal(model.rows[0].reason, "us-east-1/cdn.example.com: WARN: expires in 20 days");
});
