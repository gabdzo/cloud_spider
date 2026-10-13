// A local stand-in for the ELBv2 query API (DescribeLoadBalancers,
// DescribeTags, DescribeTargetGroups), so upgrades/observability, which reads
// ALBs with the AWS SDK directly, runs under Pulumi mocks with no cloud:
// the SDK goes to AWS_ENDPOINT_URL_ELASTIC_LOAD_BALANCING_V2.
// albs: [{ name, cluster, targetGroups: [name] }]
import { createServer } from "node:http";

const NS = "http://elasticloadbalancing.amazonaws.com/doc/2015-12-01/";
const arn = (name) => `arn:aws:elasticloadbalancing:eu-north-1:550536272523:loadbalancer/app/${name}/0123456789abcdef`;

export function startFakeElb(albs = []) {
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const q = new URLSearchParams(body);
      const action = q.get("Action");
      let inner = "";
      if (action === "DescribeLoadBalancers") inner = `<LoadBalancers>${albs.map((a) => `<member><LoadBalancerArn>${arn(a.name)}</LoadBalancerArn><LoadBalancerName>${a.name}</LoadBalancerName><Type>application</Type></member>`).join("")}</LoadBalancers>`;
      else if (action === "DescribeTags") {
        const asked = [...q.entries()].filter(([k]) => k.startsWith("ResourceArns.member")).map(([, v]) => v);
        inner = `<TagDescriptions>${albs.filter((a) => asked.includes(arn(a.name))).map((a) => `<member><ResourceArn>${arn(a.name)}</ResourceArn><Tags><member><Key>elbv2.k8s.aws/cluster</Key><Value>${a.cluster}</Value></member></Tags></member>`).join("")}</TagDescriptions>`;
      } else if (action === "DescribeTargetGroups") {
        const lb = albs.find((a) => arn(a.name) === q.get("LoadBalancerArn"));
        inner = `<TargetGroups>${(lb?.targetGroups || []).map((t) => `<member><TargetGroupArn>arn:aws:elasticloadbalancing:eu-north-1:550536272523:targetgroup/${t}/fedcba9876543210</TargetGroupArn></member>`).join("")}</TargetGroups>`;
      } else {
        res.writeHead(400);
        res.end(`<ErrorResponse xmlns="${NS}"><Error><Code>InvalidAction</Code><Message>${action}</Message></Error></ErrorResponse>`);
        return;
      }
      res.writeHead(200, { "content-type": "text/xml" });
      res.end(`<${action}Response xmlns="${NS}"><${action}Result>${inner}</${action}Result><ResponseMetadata><RequestId>fake</RequestId></ResponseMetadata></${action}Response>`);
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}
