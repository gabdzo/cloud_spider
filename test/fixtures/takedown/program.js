// A stand-in Pulumi program for the TAKE DOWN CLUSTER end-to-end test
// (test/cluster-takedown-e2e.test.js). Its resources are dynamic-provider
// objects in a fake cluster (a JSON file, FAKE_CLUSTER): no cloud, no kube.
// A delete is refused like the real thing: by a Kyverno webhook with no pod
// behind it, and by a finalizer no controller removes (0 nodes).
// The program throws when config `bad` is set, like the real guards
// (maxPods 50 on a t4g.small, "the EKS stack installs these now", free pod
// slots): pulumi destroy must never run it.
const pulumi = require("@pulumi/pulumi");

const provider = {
  async create(inputs) {
    const fs = require("fs");
    const file = process.env.FAKE_CLUSTER;
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    s.objects[inputs.key] = true;
    if (inputs.webhook) s.webhooks.push(inputs.webhook);
    if (inputs.finalizer) s.finalizers[inputs.key] = inputs.finalizer;
    fs.writeFileSync(file, JSON.stringify(s, null, 2));
    return { id: inputs.key, outs: inputs };
  },
  async delete(id, props) {
    const fs = require("fs");
    const file = process.env.FAKE_CLUSTER;
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    const save = () => fs.writeFileSync(file, JSON.stringify(s, null, 2));
    if (props.kube && s.webhooks.length && !s.kyvernoRunning) {
      throw new Error(`admission webhook "validate.kyverno.svc-fail" denied the request: failed calling webhook: no endpoints available for service "kyverno-svc" (deleting ${props.key})`);
    }
    if (s.finalizers[props.key] && !s.nodes) {
      throw new Error(`timed out waiting for ${props.key} to be deleted: finalizer ${s.finalizers[props.key]} and no controller running (0 nodes)`);
    }
    if (s.failOnce === props.key) {
      s.failOnce = null;
      save();
      throw new Error(`the API server timed out deleting ${props.key}`);
    }
    // A controller (nodes > 0) cleans up what it made in AWS.
    if (s.finalizers[props.key]) delete s.finalizers[props.key];
    delete s.objects[props.key];
    if (props.webhook) s.webhooks = s.webhooks.filter((w) => w !== props.webhook);
    save();
  },
};

class Thing extends pulumi.dynamic.Resource {
  constructor(name, props, opts) {
    super(provider, name, props, opts);
  }
}

const config = new pulumi.Config();
if (config.get("bad")) throw new Error(config.get("bad"));
const stack = pulumi.getStack();
const things = JSON.parse(config.require("things"));
for (const t of things) new Thing(t.key.replace(/[^a-z0-9-]/gi, "-"), { kube: true, ...t, key: `${stack}:${t.key}` }, t.protect ? { protect: true } : {});
module.exports = { name: config.get("clusterName") || "cloudspider-up" };
