import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeNetworkInterfacesCommand,
  DescribeRouteTablesCommand,
  DescribeSecurityGroupsCommand,
  DescribeSubnetsCommand,
} from "@aws-sdk/client-ec2";
import {
  ElasticLoadBalancingV2Client,
  DescribeListenersCommand,
  DescribeLoadBalancersCommand,
  DescribeRulesCommand,
  DescribeTagsCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
} from "@aws-sdk/client-elastic-load-balancing-v2";
import {
  EKSClient,
  DescribeClusterCommand,
  DescribeNodegroupCommand,
  ListClustersCommand,
  ListNodegroupsCommand,
} from "@aws-sdk/client-eks";
import { CloudWatchClient, GetMetricDataCommand } from "@aws-sdk/client-cloudwatch";
import { publicError } from "./aws.js";
import { isInstanceId } from "./ids.js";
import { linesFromTargets, targetCounts } from "./path-diagnose.js";

const METRICS = {
  elb502: "HTTPCode_ELB_502_Count",
  elb503: "HTTPCode_ELB_503_Count",
  elb504: "HTTPCode_ELB_504_Count",
  target5xx: "HTTPCode_Target_5XX_Count",
  requests: "RequestCount",
};

export function createPathAws() {
  const elb = (region) => new ElasticLoadBalancingV2Client({ region });
  const ec2 = (region) => new EC2Client({ region });
  const inVpc = (vpcId) => [{ Name: "vpc-id", Values: [vpcId] }];

  return {
    loadBalancers(region) {
      const client = elb(region);
      return collect(
        (command) => client.send(command),
        (Marker) => new DescribeLoadBalancersCommand({ Marker }),
        (out) => ({ items: (out.LoadBalancers || []).map(loadBalancerFrom), next: out.NextMarker }),
      );
    },
    listeners(region, lbArn) {
      const client = elb(region);
      return collect(
        (command) => client.send(command),
        (Marker) => new DescribeListenersCommand({ LoadBalancerArn: lbArn, Marker }),
        (out) => ({ items: (out.Listeners || []).map(listenerFrom), next: out.NextMarker }),
      );
    },
    rules(region, listenerArn) {
      const client = elb(region);
      return collect(
        (command) => client.send(command),
        (Marker) => new DescribeRulesCommand({ ListenerArn: listenerArn, Marker }),
        (out) => ({ items: (out.Rules || []).map((raw) => ruleFrom(raw, listenerArn)), next: out.NextMarker }),
      );
    },
    targetGroups(region) {
      const client = elb(region);
      return collect(
        (command) => client.send(command),
        (Marker) => new DescribeTargetGroupsCommand({ Marker }),
        (out) => ({ items: (out.TargetGroups || []).map(targetGroupFrom), next: out.NextMarker }),
      );
    },
    async targetHealth(region, tgArn) {
      try {
        const out = await elb(region).send(new DescribeTargetHealthCommand({ TargetGroupArn: tgArn }));
        return { items: (out.TargetHealthDescriptions || []).map(healthFrom) };
      } catch (error) {
        return publicError(error);
      }
    },
    async tags(region, arns) {
      try {
        const client = elb(region);
        const tags = {};
        for (const part of chunks(arns, 20)) {
          const out = await client.send(new DescribeTagsCommand({ ResourceArns: part }));
          for (const item of out.TagDescriptions || []) tags[item.ResourceArn] = (item.Tags || []).map(tagFrom);
        }
        return { tags };
      } catch (error) {
        return publicError(error);
      }
    },
    subnets(region, vpcId) {
      const client = ec2(region);
      return collect(
        (command) => client.send(command),
        (NextToken) => new DescribeSubnetsCommand({ Filters: inVpc(vpcId), NextToken }),
        (out) => ({
          items: (out.Subnets || []).map((raw) => ({
            id: raw.SubnetId,
            vpcId: raw.VpcId || "",
            cidr: raw.CidrBlock || "",
            zone: raw.AvailabilityZone || "",
          })),
          next: out.NextToken,
        }),
      );
    },
    securityGroups(region, vpcId) {
      const client = ec2(region);
      return collect(
        (command) => client.send(command),
        (NextToken) => new DescribeSecurityGroupsCommand({ Filters: inVpc(vpcId), NextToken }),
        (out) => ({ items: (out.SecurityGroups || []).map(securityGroupFrom), next: out.NextToken }),
      );
    },
    routeTables(region, vpcId) {
      const client = ec2(region);
      return collect(
        (command) => client.send(command),
        (NextToken) => new DescribeRouteTablesCommand({ Filters: inVpc(vpcId), NextToken }),
        (out) => ({ items: (out.RouteTables || []).map(routeTableFrom), next: out.NextToken }),
      );
    },
    interfaces(region, vpcId) {
      const client = ec2(region);
      return collect(
        (command) => client.send(command),
        (NextToken) => new DescribeNetworkInterfacesCommand({ Filters: inVpc(vpcId), NextToken }),
        (page) => ({ items: (page.NetworkInterfaces || []).flatMap(interfacesFrom), next: page.NextToken }),
      );
    },
    async interfacesByAddress(region, ips) {
      const wanted = [...new Set((ips || []).filter(Boolean))];
      if (!wanted.length) return { items: [] };
      const client = ec2(region);
      const items = [];
      for (const part of chunks(wanted, 200)) {
        const out = await collect(
          (command) => client.send(command),
          (NextToken) =>
            new DescribeNetworkInterfacesCommand({
              Filters: [{ Name: "addresses.private-ip-address", Values: part }],
              NextToken,
            }),
          (page) => ({ items: (page.NetworkInterfaces || []).flatMap(interfacesFrom), next: page.NextToken }),
        );
        if (out.error) return out;
        items.push(...out.items);
      }
      return { items };
    },
    async targetLines(region, balancers) {
      const groups = await this.targetGroups(region);
      if (groups.error) return { edges: [], error: groups.error };
      const wanted = new Set((balancers || []).flatMap((lb) => [lb.id, lb.arn].filter(Boolean)));
      const mine = groups.items.filter((group) => (group.lbArns || []).some((arn) => wanted.has(arn)));
      const health = {};
      const ips = [];
      for (const group of mine) {
        const out = await this.targetHealth(region, group.arn);
        if (out.error) return { edges: [], error: out.error };
        health[group.arn] = out.items;
        for (const item of out.items) if (item.id && !isInstanceId(item.id)) ips.push(item.id);
      }
      const faces = await this.interfacesByAddress(region, ips);
      if (faces.error) return { edges: [], error: faces.error };
      return {
        edges: linesFromTargets(balancers, mine, health, faces.items),
        counts: targetCounts(balancers, mine, health),
        error: "",
      };
    },
    async instancesById(region, ids) {
      const client = ec2(region);
      const items = [];
      for (const part of chunks(ids, 100)) {
        const out = await collect(
          (command) => client.send(command),
          (NextToken) =>
            new DescribeInstancesCommand({ Filters: [{ Name: "instance-id", Values: part }], NextToken }),
          (page) => ({
            items: (page.Reservations || []).flatMap((reservation) => (reservation.Instances || []).map(nodeFrom)),
            next: page.NextToken,
          }),
        );
        if (out.error) return out;
        items.push(...out.items);
      }
      return { items };
    },
    async clusters(region) {
      try {
        const client = new EKSClient({ region });
        const send = (command) => client.send(command);
        const names = await collect(
          send,
          (nextToken) => new ListClustersCommand({ nextToken }),
          (out) => ({ items: out.clusters || [], next: out.nextToken }),
        );
        if (names.error) return names;
        const items = [];
        for (const name of names.items) {
          const { cluster } = await client.send(new DescribeClusterCommand({ name }));
          const groups = await collect(
            send,
            (nextToken) => new ListNodegroupsCommand({ clusterName: name, nextToken }),
            (out) => ({ items: out.nodegroups || [], next: out.nextToken }),
          );
          if (groups.error) return groups;
          const nodegroups = [];
          for (const group of groups.items) {
            const { nodegroup } = await client.send(
              new DescribeNodegroupCommand({ clusterName: name, nodegroupName: group }),
            );
            nodegroups.push(nodegroupFrom(nodegroup));
          }
          items.push(clusterFrom(cluster, nodegroups));
        }
        return { items };
      } catch (error) {
        return publicError(error);
      }
    },
    async metrics(region, lb) {
      if (lb.type !== "application") return { values: {} };
      try {
        const end = new Date();
        const start = new Date(end.getTime() - 15 * 60_000);
        const out = await new CloudWatchClient({ region }).send(
          new GetMetricDataCommand({
            StartTime: start,
            EndTime: end,
            MetricDataQueries: metricQueries(lbDimension(lb.arn)),
          }),
        );
        return { values: metricsFrom(out) };
      } catch (error) {
        return publicError(error);
      }
    },
  };
}

