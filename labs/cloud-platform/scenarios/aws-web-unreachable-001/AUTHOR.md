# aws-web-unreachable-001 author notes

## sg-no-http

The security group lost its inbound TCP 80 rule from the operator /32. Packets never reach the server.

Diagnosis path: endpoint times out (not refused) -> `describe-instances` shows the instance running, public IP
matches -> `get-console-output` shows the server started -> `describe-security-groups` on the instance's SG shows
no ingress for port 80. Fix: `aws ec2 authorize-security-group-ingress --group-id <sg> --protocol tcp --port 80
--cidr <your-ip>/32`. Opening 80 to `0.0.0.0/0` or `::/0` fails the `no-world-ingress` guard.

## route-no-igw

The subnet's route table lost its `0.0.0.0/0` route to the internet gateway. Inbound packets arrive through the IGW,
but replies have no route out, so the connection times out.

Diagnosis path: SG and NACL look correct -> `describe-route-tables` for the subnet shows only the `local` route ->
`describe-internet-gateways` shows the IGW still attached. Fix: `aws ec2 create-route --route-table-id <rtb>
--destination-cidr-block 0.0.0.0/0 --gateway-id <igw>`.

## nacl-no-ephemeral

The NACL's outbound allow-all was replaced with outbound TCP 80 and 443 only. Requests arrive, but the reply goes
to the client's ephemeral port, and NACLs are stateless, so the reply is dropped.

Diagnosis path: SG and routes look correct -> `describe-network-acls` for the subnet shows egress limited to ports
80/443 -> reason about stateless return traffic. Fix: restore outbound allow-all, or add an outbound rule allowing
TCP 1024-65535 to your IP (or `0.0.0.0/0`). Either passes validation.

## All faults

Rebooting the instance (allowed) fixes none of them; the self-terminate deadline survives a reboot.
