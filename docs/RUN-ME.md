# RUN-ME: what Gabriel runs after the overnight PRs

Nothing in these PRs touched AWS. Run these yourself from the repo root on your Mac, with your usual profile (`AWS_PROFILE=default`, eu-north-1) and `PULUMI_CONFIG_PASSPHRASE` (empty unless you set one). Always `preview` before `up`. Prices are approximate eu-north-1 list prices.

## 1. Clean up the local EKS state (free, one time; already done: skip it unless `pulumi stack ls` still lists an empty eks-cloudspider-up)

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
npm ci && AWS_PROFILE=default AWS_REGION=eu-north-1 CLOUDSPIDER_LOG_GROUP=/cloudspider/test npm start    # http://127.0.0.1:9241
```

`PORT=<n>` serves on another port. After every pull: `npm ci`, restart, reload the page (PATH and CLUSTER come back to the same view).

## 3. New vaults from templates (PR 20, free, no AWS)

Templates are in vaults/templates/ and show under TEMPLATES on the VAULTS page. To make a living vault:

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

Every new card shows its cost on the card (hour / day / month, eu-north-1). Raise them from the Stacks panel (open the card, `preview`, then `run`) or by hand as below. Each stack is its own state; `take it down` (or `pulumi destroy`) removes everything it made. Install a stack's packages once: `cd upgrades/<name> && npm ci`.

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

## 12. OpenShift Local on EC2 (PR learn, about $0.43/h while running, about $10/month stopped)

The `openshift` stack is one m7i-flex.2xlarge (8 vCPU, 32 GiB) with EC2 nested virtualization and a 120 GB gp3 disk. It runs OpenShift Local (CRC), which is what the EX280 labs were written on. It has no inbound ports and no SSH key. You get in with Session Manager, so the AWS CLI needs the [Session Manager plugin](https://docs.aws.amazon.com/systems-manager/latest/userguide/session-manager-working-with-install-plugin.html).

| state | $/hour | $/day | $/month |
| --- | ---: | ---: | ---: |
| running (m7i-flex.2xlarge 0.407 + disk 0.0137 + IPv4 0.005) | 0.4257 | 10.22 | 310.79 |
| stopped (the 120 GB disk only) | 0.0137 | 0.33 | 10.03 |
| 2 h a day, 22 days a month | | | about 28 |
| fallback `instanceType=c5.metal` while running | 4.387 | 105.28 | 3202 |

It stops itself in two ways. A timer powers it off `maxHours` (default 4, 1–12) after **every** boot; the instance is set to stop on shutdown, not terminate. EventBridge Scheduler also stops it every night at 22:00 Europe/Prague. When it is stopped, only the disk bills.

1. **Get your pull secret.** Download it from <https://console.redhat.com/openshift/create/local> (free Red Hat account). Keep it on your laptop. It never goes into the repo, Pulumi config or state.
2. **Raise it.** Open STACKS → OPENSHIFT LOCAL, keep `m7i-flex.2xlarge` and `maxHours` 4, then press `preview` and `run`. Or from the shell:
   ```bash
   cd upgrades/openshift && npm ci
   pulumi stack select openshift --create
   pulumi config set aws:region eu-north-1
   pulumi up                       # ~2 minutes; first-boot setup runs ~5 more
   pulumi stack output connect     # the aws ssm start-session line
   ```
3. **Copy the pull secret in and start CRC.** Run this from the laptop:
   ```bash
   ID=$(pulumi stack output instanceId)
   aws ssm start-session --region eu-north-1 --target "$ID"
   # on the host:
   sudo -iu crc
   cat > ~/pull-secret.txt      # paste the secret, then Ctrl-D
   crc setup                    # ~5 min (downloads the ~5 GB bundle)
   crc start -p ~/pull-secret.txt   # ~10 min; prints the kubeadmin password
   eval $(crc oc-env) && oc login -u kubeadmin https://api.crc.testing:6443
   ```
   If `crc setup` says virtualization is not available, nested KVM did not work. Set `instanceType` to `c5.metal`, press `run` again and repeat. That host costs ~$4.39/h, so keep `maxHours` low.
4. **Run the labs on the host.** Clone the repo there (`git clone https://github.com/gabdzo/cloud_spider`) and follow the LEARN tab's OPENSHIFT EX280 holotapes (`cd labs/ex280/lab01-workloads && ./setup.sh`). The route hosts are `*.apps-crc.testing`; the verify scripts curl them from the host itself.
5. **The console from your laptop (optional):**
   ```bash
   aws ssm start-session --region eu-north-1 --target "$ID" \
     --document-name AWS-StartPortForwardingSession --parameters portNumber=443,localPortNumber=8443
   ```
   Then point `console-openshift-console.apps-crc.testing` and `oauth-openshift.apps-crc.testing` at 127.0.0.1 in /etc/hosts and open https://console-openshift-console.apps-crc.testing:8443. CRC listens on the host's 443 only after `crc start`.