export async function collect(send, makeCommand, readPage) {
  const items = [];
  let next;
  try {
    do {
      const page = readPage(await send(makeCommand(next)));
      items.push(...(page.items || []));
      next = page.next;
    } while (next);
    return { items };
  } catch (error) {
    return publicError(error);
  }
}

export function createLinkCache({ read, clock = Date.now, ttl = 30_000 }) {
  const slots = new Map();
  return {
    current(region) {
      const slot = slots.get(region);
      if (!slot?.at) return { edges: [], error: "", known: false };
      return { edges: slot.edges || [], counts: slot.counts || {}, error: slot.error || "", known: true, at: slot.at };
    },
    kick(region, balancers) {
      const slot = slots.get(region);
      const now = clock();
      if (slot?.inflight) return;
      if (slot?.at && now - slot.at < ttl) return;
      slots.set(region, slot ? { ...slot, inflight: true } : { edges: [], error: "", at: 0, inflight: true });
      let pending;
      try {
        pending = read(region, balancers);
      } catch (error) {
        pending = Promise.reject(error);
      }
      Promise.resolve(pending)
        .then((result) => {
          slots.set(region, {
            edges: result?.error ? [] : result?.edges || [],
            counts: result?.error ? {} : result?.counts || {},
            error: result?.error || "",
            at: clock(),
            inflight: false,
          });
        })
        .catch((error) => {
          slots.set(region, {
            edges: [],
            counts: {},
            error: error?.message || "the target read failed",
            at: clock(),
            inflight: false,
          });
        });
    },
  };
}

