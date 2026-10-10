import pulumi
import pulumi_aws as aws

from labctl.aws.infra import LabConfig, run_tagged_statement, solver_role

lab = LabConfig.load()
ec2_arn = f"arn:aws:ec2:{lab.region}:{lab.account_id}"
operator_cidr = f"{lab.operator_ip}/32"

SERVER = f"""\
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


class Handler(BaseHTTPRequestHandler):
    timeout = 10

    def do_GET(self):
        ok = self.path == "/health"
        body = b"ok {lab.nonce}\\n" if ok else b"not found\\n"
        self.send_response(200 if ok else 404)
        self.send_header("Content-Type", "text/plain")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


ThreadingHTTPServer(("0.0.0.0", 80), Handler).serve_forever()
"""

USER_DATA = f"""#!/bin/bash
mkdir -p /opt/web
date -u -d "+{lab.self_terminate_minutes} minutes" +%s > /opt/web/deadline
cat > /opt/web/selfterm.sh <<'EOF'
#!/bin/bash
left=$(( ($(cat /opt/web/deadline) - $(date +%s) + 59) / 60 ))
if [ "$left" -le 0 ]; then exec shutdown -h now; fi
exec shutdown -h +"$left"
EOF
chmod +x /opt/web/selfterm.sh
cat > /etc/systemd/system/selfterm.service <<'EOF'
[Unit]
Description=self-terminate at the lab deadline

[Service]
Type=oneshot
ExecStart=/opt/web/selfterm.sh

[Install]
WantedBy=multi-user.target
EOF
cat > /opt/web/server.py <<'EOF'
{SERVER}EOF
cat > /etc/systemd/system/web.service <<'EOF'
[Unit]
Description=web
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/web/server.py
Restart=always

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now selfterm.service
systemctl enable --now web.service
"""

vpc = aws.ec2.Vpc("vpc", cidr_block="10.20.0.0/16", enable_dns_support=True, enable_dns_hostnames=True)
igw = aws.ec2.InternetGateway("igw", vpc_id=vpc.id)
subnet = aws.ec2.Subnet(
    "public",
    vpc_id=vpc.id,
    cidr_block="10.20.1.0/24",
    availability_zone=f"{lab.region}a",
    map_public_ip_on_launch=True,
)

rtb = aws.ec2.RouteTable("public", vpc_id=vpc.id)
aws.ec2.Route("default", route_table_id=rtb.id, destination_cidr_block="0.0.0.0/0", gateway_id=igw.id)
aws.ec2.RouteTableAssociation("public", subnet_id=subnet.id, route_table_id=rtb.id)

nacl = aws.ec2.NetworkAcl("public", vpc_id=vpc.id)
for name, number, egress, protocol, cidr, from_port, to_port in [
    ("in-http", 100, False, "tcp", operator_cidr, 80, 80),
    ("in-ephemeral", 110, False, "tcp", "0.0.0.0/0", 1024, 65535),
    ("out-all", 100, True, "-1", "0.0.0.0/0", 0, 0),
]:
    aws.ec2.NetworkAclRule(
        name,
        network_acl_id=nacl.id,
        rule_number=number,
        egress=egress,
        protocol=protocol,
        rule_action="allow",
        cidr_block=cidr,
        from_port=from_port,
        to_port=to_port,
    )
aws.ec2.NetworkAclAssociation("public", network_acl_id=nacl.id, subnet_id=subnet.id)

sg = aws.ec2.SecurityGroup("web", vpc_id=vpc.id, description="web server")
aws.vpc.SecurityGroupIngressRule(
    "web-http", security_group_id=sg.id, ip_protocol="tcp", from_port=80, to_port=80, cidr_ipv4=operator_cidr,
)
aws.vpc.SecurityGroupEgressRule("web-out", security_group_id=sg.id, ip_protocol="-1", cidr_ipv4="0.0.0.0/0")

ami = aws.ssm.get_parameter(name="/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64")
instance = aws.ec2.Instance(
    "web",
    ami=ami.value,
    instance_type="t4g.micro",
    subnet_id=subnet.id,
    vpc_security_group_ids=[sg.id],
    associate_public_ip_address=True,
    instance_initiated_shutdown_behavior="terminate",
    credit_specification=aws.ec2.InstanceCreditSpecificationArgs(cpu_credits="standard"),
    metadata_options=aws.ec2.InstanceMetadataOptionsArgs(http_tokens="required", http_endpoint="enabled"),
    user_data=USER_DATA,
    user_data_replace_on_change=True,
)

sg_actions = [
    "ec2:AuthorizeSecurityGroupIngress", "ec2:RevokeSecurityGroupIngress",
    "ec2:AuthorizeSecurityGroupEgress", "ec2:RevokeSecurityGroupEgress",
    "ec2:ModifySecurityGroupRules", "ec2:UpdateSecurityGroupRuleDescriptionsIngress",
    "ec2:UpdateSecurityGroupRuleDescriptionsEgress",
]
route_actions = ["ec2:CreateRoute", "ec2:ReplaceRoute", "ec2:DeleteRoute"]
nacl_actions = ["ec2:CreateNetworkAclEntry", "ec2:ReplaceNetworkAclEntry", "ec2:DeleteNetworkAclEntry"]

role = solver_role(lab, [
    {"Effect": "Allow", "Action": ["ec2:Describe*", "ec2:GetConsoleOutput"], "Resource": "*"},
    run_tagged_statement(sg_actions, [f"{ec2_arn}:security-group/*"], lab.run_id),
    # A new rule has no tags yet, so the rule resource cannot carry the run-tag condition.
    {"Effect": "Allow", "Action": sg_actions, "Resource": [f"{ec2_arn}:security-group-rule/*"]},
    run_tagged_statement(
        route_actions, [f"{ec2_arn}:route-table/*", f"{ec2_arn}:internet-gateway/*"], lab.run_id,
    ),
    run_tagged_statement(nacl_actions, [f"{ec2_arn}:network-acl/*"], lab.run_id),
    run_tagged_statement(["ec2:RebootInstances"], [f"{ec2_arn}:instance/*"], lab.run_id),
])

pulumi.export("endpoint", instance.public_ip.apply(lambda ip: f"http://{ip}/health"))
pulumi.export("instance_id", instance.id)
pulumi.export("vpc_id", vpc.id)
pulumi.export("subnet_id", subnet.id)
pulumi.export("igw_id", igw.id)
pulumi.export("route_table_id", rtb.id)
pulumi.export("nacl_id", nacl.id)
pulumi.export("sg_id", sg.id)
pulumi.export("solver_role_arn", role.arn)
