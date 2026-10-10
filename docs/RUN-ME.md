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
