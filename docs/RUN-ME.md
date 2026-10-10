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

## 10. Monitoring: metrics, logs and failures (PR 24, about $0.01/day, no AWS writes)

Nothing to deploy. Restart Cloud Spider (§2) and keep the tab open:

- **Metrics:** Cloud Spider makes one batched CloudWatch `GetMetricData` call for everything on the map. That covers EC2 (`CPUUtilization`, `StatusCheckFailed`), ALB (`RequestCount`, ELB and target 5XX, `TargetResponseTime`) and Lambda (`Invocations`, `Errors`, `Throttles`, `Duration`). It reads 3 hours at 5-minute points and caches the answer for 5 minutes. The page asks only while the tab is visible, so a hidden tab costs nothing. EKS nodes are EC2 instances, so they get the same numbers.
  - **On the map:** the numbers show on the pieces (`CPU 86%` under a house, `5XX 13/h · 791 REQ` on an ALB card, `9 ERR · 92 INV/h` on the Lambda). A `!` marks a reading worth a look. A piece burns when it is clearly bad: CPU ≥ 90%, a failed status check, or ≥ 25% errors. Each new alert also gets one spider line on the radio.
  - **In the vaults:** an open vault shows METRICS, with a sparkline and the latest value for each resource it owns.
- **Cluster:** metrics-server, installed by the demo in §8, gives `CPU n% MEM n%` on each node card. Clicking a node opens its load meters and its EC2 CloudWatch CPU. Pod CPU and memory stay on the pod cards, and clicking a pod still shows its logs and events (PR 23). The viewer role needs no changes, because §8's ClusterRole already allows `metrics.k8s.io` pods and nodes.
- **Logs and failures:** a vault's ERROR LINES (CloudWatch Logs, on open) and TROUBLE (CloudTrail failed calls) come from PR 22. Pod logs come from PR 23.
- **Not used, on purpose:** Container Insights, VPC flow logs and ALB access logs.

Your profile needs `cloudwatch:GetMetricData`, which ReadOnlyAccess or an admin profile already has. To check from the repo root while it runs:

```sh
curl -s http://127.0.0.1:9241/api/metrics | head -c 600; echo     # region, queries, targets{headline, flag, series}
```

If the answer says `GetMetricData: AccessDenied…`, add the permission to the profile's user or role. That is a read-only action, so nothing else changes.

### Monitoring cost

| piece | rate | a day (tab open ~8 h) |
| --- | --- | --- |
| GetMetricData: today's map is ~12 metrics (2 instances, 1 ALB, 1 Lambda), 12 calls/h | $0.01 per 1,000 metrics requested | ~1,150 metrics ≈ $0.012 |
| same, with a bigger map (~40 metrics) | | ≈ $0.04 |
| FilterLogEvents (vault ERROR LINES), CloudTrail LookupEvents, k8s API | free to call | $0 |
| vended EC2/ALB/Lambda metrics themselves | free | $0 |

The first 1 million GetMetricData metrics a month may fall under the free tier, depending on the account. Either way it is pennies a month.

## 11. More stacks and Terraform (PR stacks-expansion, pay only for what you raise)

Every new card shows its cost on the card (hour / day / month, eu-north-1). Raise them from the Stacks panel (the RUN key) or by hand as below. Each stack is its own state; Take it down (or `pulumi destroy`) removes everything it made. Install a stack's packages once: `cd upgrades/<name> && npm ci`.

### RDS Postgres: about $0.02/h, $0.48/day, $14.48/month

```sh
cd upgrades/rds && npm ci
pulumi stack select rds --create
pulumi preview --stack rds && pulumi up --stack rds          # ~6 minutes
pulumi stack output masterSecretArn                         # the password stays in Secrets Manager
aws secretsmanager get-secret-value --secret-id "$(pulumi stack output masterSecretArn)" --query SecretString --output text   # only if you need it
npm run vaults:new -- rds rds                               # back at the repo root: make the vault living
```