6. **Pause and resume.** The map's stop key (it is tagged `cloudspider=expendable`) or `aws ec2 stop-instances --instance-ids "$ID"` pauses it. To keep going past the timer, run `sudo shutdown -c`. After a start, run `crc start` again (~5 min). The cluster keeps its state on the disk.
7. **Tear down.** Use STACKS → OPENSHIFT LOCAL → `take it down`, or `pulumi destroy` in `upgrades/openshift`. That deletes the instance, the disk, the VPC, the role and the schedule. Nothing bills afterwards.

## 13. LEARN: the lab shelf (free in Cloud Spider; the clusters cost what they cost)

The LEARN key on the console opens the holotape shelf. It has three tracks:

- **KUBERNETES / EKS**: `labs/k8s/lab01…lab15`, the EX280 labs rewritten for `kubectl` (namespaces `k8s-labNN`, Pod Security `restricted`, an unprivileged nginx on 8080). They run on the `cloudspider-up` EKS cluster (§6, about $0.13/h; pick t4g.medium for the bigger labs) or any kind/k3s cluster. Some labs need extras:
  - lab03 NetworkPolicy needs the VPC CNI network policy agent: `aws eks update-addon --cluster-name cloudspider-up --addon-name vpc-cni --configuration-values '{"enableNetworkPolicy":"true"}'` (free).
  - lab10 and lab11 need `helm`. Lab11 installs cert-manager into `k8s-lab11` (free).
  - lab12 reads the Ingress objects and the TLS secrets only, so it needs no ingress controller. Installing ingress-nginx to curl them would add an NLB, about $0.024/h, $17/month.
- **OPENSHIFT EX280**: `labs/ex280/…`, the original labs and mock exams. They need `oc` as cluster-admin, which means the §12 host.
- **CLOUD PLATFORM**: the AWS break-fix scenarios of `labs/cloud-platform` (§15). Their check is `lab validate`, which Cloud Spider never runs; the tape shows the last result `labctl` recorded.

Each tape shows the task, the setup commands (COPY), hints one at a time and the check. Cloud Spider runs a check only when a scan of the script and every helper it calls finds no write, exec or install. All 15 Kubernetes checks qualify, and so do 14 of the 18 OpenShift ones. The OpenShift lab03, lab06, lab15 and mock02 checks exec into pods or rotate a secret, so their RUN CHECK stays off; copy the command instead. Progress is kept in `.learn/progress.json` (gitignored); with SAMPLE on it is kept in the browser instead, and nothing runs. FORGET PROGRESS clears a lab.

Clean up a Kubernetes lab with its CLEAN command (`kubectl delete namespace k8s-labNN…`). For OpenShift, use `labs/ex280/common/cleanup-all.sh`.

## 14. Cluster telemetry: Cluster → TELEMETRY (no AWS cost beyond the cluster)

The Cluster view has two screens now, **TOPOLOGY** and **TELEMETRY**. TELEMETRY shows the following for each node:
- CPU, MEM and DISK gauges
- READY, MEM PRESSURE, DISK PRESSURE and PID PRESSURE lamps
- allocatable vs requested vs used bars
- 1-hour charts
- the EC2 CloudWatch series the map already reads

It also lists the top pods by CPU and memory, with restarts and OOMKilled.

**Where the numbers come from (best first)**
1. **The OTel collector you already run** (upgrades/demo). Its DaemonSet now also runs:
   - `kubeletstats`: node, pod and container CPU, memory, filesystem and network
   - `hostmetrics`: node disk, filesystem, load and network
   
   It sends them over OTLP to a one-replica `otel-gateway`, which serves Prometheus text on the `otel-metrics` Service (port 8889, inside the cluster only). Cloud Spider reads it through the API server's service proxy (`/api/v1/namespaces/demo/services/otel-metrics/proxy/metrics`) with the viewer role. A Role grants the viewer `get` on `services/proxy` for **that one Service only**, and nothing else changes.
2. **metrics-server** is the fallback when the gateway isn't there yet: CPU and memory only, so the disk gauge shows "needs OTel". The screen says which source it used.

Node conditions and requests come from the kube API in both cases.

**History** lives in Cloud Spider's memory: one sample every 30 s, kept for 1 hour, and only while the TELEMETRY screen is open (nothing is read in the background). It starts empty after every restart.

**To turn it on:**
```bash
cd upgrades/demo && npm ci && pulumi preview --diff -s demo && pulumi up -s demo
# then in Cloud Spider: Cluster → TELEMETRY. The lamp says OTEL COLLECTOR.
kubectl -n demo get pods -l app=otel-gateway       # 1/1 Running
```
`CLOUDSPIDER_OTEL_METRICS=<ns>/<service>` points the app at another gateway (default `demo/otel-metrics`).

**Cost:** $0 in AWS. No CloudWatch custom metrics, no new load balancer, no new log group. The gateway uses about 10m CPU and 48–128 Mi of memory on the node you already pay for, and the collector's extra receivers add a few millicores. The only AWS calls are the EC2 CloudWatch reads the map already makes.

