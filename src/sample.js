export function samplePlace() {
  const vpc = { id: "sample-vpc", cidr: "10.0.0.0/16" };
  const subnet = { id: "sample-subnet", vpcId: vpc.id, cidr: "10.0.1.0/24" };
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

// Sample radio chatter, newest first, in the same "Name resource" shape as
// radioWindow, so the radio panel has stations without CloudTrail.
export function sampleRadio() {
  return [
    "StopInstances sample-stopped",
    "RunInstances sample-running",
    "AuthorizeSecurityGroupIngress sg-0sample0001",
    "CreateTags sample-running",
    "TerminateInstances i-0wasteland01",
    "ModifyInstanceAttribute sample-untagged",
  ].join("\n");
}
