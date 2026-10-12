// Sample probes: what SAMPLE mode (and the screenshots) debug instead of
// the network. Same interface as probes.js; fixed answers, no I/O.
//   google.com, www.google.com  healthy, one redirect, Google's own front end
//   web.sample.test             the sample ALB (path-sample.js) answers 503:
//                               k8s-shop-web has no targets
//   api.sample.test             the sample ALB, 200, slow origin
//   cdn.sample.test             CloudFront in front of the sample ALB answers
//                               502: the origin is the ALB's elb name over
//                               https (sample-aws.js has the distribution)
//   anything else               NXDOMAIN
const DAY = 86_400_000;
const NOW = () => Date.now();

const SITES = {
  "google.com": { ips: ["142.250.74.110", "2a00:1450:400f:80d::200e"], cnames: [], doh: ["142.250.74.110"], ttl: 300, cert: { subject: "*.google.com", san: ["*.google.com", "google.com", "*.google.se"], issuer: "WR2", root: "GTS Root R1", days: 61 }, alpn: "h2", http: { status: 301, server: "gws", location: "https://www.google.com/", timing: { connect: 14, tls: 38, ttfb: 71, total: 72 } } },
  "www.google.com": { ips: ["142.250.74.100"], cnames: [], doh: ["142.250.74.100"], ttl: 300, cert: { subject: "www.google.com", san: ["www.google.com"], issuer: "WR2", root: "GTS Root R1", days: 61 }, alpn: "h2", http: { status: 200, server: "gws", timing: { connect: 13, tls: 36, ttfb: 88, total: 104 } } },
  "web.sample.test": { ips: ["13.48.10.21", "13.53.200.7"], cnames: ["k8s-demo-api-7b31d2.eu-north-1.elb.amazonaws.com"], doh: ["13.48.10.21", "13.53.200.7"], ttl: 60, cert: { subject: "*.sample.test", san: ["*.sample.test", "sample.test"], issuer: "Amazon RSA 2048 M02", root: "Amazon Root CA 1", days: 74 }, alpn: "h2", http: { status: 503, server: "awselb/2.0", type: "text/html", timing: { connect: 31, tls: 79, ttfb: 88, total: 90 } } },
  "api.sample.test": { ips: ["13.48.10.21", "13.53.200.7"], cnames: ["k8s-demo-api-7b31d2.eu-north-1.elb.amazonaws.com"], doh: ["13.48.10.21", "13.53.200.7"], ttl: 60, cert: { subject: "*.sample.test", san: ["*.sample.test", "sample.test"], issuer: "Amazon RSA 2048 M02", root: "Amazon Root CA 1", days: 74 }, alpn: "h2", http: { status: 200, server: "envoy", type: "application/json", trace: "Root=1-6709a1f2-3b1c", timing: { connect: 30, tls: 77, ttfb: 1412, total: 1420 } } },
  "cdn.sample.test": { ips: ["18.66.2.14", "18.66.2.71"], cnames: ["d1sample.cloudfront.net"], doh: ["18.66.2.14", "18.66.2.71"], ttl: 60, cert: { subject: "*.sample.test", san: ["*.sample.test", "sample.test"], issuer: "Amazon RSA 2048 M02", root: "Amazon Root CA 1", days: 74 }, alpn: "h2", http: { status: 502, server: "CloudFront", type: "text/html", extra: { via: "1.1 5f2d.cloudfront.net (CloudFront)", "x-cache": "Error from cloudfront", "x-amz-cf-pop": "ARN56-P1" }, timing: { connect: 9, tls: 27, ttfb: 312, total: 314 } } },
};

const site = (host) => SITES[String(host).toLowerCase()];
const nx = () => Object.assign(new Error("queryA ENOTFOUND"), { code: "ENOTFOUND" });

export const sampleProbes = {
  async systemDns(host) {
    const s = site(host);
    if (!s) return { addresses: [], cnames: [], ms: 9, error: "ENOTFOUND", message: nx().message };
    return { addresses: s.ips.map((address) => ({ address, family: address.includes(":") ? 6 : 4 })), cnames: s.cnames, ms: 12 };
  },
  async dohQuery(host, endpoint, type = "A") {
    const s = site(host);
    if (!s) return { endpoint, type, status: "NXDOMAIN", ips: [], cnames: [], ttl: null, ms: 24 };
    return { endpoint, type, status: "NOERROR", ips: s.doh, cnames: s.cnames, ttl: s.ttl, ms: 22 };
  },
  async tcpConnect(address, port) {
    return { address, port, ok: true, ms: address.includes(":") ? 16 : 14 };
  },
  async tlsHandshake(address, host, port) {
    const s = site(host);
    const c = s.cert;
    const leafEnd = new Date(NOW() + c.days * DAY + 3_600_000).toISOString();
    return {
      address, host, port, ok: true, ms: 41, protocol: "TLSv1.3", cipher: "TLS_AES_128_GCM_SHA256", alpn: s.alpn, authorized: true, authorizationError: "", nameMatch: true, nameError: "", ocspStapled: false,
      chain: [
        { subject: c.subject, issuer: c.issuer, san: c.san, notBefore: new Date(NOW() - 29 * DAY).toISOString(), notAfter: leafEnd, fingerprint256: "" },
        { subject: c.issuer, issuer: c.root, san: [], notBefore: "", notAfter: new Date(NOW() + 900 * DAY).toISOString(), fingerprint256: "" },
      ],
    };
  },
  async httpRequest(target, address) {
    const h = site(target.host).http;
    const headers = { server: h.server, ...(h.location ? { location: h.location } : {}), ...(h.type ? { "content-type": h.type } : {}), ...(h.trace ? { "x-amzn-trace-id": h.trace } : {}), ...(h.extra || {}) };
    return { address, ok: true, status: h.status, headers, bytes: h.status === 301 ? 220 : 1830, timing: { ...h.timing } };
  },
};
