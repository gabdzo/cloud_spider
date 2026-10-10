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

## 6. Bring up the cluster cloudspider-up (PR 23, about $0.13/h while up)

The first cluster lives in the stack `upgrade`. PR 23 adds access entries (`API_AND_CONFIG_MAP`, changed in place) and a read-only viewer role, `cloudspider-up-viewer`, which gets AmazonEKSViewPolicy (no Secrets) and the group `cloudspider-viewers`.

```sh
cd upgrades/eks && npm ci
pulumi stack select upgrade
pulumi config get clusterName        # cloudspider-up, or "not found" (the default is cloudspider-up)
pulumi preview --stack upgrade --diff  # creates: VPC, subnets, roles, cluster, node group, viewer role + access entry
pulumi up --stack upgrade            # about 15 minutes
cd ../..
```

## 7. The read-only kube context for Cloud Spider (free)

```sh
VIEWER=$(cd upgrades/eks && pulumi stack output viewerRoleArn --stack upgrade)
aws eks update-kubeconfig --region eu-north-1 --name cloudspider-up --role-arn "$VIEWER" --alias cloudspider-viewer
aws eks update-kubeconfig --region eu-north-1 --name cloudspider-up --alias cloudspider-up      # your admin context (kubectl, port-forward)
kubectl --context cloudspider-viewer get pods -A         # works
kubectl --context cloudspider-viewer get secrets -A      # Forbidden, as it should be
```

Cloud Spider reads only the `cloudspider-viewer` context (override with `CLOUDSPIDER_KUBE_CONTEXT`) and only sends GET requests. After the demo (§8) the Cluster tab shows namespaces → services → workloads → pods → node. Click a pod to see its last log lines and events.

## 8. Deploy the demo (PR 23, a few cents a day on top of the cluster)

```sh
cd upgrades/demo && npm ci
pulumi stack init demo                           # once; same S3 backend and passphrase as the other stacks
pulumi config set clusterName cloudspider-up
pulumi preview --stack demo --diff               # log group, collector role, pod identity, 2 add-ons, namespace demo, web/api/loadgen, collector
pulumi up --stack demo                           # about 3 minutes
kubectl --context cloudspider-up -n demo get pods
kubectl --context cloudspider-up -n demo port-forward svc/web 9898:9898     # http://127.0.0.1:9898
aws logs tail /cloudspider/eks/cloudspider-up/demo --follow --region eu-north-1
cd ../..
```

A t4g.small fits 11 pods: 6 system (aws-node, kube-proxy, 2× coredns, pod identity agent, metrics-server) plus 4 demo pods. If a demo pod stays Pending with "Too many pods", set `pulumi config set instanceType t4g.medium` in upgrades/eks and run `up` there again. That fits 17 pods and adds about $0.017/h.

## 9. Tear down (stops all spend)

```sh
cd upgrades/demo && pulumi destroy --stack demo --yes && cd ../..
cd upgrades/eks && pulumi destroy --stack upgrade --yes && cd ../..   # about 10 minutes
kubectl config delete-context cloudspider-viewer; kubectl config delete-context cloudspider-up
# optional: the small stacks
cd upgrades/camp && pulumi destroy --stack camp --yes && cd ../..
cd infra && pulumi destroy --stack test --yes && cd ..                # only if it is up
```

### Costs (eu-north-1, approximate list prices)

| piece | rate | a day |
| --- | --- | --- |
| EKS control plane | $0.10/h | $2.40 |
| 1× t4g.small node | ~$0.017/h | ~$0.41 |
| node public IPv4 | $0.005/h | $0.12 |
| node EBS 20 GB gp3 | ~$1.7/month | ~$0.06 |
| demo logs to CloudWatch (a few MB/day, 1-day retention) | ~$0.6/GB ingested | < $0.01 |
| X-Ray traces (loadgen: 4 requests every ~10 s, ~35k traces/day; 100k/month free) | $5 per million | ~$0.00–0.18 |
| camp (Lambda URL, S3, DynamoDB on-demand, 1 secret) | mostly free tier; secret $0.40/month | ~$0.02 |
| **total with the cluster and demo up** | **≈ $0.13/h** | **≈ $3.00–3.20** |

When you're done, run the destroys in §9. Nothing in Cloud Spider keeps resources alive.
