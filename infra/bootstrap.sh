#!/bin/sh
# One-time state bucket. The stack cannot create the bucket that stores its own state.
# Idempotent: a second run only re-applies versioning, the public access block
# and the vault tag.
set -eu
export AWS_PROFILE=default
export AWS_REGION=eu-north-1
BUCKET=cloudspider-state-550536272523

if aws s3api head-bucket --bucket "$BUCKET" --region eu-north-1 >/dev/null 2>&1; then
  echo "state bucket already exists: $BUCKET"
else
  aws s3api create-bucket \
    --bucket "$BUCKET" \
    --region eu-north-1 \
    --create-bucket-configuration LocationConstraint=eu-north-1 >/dev/null
  echo "created state bucket: $BUCKET"
fi

aws s3api put-bucket-versioning \
  --bucket "$BUCKET" \
  --region eu-north-1 \
  --versioning-configuration Status=Enabled

aws s3api put-public-access-block \
  --bucket "$BUCKET" \
  --region eu-north-1 \
  --public-access-block-configuration \
  BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true

# Vault tag (vaults/pulumi-state.yaml). tag-resources merges, it never drops
# other tags.
aws resourcegroupstaggingapi tag-resources \
  --region eu-north-1 \
  --resource-arn-list "arn:aws:s3:::$BUCKET" \
  --tags project=pulumi-state,managed-by=bootstrap >/dev/null

echo "versioning enabled, public access blocked, tagged project=pulumi-state: $BUCKET"
