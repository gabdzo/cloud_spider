// CloudTrail trails seen from the home region: multi-region, logging,
// management events (cloudtrail:DescribeTrails, GetTrailStatus,
// GetEventSelectors). Shadow copies of one trail are read once.
import { DescribeTrailsCommand, GetEventSelectorsCommand, GetTrailStatusCommand } from "@aws-sdk/client-cloudtrail";
import { awsFailure, evidence } from "../evidence.js";

export const awsCloudtrail = {
  key: "aws-cloudtrail",
  target: "aws",
  reads: ["cloudtrail:DescribeTrails", "cloudtrail:GetTrailStatus", "cloudtrail:GetEventSelectors"],
  async collect({ regions, clients }) {
    const home = regions[0];
    const trail = clients.trail(home);
    const fail = (failure, read) => {
      const f = awsFailure(failure);
      return evidence({ key: "aws-cloudtrail", collector: "aws-cloudtrail", read, target: "aws", status: f.status, fields: { trails: [] }, error: f.error });
    };
    let list;
    try {
      list = (await trail.send(new DescribeTrailsCommand({ includeShadowTrails: true }))).trailList || [];
    } catch (failure) {
      return fail(failure, "cloudtrail:DescribeTrails");
    }
    const trails = [];
    for (const t of list) {
      try {
        const status = await trail.send(new GetTrailStatusCommand({ Name: t.TrailARN }));
        const sel = await trail.send(new GetEventSelectorsCommand({ TrailName: t.TrailARN }));
        const management = (sel.EventSelectors || []).some((s) => s.IncludeManagementEvents && s.ReadWriteType === "All") || (sel.AdvancedEventSelectors || []).some((s) => (s.FieldSelectors || []).some((f) => f.Field === "eventCategory" && (f.Equals || []).includes("Management")));
        trails.push({ name: t.Name || "", arn: t.TrailARN || "", multiRegion: t.IsMultiRegionTrail === true, logging: status.IsLogging === true, management });
      } catch (failure) {
        return fail(failure, "cloudtrail:GetTrailStatus");
      }
    }
    return evidence({ key: "aws-cloudtrail", collector: "aws-cloudtrail", read: "cloudtrail:DescribeTrails", target: "aws", status: "ok", fields: { trails }, error: null });
  },
};
