npm install
AWS_PROFILE=default AWS_REGION=eu-north-1 CLOUDSPIDER_LOG_GROUP=/cloudspider/test npm start
open http://127.0.0.1:9241

Sample does not touch AWS. It draws three local shacks.
Only a shack tagged cloudspider=expendable can be stopped or started.
The radio lists the last 15 actions, newest first.
Path follows a request: load balancer, listener, rule, target group, target, node, EKS cluster.
It names the first broken or hanging edge. Paste a URL or host to follow one rule. Path only reads.
