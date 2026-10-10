A local page for one AWS account. Take it down is real only when the EKS card says the cluster is gone.

npm install
AWS_PROFILE=default AWS_REGION=eu-north-1 CLOUDSPIDER_LOG_GROUP=/cloudspider/test npm start
open http://127.0.0.1:9241

Sample does not touch AWS. It draws three local shacks.
Only a shack tagged cloudspider=expendable can be stopped or started.

The radio lists the last 15 actions, newest first.
Path follows a request: load balancer, listener, rule, target group, target, node, EKS cluster.
It names the first broken or hanging edge. Paste a URL or host to follow one rule. Path only reads.

Cost is the account bill for this month, not the region on screen. The map poll does not call it.

Cluster is a separate tab. It draws EKS in this region, or an OpenShift-shaped sample. Path and Cluster share one picture: nodes, edges, and a kind icon.


Vaults are your projects on the map, written as YAML files like a Backstage catalog-info.yaml.
Cloud Spider reads every *.yaml in ./vaults (set CLOUDSPIDER_VAULTS_DIR to use another folder) and picks up changes on the next refresh.
Templates live in vaults/templates/ (vaults/templates/example.yaml explains every field). They are never drawn; the TEMPLATES button by the VAULTS sign lists them, and COPY gives the command that makes a living vault from one. An old-style example.yaml or *.example.yaml in vaults/ still counts as a template. The doors are ordered by number.
A living vault can name its Pulumi stack with spec.stack: {dir: upgrades/camp, name: camp} (a trailing * matches several stacks, e.g. every cluster). The door then reads LIVE · <stack>, and the panel shows STACK.
In short:

    apiVersion: cloudspider/v1
    kind: Vault
    metadata:
      name: landing            # lowercase, digits, dashes; unique
      number: 101              # 0-999, the door plate reads VAULT 101
      title: Landing page      # optional
      description: The public landing page.
      owner: web-team
      tags: [web]              # optional
    spec:
      type: static-site        # static-site, service, api, cluster, worker, data or other
      resources:
        tags: {project: landing}             # every listed tag must match
        ids: [i-0abc..., arn:aws:s3:::site]  # instance ids, ARNs or names
      links: {view: https://..., repo: https://..., docs: https://..., dashboard: https://...}
      checks:
        http:
          - url: https://example.com/
            expect: 200        # default 200
            contains: Welcome  # optional
            timeout: 5000      # ms, default 5000, 100-30000

A vault owns the machines, gates, buckets, functions, tables and secrets it selects. Tags or ids, either one counts; the vault with the lowest number keeps a resource two of them claim.
Owned pieces outside a VPC move from the camp into the vault. Machines in a VPC stay in their camp and the open vault draws a line to them.
The server runs the checks with a timeout and keeps each answer for a minute. The light is green when every check passes, amber when one is slow (over half its timeout, or 2s), and red when one fails.
Click a door to open the vault: its resources, the description, owner, type, check results, and VIEW, REPO, DOCS and TEST. OPEN ALL / CLOSE ALL is beside the VAULTS sign. Open doors are remembered in the browser.
A file that does not parse or pass the check shows as a damaged vault with each error. It never stops the page.
Sample shows three vaults: a landing page that passes, an API whose health check fails, and a damaged file.

To add a vault:

1. Run npm run vaults:new -- <template> <name> (for example npm run vaults:new -- service shop-api). It writes vaults/<name>.yaml with the name, a free number and project=<name> filled in, and never overwrites a file.
2. Tag the project's resources project=<name>. In Pulumi, put it on the stack, not on each resource (below).
3. Run npm run vaults:check. It validates every file in vaults/ (templates too) and fails on a reused number, or on a project tag that is not the vault's name.
4. Refresh the page.

The tag convention is one tag, project=<vault name>, on every taggable resource. Each vault selects spec.resources.tags: {project: <name>}. One stack is one living vault: a vault with spec.stack also owns every resource in that stack's state (read with pulumi stack export, cached 60 s, no AWS call), so it finds them even before the tags land. VPCs and subnets count as resources too.
A link or a check URL can be {output: <name>}, read from the stack's outputs (camp's VIEW and check use {output: pageUrl}). Until the stack exports it, the link is left off and the panel lists it under WAITING.
The Pulumi stacks set the tag stack-wide, so new resources inherit it:

- infra/ (stack test): aws:defaultTags in Pulumi.test.yaml puts project=cloudspider and managed-by=pulumi on everything. The parts carry a component tag instead of their own vault: component=alb-test (the load balancer, its group, target groups, listener and rules), component=test-machines (the two expendable machines) and component=test-logs (/cloudspider/test).
- upgrades/eks, signal, barrel, camp: upgrades/tags.js adds project=<eks|signal|barrel|camp> and managed-by=pulumi to every AWS resource that has tags. EKS also gets cluster=<cluster name>. It is a stack transformation, not provider defaultTags, because the Stacks panel makes these stack files itself and camp uses its own provider.

Vaults for this repo:

