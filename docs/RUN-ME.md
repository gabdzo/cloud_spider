# RUN-ME: what Gabriel runs after the overnight PRs

Nothing in these PRs touched AWS. Run these yourself from the repo root on your Mac, with your usual profile (`AWS_PROFILE=default`, eu-north-1) and `PULUMI_CONFIG_PASSPHRASE` (empty unless you set one). Always `preview` before `up`. Prices are approximate eu-north-1 list prices.

## 1. Clean up the local EKS state (free, one time)

```sh
git pull
git checkout upgrades/eks/Pulumi.upgrade.yaml          # drop the stray clusterName edit (dev-eks-eu-north-1)
cd upgrades/eks && npm ci
pulumi stack ls                                         # expect: upgrade (0 resources), eks-cloudspider-up (0 resources)
pulumi stack rm eks-cloudspider-up --yes                # the empty stack; refuses if it has resources
cd ../..
```

## 2. Restart Cloud Spider

```sh
npm ci && AWS_PROFILE=default AWS_REGION=eu-north-1 npm start    # http://127.0.0.1:9241
```

## 3. New vaults from templates (PR 20, free, no AWS)

Templates are in vaults/templates/ and show under TEMPLATES on the map. To make a living vault:

```sh
npm run vaults:new -- service shop-api      # writes vaults/shop-api.yaml (name, free number, project tag)
$EDITOR vaults/shop-api.yaml                # set spec.stack {dir, name} to the stack that deploys it
npm run vaults:check
```

## 4. Tags-only `pulumi up`s (PR 21, free, a minute each)

One stack is one vault now. The infra parts swap `project=alb-test|test-machines|test-logs` for `component=…`, so `project=cloudspider` (the stack default) shows through. Camp gains a `pageUrl` output, which VIEW and the HTTP check read. Preview first. You should see only `~ update` on `tags`/`tagsAll` (plus camp's new output): nothing to create, replace or delete. If a preview shows anything else, stop.

```sh
cd infra && npm ci && pulumi preview --stack test --diff     # only if the test stack is up (pulumi stack ls)
pulumi up --stack test && cd ..
cd upgrades/camp && npm ci && pulumi preview --stack camp --diff
pulumi up --stack camp && cd ../..                           # adds the pageUrl output; resources unchanged
```

The cloudspider, eks and camp vaults also own whatever their stack made (Cloud Spider reads `pulumi stack export`, which is read-only), so even before these ups the doors show LIVE and the resources. signal and barrel are now templates (vaults/templates/), since their stacks are not up. alb-test, test-machines, test-logs and pulumi-state are gone.

## 5. Camp on the map + vault TROUBLE (PR 22, free, no AWS writes)

Nothing to deploy. The camp pieces, now including the function URL, stay on the map, and a vault counts them (`5 ON MAP`). An open vault shows TROUBLE: failed AWS calls on its resources, taken from the radio's CloudTrail read. It also shows ERROR LINES: the last hour of `ERROR`/`Exception`/`Task timed out` lines from its log groups, i.e. its Lambda's `/aws/lambda/<name>` and any stack log group. Your profile needs `logs:FilterLogEvents`, which a ReadOnlyAccess or admin profile already has. Cost: FilterLogEvents is free to call. CloudWatch Logs bills on ingestion and storage, not reads.
