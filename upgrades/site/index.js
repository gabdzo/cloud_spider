import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { inheritTags, stackTags } from "../tags.js";
import { PAGE } from "./page.js";

// A static site: a private bucket (no public access, no website endpoint)
// read by CloudFront through origin access control. Stack: site.
// Idle cost is about $0: S3 storage for one small page and CloudFront's free
// tier (1 TB out, 10M requests a month). PriceClass_100 keeps it to the
// cheapest edges (Europe and North America).
// Vault: vaults/templates/site.yaml selects project=site.
inheritTags(pulumi, stackTags("site"));

const config = new pulumi.Config();
const name = config.get("name") || "cloudspider-site";
if (!/^[a-z][a-z0-9-]{1,27}$/.test(name)) throw new Error("name must be a short lowercase name");

const tags = { Name: name, cloudspider: "expendable" };
const identity = await aws.getCallerIdentity();

const bucket = new aws.s3.BucketV2("site", { bucket: `${name}-${identity.accountId}`, forceDestroy: true, tags });
new aws.s3.BucketPublicAccessBlock("site", {
  bucket: bucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});
new aws.s3.BucketOwnershipControls("site", { bucket: bucket.id, rule: { objectOwnership: "BucketOwnerEnforced" } });


new aws.s3.BucketObjectv2("index", {
  bucket: bucket.id,
  key: "index.html",
  content: PAGE,
  contentType: "text/html; charset=utf-8",
  cacheControl: "max-age=60",
  tags,
});

const oac = new aws.cloudfront.OriginAccessControl("site", {
  name: `${name}-oac`,
  originAccessControlOriginType: "s3",
  signingBehavior: "always",
  signingProtocol: "sigv4",
});

const distribution = new aws.cloudfront.Distribution("site", {
  enabled: true,
  comment: name,
  defaultRootObject: "index.html",
  priceClass: "PriceClass_100",
  httpVersion: "http2and3",
  origins: [{ originId: "s3", domainName: bucket.bucketRegionalDomainName, originAccessControlId: oac.id }],
  defaultCacheBehavior: {
    targetOriginId: "s3",
    viewerProtocolPolicy: "redirect-to-https",
    allowedMethods: ["GET", "HEAD"],
    cachedMethods: ["GET", "HEAD"],
    compress: true,
    // AWS managed policy "CachingOptimized".
    cachePolicyId: "658327ea-f89d-4fab-a63d-7e88639e58f6",
  },
  restrictions: { geoRestriction: { restrictionType: "none" } },
  viewerCertificate: { cloudfrontDefaultCertificate: true },
  tags,
});

// Only this distribution may read the bucket.
new aws.s3.BucketPolicy("site", {
  bucket: bucket.id,
  policy: pulumi.all([bucket.arn, distribution.arn]).apply(([bucketArn, distributionArn]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "CloudFrontReadsThroughOAC",
          Effect: "Allow",
          Principal: { Service: "cloudfront.amazonaws.com" },
          Action: "s3:GetObject",
          Resource: `${bucketArn}/*`,
          Condition: { StringEquals: { "AWS:SourceArn": distributionArn } },
        },
      ],
    }),
  ),
});

export const bucketName = bucket.bucket;
export const siteUrl = pulumi.interpolate`https://${distribution.domainName}/`;
export const distributionId = distribution.id;
