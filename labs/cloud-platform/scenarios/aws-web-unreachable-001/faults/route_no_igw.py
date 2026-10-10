ID = "route-no-igw"
DESTINATION = "0.0.0.0/0"


def _ec2(env):
    return env.session.client("ec2", region_name=env.region)


def inject(env):
    _ec2(env).delete_route(RouteTableId=env.outputs["route_table_id"], DestinationCidrBlock=DESTINATION)


def revert(env):
    _ec2(env).create_route(
        RouteTableId=env.outputs["route_table_id"],
        DestinationCidrBlock=DESTINATION,
        GatewayId=env.baseline.get("igw_id", env.outputs["igw_id"]),
    )
