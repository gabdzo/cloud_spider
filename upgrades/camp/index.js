import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { html } from "./page.js";
import { inheritTags, stackTags } from "../tags.js";

// Vault: vaults/camp.yaml selects project=camp.
inheritTags(pulumi, stackTags("camp"));

// gstack-shortcut(dec-6b984f98-b288-4b2f-b4e4-e203812e4644): one stack, upgrade when a second tear-down stack needs its own picture
// gstack-shortcut(dec-ffe38b30-ac3a-43b0-901e-67c2cb161c56): page, function, table, secret, upgrade when a domain is owned or a paid database is wanted

const config = new pulumi.Config();
const name = config.get("name") || "cloudspider-camp";

if (!/^[a-z][a-z0-9-]{1,27}$/.test(name)) {
  throw new Error("name must be a short lowercase name");
}

const north = new aws.Provider("north", { region: "eu-north-1" });
const opts = { provider: north };
const identity = await aws.getCallerIdentity({}, opts);
if (identity.accountId !== "550536272523") {
  throw new Error("this stack is pinned to one account");
}

const bucket = new aws.s3.Bucket("page", {
  bucket: `${name}-${identity.accountId}`,
  forceDestroy: true,
  tags: { Name: name, cloudspider: "expendable" },
}, opts);

new aws.s3.BucketPublicAccessBlock("page-block", {
  bucket: bucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
}, opts);

new aws.s3.BucketObject("page-file", {
  bucket: bucket.id,
  key: "index.html",
  content: html,
  contentType: "text/html; charset=utf-8",
}, opts);

const table = new aws.dynamodb.Table("table", {
  name: `${name}-table`,
  billingMode: "PAY_PER_REQUEST",
  hashKey: "id",
  attributes: [{ name: "id", type: "S" }],
  tags: { Name: name, cloudspider: "expendable" },
}, opts);

new aws.dynamodb.TableItem("row", {
  tableName: table.name,
  hashKey: table.hashKey,
  item: JSON.stringify({ id: { S: "camp" }, note: { S: "hello" } }),
}, opts);

const secret = new aws.secretsmanager.Secret("secret", {
  name: `${name}-secret`,
  recoveryWindowInDays: 0,
  tags: { Name: name, cloudspider: "expendable" },
}, opts);

new aws.secretsmanager.SecretVersion("secret-value", {
  secretId: secret.id,
  secretString: "camp",
}, opts);

const role = new aws.iam.Role("role", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Action: "sts:AssumeRole",
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
    }],
  }),
  tags: { Name: name, cloudspider: "expendable" },
}, opts);

new aws.iam.RolePolicy("role-policy", {
  role: role.id,
  policy: pulumi.all([bucket.arn, table.arn, secret.arn]).apply(([bucketArn, tableArn, secretArn]) => JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      { Effect: "Allow", Action: ["s3:GetObject"], Resource: `${bucketArn}/*` },
      { Effect: "Allow", Action: ["dynamodb:GetItem"], Resource: tableArn },
      { Effect: "Allow", Action: ["secretsmanager:GetSecretValue"], Resource: secretArn },
    ],
  })),
}, opts);

const page = new aws.lambda.Function("page-fn", {
  name: `${name}-page`,
  runtime: "nodejs20.x",
  role: role.arn,
  handler: "index.handler",
  code: new pulumi.asset.AssetArchive({
    "index.js": new pulumi.asset.StringAsset(
      `exports.handler = async () => ({ statusCode: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: ${JSON.stringify(html)} });`,
    ),
  }),
  tags: { Name: name, cloudspider: "expendable" },
}, opts);

const pageUrlResource = new aws.lambda.FunctionUrl("page-url", {
  functionName: page.name,
  authorizationType: "NONE",
}, opts);

new aws.lambda.Permission("page-invoke", {
  action: "lambda:InvokeFunctionUrl",
  function: page.name,
  principal: "*",
  functionUrlAuthType: "NONE",
}, opts);
// A function URL created after October 2025 stays 403 until the policy also
// allows lambda:InvokeFunction. Auth type NONE is not enough on its own.
new aws.lambda.Permission("page-invoke-fn", {
  action: "lambda:InvokeFunction",
  function: page.name,
  principal: "*",
}, opts);

export const bucketName = bucket.bucket;
export const functionName = page.name;
export const tableName = table.name;
export const secretName = secret.name;
// vaults/camp.yaml: VIEW and the HTTP check read this output. Adding an
// output changes no resource.
export const pageUrl = pageUrlResource.functionUrl;
