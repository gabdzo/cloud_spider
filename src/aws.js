import {
  EC2Client,
  DescribeRegionsCommand,
  DescribeVpcsCommand,
  DescribeSubnetsCommand,
  DescribeInstancesCommand,
  StopInstancesCommand,
  StartInstancesCommand,
} from "@aws-sdk/client-ec2";
import { CloudTrailClient, LookupEventsCommand } from "@aws-sdk/client-cloudtrail";
import {
  CloudWatchLogsClient,
  GetLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";

export function createAws() {
  return {
    ec2: {
      defaultRegion,
      describeRegions,
      describeVpcs,
      describeSubnets,
      describeInstances,
      describeInstance,
      stopInstances,
      startInstances,
    },
    trail: { lookupEvents },
    logs: { filter: readLogStream },
  };
}

async function defaultRegion() {
  try {
    const client = new EC2Client({});
    return await client.config.region();
  } catch (error) {
    return publicError(error).error;
  }
}

async function describeRegions() {
  try {
    const out = await clientFor().send(new DescribeRegionsCommand({ AllRegions: false }));
    return {
      regions: (out.Regions || []).map((region) => region.RegionName).filter(Boolean),
    };
  } catch (error) {
    return publicError(error);
  }
}

async function describeVpcs(region, token) {
  return pages(region, token, (next) => new DescribeVpcsCommand({ NextToken: next }), (out) =>
    (out.Vpcs || []).map((vpc) => ({ id: vpc.VpcId, cidr: vpc.CidrBlock })),
  );
}

async function describeSubnets(region, token) {
  return pages(region, token, (next) => new DescribeSubnetsCommand({ NextToken: next }), (out) =>
    (out.Subnets || []).map((subnet) => ({
      id: subnet.SubnetId,
      vpcId: subnet.VpcId,
      cidr: subnet.CidrBlock,
    })),
  );
}

async function describeInstances(region, token) {
  return pages(
    region,
    token,
    (next) => new DescribeInstancesCommand({ NextToken: next }),
    (out) => (out.Reservations || []).flatMap((reservation) => (reservation.Instances || []).map(instanceFrom)),
  );
}

async function describeInstance(region, id) {
  try {
    const out = await clientFor(region).send(
      new DescribeInstancesCommand({ InstanceIds: [id] }),
    );
    const found = (out.Reservations || [])
      .flatMap((reservation) => reservation.Instances || [])
      .map(instanceFrom)[0];
    return found || null;
  } catch (error) {
    if (error?.name === "InvalidInstanceID.NotFound") return null;
    return publicError(error);
  }
}

async function stopInstances(region, id, dryRun) {
  return verb(region, id, dryRun, (dry) => new StopInstancesCommand({ InstanceIds: [id], DryRun: dry }));
}

async function startInstances(region, id, dryRun) {
  return verb(region, id, dryRun, (dry) => new StartInstancesCommand({ InstanceIds: [id], DryRun: dry }));
}

async function verb(region, id, dryRun, command) {
  try {
    await clientFor(region).send(command(dryRun));
    if (dryRun) return { error: "dry run was not refused" };
    return {};
  } catch (error) {
    if (dryRun && errorName(error) === "DryRunOperation") return { dryRunPass: true };
    return publicError(error);
  }
}

async function lookupEvents(region) {
  try {
    const client = new CloudTrailClient({ region });
    const out = await client.send(new LookupEventsCommand({ MaxResults: 1 }));
    const event = out.Events?.[0];
    if (!event) return { event: null };
    return {
      event: {
        name: event.EventName,
        resources: (event.Resources || []).map(resourceId).filter(Boolean),
      },
    };
  } catch (error) {
    return publicError(error);
  }
}

async function readLogStream({ region, group, stream, limit }) {
  try {
    const client = new CloudWatchLogsClient({ region });
    const out = await client.send(
      new GetLogEventsCommand({
        logGroupName: group,
        logStreamName: stream,
        limit,
        startFromHead: false,
      }),
    );
    return {
      events: (out.events || []).map((event) => ({ message: event.message || "" })),
    };
  } catch (error) {
    if (error?.name === "ResourceNotFoundException") {
      if (/log group/i.test(error.message || "")) return publicError(error);
      return { missing: true };
    }
    return publicError(error);
  }
}

async function pages(region, token, command, mapItems) {
  try {
    const out = await clientFor(region).send(command(token));
    return { items: mapItems(out), nextToken: out.NextToken };
  } catch (error) {
    return publicError(error);
  }
}

function clientFor(region) {
  return new EC2Client(region ? { region } : {});
}

function instanceFrom(raw) {
  const tags = (raw.Tags || []).map((tag) => ({ key: tag.Key, value: tag.Value || "" }));
  const name = tags.find((tag) => tag.key === "Name" && tag.value)?.value;
  return {
    id: raw.InstanceId,
    type: raw.InstanceType,
    state: raw.State?.Name,
    vpcId: raw.VpcId,
    subnetId: raw.SubnetId,
    name,
    tags,
  };
}

function resourceId(resource) {
  const name = resource.ResourceName || "";
  const slash = name.lastIndexOf("/");
  return slash >= 0 ? name.slice(slash + 1) : name;
}

function errorName(error) {
  return error?.name || error?.Code || error?.code || "";
}

function publicError(error) {
  const name = errorName(error);
  const text = typeof error?.message === "string" && error.message ? error.message : name || "error";
  return { error: text };
}
