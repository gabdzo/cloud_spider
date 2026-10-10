export function samplePlace() {
  const vpc = { id: "sample-vpc", cidr: "10.0.0.0/16", name: "sample" };
  const subnet = {
    id: "sample-subnet",
    vpcId: vpc.id,
    cidr: "10.0.1.0/24",
    name: "camp",
    zone: "sample-a",
    public: false,
  };
  const tagged = (id, state) => ({
    id,
    state,
    type: "t4g.nano",
    vpcId: vpc.id,
    subnetId: subnet.id,
    name: id,
    tags: [{ key: "cloudspider", value: "expendable" }],
  });
  return {
    region: "sample",
    vpcs: [vpc],
    subnets: [subnet],
    gateways: [{ vpcId: vpc.id, kind: "igw", id: "igw-sample" }],
    fixtures: [
      { id: "alb-sample", vpcId: vpc.id, kind: "alb", name: "sample-gate", status: "ok" },
      { id: "camp-bucket", vpcId: "", kind: "bucket", name: "cloudspider-camp", status: "ok" },
      {
        id: "camp-function",
        vpcId: "",
        kind: "function",
        name: "cloudspider-camp-page",
        status: "ok",
        uses: ["camp-bucket", "camp-table", "camp-secret"],
      },
      { id: "camp-table", vpcId: "", kind: "table", name: "cloudspider-camp-table", status: "ok" },
      { id: "camp-secret", vpcId: "", kind: "secret", name: "cloudspider-camp-secret", status: "ok" },
    ],
    links: [{ from: "alb-sample", to: "sample-running" }],
    instances: [
      tagged("sample-running", "running"),
      tagged("sample-stopped", "stopped"),
      {
        id: "sample-untagged",
        state: "stopped",
        type: "t4g.nano",
        vpcId: vpc.id,
        subnetId: subnet.id,
        name: "",
        tags: [],
      },
    ],
  };
}