| file | number | covers |
| --- | --- | --- |
| cloudspider.yaml | 100 | infra/ stack test: the test VPC and subnets, the internal ALB cloudspider-api (the PR #6 broken path), the expendable nanos, the untagged nano, /cloudspider/test |
| eks.yaml | 110 | upgrades/eks, every stack: each EKS cluster with its VPC, roles and node group |
| camp.yaml | 140 | upgrades/camp stack camp: page bucket, function, function URL, table, secret, role. VIEW and an HTTP check on the pageUrl output |
| templates/signal.yaml, templates/barrel.yaml | 120, 130 | upgrades/signal and upgrades/barrel, templates until their stacks are up |

The state bucket (infra/bootstrap.sh) has no vault; it is not a stack.

Existing stacks get the tags on their next pulumi up. The change is tags only: preview shows ~ update on tags and nothing replaced. Use the passphrase the Stacks panel uses (empty unless you set PULUMI_CONFIG_PASSPHRASE):

    cd infra && npm ci && pulumi preview --stack test --diff && pulumi up --stack test
    cd upgrades/eks && npm ci && pulumi preview --stack upgrade --diff && pulumi up --stack upgrade
    cd upgrades/signal && npm ci && pulumi preview --stack signal --diff && pulumi up --stack signal
    cd upgrades/barrel && npm ci && pulumi preview --stack barrel --diff && pulumi up --stack barrel
    cd upgrades/camp && npm ci && pulumi preview --stack camp --diff && pulumi up --stack camp

Skip a stack that is not up. Running Up again from the Stacks panel does the same. The state bucket is not in Pulumi, so tag it once (infra/bootstrap.sh does this from now on):

    aws resourcegroupstaggingapi tag-resources --region eu-north-1 --resource-arn-list arn:aws:s3:::cloudspider-state-550536272523 --tags project=pulumi-state,managed-by=bootstrap

Load balancer tags are read with elasticloadbalancing:DescribeTags. Without that permission, ALBs match by name only.

EKS clusters, one stack each:

Every cluster has its own Pulumi stack in upgrades/eks, so its own state file, lock and Pulumi.<stack>.yaml. The first cluster, cloudspider-up, stays in the stack upgrade. Nothing moves and nothing is replaced. Any other name gets the stack eks-<name>. Its IAM roles and node group are named <name>-cluster, <name>-node and <name>-nodes, and every resource is tagged cluster=<name>. The program refuses to run a stack for a different cluster name. Before this, every name went to the stack upgrade, so a "new" cluster rewrote the old cluster's config and tried to rename it in place.

To make a second cluster in the Stacks panel: open EKS, type a new clusterName (for example cloudspider-two) and press Up. The card shows the stack it uses (stack eks-cloudspider-two). When Pulumi fails, the card shows Pulumi's own error lines, not just the exit code. Down needs the same name.

The same from a shell, from the repo root:

    cd upgrades/eks && npm ci
    pulumi stack select eks-cloudspider-two --create
    pulumi config set --stack eks-cloudspider-two aws:region eu-north-1
    pulumi config set --stack eks-cloudspider-two --path 'aws:allowedAccountIds[0]' 550536272523
    pulumi config set --stack eks-cloudspider-two cloudspider-upgrade:clusterName cloudspider-two
    pulumi up --stack eks-cloudspider-two

Pass --stack every time. stack select changes the stack a bare pulumi up uses in that folder. Pulumi.eks-*.yaml files stay local (they are in .gitignore).

At most two clusters can be up at once. Set CLOUDSPIDER_MAX_CLUSTERS to change that. The account's on-demand limit is 5 vCPU. Each cluster's t4g.small node uses 2, and so does the running test nano. Stop the nano or ask AWS for a higher limit before you bring up a second cluster.

If an earlier try at a second cluster changed upgrades/eks/Pulumi.upgrade.yaml, put the first cluster's name back before you press Up on it again:

    cd upgrades/eks && pulumi config set --stack upgrade cloudspider-upgrade:clusterName cloudspider-up

Running git checkout upgrades/eks/Pulumi.upgrade.yaml does the same. Then run pulumi preview --stack upgrade --diff. It should show nothing to replace.

TERMINAL (ASK): your local Cursor agent:

The ASK tab opens a RobCo-style terminal that sends one question about what is on screen to the Cursor CLI on your own machine. It runs only when you press ASK, press Enter in its prompt, or click a quick-question chip. Nothing asks on page load, on refresh or on a timer. The ASK buttons on a vault panel, and ASK ABOUT THIS for a selected building or a path, only fill the prompt.

Setup, once:

    curl https://cursor.com/install -fsS | bash
    agent login

Cloud Spider runs `agent` from PATH (it also looks in ~/.local/bin). To use another command, start it with CLOUDSPIDER_AGENT_CMD, for example CLOUDSPIDER_AGENT_CMD=cursor-agent npm start. Extra words after the command are passed first. CLOUDSPIDER_AGENT_MODEL=<model> adds --model. If the CLI is missing or not logged in, the terminal says so and shows the fix.

Each question runs:

    agent --print --output-format stream-json --stream-partial-output --mode ask --trust --workspace <repo> "<instructions + snapshot + question>"

with the repo as its working directory (flags from cursor.com/docs/cli/reference/parameters and .../output-format). The snapshot is a compact JSON of the map: VPCs, instances, fixtures, the camp, vault lights and checks, the last 15 radio rows, the region, the mode, the selection and the path diagnosis. It is capped at 16,000 characters.

Safety:
- --mode ask is the CLI's read-only Q&A mode. Cloud Spider never passes --force or --yolo, and the instructions tell the agent not to edit files, run commands or call AWS.
- The agent never acts. It can propose actions in a fenced cloudspider block (stop <id>, start <id>, up <stack>). Each one becomes a button that leads into Cloud Spider's usual flow: the Y/N line for an expendable instance, or the Stacks card where you press run. Any other command shows in a block with COPY, for you to run yourself.
- One question at a time. CANCEL, a closed tab or a 3-minute timeout kills the CLI's process group.
- POST /api/agent and /api/agent/cancel refuse other origins, like the stop/start and Stacks endpoints.
- In SAMPLE mode the answer is canned and no CLI runs.
