// RDS instances in every scanned region: public flag, Multi-AZ, storage
// encryption, backup retention, security groups (rds:DescribeDBInstances).
import { DescribeDBInstancesCommand } from "@aws-sdk/client-rds";
import { evidence, pageAll, worst } from "../evidence.js";

export const awsRds = {
  key: "aws-rds",
  target: "aws",
  reads: ["rds:DescribeDBInstances"],
  async collect({ regions, clients }) {
    const instances = [];
    const statuses = [];
    let error = null;
    for (const region of regions) {
      const rds = clients.rds(region);
      const got = await pageAll(async (Marker) => {
        const out = await rds.send(new DescribeDBInstancesCommand({ Marker }));
        return { items: out.DBInstances || [], next: out.Marker };
      });
      statuses.push(got.status);
      error ||= got.error || null;
      for (const db of got.items) {
        instances.push({
          id: db.DBInstanceIdentifier || "", region, engine: db.Engine || "",
          public: db.PubliclyAccessible === true, multiAz: db.MultiAZ === true, encrypted: db.StorageEncrypted === true,
          backupDays: db.BackupRetentionPeriod ?? 0, port: db.Endpoint?.Port ?? db.DbInstancePort ?? null,
          securityGroups: (db.VpcSecurityGroups || []).map((g) => g.VpcSecurityGroupId),
        });
      }
    }
    return evidence({ key: "aws-rds", collector: "aws-rds", read: "rds:DescribeDBInstances", target: "aws", status: worst(statuses), fields: { instances }, error });
  },
};
