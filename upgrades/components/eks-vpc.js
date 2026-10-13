// EksVpc: the EKS stack's network as one ComponentResource, like a Terraform
// module (docs/iac-robustness-plan.md item 8). Pulumi and the AWS SDK come
// from the calling stack (its own pinned node_modules).
//
// Inputs:  clusterName (string), cidr (VPC range), subnets ([cidr, cidr]),
//          zones ([zone, zone]), tags (object)
// Outputs: vpcId, subnetIds ([id, id]), routeTableId
//
// The children keep their logical names ("up", "a", "b") and carry an alias
// to their old place under the stack, so a stack made before the component
// existed moves them under it with no replace (verify with pulumi preview).
export function eksVpcComponent(pulumi, aws) {
  return class EksVpc extends pulumi.ComponentResource {
    constructor(name, args, opts = {}) {
      super("cloudspider:network:EksVpc", name, {}, opts);
      const child = { parent: this, aliases: [{ parent: pulumi.rootStackResource }] };
      const { clusterName, cidr, subnets, zones, tags } = args;
      const vpc = new aws.ec2.Vpc("up", { cidrBlock: cidr, enableDnsHostnames: true, enableDnsSupport: true, tags }, child);
      const gateway = new aws.ec2.InternetGateway("up", { vpcId: vpc.id, tags }, child);
      const route = new aws.ec2.RouteTable("up", { vpcId: vpc.id, routes: [{ cidrBlock: "0.0.0.0/0", gatewayId: gateway.id }], tags }, child);
      const nets = ["a", "b"].map((id, i) => {
        const net = new aws.ec2.Subnet(id, {
          vpcId: vpc.id,
          cidrBlock: subnets[i],
          availabilityZone: zones[i],
          mapPublicIpOnLaunch: true,
          tags: { ...tags, [`kubernetes.io/cluster/${clusterName}`]: "shared", "kubernetes.io/role/elb": "1" },
        }, child);
        new aws.ec2.RouteTableAssociation(id, { subnetId: net.id, routeTableId: route.id }, child);
        return net;
      });
      this.vpcId = vpc.id;
      this.subnetIds = nets.map((n) => n.id);
      this.routeTableId = route.id;
      this.subnets = nets;
      this.registerOutputs({ vpcId: this.vpcId, subnetIds: this.subnetIds, routeTableId: this.routeTableId });
    }
  };
}
