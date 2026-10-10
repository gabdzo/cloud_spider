// Stack-wide tags for the upgrade stacks, so Cloud Spider vaults can claim
// what each stack made (vaults/<project>.yaml selects `project: <name>`).
//
// Why a transformation and not the provider's defaultTags: these stacks are
// created and configured by the Stacks panel (`pulumi config set`), so there
// is no committed stack file to hold `aws:defaultTags`, and swapping the
// resources over to a new explicit provider could replace them. Instead every
// AWS resource whose type has a `tags` input gets these merged in (its own
// tags win), the way provider default tags work, so new resources inherit
// them with no code. Types without tags (attachments, policies) are skipped.
//
// Pure: the program passes its own @pulumi/pulumi in (this file sits outside
// each project's node_modules).
export function stackTags(project, extra = {}) {
  return { project, "managed-by": "pulumi", ...extra };
}

export function mergeTags(pulumi, base, own) {
  if (own === undefined || own === null) return { ...base };
  if (pulumi.Output.isInstance(own) || typeof own?.then === "function") {
    return pulumi.output(own).apply((value) => ({ ...base, ...(value || {}) }));
  }
  return { ...base, ...own };
}

export function inheritTags(pulumi, base) {
  pulumi.runtime.registerStackTransformation((args) => {
    if (!String(args.type).startsWith("aws:")) return undefined;
    if (!args.props || !("tags" in args.props)) return undefined;
    return { props: { ...args.props, tags: mergeTags(pulumi, base, args.props.tags) }, opts: args.opts };
  });
}
