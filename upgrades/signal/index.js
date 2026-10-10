import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { inheritTags, stackTags } from "../tags.js";

// Vault: vaults/signal.yaml selects project=signal.
inheritTags(pulumi, stackTags("signal"));

const config = new pulumi.Config();
const name = config.get("name") || "cloudspider-signal";

if (!/^[a-z][a-z0-9-]{1,27}$/.test(name)) {
  throw new Error("name must be a short lowercase name");
}

const group = new aws.cloudwatch.LogGroup("signal", {
  name: `/cloudspider/${name}`,
  retentionInDays: 1,
  tags: { Name: name, cloudspider: "expendable" },
});

export const logGroupName = group.name;
