// A fake AWS client factory for scanner collectors: handlers keyed by the
// SDK command class name, per region. Records every call.
export function fakeAws(handlers, calls = []) {
  const client = (service, region) => ({
    async send(command) {
      const name = command.constructor.name;
      calls.push({ service, region, name, input: command.input });
      const handler = handlers[name];
      if (!handler) throw Object.assign(new Error(`no fake for ${name}`), { name: "NotImplemented" });
      return handler(command.input, region);
    },
  });
  return {
    calls,
    clients: {
      ec2: (region) => client("ec2", region),
      elb: (region) => client("elb", region),
      eks: (region) => client("eks", region),
      rds: (region) => client("rds", region),
      trail: (region) => client("trail", region),
      cw: (region) => client("cw", region),
      logs: (region) => client("logs", region),
      iam: () => client("iam", "us-east-1"),
      r53: () => client("r53", "us-east-1"),
      cf: () => client("cf", "us-east-1"),
    },
  };
}

export const denied = () => {
  throw Object.assign(new Error("User is not authorized"), { name: "AccessDenied" });
};
