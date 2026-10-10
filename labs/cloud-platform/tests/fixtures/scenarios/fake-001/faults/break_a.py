ID = "break-a"


def inject(env):
    env.session.world["broken"].add(ID)


def revert(env):
    env.session.world["broken"].discard(ID)
