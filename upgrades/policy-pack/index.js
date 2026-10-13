// Pulumi CrossGuard pack: pulumi preview --policy-pack upgrades/policy-pack
// (npm ci here first; scripts/stack-deps.mjs does it for the tests).
import { PolicyPack } from "@pulumi/policy";
import { RULES } from "./rules.js";

new PolicyPack("cloudspider", {
  policies: RULES.map((rule) => ({
    name: rule.name,
    description: rule.description,
    enforcementLevel: rule.enforcementLevel,
    validateResource: (args, report) => {
      for (const message of rule.check(args.type, args.props || {})) report(message);
    },
  })),
});