It is private (no internet path), so nothing outside its VPC can connect; that is the point of the template. Tear down: `pulumi destroy --stack rds --yes` (no final snapshot: the data goes).

### Postgres on EKS (CloudNativePG) + Shop API: about $0.0006/h on top of EKS

Needs the cluster from §6 **on t4g.medium** (a t4g.small runs out of pods): set instanceType to t4g.medium on the EKS card and RUN (+$0.0172/h).

```sh
cd upgrades/pgcluster && npm ci
pulumi stack select pgcluster --create
pulumi config set podIdentityAgent present        # ONLY if the demo stack (§8) is up; it already installed the agent
pulumi up --stack pgcluster                        # ~5 minutes: CSI driver, operator, shop/shopdb
kubectl -n shop get cluster shopdb                 # STATUS "Cluster in healthy state"
cd ../shopapi && npm ci
pulumi stack select shopapi --create && pulumi up --stack shopapi
kubectl -n shop logs job/$(pulumi stack output migrationJob)     # "applying /sql/001-shop.sql"
kubectl -n shop port-forward svc/shopapi 3000:80 &
curl -s localhost:3000/items                       # stimpak, rad-away, nuka-cola
```

Tear down in reverse: `pulumi destroy --stack shopapi --yes`, then `pulumi destroy --stack pgcluster --yes` (the StorageClass deletes the EBS volume with the claim). Check no volume is left: `aws ec2 describe-volumes --filters Name=tag:project,Values=pgcluster --query 'Volumes[].VolumeId'`.

### Static site: about $0 (free tier)

```sh
cd upgrades/site && npm ci && pulumi stack select site --create && pulumi up --stack site   # CloudFront takes ~5 minutes
curl -s "$(pulumi stack output siteUrl)" | head -3
```

Tear down: `pulumi destroy --stack site --yes` (disabling and deleting the distribution takes a few minutes).

### SQS worker: about $0 (free tier)

```sh
cd upgrades/worker && npm ci && pulumi stack select worker --create && pulumi up --stack worker
aws sqs send-message --queue-url "$(pulumi stack output queueUrl)" --message-body '{"hello":"wasteland"}'
aws sqs send-message --queue-url "$(pulumi stack output queueUrl)" --message-body '{"fail":true}'   # lands in the DLQ after 3 tries (~3 min)
aws logs tail /aws/lambda/cloudspider-worker --since 10m
```

Tear down: `pulumi destroy --stack worker --yes`.

### Terraform RDS (tf-rds): about $0.02/h, $14.48/month, the same database made by Terraform

Needs Terraform 1.10+ (`brew install terraform`). Cloud Spider only reads this stack (state and outputs); you run these:

```sh
cd terraform/stacks/rds
terraform init                       # S3 backend: cloudspider-state-550536272523, key terraform/rds.tfstate
terraform test                       # mock provider, no AWS calls
terraform plan -out tfplan
terraform apply tfplan               # ~6 minutes
terraform output
```

After `init`, the TERRAFORM card in the Stacks panel shows the state ("6 resources in state, 6 tagged project=tf-rds") and the outputs. Make the vault living with `npm run vaults:new -- tf-rds tf-rds`. Tear down: `terraform destroy` (asks for yes).

### Costs at a glance

| stack | $/hour | $/day | $/month |
| --- | ---: | ---: | ---: |
| rds | 0.0198 | 0.48 | 14.48 |
| pgcluster (on top of EKS; +0.0172/h for the t4g.medium node) | 0.0006 | 0.01 | 0.42 |
| shopapi | 0 | 0 | 0 |
| site | 0 + use | 0 + use | 0 + use |
| worker | 0 + use | 0 + use | 0 + use |
| tf-rds | 0.0198 | 0.48 | 14.48 |

Prices and sources: docs/plan-expansion.md.
