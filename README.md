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
Start from vaults/example.yaml:

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

A vault owns the machines, gates, buckets, functions, tables and secrets it selects. Tags or ids, either one counts; the first vault to claim a resource keeps it.
Owned pieces outside a VPC move from the camp into the vault. Machines in a VPC stay in their camp and the open vault draws a line to them.
The server runs the checks with a timeout and keeps each answer for a minute. The light is green when every check passes, amber when one is slow (over half its timeout, or 2s), and red when one fails.
Click a door to open the vault: its resources, the description, owner, type, check results, and VIEW, REPO, DOCS and TEST. OPEN ALL / CLOSE ALL is beside the VAULTS sign. Open doors are remembered in the browser.
A file that does not parse or pass the check shows as a damaged vault with each error. It never stops the page.
Sample shows three vaults: a landing page that passes, an API whose health check fails, and a damaged file.
