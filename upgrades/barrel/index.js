import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const config = new pulumi.Config();
const name = config.get("name") || "cloudspider-barrel";

if (!/^[a-z][a-z0-9-]{1,27}$/.test(name)) {
  throw new Error("name must be a short lowercase name");
}

const identity = await aws.getCallerIdentity();
const bucket = new aws.s3.Bucket("barrel", {
  bucket: `${name}-${identity.accountId}`,
  forceDestroy: true,
  tags: { Name: name, cloudspider: "expendable" },
});

export const bucketName = bucket.bucket;