**EC2 memory and disk in CloudWatch** are *not* published by EC2 itself. They need the CloudWatch agent, which bills as custom metrics: about $0.30 per metric per month, so a node with memory plus 2 disk metrics costs about $0.90/month. node-exporter scraped into CloudWatch would cost the same. Because the OTel path above already shows memory and disk for free, this isn't set up. If you ever add the CloudWatch agent, reading its `CWAgent` namespace next to the EC2 series is a small follow-up.

## 15. cloud-platform scenarios (`labs/cloud-platform`, about $0.02 per run)

`labctl` (`lab`) builds a small network with Pulumi, proves it healthy, breaks one hidden thing and hands it over; `lab validate` checks your fix and the guards (no world-open rules, no new infrastructure). Cloud Spider only lists the scenarios on the CLOUD PLATFORM shelf and reads `labs/cloud-platform/.lab/` (gitignored) to show the run's state and last validate result. It never calls AWS for them.

**Before the first run.** It was designed for a separate AWS Organization with a `labs-sandbox` account, IAM Identity Center (`cp-lab` profile) and the `lab-solver-boundary` policy (`docs/cloud-platform/ARCHITECTURE.md`, `labs/cloud-platform/platform/BOOTSTRAP.md`). That is not built yet, so `lab up` stops at the solver role in a single account. See the open question in `docs/plan-expansion.md`.

```bash
cd labs/cloud-platform
uv sync --frozen                                   # Python 3.12 + deps into .venv
uv run --frozen pytest -q tests scenarios          # offline, no AWS
# Pulumi passphrase for the local state: env var, keychain, secret-tool, or a private file
mkdir -p ~/.config/cloud-platform && (umask 077; printf '%s' 'choose-one' > ~/.config/cloud-platform/pulumi-passphrase)
source scripts/lab-env.sh                          # LAB_REGION defaults to eu-north-1
uv run lab up aws-web-unreachable-001              # builds, breaks, prints endpoint + instance_id
uv run lab shell                                   # 1 h solver credentials
uv run lab status                                  # time left
uv run lab validate                                # repeat until it passes
uv run lab reveal                                  # the cause, after a pass
uv run lab down                                    # tear down (idempotent)
uv run lab janitor                                 # list anything left tagged lab_run_id
```

| Scenario | What runs | Cost |
|---|---|---|
| aws-smoke-001 | VPC + security group, no instance, TTL 15 min | free |
| aws-web-unreachable-001 | VPC, subnet, IGW, NACL, t4g.micro + public IPv4, TTL 90 min | $0.0136/h: about $0.02 per run, $0.33/day if left up |

**Teardown**: `uv run lab down` (or `lab down <run_id>`), then `uv run lab janitor` must print `clean`. Runs past their TTL are not deleted automatically; `lab status` and the tape say EXPIRED.

## 16. Cluster add-ons (`upgrades/addons`, $0 idle; Karpenter nodes $0.0245/h each)

A DevOps toolbox for an EKS cluster you already have (section 6). It is one Pulumi project (`cloudspider-addons`) with **one stack per add-on and cluster**, named `<addon>-<cluster>`, for example `kyverno-cloudspider-up`. The program reads `clusterName` from config and refuses to run when it does not match the stack name. Every AWS resource carries `project=<addon>`, `cluster=<cluster>` and `cloudspider=expendable`, and each add-on has a vault template (`vaults/templates/<addon>.yaml`, numbers 200–207).

In Cloud Spider, **STACKS → CLUSTER ADD-ONS** lists every cluster (EKS `ListClusters` plus any cluster an add-on stack names). Under each cluster, every add-on shows one of these states, with its version:
- **INSTALLED**: its stack holds resources.
- **PRESENT**: it is in the cluster but came from somewhere else, such as the demo's metrics-server. `up` is refused.
- **NOT INSTALLED**
- **NEEDS A DOMAIN**: ExternalDNS.

A row opens the usual card, with the cluster filled in and three buttons: **PREVIEW** (`pulumi preview --diff`, changes nothing), **RUN** and **TAKE IT DOWN**. It also has the same commands to copy. **Cluster → OPS** shows Kyverno policy reports and violations, HPA replica racks with CPU against target, Karpenter's pool and its node claims, KEDA, and the cluster's events. Scaling, node, policy and warning events also go on the radio. Everything is read-only, through the viewer context (section 7). Kyverno, Karpenter, cert-manager, KEDA and the scaling demo each grant the `cloudspider-viewers` group get/list/watch on their own kinds, and nothing more.

**Once:**
```bash
cd upgrades/addons && npm ci
export CLUSTER=cloudspider-up
```

