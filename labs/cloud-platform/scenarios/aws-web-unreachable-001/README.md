# aws-web-unreachable-001: the health endpoint stopped responding

The health endpoint at the printed `endpoint` URL stopped responding. Nobody changed the application.

You get the endpoint URL, the instance ID, and a solver shell (`lab shell`) or console (`lab console`) with
read access to EC2, limited permission to change things in this lab's network, and permission to reboot the
instance.

Restore service without creating new infrastructure and without opening the instance to the world. Any inbound
security group rule from `0.0.0.0/0` or `::/0`, on any port, counts as opening it to the world.
Time box: 60 minutes. Done when `lab validate` passes.
