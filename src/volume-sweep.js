// After pgcluster's TAKE IT DOWN: the run is not done until its EBS volumes
// are gone (drill 2026-10-11: the 5 GB volume outlived the cluster). The
// stack removes the database, its claim and then the EBS CSI driver itself,
// so a PV the driver had not deleted yet (here: just force-detached from a
// dead node) is left `available` with nobody to delete it.
//
// The step waits while a volume is still attached or being deleted, gives
// the driver a grace period, then deletes what is left, but only volumes
// that carry every one of the stack's tags (project, cluster, cloudspider)
// AND the CSI driver's own tag, and only in state `available`. Then it waits
// until they are gone. Anything else stops the run with a hint.
//
// In TAKE DOWN CLUSTER (cluster-takedown.js) the run passes deferInUse: a
// volume still `in-use` after inUseMs is attached to a node (a CNPG pod or
// its PV held it; live run 2026-10-13: vol-007425c832df349ee stayed in-use
// until the nodes went). It goes with the nodes when the EKS stack deletes
// them, so the step warns and hands its id on to the re-check after the
// cluster is gone instead of failing the run.
export const SWEEP = { graceMs: 90_000, inUseMs: 3 * 60_000, timeoutMs: 10 * 60_000, everyMs: 10_000 };

export function sweepFilters(project, clusterName) {
  return [
    { Name: "tag:project", Values: [project] },
    { Name: "tag:cluster", Values: [clusterName] },
    { Name: "tag:cloudspider", Values: ["expendable"] },
  ];
}

// Made by the EBS CSI driver for a PersistentVolumeClaim (not a root disk,
// not something made by hand that happens to carry the tags).
export function csiMade(volume) {
  const tags = volume?.tags || {};
  return tags["ebs.csi.aws.com/cluster"] === "true" || Boolean(tags["kubernetes.io/created-for/pvc/name"]);
}

export function volumeSweepStep({ volumes, project, clusterName, region = "eu-north-1", clock = Date.now, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), limits = SWEEP }) {
  const filters = sweepFilters(project, clusterName);
  return {
    text: `wait until ${project}'s EBS volumes on ${clusterName} are gone (tags project=${project}, cluster=${clusterName})`,
    fn: async ({ say = () => {}, deferInUse = null } = {}) => {
      const started = clock();
      const deleted = new Set();
      for (;;) {
        const got = await volumes.list(region, filters);
        if (got?.error) return { error: `DescribeVolumes: ${got.error}`, hint: `Check by hand: aws ec2 describe-volumes --region ${region} --filters Name=tag:project,Values=${project} Name=tag:cluster,Values=${clusterName}` };
        const left = (got.items || []).filter((v) => v.state !== "deleted");
        if (!left.length) return { lines: [deleted.size ? `${deleted.size} leftover volume${deleted.size === 1 ? "" : "s"} deleted; no ${project} volume left` : `no ${project} volume left`] };
        const waited = clock() - started;
        const inUse = left.filter((v) => v.state === "in-use");
        if (deferInUse && inUse.length === left.length && waited >= (limits.inUseMs ?? limits.graceMs)) {
          deferInUse(inUse.map((v) => v.id));
          return { lines: [`! ${inUse.map((v) => v.id).join(", ")} still in-use after ${Math.round(waited / 1000)} s: attached to a node, so it goes with the nodes when the EKS stack deletes them (not a failure; re-checked once the cluster is gone)`] };
        }
        if (waited >= limits.timeoutMs) {
          if (deferInUse && inUse.length) deferInUse(inUse.map((v) => v.id));
          const rest = deferInUse ? left.filter((v) => v.state !== "in-use") : left;
          if (deferInUse && !rest.length) return { lines: [`! ${inUse.map((v) => v.id).join(", ")} still in-use: goes with the nodes; re-checked once the cluster is gone`] };
          const list = rest.map((v) => `${v.id} (${v.state})`).join(", ");
          return { error: `${project} volumes still there after ${Math.round(waited / 60_000)} min: ${list}`, hint: `An in-use volume is still attached to a node: wait for it to detach, then aws ec2 delete-volume --region ${region} --volume-id <id>. Take the cluster down only after this is clean.` };
        }
        for (const v of left) {
          if (v.state !== "available" || deleted.has(v.id) || waited < limits.graceMs) continue;
          if (!csiMade(v)) {
            say(`${v.id} is available but was not made by the EBS CSI driver: left alone`);
            continue;
          }
          const out = await volumes.remove(region, v.id);
          if (out?.error && !/NotFound/i.test(out.error)) return { error: `DeleteVolume ${v.id}: ${out.error}`, hint: `Delete it by hand: aws ec2 delete-volume --region ${region} --volume-id ${v.id}` };
          deleted.add(v.id);
          say(`deleted leftover volume ${v.id} (${v.size || "?"} GiB, ${v.tags?.["kubernetes.io/created-for/pvc/name"] || "pvc"}): the CSI driver went before it`);
        }
        const foreign = left.filter((v) => v.state === "available" && !csiMade(v));
        if (foreign.length === left.length) return { lines: [`${foreign.length} tagged volume${foreign.length === 1 ? "" : "s"} not made by the CSI driver left alone: ${foreign.map((v) => v.id).join(", ")}`] };
        say(`waiting: ${left.map((v) => `${v.id} ${v.state}`).join(", ")}`);
        await sleep(limits.everyMs);
      }
    },
  };
}