**Per add-on** (replace `kyverno` with the add-on's id):
```bash
pulumi stack select --create kyverno-$CLUSTER && pulumi config set clusterName $CLUSTER
pulumi preview --diff        # read it
pulumi up                    # raise it
pulumi destroy && pulumi stack rm kyverno-$CLUSTER    # take it away again
```

| Order | Add-on (id) | What you get | Cost |
|---|---|---|---|
| 1 | Pod Identity agent (`pod-identity`) | EKS add-on; how the next three get AWS credentials. Skip it if the tree says PRESENT (the demo installs it). | $0 |
| 1 | metrics-server (`metrics-server`) | EKS add-on for `kubectl top` and HPAs. Skip it if PRESENT (the demo installs it). | $0 |
| 2 | Kyverno (`kyverno`) | Four baseline policies in **Audit** mode: no privileged containers, no hostPath, requests set, no `:latest`. Plus two demo policies, also Audit: `require-app-name-label` (Pods carry `app.kubernetes.io/name`) and `require-readiness-probe`. Nothing is blocked. | $0 (about 200m CPU, 600 Mi on your node) |
| 2 | Karpenter (`karpenter`) | Controller, interruption queue + 5 EventBridge rules, node role. NodePool `default`: t4g.small/medium arm64, spot first, **capped at 4 vCPU**, empty nodes removed after 1 min, every node replaced after 24 h. `pulumi config set capacity on-demand` to skip spot. | $0 idle (SQS free tier); **each node $0.0245/h, $0.59/day, $17.88/month** (t4g.small + 20 GB gp3 + public IPv4), at most 4 vCPU |
| 3 | HPA scaling demo (`scaling-demo`) | HPAs on demo `web` and `api` (1–4 at 60% CPU). `config set burst on` adds load; `config set inflate 3` adds 3 pause pods of 500m that Karpenter has to place. | $0 itself; inflate pods can make Karpenter add a node |
| 2 | AWS Load Balancer Controller (`lbc`) | ALBs for Ingress, NLBs for annotated Services. It does not touch existing Services (service mutator off). | $0 until something asks; each ALB/NLB about $0.024/h ($17.48/month) + LCUs |
| 2 | cert-manager (`cert-manager`) | CRDs + a self-signed ClusterIssuer `cloudspider-selfsigned`. | $0 |
| 3 | KEDA (`keda`), optional | A `jobs-worker` that scales 0→3 on its own SQS queue `<cluster>-keda-jobs`. | $0 at this volume (SQS free tier) |
| – | ExternalDNS | Not built: needs a domain and a Route 53 zone ($0.50/month). | – |

**Room for pods** (read this before Kyverno on the demo cluster): every EKS node has a hard pod cap from the VPC CNI (one IP per pod). A **t4g.small holds 11 pods**, and the demo cluster's single node already runs 11 (4 demo + 7 kube-system). Kyverno needs 3 more, so its pods stay Pending, Helm's atomic install times out after 10 minutes, and its rollback hangs on a Pending hook. (That happened on 2026-10-11, and the leftovers were cleaned up.) Now both Cloud Spider's RUN and `pulumi preview`/`up` on the add-on stack count free slots first and refuse with a message like *"Kyverno needs 3 free pod slots on cloudspider-up, and its 1 node has 0 (11/11 in use; t4g.small holds 11 pods)"*. If Karpenter will add the node anyway, `pulumi config set skipRoomCheck true` skips the check.

To make room, pick one:
- **A second node** (about +$0.02/h, $0.50/day for a t4g.small and its disk): raise the node group's desired size to 2 in the cluster's stack (section 6), `pulumi up` there, and wait for `kubectl --context cloudspider-up get nodes` to show 2 Ready nodes.
- **A larger instance** (t4g.medium also holds only 17 pods; t4g.large holds 35): only if you also want the CPU.

Then retry Kyverno:
```bash
cd upgrades/addons && export CLUSTER=cloudspider-up
pulumi stack select --create kyverno-$CLUSTER && pulumi config set clusterName $CLUSTER
pulumi preview --diff        # prints "<n> free pod slots, Kyverno needs 3"
pulumi up                    # about 2 minutes; then: kubectl --context $CLUSTER get cpol,policyreport -A
```
If an up is ever interrupted with Pods Pending, undo it like this (cluster first, then the stack): `helm uninstall kyverno -n kyverno --kube-context $CLUSTER --no-hooks`, `kubectl --context $CLUSTER delete ns kyverno`, check `kubectl --context $CLUSTER get crd | grep -E 'kyverno|wgpolicy'` is empty, then `pulumi cancel -s kyverno-$CLUSTER` (only if a dead run left a lock), `pulumi refresh -s kyverno-$CLUSTER --clear-pending-creates --yes`, `pulumi stack rm -s kyverno-$CLUSTER --force --yes`.

**Watch it scale:**
```bash
pulumi stack select scaling-demo-$CLUSTER && pulumi config set burst on && pulumi config set inflate 3 && pulumi up
# Cluster → OPS: web goes 1→4, a t4g node claim appears (LAUNCHING → READY); the radio says so
pulumi config set burst off && pulumi config set inflate 0 && pulumi up    # Karpenter removes the node a minute later
```

**Notes:**
- **Spot** needs the EC2 Spot service-linked role. If Karpenter's events say `AuthFailure.ServiceLinkedRoleCreationNotPermitted`, run `aws iam create-service-linked-role --aws-service-name spot.amazonaws.com` once, or switch the pool with `capacity on-demand`.
- A `pulumi up` on `upgrades/demo` resets `web` and `api` to their own replica counts. The HPA moves them back within a minute.
- The **Kubernetes lab 11** installs its own cert-manager. Raise only one of the two on a cluster.
- The kube viewer context (section 7) must exist for PRESENT detection and the OPS screen. Without it, the tree shows only what the stacks say, and RUN does not check needs.

**Teardown** (reverse order; Karpenter last, after its nodes are gone):
```bash
for a in keda scaling-demo cert-manager lbc kyverno; do pulumi destroy -s $a-$CLUSTER --yes && pulumi stack rm -s $a-$CLUSTER --yes; done
kubectl get nodeclaims    # wait until empty (scale the demo down first)
pulumi destroy -s karpenter-$CLUSTER --yes && pulumi stack rm -s karpenter-$CLUSTER --yes
for a in metrics-server pod-identity; do pulumi destroy -s $a-$CLUSTER --yes && pulumi stack rm -s $a-$CLUSTER --yes; done
aws ec2 describe-instances --region eu-north-1 --filters Name=tag:project,Values=karpenter Name=instance-state-name,Values=running --query 'Reservations[].Instances[].InstanceId'   # must be []
```
Take the add-ons down before the cluster itself (section 9). A destroyed cluster leaves add-on stacks that can no longer reach it; `pulumi stack rm --force -s <addon>-<cluster>` drops them.

## 17. SLOs: SLA, SLO and SLI on the cards (free, except about $1.7/month per ALB an `alb` SLO watches)

A vault can list its objectives under `spec.slos`. The cluster gets three by default:
- API availability
- node readiness
- pod restart rate

```yaml
spec:
  slos:
    - name: page-availability
      sli: availability          # availability | latency | error-rate
      source: checks             # checks | check:<name> | alb | lambda | ec2 | resources
                                 # | kube:api | kube:nodes | kube:restarts[:<ns>/<workload>]
      target: 99.5%
      window: 30d                # default 30d, up to 90d
    - name: page-latency
      sli: latency
      source: check:camp page
      threshold: 800             # ms; latency only
      target: 99%
    - name: alb-latency
      sli: latency
      source: alb
      threshold: 300
      percentile: p95            # alb latency only: p50 | p90 | p95 (default) | p99
      target: 99%
    - name: api-restarts
      sli: error-rate
      source: kube:restarts:shop/shopapi
      target: 99%
      cluster: cs-drill          # kube:* only, optional: an EKS name or a kube context
```

- **SLI** is what was measured: good ÷ all. **SLO** is your target for it over the window. **SLA** is a promise to someone else with a penalty. There is none here, so keep each SLO stricter than any SLA you might give.
- **Error budget** is 100 % − SLO, counted in readings over the **whole window**: a 99 % SLO over 24 h with one check a minute may hold 14.4 bad checks. Until a full window has been seen, the window's count is the rate seen so far times the window, so one failed check in the first ten minutes spends 1/14.4 of the budget, not all of it. The card says how much has been seen, for example `3d of 30d seen`. A fresh failure still lights BURNING through the burn rate.
- **Burn rate** is how fast the last hour spends the budget. 1× lasts exactly the window. At 2× or more the **BUDGET BURNING** lamp lights; at 14.4× or more it says FAST. When nothing is left, the lamp reads **BUDGET SPENT**.
- **Where it shows:**
  - each vault's panel and page (dial, bar and lamp)
  - the map's info plate for every piece the vault owns
  - the Cluster view's node card (API and nodes)
  - a workload card: click a workload, and its own restart rate is shown next to the cluster objectives
  - the morning's **HURTING** card, for an SLO whose budget is spent or that burns FAST. HURTING also names an ALB whose last 10 minutes of traffic got 5XX (5 % or more, or 50+), including the ALB's own 503s when no target is left; such an ALB is not called idle
  - **SLA · SLO · SLI ?** on any of these opens the short explanation
- **Where the numbers come from:**
  - `checks` uses the vault's own HTTP checks, as the page already runs them (one reading per result).
  - `alb` is read by the server itself, in the background, whether a page is open or not (every 30 s it evaluates every vault; that also keeps the vaults' HTTP checks running). For each ALB that a vault's `alb` SLO needs, it asks CloudWatch for one-minute points: RequestCount, both 5XX counts and `TargetResponseTime` at the SLO's percentile (p95 by default; an average hid the drill's slow tail, see `docs/disaster-drill-2026-10-11.md` fault c). Each minute is one reading: availability counts requests without a 5XX, the ALB's own 503s included; latency counts the minute good when its percentile is under the threshold. The points go into the ledger, so the window reaches past CloudWatch's 3 h answer, and a minute CloudWatch fills in late is replaced, not counted twice.
    - **The floor.** ALB metrics exist per minute, so 60 s is the shortest period CloudWatch has for them, and they arrive about 1–2 minutes late. With the 60 s read, an ALB breach shows on the card about **2–3 minutes** after it starts (it was 5–10 minutes with the map's 5-minute series behind a 5-minute cache). Faster than that needs something in the request path (access logs, a load balancer that pushes), which is not part of this.
    - **The cost.** 4 metrics per read, one read a minute: about 5,760 metrics a day, about **$0.06/day ($1.7/month) per watched ALB** at $0.01 per 1,000. Nothing is read for an ALB no `alb` SLO names.
  - `lambda` and `ec2` use the 3 h, 5-minute CloudWatch series the map already asks for.
  - `resources` uses the owned pieces' status on each map read.
  - `kube:*` uses the read-only snapshots of **every** kube context (§19), each read on its own clock by the health watch, and each only within its namespace allowlist. Restarts count from the second read on. Which cluster a vault's `kube:*` SLO reads:
    1. its own `cluster:` (the EKS name or a kube context's name), when set
    2. for `kube:restarts:<ns>/<workload>`, the cluster where that workload is seen
    3. an EKS cluster the vault owns on the map
    4. the cluster the vault's own `kube:restarts` SLOs found
    5. the primary (first) context's cluster
  
    So a CONNECTed cluster's vault no longer reads `nodata` until it is made primary. `CLOUDSPIDER_KUBE_CONTEXT` set next to `CLOUDSPIDER_KUBE_CONTEXTS` or cloudspider.contexts.yaml is now named as ignored in the server's log.

  Readings are kept in 5-minute buckets for at most 30 days, in memory and in **`.cloudspider/slo-ledger.json`** (saved every minute when something changed, and on Ctrl-C; read back on start, so a restart keeps the history). The file holds counts only. Delete it to start the budgets over. Apart from the `alb` reader above, no AWS or kube call is added.

## 18. The cluster on the map (free: the Cluster view's read, shared)

With the kube context from §7 set, the MAP draws the EKS cluster inside
the subnets its nodes run in: a fenced compound per subnet, the nodes as
its buildings, the apps as tents and the pods as little figures. Nothing
new is read: the map and the Cluster view share one viewer-role snapshot
(the map reuses it for 30 s, the Cluster view for 5 s; one read in
flight at a time). `GET /api/map/kube` serves it; `?sample=1` is the
sample cluster.

The `1 2 3 AUTO` switch on the compound's top right picks how much to
draw, per cluster, and the choice is kept in this browser
(`cloudspider.map.kube` in localStorage):

| level | draws |
| --- | --- |
| 1 | the cluster and its nodes |
| 2 | nodes and apps: Deployments, StatefulSets and DaemonSets per namespace, with ready/wanted replicas and a sign post when a Service selects them; system namespaces fold to one line |
| 3 | every pod, under its app, in the subnet of the node it runs on |
| AUTO | 3 when the yard has room, 2 when it is narrow or there are more than 40 pods, 1 when even the tents would not fit (the map has no zoom, so AUTO goes by room) |

Click a tent to open the Cluster view on that workload (its card and
SLOs), a figure to open the pod's deep-inspect panel, the compound's
name for the Cluster view itself. With no kube context the map stays as
before: the nodes are plain buildings.

## 19. More kube contexts, scoped to your namespaces (free; GET only)

The Cluster view can read more than one kube context, for example the
demo cluster plus a work cluster where you only have rights in a few
namespaces. List them in `cloudspider.contexts.yaml` at the repo root. The
file is gitignored; copy `cloudspider.contexts.example.yaml` to start one.
For a quick try, use the env var instead:

```sh
CLOUDSPIDER_KUBE_CONTEXTS="cloudspider-viewer:*;my-work-context:team-a,team-b" npm start
```

Cloud Spider reads its contexts from the first of these it finds:

1. `CLOUDSPIDER_KUBE_CONTEXTS`
2. the file, or the path in `CLOUDSPIDER_KUBE_CONTEXTS_FILE`
3. the single `CLOUDSPIDER_KUBE_CONTEXT` (§7)

The first context listed is the **primary** one. The map compound (§18),
TELEMETRY, OPS and the cluster SLOs read the primary only. Every context
gets:

- **A button in the Cluster view's context switcher.** The button's health
  lamp is green when every pod is healthy, amber for warnings, and red for
  crashloops, image pulls, OOMKills and failed Jobs. Its lanes are the
  context's namespaces. Each context reads with its own kubeconfig
  credentials, so one context failing never touches another.
- **A health watch.** Each context is read on its own clock: `poll` in
  seconds, default 60, at least 30. One namespaced snapshot is shared with
  the Cluster view. The watch flags:
  - CrashLoopBackOff
  - ImagePullBackOff / ErrImagePull
  - OOMKilled (current or last state)
  - restart counts that rose since the last read (3 or more)
  - Pending for over 5 minutes, with the cause: the pod's newest Warning
    event (for example `FailedAttachVolume: Multi-Attach error…` or
    `FailedScheduling`), else its Unschedulable condition. Events are read
    (GET, cached 60 s) only for namespaces with a stuck pod.
  - failed Jobs
  - Deployments and StatefulSets with fewer ready replicas than wanted

  Each new finding goes on the radio once, naming the context, the
  namespace and the pod.
- **A PODS line on the morning report** with the counts and the worst
  three offenders.

**Namespaced means namespaced.** When `namespaces` is a list, Cloud Spider
calls only the namespaced endpoints in those namespaces, for each
namespace:
- pods
- services
- deployments, daemonsets and statefulsets
- jobs
- ingresses
- pod metrics
- events and HPAs (OPS)

It never asks for cluster-wide lists, nodes or the namespace list. The
nodes in the picture are only the names the pods report. A 403 on any of
these lists shows as an amber `NO ACCESS · …` chip on that namespace's
lane, never as an error. A pod outside the list is refused before any
request is made. Everything is GET; nothing is written, exec'd or
port-forwarded, and Secrets are never read.

**The safer door: a read-only Role per namespace.** Ask your cluster
admins to bind the built-in `view` ClusterRole in each of your namespaces.
`view` reads workloads, pods, logs and events, but not Secrets. Add a
second, tiny Role per namespace only if you want pod metrics. For example,
for an IAM role or SSO group mapped to the user `ppf-readonly` (EKS access
entries or aws-auth):

```yaml
# One RoleBinding per namespace (repeat for team-b, ...).
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: cloudspider-view
  namespace: team-a
subjects:
  - kind: User            # or Group
    name: ppf-readonly
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: ClusterRole
  name: view              # built in: read-only, no Secrets
  apiGroup: rbac.authorization.k8s.io
---
# Optional: pod CPU/memory from metrics-server in this namespace.
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: cloudspider-pod-metrics
  namespace: team-a
rules:
  - apiGroups: ["metrics.k8s.io"]
    resources: ["pods"]
    verbs: ["get", "list"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: cloudspider-pod-metrics
  namespace: team-a
subjects:
  - kind: User
    name: ppf-readonly
    apiGroup: rbac.authorization.k8s.io
roleRef:
  kind: Role
  name: cloudspider-pod-metrics
  apiGroup: rbac.authorization.k8s.io
```

Then make a kubeconfig context that uses that identity (for EKS:
`aws eks update-kubeconfig --name <cluster> --role-arn <read-only role>
--alias my-work-context`) and list it with its namespaces.

Context names and namespaces come only from your config, and names that
do not look like kube names are refused at start. Cloud Spider writes no
tokens and no pod contents to its log; only config mistakes are printed.

## 20. Stacks: the run pane, run logs and errors (free)

Every PREVIEW, RUN and TAKE IT DOWN in a Stacks card now shows a terminal under the buttons: each pulumi step with ✓ / ▶ / ✗, the clock, and the live log (stdout and stderr). The card shows its own stack only (the name in its fields): the run going on it, or its last run.

- Every run is written to `.cloudspider/runs/<stack>/<time>.log` (plus a `.json` with the steps and the error), gitignored. The `log:` link under the pane opens the whole log; it survives a page reload and a server restart.
- A failed run gets a red ERROR plate: the step that failed, Pulumi's first error lines, WHAT TO DO for the known causes (pulumi not on PATH, passphrase, Pulumi state not reachable, AWS credentials expired or the wrong profile, quota, a name already taken, a locked stack) and BY HAND with COPY: the same steps as one line for a terminal (the passphrase is never written out). The radio gets the first error line too.
- A run Cloud Spider refuses before pulumi starts (another run still going, the two-cluster limit, an add-on with no pod room, a wrong name for take-down) shows `REFUSED · NOTHING RAN` and stays until the next press. Before this it flashed for under two seconds and the next poll painted the last run's log over it.
- PREVIEW makes the stack (and its `Pulumi.<stack>.yaml`) but creates nothing in AWS; the card now says so ("nothing is made yet … RUN makes it"). RUN is what creates the cluster.

### A second, medium cluster (about $0.14/h, $3.40/day while up)

EKS control plane $0.10/h + one t4g.medium $0.0344/h + 20 GB gp3 + a public IPv4 (eu-north-1). The card's cost chip follows instanceType and nodeCount.

1. Start the server from a terminal where `aws sts get-caller-identity --profile default` answers with account 550536272523 and `pulumi version` works: `AWS_PROFILE=default AWS_REGION=eu-north-1 PULUMI_CONFIG_PASSPHRASE= npm start`.
2. Stacks → EKS: clusterName `cloudspider-medium` (or any short lowercase name), instanceType `t4g.medium`, nodeCount 1.
3. Optional: PREVIEW, and wait until the pane says DONE (about a minute). A RUN pressed while the preview is still going is refused.
4. RUN. Leave the tab open: about 15 minutes; the pane shows each step and the log. When it says DONE, the cluster is up and billing.
5. Take it down when done: type the cluster name in the box, TAKE IT DOWN (about 10 minutes).

## 21. CONNECT: put an EKS cluster in kubectl and Cloud Spider (free)

No more editing the kubeconfig or `cloudspider.contexts.yaml` by hand. The Stacks EKS card (for the cluster named in its fields), the Cluster view's EKS strip (top right, folded when everything is connected) and the map compound's KUBE chip / the EKS plate's KUBE line show a lamp:

- NOT CONNECTED (amber): press CONNECT.
- CONNECTED (green): the cluster has a kube context and Cloud Spider reads it. DISCONNECT shows only for a context CONNECT made.
- NO ACCESS (red): the context is there but the cluster refuses the viewer role (no access entry yet, or you may not assume `<cluster>-viewer`). RUN the EKS card again for that cluster, then CHECK AGAIN.

CONNECT runs on this Mac, in the cluster's run pane (log and ERROR plate as in §20):

1. backs up `~/.kube/config` to `~/.kube/config.cloudspider.bak`;
2. `aws eks update-kubeconfig --region eu-north-1 --name <cluster> --alias <cluster>-viewer --user-alias <cluster>-viewer --role-arn <viewerRoleArn from the stack>` with the server's AWS_PROFILE. It writes only the kubeconfig, nothing in AWS; other contexts are untouched;
3. `kubectl config use-context <the one you had>` (update-kubeconfig switches it; this puts it back);
4. adds `<cluster>-viewer` to `cloudspider.contexts.yaml` (made from the example if it is missing; your entries and comments stay);
5. reloads the contexts without a restart, and does one GET to check the viewer can read.

A context that already points at the cluster (for example `cloudspider-viewer` for `cloudspider-up`) counts as CONNECTED and nothing is rewritten. CONNECT never overwrites a context of the same name that is something else. If a context named `<cluster>-viewer` already exists and talks to the same API server (the same cluster, but another user or role), the lamp says FOUND and offers USE IT. That runs one GET with it and lists it in Cloud Spider if it can read; the kubeconfig is not touched, and if it can't read, it is taken out of the list again. If it points at another server, only renaming it helps (the hint gives the command).

In the Cluster view the EKS panel folds into a chip right of TOPOLOGY / TELEMETRY / OPS: `EKS 1/2` with a lamp for the worst state (green all connected, amber needs a press, red an error). Click the chip, the panel header or FOLD (or press Esc) to fold or open it; the choice is remembered in this browser. With nothing remembered it opens only when a cluster needs attention. The CONNECT / USE IT log inside it folds by itself once it is DONE (click its bar to see it). DISCONNECT removes only `<cluster>-viewer` (its context, its user if nothing else uses it, and its yaml line), after a backup. After a RUN that made a cluster, the pane offers CONNECT NOW. If you start the server with `CLOUDSPIDER_KUBE_CONTEXTS` set, that list wins over the file and the run says so.


## 22. ADD-ONS on the EKS card: pick, see the cost and the pod slots, install in one go

Under the EKS card's run pane (for the cluster named in its fields) is the ADD-ONS checklist: Pod Identity agent, metrics-server, Karpenter, AWS Load Balancer Controller, cert-manager, Kyverno, KEDA and the HPA scaling demo, in the order they install. Each row shows its own cost ("free", "+ use" for SQS-billed ones, "+ nodes" for Karpenter, which launches nodes at about $0.02/h each), how many pods it runs, and INSTALLED / PRESENT (put there by another stack or by hand, e.g. the demo's metrics-server) for the ones already on the cluster. Those cannot be ticked and are skipped.

- The line under the list counts: "needs N free pod slots, you have M" from the cluster's nodes (the #71 check). The numbers need the cluster to be CONNECTED (§21). When N > M, INSTALL SELECTED refuses before anything runs. Add a node (§16, "Room for pods") or untick something.
- Ticking an add-on whose need is missing (Karpenter, LBC or KEDA without the Pod Identity agent) adds the need, and the confirm says so.
- INSTALL SELECTED asks once, listing each stack it will create (`<addon>-<cluster>`), the pods and the hourly cost. It then runs one job in the EKS card's pane: for each add-on, `pulumi preview`, then `pulumi up`, one after the other. It stops at the first failure with the ERROR plate (what failed, why, BY HAND). The add-ons before it stay installed; press it again after fixing, and they are skipped.
- **with add-ons**: tick it before RUN on a new cluster. When the cluster run is DONE, CONNECT runs, then INSTALL SELECTED for the ticked add-ons. The card shows `QUEUED · …` while it waits. If any stage fails, the queue stops there and says why.
