from labctl.checks import Check


def baseline(env):
    return {"instances": ["i-1"]}


def checks(env):
    world = env.session.world
    broken = bool(world["broken"]) and not world.get("fault_is_noop", False)
    healthy = world["baseline_ok"] and not broken
    return [
        Check("endpoint-ok", "outcome", healthy, "fake endpoint"),
        Check("guard-ok", "guard", world["guards_ok"]),
    ]
