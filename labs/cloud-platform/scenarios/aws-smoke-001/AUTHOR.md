# aws-smoke-001 author notes

## rule-removed

The single ingress rule (TCP 8080 from 10.0.0.0/8) is revoked. Fix:
`aws ec2 authorize-security-group-ingress --group-id <sg_id> --protocol tcp --port 8080 --cidr 10.0.0.0/8`.
