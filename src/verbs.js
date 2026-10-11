import { isInstanceId } from "./ids.js";
import { report } from "./report.js";

const REQUIRED = { stop: "running", start: "stopped" };
const CALL = { stop: "StopInstances", start: "StartInstances" };

export function isExpendable(instance) {
  // Instances carry [{key, value}]; camp fixtures a plain {key: value} map.
  const tags = instance?.tags;
  if (tags && !Array.isArray(tags)) return tags.cloudspider === "expendable";
  return (tags || []).some(
    (tag) => tag.key === "cloudspider" && tag.value === "expendable",
  );
}

export async function attemptVerb({ ec2, lines, region, id, verb }) {
  const call = CALL[verb];
  const refuse = `the ${verb} did not happen`;
  if (!isInstanceId(id)) {
    const sentence = report(lines, {
      call,
      id,
      sentence: "it is not an instance id",
    });
    return { sentence, wait: false };
  }

  const described = await ec2.describeInstance(region, id);
  if (!described || described.error) {
    const sentence = report(lines, {
      call,
      id,
      sentence: refuse,
      detail: described?.error ? { message: described.error } : undefined,
    });
    return { sentence, wait: false };
  }

  if (!isExpendable(described) || described.state !== REQUIRED[verb]) {
    const sentence = report(lines, { call, id, sentence: refuse });
    return { sentence, wait: false, state: described.state };
  }

  const dry =
    verb === "stop"
      ? await ec2.stopInstances(region, id, true)
      : await ec2.startInstances(region, id, true);
  if (!dry?.dryRunPass) {
    const sentence = report(lines, {
      call,
      id,
      sentence: refuse,
      detail: { message: dry?.error || "dry run was not refused" },
    });
    return { sentence, wait: false, state: described.state };
  }

  const real =
    verb === "stop"
      ? await ec2.stopInstances(region, id, false)
      : await ec2.startInstances(region, id, false);
  if (real?.error) {
    const sentence = report(lines, {
      call,
      id,
      sentence: refuse,
      detail: { message: real.error },
    });
    return { sentence, wait: false, state: described.state };
  }

  return { sentence: "", wait: true, state: described.state };
}