export function chunks(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export function lbDimension(arn) {
  const marker = ":loadbalancer/";
  const at = String(arn).indexOf(marker);
  return at >= 0 ? arn.slice(at + marker.length) : "";
}

export function metricQueries(dimension) {
  return Object.entries(METRICS).map(([Id, MetricName]) => ({
    Id,
    MetricStat: {
      Metric: {
        Namespace: "AWS/ApplicationELB",
        MetricName,
        Dimensions: [{ Name: "LoadBalancer", Value: dimension }],
      },
      Period: 60,
      Stat: "Sum",
    },
    ReturnData: true,
  }));
}

export function metricsFrom(out) {
  const values = {};
  for (const key of Object.keys(METRICS)) {
    const found = (out.MetricDataResults || []).find((item) => item.Id === key);
    values[key] = (found?.Values || []).reduce((sum, value) => sum + value, 0);
  }
  return values;
}

function tagFrom(tag) {
  return { key: tag.Key, value: tag.Value || "" };
}

export function loadBalancerFrom(raw) {
  const zones = raw.AvailabilityZones || [];
  return {
    arn: raw.LoadBalancerArn,
    name: raw.LoadBalancerName,
    dns: (raw.DNSName || "").toLowerCase(),
    scheme: raw.Scheme || "",
    type: raw.Type || "",
    state: raw.State?.Code || "",
    stateReason: raw.State?.Reason || "",
    vpcId: raw.VpcId || "",
    subnetIds: zones.map((zone) => zone.SubnetId).filter(Boolean),
    zones: zones.map((zone) => zone.ZoneName).filter(Boolean),
    securityGroupIds: raw.SecurityGroups || [],
  };
}

export function listenerFrom(raw) {
  return {
    arn: raw.ListenerArn,
    lbArn: raw.LoadBalancerArn,
    port: raw.Port,
    protocol: raw.Protocol || "",
    defaultActions: (raw.DefaultActions || []).map(actionFrom),
  };
}

export function actionFrom(raw) {
  const weighted = raw.ForwardConfig?.TargetGroups;
  const arns = (
    weighted?.length
      ? weighted.filter((item) => item.Weight !== 0).map((item) => item.TargetGroupArn)
      : [raw.TargetGroupArn]
  ).filter(Boolean);
  return {
    type: raw.Type || "",
    targetGroupArns: [...new Set(arns)],
    weightless: Boolean(weighted?.length) && arns.length === 0,
    redirectHost: raw.RedirectConfig?.Host || "",
    redirectPort: raw.RedirectConfig?.Port || "",
    redirectProtocol: raw.RedirectConfig?.Protocol || "",
    statusCode: raw.RedirectConfig?.StatusCode || raw.FixedResponseConfig?.StatusCode || "",
    // Weighted forward: every group with its weight (0 kept: it is drawn dim).
    weights: (weighted || []).map((item) => ({ arn: item.TargetGroupArn, weight: item.Weight ?? 1 })),
    redirectPath: raw.RedirectConfig?.Path || "",
    redirectQuery: raw.RedirectConfig?.Query || "",
    contentType: raw.FixedResponseConfig?.ContentType || "",
    messageBody: raw.FixedResponseConfig?.MessageBody || "",
  };
}

export function ruleFrom(raw, listenerArn) {
  const values = (field, key) =>
    (raw.Conditions || [])
      .filter((condition) => condition.Field === field)
      .flatMap((condition) => condition[key]?.Values || condition.Values || []);
  return {
    arn: raw.RuleArn,
    listenerArn,
    priority: raw.Priority || "",
    isDefault: Boolean(raw.IsDefault),
    hosts: values("host-header", "HostHeaderConfig"),
    paths: values("path-pattern", "PathPatternConfig"),
    headers: (raw.Conditions || []).filter((c) => c.Field === "http-header").map((c) => ({ name: c.HttpHeaderConfig?.HttpHeaderName || "", values: c.HttpHeaderConfig?.Values || [] })),
    queries: (raw.Conditions || []).filter((c) => c.Field === "query-string").flatMap((c) => (c.QueryStringConfig?.Values || []).map((v) => ({ key: v.Key || "", value: v.Value || "" }))),
    methods: values("http-request-method", "HttpRequestMethodConfig"),
    sources: values("source-ip", "SourceIpConfig"),
    others: (raw.Conditions || []).filter(
      (condition) => condition.Field !== "host-header" && condition.Field !== "path-pattern",
    ).length,
    actions: (raw.Actions || []).map(actionFrom),
  };
}

export function targetGroupFrom(raw) {
  return {
    arn: raw.TargetGroupArn,
    name: raw.TargetGroupName,
    protocol: raw.Protocol || "",
    port: raw.Port,
    targetType: raw.TargetType || "",
    vpcId: raw.VpcId || "",
    healthPath: raw.HealthCheckPath || "",
    healthPort: raw.HealthCheckPort || "traffic-port",
    healthProtocol: raw.HealthCheckProtocol || "",
    matcher: raw.Matcher?.HttpCode || raw.Matcher?.GrpcCode || "",
    lbArns: raw.LoadBalancerArns || [],
  };
}

export function healthFrom(raw) {
  return {
    id: raw.Target?.Id || "",
    port: raw.Target?.Port,
    zone: raw.Target?.AvailabilityZone || "",
    state: raw.TargetHealth?.State || "",
    reason: raw.TargetHealth?.Reason || "",
    description: raw.TargetHealth?.Description || "",
  };
}

function permissionFrom(raw) {
  return {
    protocol: String(raw.IpProtocol ?? "-1"),
    from: raw.FromPort ?? -1,
    to: raw.ToPort ?? -1,
    cidrs: (raw.IpRanges || []).map((range) => range.CidrIp).filter(Boolean),
    groupIds: (raw.UserIdGroupPairs || []).map((pair) => pair.GroupId).filter(Boolean),
    prefixListIds: (raw.PrefixListIds || []).map((item) => item.PrefixListId).filter(Boolean),
    ipv6: (raw.Ipv6Ranges || []).map((range) => range.CidrIpv6).filter(Boolean),
  };
}

export function securityGroupFrom(raw) {
  return {
    id: raw.GroupId,
    name: raw.GroupName || "",
    vpcId: raw.VpcId || "",
    ingress: (raw.IpPermissions || []).map(permissionFrom),
    egress: (raw.IpPermissionsEgress || []).map(permissionFrom),
  };
}

export function routeTableFrom(raw) {
  const associations = raw.Associations || [];
  return {
    id: raw.RouteTableId,
    vpcId: raw.VpcId || "",
    main: associations.some((association) => association.Main),
    subnetIds: associations.map((association) => association.SubnetId).filter(Boolean),
    routes: (raw.Routes || []).map((route) => ({
      dest: route.DestinationCidrBlock || route.DestinationPrefixListId || "",
      target:
        route.GatewayId ||
        route.NatGatewayId ||
        route.TransitGatewayId ||
        route.VpcPeeringConnectionId ||
        route.NetworkInterfaceId ||
        route.InstanceId ||
        "",
      state: route.State || "active",
    })),
  };
}

export function interfacesFrom(raw) {
  const listed = (raw.PrivateIpAddresses || []).map((entry) => entry.PrivateIpAddress).filter(Boolean);
  const ips = listed.length ? listed : [raw.PrivateIpAddress].filter(Boolean);
  const prefixes = (raw.Ipv4Prefixes || []).map((entry) => entry.Ipv4Prefix).filter(Boolean);
  const base = {
    id: raw.NetworkInterfaceId,
    subnetId: raw.SubnetId || "",
    groupIds: (raw.Groups || []).map((group) => group.GroupId).filter(Boolean),
    instanceId: raw.Attachment?.InstanceId || "",
    description: raw.Description || "",
  };
  return [
    ...ips.map((ip) => ({ ...base, ip, prefix: "" })),
    ...prefixes.map((prefix) => ({ ...base, ip: "", prefix })),
  ];
}

export function nodeFrom(raw) {
  const tags = (raw.Tags || []).map(tagFrom);
  return {
    id: raw.InstanceId,
    state: raw.State?.Name || "",
    vpcId: raw.VpcId || "",
    subnetId: raw.SubnetId || "",
    privateIp: raw.PrivateIpAddress || "",
    instanceType: raw.InstanceType || "",
    zone: raw.Placement?.AvailabilityZone || "",
    groupIds: (raw.SecurityGroups || []).map((group) => group.GroupId).filter(Boolean),
    name: tags.find((tag) => tag.key === "Name" && tag.value)?.value || "",
    tags,
  };
}

function issueFrom(raw) {
  return { code: raw.code || "", message: raw.message || "" };
}

export function nodegroupFrom(raw) {
  return {
    name: raw.nodegroupName,
    status: raw.status || "",
    issues: (raw.health?.issues || []).map(issueFrom),
    desired: raw.scalingConfig?.desiredSize ?? 0,
  };
}

export function clusterFrom(raw, nodegroups) {
  return {
    name: raw.name,
    status: raw.status || "",
    version: raw.version || "",
    vpcId: raw.resourcesVpcConfig?.vpcId || "",
    issues: (raw.health?.issues || []).map(issueFrom),
    nodegroups,
  };
}
